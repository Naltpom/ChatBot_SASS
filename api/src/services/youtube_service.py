"""Client YouTube (OAuth Google + YouTube Data API v3) — côté serveur.

Module « Chapote Publisher » YouTube (Shorts) de l'Espace client : chaque
tenant connecte ses propres chaînes et y envoie ses vidéos. TOUS les appels
Google passent par ici : le navigateur ne voit ni le client_secret ni les
jetons.

Contrats Google :
- OAuth 2.0 « Web server » (https://developers.google.com/identity/protocols/oauth2/web-server) :
  autorisation sur accounts.google.com avec access_type=offline + prompt=consent
  (refresh token à chaque connexion) ; /token et /revoke en formulaire
  urlencoded ; erreur {error, error_description}. Access token 1 h ; le refresh
  token ne change pas au refresh. invalid_grant = refresh token mort (révoqué,
  mot de passe changé, ou app « en test » : 7 jours).
- API v3 : erreur {"error": {code, message, errors: [{reason, domain}], status}}.
  Codes machine = errors[0].reason (quotaExceeded, uploadLimitExceeded…).
- videos.insert « resumable » (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) :
  POST /upload/youtube/v3/videos?uploadType=resumable (métadonnées JSON,
  X-Upload-Content-Length/-Type) -> en-tête Location = URL de session ; PUT
  des morceaux (multiples de 256 Kio sauf le dernier) avec Content-Range ;
  308 = « continuer » (en-tête Range = octets reçus), 200/201 = ressource vidéo.
  Reprise : PUT vide « Content-Range: bytes */total » -> 308 + Range.
  Coût : 1 600 unités de quota (10 000 / jour par projet).
- Projet non audité (créé après le 28/07/2020) : YouTube garde la vidéo
  PRIVÉE quel que soit privacyStatus demandé, jusqu'à l'audit de conformité.
- Short : vidéo verticale (ou carrée) de 3 min au plus. Rien d'autre à
  déclarer : YouTube la classe en Short tout seul.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.youtube import YouTubeAccount
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload"
SCOPE_READONLY = "https://www.googleapis.com/auth/youtube.readonly"
SCOPES = f"{SCOPE_UPLOAD} {SCOPE_READONLY}"

# Envoi vers YouTube : morceaux de 8 Mio (multiple de 256 Kio exigé).
CHUNK_UNIT = 256 * 1024
CHUNK_SIZE = 32 * CHUNK_UNIT
MAX_VIDEO_SIZE = 256 * 1024 * 1024 * 1024   # 256 Go (limite YouTube)
MAX_DURATION_SEC = 180                      # Short : 3 min au plus
ALLOWED_MIME = {"video/mp4", "video/quicktime", "video/webm"}
TITLE_MAX = 100
DESCRIPTION_MAX_BYTES = 5000
TAGS_MAX = 500
DEFAULT_CATEGORY = "22"                     # People & Blogs ; 10 = Music

# Morceau : réessais sur erreur passagère (5xx, 429, coupure réseau), en
# reprenant à l'octet confirmé par YouTube.
CHUNK_RETRY_DELAYS = (2, 5, 15)
_RETRYABLE_HTTP = {429, 500, 502, 503, 504}

REFRESH_MARGIN = timedelta(minutes=5)

# Transport httpx injectable (tests : httpx.MockTransport).
_transport: Optional[httpx.AsyncBaseTransport] = None


ERROR_MESSAGES = {
    # OAuth
    "invalid_grant": "L'autorisation Google a expiré ou a été révoquée : reconnectez la chaîne.",
    "access_denied": "Vous avez refusé l'accès : aucune chaîne n'a été connectée.",
    "authError": "L'autorisation Google a expiré ou a été révoquée : reconnectez la chaîne.",
    "scope_missing": "Chapote n'a pas reçu l'autorisation d'envoyer des vidéos : reconnectez la chaîne en cochant toutes les autorisations.",
    "no_channel": "Ce compte Google n'a pas de chaîne YouTube. Créez-en une sur youtube.com, puis reconnectez-vous.",
    # API
    "quotaExceeded": "Le quota quotidien de l'API YouTube est épuisé (environ 6 vidéos par jour). Réessayez demain, après 9 h (minuit, heure du Pacifique).",
    "uploadLimitExceeded": "Cette chaîne a atteint sa limite d'envois YouTube pour aujourd'hui. Réessayez demain.",
    "rateLimitExceeded": "Trop de requêtes vers YouTube. Patientez une minute puis réessayez.",
    "userRateLimitExceeded": "Trop de requêtes vers YouTube. Patientez une minute puis réessayez.",
    "forbidden": "YouTube a refusé l'envoi pour cette chaîne.",
    "insufficientPermissions": "Chapote n'a pas reçu l'autorisation d'envoyer des vidéos : reconnectez la chaîne.",
    "youtubeSignupRequired": "Ce compte Google n'a pas de chaîne YouTube. Créez-en une sur youtube.com, puis reconnectez-vous.",
    "invalidTitle": "Titre refusé par YouTube (100 caractères au plus, sans < ni >).",
    "invalidDescription": "Description refusée par YouTube (5 000 octets au plus, sans < ni >).",
    "invalidTags": "Mots-clés refusés par YouTube (500 caractères au plus en tout).",
    "invalidCategoryId": "Catégorie YouTube invalide.",
    "invalidPublishAt": "Date de mise en ligne programmée refusée par YouTube.",
    "invalidVideoMetadata": "Métadonnées de la vidéo refusées par YouTube.",
    "backendError": "Erreur temporaire chez YouTube. Réessayez plus tard.",
    "upload_unavailable": "Le serveur d'envoi YouTube est momentanément indisponible. Réessayez dans quelques minutes.",
    "upload_network_error": "Connexion au serveur d'envoi YouTube interrompue. Réessayez dans quelques minutes.",
    "upload_session_expired": "La session d'envoi YouTube a expiré. Relancez la publication.",
    # Traitement (status.failureReason / rejectionReason)
    "codec": "Codec vidéo refusé par YouTube.",
    "conversion": "YouTube n'a pas pu convertir la vidéo.",
    "emptyFile": "Fichier vidéo vide.",
    "invalidFile": "Fichier vidéo illisible par YouTube.",
    "tooSmall": "Fichier vidéo trop petit.",
    "uploadAborted": "L'envoi à YouTube a été interrompu.",
    "claim": "Vidéo refusée : revendication de droits d'auteur.",
    "copyright": "Vidéo refusée pour atteinte aux droits d'auteur.",
    "duplicate": "Vidéo refusée par YouTube : doublon d'une vidéo déjà envoyée.",
    "inappropriate": "Vidéo refusée : contenu jugé inapproprié par YouTube.",
    "legal": "Vidéo refusée par YouTube pour raison juridique.",
    "length": "Vidéo refusée par YouTube : trop longue.",
    "termsOfUse": "Vidéo refusée : non conforme aux conditions d'utilisation de YouTube.",
    "trademark": "Vidéo refusée : atteinte à une marque.",
    "uploaderAccountClosed": "La chaîne YouTube a été fermée.",
    "uploaderAccountSuspended": "La chaîne YouTube est suspendue.",
    "deleted": "La vidéo a été supprimée de YouTube.",
    "locked_private": "YouTube a gardé la vidéo privée : tant que le projet Google n'a pas passé l'audit de conformité de l'API YouTube, toute vidéo envoyée par l'API reste privée. Passez-la en public depuis YouTube Studio.",
}


class YouTubeError(Exception):
    """Erreur renvoyée par Google (code machine + message + statut HTTP)."""

    def __init__(self, code: str, message: str = "", http_status: int = 0):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status

    def describe(self) -> str:
        txt = ERROR_MESSAGES.get(self.code)
        if txt is None:
            txt = f"Erreur YouTube « {self.code} »"
            if self.message:
                txt += f" : {self.message}"
        return txt


class ReconnectRequired(Exception):
    """La chaîne doit être reconnectée (refresh token révoqué, expiré ou illisible)."""


def is_enabled() -> bool:
    return bool(settings.YOUTUBE_CLIENT_ID and settings.YOUTUBE_CLIENT_SECRET)


def max_upload_bytes() -> int:
    return min(settings.YOUTUBE_MAX_UPLOAD_MB * 1024 * 1024, MAX_VIDEO_SIZE)


def _client(**kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=kw.pop("timeout", 30), transport=_transport, **kw)


def redirect_uri(app: str = "chapote") -> str:
    """URI de retour : chapote.fr (Espace client) ou cm.chapote.fr."""
    if app == "cm":
        return f"{settings.CM_URL.rstrip('/')}/youtube/callback"
    return settings.YOUTUBE_REDIRECT_URI


def authorize_url(state: str, app: str = "chapote") -> str:
    params = {
        "client_id": settings.YOUTUBE_CLIENT_ID,
        "redirect_uri": redirect_uri(app),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        # Toujours l'écran de choix du compte + consentement : refresh token
        # garanti, et possibilité de connecter une 2e chaîne (compte de marque).
        "prompt": "select_account consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# --------------------------------------------------------------------------
# Appels HTTP
# --------------------------------------------------------------------------

def _json(resp: httpx.Response) -> dict:
    if not resp.content.strip():
        return {}
    try:
        body = resp.json()
    except ValueError:
        raise YouTubeError("invalid_response", f"Réponse non JSON (HTTP {resp.status_code})", resp.status_code)
    return body if isinstance(body, dict) else {}


def _api_error(resp: httpx.Response, body: Optional[dict] = None) -> YouTubeError:
    try:
        body = body if body is not None else _json(resp)
    except YouTubeError:
        body = {}
    err = body.get("error")
    if isinstance(err, dict):
        reasons = [e.get("reason") for e in (err.get("errors") or []) if isinstance(e, dict) and e.get("reason")]
        code = reasons[0] if reasons else (err.get("status") or f"http_{resp.status_code}")
        if resp.status_code == 401 and not reasons:
            code = "authError"
        return YouTubeError(code, err.get("message") or "", resp.status_code)
    if isinstance(err, str):  # format OAuth
        return YouTubeError(err, body.get("error_description") or "", resp.status_code)
    return YouTubeError(f"http_{resp.status_code}", "", resp.status_code)


async def _oauth_post(path: str, form: dict) -> dict:
    form = {"client_id": settings.YOUTUBE_CLIENT_ID,
            "client_secret": settings.YOUTUBE_CLIENT_SECRET, **form}
    async with _client() as c:
        resp = await c.post(f"{settings.YOUTUBE_OAUTH_BASE}{path}", data=form,
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
    body = _json(resp)
    if resp.status_code >= 400 or body.get("error"):
        raise _api_error(resp, body)
    return body


async def _api(method: str, path: str, access_token: str, *,
               params: Optional[dict] = None, json: Any = None) -> dict:
    async with _client() as c:
        resp = await c.request(method, f"{settings.YOUTUBE_API_BASE}{path}",
                               headers={"Authorization": f"Bearer {access_token}"},
                               params=params, json=json)
    body = _json(resp)
    if resp.status_code >= 400:
        raise _api_error(resp, body)
    return body


async def exchange_code(code: str, app: str = "chapote") -> dict:
    return await _oauth_post("/token", {
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri(app),
    })


async def refresh_tokens(refresh_token: str) -> dict:
    return await _oauth_post("/token", {"grant_type": "refresh_token", "refresh_token": refresh_token})


async def revoke(token: str) -> None:
    async with _client() as c:
        resp = await c.post(f"{settings.YOUTUBE_OAUTH_BASE}/revoke", data={"token": token},
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
    if resp.status_code >= 400:
        raise _api_error(resp)


async def my_channel(access_token: str) -> dict:
    """Chaîne du compte autorisé : {id, title, handle, thumbnail_url}."""
    body = await _api("GET", "/youtube/v3/channels", access_token,
                      params={"part": "snippet", "mine": "true"})
    items = body.get("items") or []
    if not items:
        raise YouTubeError("no_channel", "Aucune chaîne pour ce compte Google", 400)
    ch = items[0]
    sn = ch.get("snippet") or {}
    thumbs = sn.get("thumbnails") or {}
    thumb = (thumbs.get("default") or thumbs.get("medium") or {}).get("url")
    return {"id": ch.get("id"), "title": sn.get("title"), "handle": sn.get("customUrl"),
            "thumbnail_url": thumb}


def video_resource(post) -> dict:
    """Corps snippet + status de videos.insert pour une publication."""
    snippet = {"title": post.title, "description": post.description or "",
               "categoryId": post.category_id or DEFAULT_CATEGORY}
    if post.tags:
        snippet["tags"] = list(post.tags)
    if post.default_language:
        snippet["defaultLanguage"] = post.default_language
        snippet["defaultAudioLanguage"] = post.default_language
    status = {"privacyStatus": post.privacy_status,
              "selfDeclaredMadeForKids": bool(post.made_for_kids),
              "containsSyntheticMedia": bool(post.synthetic_media),
              "embeddable": True}
    if post.publish_at:
        status["privacyStatus"] = "private"   # exigé par YouTube pour une mise en ligne programmée
        status["publishAt"] = post.publish_at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return {"snippet": snippet, "status": status}


async def start_upload(access_token: str, resource: dict, video_size: int, mime_type: str,
                       notify_subscribers: bool = True) -> str:
    """Ouvre une session d'envoi « resumable » ; renvoie son URL (secrète : jamais loggée)."""
    params = {"uploadType": "resumable", "part": "snippet,status",
              "notifySubscribers": "true" if notify_subscribers else "false"}
    async with _client() as c:
        resp = await c.post(f"{settings.YOUTUBE_API_BASE}/upload/youtube/v3/videos", params=params,
                            json=resource, headers={
                                "Authorization": f"Bearer {access_token}",
                                "X-Upload-Content-Length": str(video_size),
                                "X-Upload-Content-Type": mime_type,
                            })
    if resp.status_code >= 400:
        raise _api_error(resp)
    location = resp.headers.get("location")
    if not location:
        raise YouTubeError("invalid_response", "URL de session d'envoi absente")
    return location


