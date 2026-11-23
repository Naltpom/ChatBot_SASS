"""Client Instagram (API Instagram avec connexion Instagram, Meta) — côté serveur.

Utilisé par cm.chapote.fr. TOUS les appels Instagram passent par ici : le
navigateur ne voit ni la clé secrète de l'app ni les jetons.

Contrats Meta (https://developers.facebook.com/docs/instagram-platform/) :
- Autorisation : www.instagram.com/oauth/authorize (compte professionnel :
  Créateur ou Entreprise). Code (un « #_ » final peut être ajouté par Instagram)
  échangé sur api.instagram.com/oauth/access_token (jeton court, 1 h), puis
  graph.instagram.com/access_token?grant_type=ig_exchange_token (jeton long,
  60 jours), rafraîchi par /refresh_access_token?grant_type=ig_refresh_token
  (jeton d'au moins 24 h, encore valable).
- Publication d'un Reel : POST /{ig-user-id}/media (media_type=REELS, video_url
  PUBLIQUE que Meta télécharge), suivi du conteneur (status_code IN_PROGRESS ->
  FINISHED | ERROR | EXPIRED), puis POST /{ig-user-id}/media_publish.
  100 publications par 24 h et par compte.
- Erreurs : {"error": {message, type, code, error_subcode, fbtrace_id}} ;
  code 190 = jeton invalide (à reconnecter) ; 4, 17, 32, 613 = trop de requêtes.
- Désautorisation / suppression des données : `signed_request` signé
  HMAC-SHA256 avec la clé secrète de l'app.

Aucun jeton n'est jamais loggé.
"""
import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import IG_MODE_API, InstagramAccount
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

SCOPE_BASIC = "instagram_business_basic"
SCOPE_PUBLISH = "instagram_business_content_publish"
SCOPE_INSIGHTS = "instagram_business_manage_insights"
SCOPES = f"{SCOPE_BASIC},{SCOPE_PUBLISH},{SCOPE_INSIGHTS}"
# Boîte de réception : demandées seulement quand INSTAGRAM_EXTRA_SCOPES les liste (revue Meta à part).
SCOPE_COMMENTS = "instagram_business_manage_comments"
SCOPE_MESSAGES = "instagram_business_manage_messages"
EXTRA_KNOWN = (SCOPE_COMMENTS, SCOPE_MESSAGES)
COMMENT_FIELDS = ("id,text,username,from{id,username},timestamp,like_count,"
                  "replies{id,text,username,from{id,username},timestamp,like_count}")


def scopes() -> str:
    extra = [x.strip() for x in (settings.INSTAGRAM_EXTRA_SCOPES or "").split(",") if x.strip() in EXTRA_KNOWN]
    return ",".join([SCOPES] + extra)


def has_scope(account: InstagramAccount, scope: str) -> bool:
    return scope in [x.strip() for x in (account.scopes or "").split(",")]
PROFILE_FIELDS = "user_id,username,name,account_type,profile_picture_url,followers_count,media_count"
MEDIA_FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count"

# Reel : 3 s à 15 min, MP4 ou MOV, 300 Mo au plus (limites Meta).
MIN_DURATION_SEC = 3
MAX_DURATION_SEC = 900
MAX_VIDEO_SIZE = 300 * 1024 * 1024
ALLOWED_MIME = {"video/mp4", "video/quicktime"}
CAPTION_MAX = 2200

LONG_TOKEN_TTL = timedelta(days=60)
# Rafraîchi quand il expire dans moins de 10 jours.
REFRESH_AHEAD = timedelta(days=10)

_transport: Optional[httpx.AsyncBaseTransport] = None

