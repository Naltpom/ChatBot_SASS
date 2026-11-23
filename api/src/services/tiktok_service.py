"""Client TikTok (Login Kit + Content Posting API) — côté serveur.

Module « Chapote Publisher » de l'Espace client : chaque tenant connecte ses
propres comptes TikTok et y publie ses vidéos. TOUS les appels TikTok passent
par ici : le navigateur ne voit ni le client_secret ni les jetons.

Contrats TikTok (https://developers.tiktok.com/doc/) :
- OAuth (/v2/oauth/token/, /v2/oauth/revoke/) : formulaire urlencoded ; erreur
  au niveau racine {error, error_description, log_id}. Access token 24 h,
  refresh token 365 j ; le refresh token renvoyé PEUT changer (rotation).
- API v2 (user/info, post/publish/*) : {data, error: {code, message, log_id}},
  succès ⇔ error.code == "ok".
- Direct Post : POST /v2/post/publish/video/init/ (video.publish), post_info +
  source_info. Brouillon : POST /v2/post/publish/inbox/video/init/
  (video.upload), source_info seul. upload_url valable 1 h. 6 init / min / jeton.
- FILE_UPLOAD (media transfer guide) : chunks de 5 à 64 MB, le dernier absorbe
  le reste (jusqu'à 128 MB) ; total_chunk_count = floor(video_size / chunk_size),
  1 à 1000 ; < 5 MB => envoi en un bloc ; > 64 MB => plusieurs chunks ; envoi
  séquentiel. 4 GB max, MP4 / MOV / WebM, 10 min max à l'init.
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
from src.models.tiktok import TikTokAccount
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
SCOPES = "user.info.basic,video.upload,video.publish"
USER_INFO_FIELDS = "open_id,avatar_url,display_name"

# Limites FILE_UPLOAD de la doc TikTok (unités « MB » décimales : les bornes
# retenues tiennent aussi en lecture MiB — chunk unique <= 64e6 < 64 Mio,
# chunk de 10e6 >= 5 Mio).
MB = 1000 * 1000
MIN_CHUNK = 5 * MB
MAX_CHUNK = 64 * MB
MAX_LAST_CHUNK = 128 * MB
MAX_CHUNK_COUNT = 1000
CHUNK_SIZE = 10 * MB            # au-delà de 64 MB ; dernier chunk < 20 MB
MAX_VIDEO_SIZE = 4 * 1000 * MB  # « Maximum of 4GB »
MAX_DURATION_SEC = 600          # 10 min max à l'init (le créateur peut avoir moins)
ALLOWED_MIME = {"video/mp4", "video/quicktime", "video/webm"}
TITLE_MAX = 2200                # post_info.title : 2200 runes UTF-16

# Envoi d'un segment : réessais sur erreur passagère du serveur d'upload
# (5xx, 429, coupure réseau) ; un segment peut être renvoyé tel quel.
CHUNK_RETRY_DELAYS = (2, 5, 15)
_RETRYABLE_HTTP = {429, 500, 502, 503, 504}

# Marge avant expiration de l'access token pour rafraîchir à la volée.
REFRESH_MARGIN = timedelta(minutes=5)

# Transport httpx injectable (tests : httpx.MockTransport).
_transport: Optional[httpx.AsyncBaseTransport] = None


# Messages FR des codes d'erreur TikTok (init, status/fetch, creator_info).
ERROR_MESSAGES = {
    "access_token_invalid": "L'autorisation TikTok a expiré ou a été révoquée : reconnectez le compte.",
    "scope_not_authorized": "Ce compte n'a pas accordé les autorisations de publication : reconnectez-le en acceptant toutes les autorisations.",
    "spam_risk_too_many_posts": "Ce compte a atteint le nombre maximal de publications autorisées pour aujourd'hui. Réessayez plus tard.",
    "spam_risk_too_many_pending_share": "Trop de vidéos en attente dans la boîte de réception TikTok de ce compte (5 par 24 h). Publiez ou supprimez-les depuis l'app TikTok, puis réessayez.",
    "spam_risk_user_banned_from_posting": "Ce compte n'est pas autorisé à publier pour le moment.",
    "reached_active_user_cap": "La limite quotidienne d'utilisateurs de l'application est atteinte. Réessayez plus tard.",
    "unaudited_client_can_only_post_to_private_accounts": "Tant que l'application n'est pas validée par TikTok, la publication n'est possible que sur un compte privé.",
    "privacy_level_option_mismatch": "Ce niveau de confidentialité n'est pas proposé par TikTok pour ce compte.",
    "rate_limit_exceeded": "Trop de requêtes vers TikTok. Patientez une minute puis réessayez.",
    "invalid_param": "TikTok a refusé la demande (paramètre invalide).",
    "url_ownership_unverified": "Source vidéo refusée par TikTok.",
    "invalid_publish_id": "Publication introuvable chez TikTok.",
    "token_not_authorized_for_specified_publish_id": "Cette publication n'appartient pas à ce compte TikTok.",
    "internal_error": "Erreur temporaire chez TikTok. Réessayez plus tard.",
    # fail_reason (status/fetch)
    "file_format_check_failed": "Format vidéo refusé par TikTok.",
    "duration_check_failed": "Durée de la vidéo refusée par TikTok.",
    "frame_rate_check_failed": "Fréquence d'images refusée par TikTok.",
    "picture_size_check_failed": "Dimensions de la vidéo refusées par TikTok.",
    "internal": "Erreur temporaire chez TikTok. Réessayez la publication.",
    "video_pull_failed": "TikTok n'a pas pu récupérer la vidéo.",
    "publish_cancelled": "La publication a été annulée.",
    "auth_removed": "L'autorisation a été retirée pendant le traitement : reconnectez le compte.",
    "spam_risk_text": "La légende a été jugée indésirable par TikTok.",
    "spam_risk": "La publication a été jugée à risque par TikTok.",
    "upload_unavailable": "Le serveur d'envoi TikTok est momentanément indisponible. Réessayez dans quelques minutes.",
    "upload_network_error": "Connexion au serveur d'envoi TikTok interrompue. Réessayez dans quelques minutes.",
}

# Codes creator_info / init signifiant « ce créateur ne peut pas publier maintenant ».
CANNOT_POST = {"spam_risk_too_many_posts", "spam_risk_user_banned_from_posting",
               "reached_active_user_cap", "spam_risk_too_many_pending_share"}


class TikTokError(Exception):
    """Erreur renvoyée par TikTok (code machine + message + log_id)."""

    def __init__(self, code: str, message: str = "", log_id: str = "", http_status: int = 0):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.log_id = log_id
        self.http_status = http_status

    def describe(self) -> str:
        """Message FR pour l'utilisateur (code TikTok + log_id en référence)."""
        txt = ERROR_MESSAGES.get(self.code)
        if txt is None:
            txt = f"Erreur TikTok « {self.code} »"
            if self.message:
                txt += f" : {self.message}"
        if self.log_id:
            txt += f" (réf. {self.log_id})"
        return txt