def _received(resp: httpx.Response) -> int:
    """Octets confirmés par une réponse 308 (en-tête « Range: bytes=0-N »)."""
    rng = resp.headers.get("range") or ""
    try:
        return int(rng.rsplit("-", 1)[1]) + 1 if rng else 0
    except (IndexError, ValueError):
        return 0


async def _put(session_url: str, content: bytes, headers: dict) -> httpx.Response:
    async with _client(timeout=300) as c:
        return await c.put(session_url, content=content, headers=headers)


async def upload_status(session_url: str, video_size: int) -> tuple[int, Optional[dict]]:
    """Où en est la session : (octets reçus, ressource vidéo si l'envoi est fini)."""
    resp = await _put(session_url, b"", {"Content-Length": "0", "Content-Range": f"bytes */{video_size}"})
    if resp.status_code in (200, 201):
        return video_size, _json(resp)
    if resp.status_code == 308:
        return _received(resp), None
    if resp.status_code in (404, 410):
        raise YouTubeError("upload_session_expired", "", resp.status_code)
    raise _api_error(resp)


async def upload_file(session_url: str, path: str, video_size: int, mime_type: str,
                      chunk_size: int = 0) -> dict:
    """Envoie le fichier par morceaux et renvoie la ressource vidéo créée.
    Sur erreur passagère, demande à YouTube l'octet atteint et reprend de là."""
    chunk_size = chunk_size or CHUNK_SIZE
    offset = 0
    failures = 0
    with open(path, "rb") as f:
        while True:
            f.seek(offset)
            content = f.read(chunk_size)
            end = offset + len(content) - 1
            headers = {"Content-Type": mime_type, "Content-Length": str(len(content)),
                       "Content-Range": f"bytes {offset}-{end}/{video_size}"}
            resp = None
            try:
                resp = await _put(session_url, content, headers)
            except httpx.TransportError:
                pass
            if resp is not None and resp.status_code in (200, 201):
                return _json(resp)
            if resp is not None and resp.status_code == 308:
                offset = _received(resp)
                failures = 0
                continue
            if resp is not None and resp.status_code in (404, 410):
                raise YouTubeError("upload_session_expired", "", resp.status_code)
            if resp is not None and resp.status_code not in _RETRYABLE_HTTP:
                raise _api_error(resp)
            if failures >= len(CHUNK_RETRY_DELAYS):
                if resp is None:
                    raise YouTubeError("upload_network_error", "Connexion au serveur d'envoi YouTube interrompue")
                raise YouTubeError("upload_unavailable", "", resp.status_code)
            logger.info("YouTube : morceau %s-%s/%s à renvoyer (%s), essai %s", offset, end, video_size,
                        resp.status_code if resp is not None else "réseau", failures + 2)
            await asyncio.sleep(CHUNK_RETRY_DELAYS[failures])
            failures += 1
            try:
                offset, done = await upload_status(session_url, video_size)
            except httpx.TransportError:
                continue
            if done is not None:
                return done