ERROR_MESSAGES = {
    "invalid_token": "L'autorisation Instagram a expiré ou a été retirée : reconnectez le compte.",
    "rate_limited": "Trop de requêtes vers Instagram. Réessayez dans quelques minutes.",
    "not_professional": "Ce compte Instagram n'est pas un compte professionnel (Créateur ou Entreprise). Passez-le en compte professionnel dans l'app Instagram, puis reconnectez-le.",
    "publish_limit": "Ce compte a atteint la limite de 100 publications par 24 h.",
    "container_error": "Instagram n'a pas pu traiter la vidéo (format, durée ou dimensions refusés).",
    "container_expired": "Instagram a abandonné le traitement de la vidéo. Relancez la publication.",
    "container_timeout": "Instagram n'a pas fini de traiter la vidéo dans l'heure. Relancez la publication.",
    "scope_missing": "Chapote n'a pas reçu l'autorisation de publier sur ce compte : reconnectez-le en acceptant toutes les autorisations.",
    "access_denied": "Vous avez refusé l'accès : aucun compte n'a été connecté.",
}


class InstagramError(Exception):
    def __init__(self, code: str, message: str = "", http_status: int = 0, subcode: Optional[int] = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status
        self.subcode = subcode

    def describe(self) -> str:
        txt = ERROR_MESSAGES.get(self.code)
        if txt is None:
            txt = "Erreur Instagram"
            if self.message:
                txt += f" : {self.message}"
        return txt


class ReconnectRequired(Exception):
    """Le compte doit être reconnecté (jeton expiré, retiré ou illisible)."""


def is_enabled() -> bool:
    return bool(settings.INSTAGRAM_CLIENT_ID and settings.INSTAGRAM_CLIENT_SECRET)


def _client(**kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=kw.pop("timeout", 30), transport=_transport, **kw)


def _graph(path: str) -> str:
    return f"{settings.INSTAGRAM_GRAPH_BASE}/{settings.INSTAGRAM_API_VERSION}{path}"


def authorize_url(state: str) -> str:
    params = {
        "client_id": settings.INSTAGRAM_CLIENT_ID,
        "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
        "response_type": "code",
        "scope": scopes(),
        "state": state,
        # Toujours l'écran de connexion (pour connecter un 2e compte).
        "force_reauth": "true",
    }
    return f"{settings.INSTAGRAM_AUTHORIZE_URL}?{urlencode(params)}"


# --------------------------------------------------------------------------
# Appels HTTP
# --------------------------------------------------------------------------

def _json(resp: httpx.Response) -> dict:
    if not resp.content.strip():
        return {}
    try:
        body = resp.json()
    except ValueError:
        raise InstagramError("invalid_response", f"Réponse non JSON (HTTP {resp.status_code})", resp.status_code)
    return body if isinstance(body, dict) else {}


def _error(resp: httpx.Response, body: dict) -> InstagramError:
    err = body.get("error")
    if isinstance(err, dict):
        code = err.get("code")
        sub = err.get("error_subcode")
        msg = err.get("error_user_msg") or err.get("message") or ""
        if code == 190 or err.get("type") == "OAuthException" and resp.status_code == 401:
            name = "invalid_token"
        elif code in (4, 17, 32, 613):
            name = "rate_limited"
        elif code == 9 or sub == 2207042:
            name = "publish_limit"
        elif code == 10 or code == 200:
            name = "scope_missing"
        else:
            name = f"ig_{code}" if code else f"http_{resp.status_code}"
        return InstagramError(name, msg, resp.status_code, sub)
    if isinstance(err, str):     # format OAuth d'api.instagram.com
        return InstagramError(err if err in ERROR_MESSAGES else "oauth_error",
                              body.get("error_description") or body.get("error_message") or "", resp.status_code)
    if body.get("error_type"):   # {"error_type": "OAuthException", "code": 400, "error_message": "..."}
        return InstagramError("oauth_error", body.get("error_message") or "", resp.status_code)
    return InstagramError(f"http_{resp.status_code}", "", resp.status_code)


async def _request(method: str, url: str, *, token: Optional[str] = None, params: Optional[dict] = None,
                   data: Optional[dict] = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with _client() as c:
        resp = await c.request(method, url, params=params, data=data, headers=headers)
    body = _json(resp)
    if resp.status_code >= 400 or (isinstance(body.get("error"), (dict, str)) and body.get("error")) \
            or body.get("error_type"):
        raise _error(resp, body)
    return body


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

def clean_code(code: str) -> str:
    return code.split("#")[0].strip()


async def exchange_code(code: str) -> dict:
    """Code -> jeton court : {access_token, user_id, permissions}."""
    body = await _request("POST", f"{settings.INSTAGRAM_OAUTH_BASE}/oauth/access_token", data={
        "client_id": settings.INSTAGRAM_CLIENT_ID,
        "client_secret": settings.INSTAGRAM_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "redirect_uri": settings.INSTAGRAM_REDIRECT_URI,
        "code": clean_code(code),
    })
    if isinstance(body.get("data"), list) and body["data"]:   # ancien format
        body = body["data"][0]
    perms = body.get("permissions")
    if isinstance(perms, list):
        perms = ",".join(str(p) for p in perms)
    return {"access_token": body.get("access_token"), "user_id": str(body.get("user_id") or ""),
            "permissions": perms or ""}


async def long_lived_token(short_token: str) -> dict:
    """{access_token, expires_in} (60 jours)."""
    return await _request("GET", f"{settings.INSTAGRAM_GRAPH_BASE}/access_token", params={
        "grant_type": "ig_exchange_token",
        "client_secret": settings.INSTAGRAM_CLIENT_SECRET,
        "access_token": short_token,
    })


async def refresh_token(token: str) -> dict:
    return await _request("GET", f"{settings.INSTAGRAM_GRAPH_BASE}/refresh_access_token", params={
        "grant_type": "ig_refresh_token", "access_token": token,
    })


async def profile(token: str) -> dict:
    return await _request("GET", _graph("/me"), token=token, params={"fields": PROFILE_FIELDS})


# --------------------------------------------------------------------------
# Publication d'un Reel
# --------------------------------------------------------------------------

async def create_reel_container(token: str, ig_user_id: str, video_url: str, caption: str,
                                share_to_feed: bool = True, thumb_offset_ms: Optional[int] = None,
                                cover_url: Optional[str] = None, collaborators: Optional[list] = None) -> str:
    data = {"media_type": "REELS", "video_url": video_url, "caption": caption or "",
            "share_to_feed": "true" if share_to_feed else "false"}
    if collaborators:
        data["collaborators"] = json.dumps(list(collaborators)[:3])
    if cover_url:
        data["cover_url"] = cover_url              # image personnalisée (prioritaire sur thumb_offset)
    elif thumb_offset_ms is not None:
        data["thumb_offset"] = str(int(thumb_offset_ms))
    body = await _request("POST", _graph(f"/{ig_user_id}/media"), token=token, data=data)
    if not body.get("id"):
        raise InstagramError("invalid_response", "Identifiant de conteneur absent")
    return str(body["id"])


async def container_status(token: str, container_id: str) -> dict:
    """{status_code: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED, status}."""
    return await _request("GET", _graph(f"/{container_id}"), token=token,
                          params={"fields": "status_code,status"})


async def publish_container(token: str, ig_user_id: str, container_id: str) -> str:
    body = await _request("POST", _graph(f"/{ig_user_id}/media_publish"), token=token,
                          data={"creation_id": container_id})
    if not body.get("id"):
        raise InstagramError("invalid_response", "Identifiant de publication absent")
    return str(body["id"])


async def media_info(token: str, media_id: str) -> dict:
    return await _request("GET", _graph(f"/{media_id}"), token=token,
                          params={"fields": "id,permalink,timestamp"})


# --------------------------------------------------------------------------
# Statistiques
# --------------------------------------------------------------------------

async def recent_media(token: str, ig_user_id: str, limit: int = 50) -> list[dict]:
    body = await _request("GET", _graph(f"/{ig_user_id}/media"), token=token,
                          params={"fields": MEDIA_FIELDS, "limit": str(limit)})
    return [m for m in (body.get("data") or []) if isinstance(m, dict)]


async def all_media(token: str, ig_user_id: str, max_items: int = 500) -> list[dict]:
    """Toutes les publications du compte (pages de 100), jusqu'à `max_items`."""
    out: list[dict] = []
    params = {"fields": MEDIA_FIELDS, "limit": "100"}
    while len(out) < max_items:
        body = await _request("GET", _graph(f"/{ig_user_id}/media"), token=token, params=params)
        out += [m for m in (body.get("data") or []) if isinstance(m, dict)]
        after = ((body.get("paging") or {}).get("cursors") or {}).get("after")
        if not after or not (body.get("paging") or {}).get("next"):
            break
        params = {**params, "after": after}
    return out[:max_items]


def _insight_values(body: dict) -> dict:
    out: dict[str, Any] = {}
    for item in body.get("data") or []:
        vals = item.get("values") or []
        if item.get("name") and vals:
            out[item["name"]] = vals[0].get("value")
        elif item.get("name") and "total_value" in item:
            out[item["name"]] = (item["total_value"] or {}).get("value")
    return out


async def media_insights(token: str, media_id: str) -> dict:
    """{views, shares, saved, reach…} d'une publication (valeurs à vie). Instagram refuse toute la
    requête si UN des chiffres n'existe pas pour ce média (anciens Reels, certaines musiques) : on
    redemande alors chaque chiffre seul, avec « plays » (ancien compteur) en secours des vues."""
    try:
        return _insight_values(await _request("GET", _graph(f"/{media_id}/insights"), token=token,
                                              params={"metric": "views,shares,saved,reach"}))
    except InstagramError as e:
        if e.code == "invalid_token":
            raise
    out: dict[str, Any] = {}
    for metric in ("views", "shares", "saved", "plays"):
        if metric == "plays" and out.get("views") is not None:
            continue
        try:
            out.update(_insight_values(await _request("GET", _graph(f"/{media_id}/insights"), token=token,
                                                      params={"metric": metric})))
        except InstagramError as e:
            if e.code == "invalid_token":
                raise
    if out.get("views") is None and out.get("plays") is not None:
        out["views"] = out["plays"]
    return out


# --------------------------------------------------------------------------
# Jetons stockés
# --------------------------------------------------------------------------

def apply_long_token(account: InstagramAccount, tok: dict, now: Optional[datetime] = None) -> None:
    now = now or utcnow()
    account.access_token_enc = encrypt_secret(tok["access_token"])
    ttl = int(tok.get("expires_in") or LONG_TOKEN_TTL.total_seconds())
    account.access_token_expires_at = now + timedelta(seconds=ttl)
    account.needs_reconnect = False


def clear_tokens(account: InstagramAccount) -> None:
    account.access_token_enc = None
    account.access_token_expires_at = None


def can_publish(account: InstagramAccount) -> bool:
    if account.mode != IG_MODE_API:
        return True
    return SCOPE_PUBLISH in (account.scopes or "").split(",")


async def valid_token(db: AsyncSession, account: InstagramAccount) -> str:
    """Jeton valable (mode api). Expiré ou illisible => « à reconnecter »."""
    if account.mode != IG_MODE_API or account.revoked_at is not None:
        raise ReconnectRequired("compte sans jeton")
    token = decrypt_secret(account.access_token_enc) if account.access_token_enc else None
    if not token or (account.access_token_expires_at and account.access_token_expires_at <= utcnow()):
        account.needs_reconnect = True
        await db.commit()
        raise ReconnectRequired("jeton expiré")
    return token


async def refresh_if_due(db: AsyncSession, account: InstagramAccount) -> None:
    """Rafraîchit le jeton long s'il expire bientôt (tâche planifiée)."""
    if account.mode != IG_MODE_API or account.revoked_at is not None or account.needs_reconnect:
        return
    if account.access_token_expires_at and account.access_token_expires_at - REFRESH_AHEAD > utcnow():
        return
    locked = (await db.execute(
        select(InstagramAccount).where(InstagramAccount.id == account.id).with_for_update()
    )).scalar_one_or_none() or account
    try:
        token = await valid_token(db, locked)
        tok = await refresh_token(token)
    except ReconnectRequired:
        return
    except InstagramError as e:
        if e.code in ("invalid_token", "oauth_error"):
            locked.needs_reconnect = True
            await db.commit()
        logger.warning("Instagram : rafraîchissement du compte %s en échec (%s)", locked.id, e.code)
        return
    if tok.get("access_token"):
        apply_long_token(locked, tok)
        await db.commit()
        logger.info("Instagram : jeton rafraîchi pour le compte %s", locked.id)


# --------------------------------------------------------------------------
# Désautorisation / suppression des données (rappels Meta)
# --------------------------------------------------------------------------

def _b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def parse_signed_request(signed: str) -> Optional[dict]:
    """Payload d'un signed_request Meta si la signature est bonne, sinon None."""
    secret = settings.INSTAGRAM_CLIENT_SECRET
    if not secret or not signed or "." not in signed:
        return None
    sig, payload = signed.split(".", 1)
    try:
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64(sig), expected):
            return None
        data = json.loads(_b64(payload))
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


# --------------------------------------------------------------------------
# Commentaires et messages (permissions manage_comments / manage_messages)
# --------------------------------------------------------------------------

async def media_comments(token: str, media_id: str, limit: int = 50) -> list[dict]:
    body = await _request("GET", _graph(f"/{media_id}/comments"), token=token,
                          params={"fields": COMMENT_FIELDS, "limit": str(limit)})
    return [c for c in (body.get("data") or []) if isinstance(c, dict)]


async def reply_comment(token: str, comment_id: str, text: str) -> str:
    body = await _request("POST", _graph(f"/{comment_id}/replies"), token=token, data={"message": text})
    return str(body.get("id") or "")


async def hide_comment(token: str, comment_id: str, hide: bool = True) -> None:
    await _request("POST", _graph(f"/{comment_id}"), token=token, data={"hide": "true" if hide else "false"})


async def private_reply(token: str, ig_user_id: str, comment_id: str, text: str) -> str:
    """Réponse privée à un commentaire (7 jours après le commentaire, une seule fois)."""
    body = await _request("POST", _graph(f"/{ig_user_id}/messages"), token=token,
                          data={"recipient": json.dumps({"comment_id": comment_id}), "message": json.dumps({"text": text})})
    return str(body.get("message_id") or "")


async def conversations(token: str, ig_user_id: str, limit: int = 25) -> list[dict]:
    body = await _request("GET", _graph(f"/{ig_user_id}/conversations"), token=token, params={
        "platform": "instagram", "limit": str(limit),
        "fields": "id,updated_time,participants,messages.limit(1){id,message,from,created_time}"})
    return [c for c in (body.get("data") or []) if isinstance(c, dict)]


async def conversation_messages(token: str, conversation_id: str, limit: int = 30) -> list[dict]:
    body = await _request("GET", _graph(f"/{conversation_id}"), token=token,
                          params={"fields": f"messages.limit({int(limit)}){{id,message,from,created_time}}"})
    return [m for m in ((body.get("messages") or {}).get("data") or []) if isinstance(m, dict)]


async def send_message(token: str, ig_user_id: str, recipient_id: str, text: str) -> str:
    body = await _request("POST", _graph(f"/{ig_user_id}/messages"), token=token,
                          data={"recipient": json.dumps({"id": recipient_id}), "message": json.dumps({"text": text})})
    return str(body.get("message_id") or "")