def is_enabled() -> bool:
    return bool(settings.TIKTOK_CLIENT_KEY and settings.TIKTOK_CLIENT_SECRET)


def max_upload_bytes() -> int:
    return min(settings.TIKTOK_MAX_UPLOAD_MB * 1024 * 1024, MAX_VIDEO_SIZE)


def _client(**kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=kw.pop("timeout", 30), transport=_transport, **kw)


def authorize_url(state: str) -> str:
    params = {
        "client_key": settings.TIKTOK_CLIENT_KEY,
        "scope": SCOPES,
        "response_type": "code",
        "redirect_uri": settings.TIKTOK_REDIRECT_URI,
        "state": state,
        # Toujours afficher l'écran d'autorisation (utile pour connecter un 2e compte).
        "disable_auto_auth": "1",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# --------------------------------------------------------------------------
# Appels HTTP
# --------------------------------------------------------------------------

def _json(resp: httpx.Response) -> dict:
    # /v2/oauth/revoke/ répond 200 avec un corps VIDE en cas de succès.
    if resp.status_code < 400 and not resp.content.strip():
        return {}
    try:
        body = resp.json()
    except ValueError:
        raise TikTokError("invalid_response", f"Réponse non JSON (HTTP {resp.status_code})",
                          http_status=resp.status_code)
    return body if isinstance(body, dict) else {}


async def _oauth_post(path: str, form: dict) -> dict:
    form = {"client_key": settings.TIKTOK_CLIENT_KEY,
            "client_secret": settings.TIKTOK_CLIENT_SECRET, **form}
    async with _client() as c:
        resp = await c.post(f"{settings.TIKTOK_API_BASE}{path}", data=form,
                            headers={"Content-Type": "application/x-www-form-urlencoded"})
    body = _json(resp)
    if resp.status_code >= 400 or body.get("error"):
        err = body.get("error")
        if isinstance(err, dict):  # certaines réponses OAuth utilisent le format v2
            if err.get("code") in (None, "", "ok") and resp.status_code < 400:
                return body
            raise TikTokError(err.get("code") or "error", err.get("message") or "",
                              err.get("log_id") or "", resp.status_code)
        raise TikTokError(str(err or f"http_{resp.status_code}"),
                          body.get("error_description") or "", body.get("log_id") or "",
                          resp.status_code)
    return body


async def _api(method: str, path: str, access_token: str, *,
               json: Any = None, params: Optional[dict] = None) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    if json is not None:
        headers["Content-Type"] = "application/json; charset=UTF-8"
    async with _client() as c:
        resp = await c.request(method, f"{settings.TIKTOK_API_BASE}{path}",
                               headers=headers, json=json, params=params)
    body = _json(resp)
    err = body.get("error") or {}
    code = err.get("code") if isinstance(err, dict) else str(err)
    if resp.status_code >= 400 or (code and code != "ok"):
        raise TikTokError(code or f"http_{resp.status_code}",
                          (err.get("message") if isinstance(err, dict) else "") or "",
                          (err.get("log_id") if isinstance(err, dict) else "") or "",
                          resp.status_code)
    return body.get("data") or {}


async def exchange_code(code: str) -> dict:
    return await _oauth_post("/v2/oauth/token/", {
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.TIKTOK_REDIRECT_URI,
    })


async def refresh_tokens(refresh_token: str) -> dict:
    return await _oauth_post("/v2/oauth/token/", {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    })


async def revoke(access_token: str) -> None:
    await _oauth_post("/v2/oauth/revoke/", {"token": access_token})


async def user_info(access_token: str) -> dict:
    data = await _api("GET", "/v2/user/info/", access_token, params={"fields": USER_INFO_FIELDS})
    return data.get("user") or {}


async def creator_info(access_token: str) -> dict:
    return await _api("POST", "/v2/post/publish/creator_info/query/", access_token, json={})


def _source_info(video_size: int) -> dict:
    chunk_size, total = chunk_plan(video_size)
    return {"source": "FILE_UPLOAD", "video_size": video_size,
            "chunk_size": chunk_size, "total_chunk_count": total}


def _check_init(data: dict) -> dict:
    if not data.get("publish_id") or not data.get("upload_url"):
        raise TikTokError("invalid_response", "publish_id/upload_url absents de la réponse init")
    return data


async def init_direct_post(access_token: str, post_info: dict, video_size: int) -> dict:
    """Direct Post (video.publish) : publie sur le profil après traitement."""
    return _check_init(await _api("POST", "/v2/post/publish/video/init/", access_token, json={
        "post_info": post_info, "source_info": _source_info(video_size),
    }))


async def init_inbox_upload(access_token: str, video_size: int) -> dict:
    """Brouillon (video.upload) : la vidéo arrive dans la boîte de réception
    TikTok du créateur, qui termine l'édition et publie depuis l'app."""
    return _check_init(await _api("POST", "/v2/post/publish/inbox/video/init/", access_token, json={
        "source_info": _source_info(video_size),
    }))


async def put_chunk(upload_url: str, content: bytes, start: int, end: int,
                    total_size: int, mime_type: str) -> int:
    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(len(content)),
        "Content-Range": f"bytes {start}-{end}/{total_size}",
    }
    for attempt in range(len(CHUNK_RETRY_DELAYS) + 1):
        retry = attempt < len(CHUNK_RETRY_DELAYS)
        try:
            async with _client(timeout=300) as c:
                resp = await c.put(upload_url, content=content, headers=headers)
        except httpx.TransportError as e:
            if not retry:
                raise TikTokError("upload_network_error", "Connexion au serveur d'envoi TikTok interrompue") from e
            resp = None
        if resp is not None and resp.status_code in (200, 201, 206):
            return resp.status_code
        if resp is not None and (resp.status_code not in _RETRYABLE_HTTP or not retry):
            break
        logger.info("TikTok : segment %s-%s/%s à renvoyer (%s), essai %s",
                    start, end, total_size, resp.status_code if resp is not None else "réseau", attempt + 2)
        await asyncio.sleep(CHUNK_RETRY_DELAYS[attempt])
    try:
        body = resp.json()
        err = body.get("error") or {}
    except ValueError:
        err = {}
    if resp.status_code == 403 and not err:
        err = {"code": "upload_url_expired", "message": "Lien d'envoi TikTok expiré"}
    elif resp.status_code in _RETRYABLE_HTTP and not err.get("code"):
        err = {"code": "upload_unavailable"}
    raise TikTokError(err.get("code") or f"upload_http_{resp.status_code}",
                      err.get("message") or "Échec de l'envoi d'un segment vidéo",
                      err.get("log_id") or "", resp.status_code)