async def video_status(access_token: str, video_id: str) -> Optional[dict]:
    """status + processingDetails d'une vidéo (None si elle n'existe plus)."""
    body = await _api("GET", "/youtube/v3/videos", access_token,
                      params={"part": "status,processingDetails", "id": video_id})
    items = body.get("items") or []
    return items[0] if items else None


# --------------------------------------------------------------------------
# Jetons stockés
# --------------------------------------------------------------------------

def apply_tokens(account: YouTubeAccount, tok: dict, now: Optional[datetime] = None) -> None:
    now = now or utcnow()
    account.access_token_enc = encrypt_secret(tok["access_token"])
    if tok.get("refresh_token"):
        account.refresh_token_enc = encrypt_secret(tok["refresh_token"])
    account.access_token_expires_at = now + timedelta(seconds=int(tok.get("expires_in") or 3600))
    if tok.get("scope"):
        account.scopes = tok["scope"]
    account.needs_reconnect = False


def clear_tokens(account: YouTubeAccount) -> None:
    account.access_token_enc = None
    account.refresh_token_enc = None
    account.access_token_expires_at = None


def can_upload(account: YouTubeAccount) -> bool:
    return SCOPE_UPLOAD in (account.scopes or "").split()


async def valid_access_token(db: AsyncSession, account: YouTubeAccount, *,
                             force_refresh: bool = False,
                             margin: timedelta = REFRESH_MARGIN) -> str:
    """Access token valide, rafraîchi au besoin. Un refresh refusé
    (invalid_grant) marque la chaîne « à reconnecter » et lève ReconnectRequired."""
    if account.revoked_at is not None:
        raise ReconnectRequired("chaîne déconnectée")
    now = utcnow()

    def _fresh(acc: YouTubeAccount) -> Optional[str]:
        if force_refresh or not acc.access_token_expires_at:
            return None
        if acc.access_token_expires_at - margin <= now:
            return None
        return decrypt_secret(acc.access_token_enc)

    token = _fresh(account)
    if token:
        return token
    locked = (await db.execute(
        select(YouTubeAccount).where(YouTubeAccount.id == account.id).with_for_update()
    )).scalar_one_or_none() or account
    if not force_refresh:
        token = _fresh(locked)
        if token:
            return token

    async def _dead(reason: str):
        locked.needs_reconnect = True
        await db.commit()
        raise ReconnectRequired(reason)

    refresh = decrypt_secret(locked.refresh_token_enc)
    if not refresh:
        await _dead("refresh token absent ou illisible")
    try:
        tok = await refresh_tokens(refresh)
    except YouTubeError as e:
        # invalid_client / unauthorized_client = configuration de Chapote, pas
        # la chaîne : on ne la marque pas « à reconnecter ».
        if e.code == "invalid_grant":
            logger.info("YouTube : refresh refusé pour la chaîne %s (%s)", locked.id, e.code)
            await _dead(e.code)
        raise
    apply_tokens(locked, tok, now)
    await db.commit()
    return tok["access_token"]