async def publish_status(access_token: str, publish_id: str) -> dict:
    return await _api("POST", "/v2/post/publish/status/fetch/", access_token,
                      json={"publish_id": publish_id})


# --------------------------------------------------------------------------
# Découpage en chunks
# --------------------------------------------------------------------------

def chunk_plan(video_size: int) -> tuple[int, int]:
    """(chunk_size, total_chunk_count) conformes aux règles FILE_UPLOAD."""
    if video_size <= 0 or video_size > MAX_VIDEO_SIZE:
        raise ValueError("Taille de vidéo invalide")
    # Jusqu'à 64 MB (et toujours sous 5 MB) : UN seul chunk de la taille du
    # fichier. Un chunk unique annoncé plus petit que la vidéo est refusé par
    # TikTok (« The chunk size is invalid »).
    if video_size <= MAX_CHUNK:
        return video_size, 1
    # Au-delà : chunks de 10 MB, floor() ; le dernier absorbe le reste
    # (< 2 x 10 MB), jamais de petit chunk final.
    return CHUNK_SIZE, video_size // CHUNK_SIZE


def chunk_range(index: int, chunk_size: int, total: int, video_size: int) -> tuple[int, int]:
    """Octets [start, end] (inclus) du chunk `index` ; le dernier prend le reste."""
    if index < 0 or index >= total:
        raise ValueError("Index de chunk hors limites")
    start = index * chunk_size
    end = video_size - 1 if index == total - 1 else start + chunk_size - 1
    return start, end