# --------------------------------------------------------------------------
# Statistiques (cm.chapote.fr) : youtube.readonly suffit (chiffres publics de la
# chaîne et des vidéos). Coût : 1 unité par appel (≈ 3 unités par relevé).
# --------------------------------------------------------------------------

def _int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def iso_duration(value: Optional[str]) -> Optional[float]:
    """Durée ISO 8601 de YouTube (PT1M5S) en secondes."""
    import re
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value or "")
    if not m or not value:
        return None
    d, h, mi, se = m.groups()
    return int(d or 0) * 86400 + int(h or 0) * 3600 + int(mi or 0) * 60 + float(se or 0)


async def channel_stats(access_token: str) -> dict:
    """{views, subscribers, videos, uploads_playlist} de la chaîne autorisée."""
    body = await _api("GET", "/youtube/v3/channels", access_token,
                      params={"part": "statistics,contentDetails", "mine": "true"})
    items = body.get("items") or []
    if not items:
        raise YouTubeError("no_channel", "Aucune chaîne pour ce compte Google", 400)
    st = items[0].get("statistics") or {}
    uploads = ((items[0].get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
    return {
        "views": _int(st.get("viewCount")),
        "subscribers": None if st.get("hiddenSubscriberCount") else _int(st.get("subscriberCount")),
        "videos": _int(st.get("videoCount")),
        "uploads_playlist": uploads,
    }


async def recent_videos(access_token: str, uploads_playlist: str, limit: int = 50) -> list[dict]:
    """Dernières vidéos de la chaîne avec leurs chiffres publics."""
    if not uploads_playlist:
        return []
    pl = await _api("GET", "/youtube/v3/playlistItems", access_token,
                    params={"part": "contentDetails", "playlistId": uploads_playlist,
                            "maxResults": str(min(limit, 50))})
    ids = [((i.get("contentDetails") or {}).get("videoId")) for i in (pl.get("items") or [])]
    ids = [i for i in ids if i]
    if not ids:
        return []
    body = await _api("GET", "/youtube/v3/videos", access_token,
                      params={"part": "snippet,statistics,contentDetails", "id": ",".join(ids)})
    out = []
    for v in body.get("items") or []:
        sn, st = v.get("snippet") or {}, v.get("statistics") or {}
        dur = iso_duration((v.get("contentDetails") or {}).get("duration"))
        thumbs = sn.get("thumbnails") or {}
        thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url")
        short = dur is not None and dur <= MAX_DURATION_SEC
        out.append({
            "id": v.get("id"), "title": sn.get("title"), "published_at": sn.get("publishedAt"),
            "thumbnail_url": thumb, "duration_sec": dur,
            "url": f"https://youtube.com/shorts/{v.get('id')}" if short else f"https://www.youtube.com/watch?v={v.get('id')}",
            "views": _int(st.get("viewCount")), "likes": _int(st.get("likeCount")),
            "comments": _int(st.get("commentCount")),
        })
    return out