# --------------------------------------------------------------------------
# Jetons stockés
# --------------------------------------------------------------------------

def apply_tokens(account: TikTokAccount, tok: dict, now: Optional[datetime] = None) -> None:
    now = now or utcnow()
    account.access_token_enc = encrypt_secret(tok["access_token"])
    if tok.get("refresh_token"):
        account.refresh_token_enc = encrypt_secret(tok["refresh_token"])
    account.access_token_expires_at = now + timedelta(seconds=int(tok.get("expires_in") or 86400))
    if tok.get("refresh_expires_in"):
        account.refresh_token_expires_at = now + timedelta(seconds=int(tok["refresh_expires_in"]))
    if tok.get("scope"):
        account.scopes = tok["scope"]
    account.needs_reconnect = False


def clear_tokens(account: TikTokAccount) -> None:
    account.access_token_enc = None
    account.refresh_token_enc = None
    account.access_token_expires_at = None
    account.refresh_token_expires_at = None


class ReconnectRequired(Exception):
    """Le compte doit être reconnecté (refresh token expiré, révoqué ou illisible)."""


# Codes OAuth signifiant que le refresh token ne servira plus jamais.
_DEAD_REFRESH = {"invalid_grant", "invalid_request", "access_token_invalid"}


async def valid_access_token(db: AsyncSession, account: TikTokAccount, *,
                             force_refresh: bool = False,
                             margin: timedelta = REFRESH_MARGIN) -> str:
    """Access token valide, rafraîchi automatiquement via le refresh token.
    Un refresh impossible marque le compte « à reconnecter » (needs_reconnect)
    et lève ReconnectRequired."""
    if account.revoked_at is not None:
        raise ReconnectRequired("compte déconnecté")
    now = utcnow()

    def _fresh(acc: TikTokAccount) -> Optional[str]:
        if force_refresh or not acc.access_token_expires_at:
            return None
        if acc.access_token_expires_at - margin <= now:
            return None
        return decrypt_secret(acc.access_token_enc)

    token = _fresh(account)
    if token:
        return token

    # Verrou de ligne : deux requêtes simultanées ne rafraîchissent pas en double
    # (le refresh token peut tourner : le 2e refresh échouerait).
    locked = (await db.execute(
        select(TikTokAccount).where(TikTokAccount.id == account.id).with_for_update()
    )).scalar_one_or_none() or account
    if not force_refresh:
        token = _fresh(locked)
        if token:
            return token

    async def _dead(reason: str):
        locked.needs_reconnect = True
        await db.commit()
        raise ReconnectRequired(reason)

    if locked.refresh_token_expires_at and locked.refresh_token_expires_at <= now:
        await _dead("refresh token expiré")
    refresh = decrypt_secret(locked.refresh_token_enc)
    if not refresh:
        await _dead("refresh token absent ou illisible")
    try:
        tok = await refresh_tokens(refresh)
    except TikTokError as e:
        if e.code in _DEAD_REFRESH:
            logger.info("TikTok : refresh refusé pour le compte %s (%s)", locked.id, e.code)
            await _dead(e.code)
        raise
    apply_tokens(locked, tok, now)
    await db.commit()
    logger.info("TikTok : access token rafraîchi pour le compte %s", locked.id)
    return tok["access_token"]
