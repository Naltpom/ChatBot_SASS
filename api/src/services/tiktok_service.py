"""Client TikTok (Login Kit + Content Posting API, Direct Post) — côté serveur.

Outil privé « Chapote Publisher » : le superadmin publie ses propres vidéos sur
ses comptes TikTok. TOUS les appels TikTok passent par ici (le navigateur ne
voit ni le client_secret ni les jetons ; il n'envoie que les octets vidéo à
l'API, qui les relaie vers l'upload_url pré-signée).

Contrats TikTok (https://developers.tiktok.com/doc/) :
- OAuth (/v2/oauth/token/, /v2/oauth/revoke/) : formulaire urlencoded ; erreur
  au niveau racine {error, error_description, log_id}.
- API v2 (user/info, post/publish/*) : {data, error: {code, message, log_id}},
  succès ⇔ error.code == "ok".
- Upload FILE_UPLOAD : chunks de 5 à 64 Mo, le dernier absorbe le reste
  (jusqu'à 128 Mo) ; total_chunk_count = floor(video_size / chunk_size) ;
  vidéo < 5 Mo => un seul chunk de la taille du fichier.
"""
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

MB = 1024 * 1024
MIN_CHUNK = 5 * MB
CHUNK_SIZE = 10 * MB          # dernier chunk < 20 Mo : reste sous les limites de body du proxy
MAX_VIDEO_SIZE = 4 * 1024 * MB
ALLOWED_MIME = {"video/mp4", "video/quicktime"}

# Marge avant expiration de l'access token (24 h chez TikTok) pour rafraîchir.
REFRESH_MARGIN = timedelta(minutes=5)

# Transport httpx injectable (tests : httpx.MockTransport).
_transport: Optional[httpx.AsyncBaseTransport] = None


class TikTokError(Exception):
    """Erreur renvoyée par TikTok (code machine + message + log_id)."""

    def __init__(self, code: str, message: str = "", log_id: str = "", http_status: int = 0):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.log_id = log_id
        self.http_status = http_status

    def describe(self) -> str:
        txt = f"Erreur TikTok « {self.code} »"
        if self.message:
            txt += f" : {self.message}"
        if self.log_id:
            txt += f" (log_id {self.log_id})"
        return txt


def is_enabled() -> bool:
    return bool(settings.TIKTOK_CLIENT_KEY and settings.TIKTOK_CLIENT_SECRET)


def _client(**kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=kw.pop("timeout", 30), transport=_transport, **kw)


def authorize_url(state: str) -> str:
    params = {
        "client_key": settings.TIKTOK_CLIENT_KEY,
        "scope": SCOPES,
        "response_type": "code",
        "redirect_uri": settings.TIKTOK_REDIRECT_URI,
        "state": state,
        # Toujours afficher l'écran d'autorisation (utile pour connecter le 2e compte).
        "disable_auto_auth": "1",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# --------------------------------------------------------------------------
# Appels HTTP
# --------------------------------------------------------------------------

def _json(resp: httpx.Response) -> dict:
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


async def init_video(access_token: str, post_info: dict, video_size: int) -> tuple[dict, int, int]:
    chunk_size, total = chunk_plan(video_size)
    data = await _api("POST", "/v2/post/publish/video/init/", access_token, json={
        "post_info": post_info,
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": chunk_size,
            "total_chunk_count": total,
        },
    })
    if not data.get("publish_id") or not data.get("upload_url"):
        raise TikTokError("invalid_response", "publish_id/upload_url absents de la réponse init")
    return data, chunk_size, total


async def put_chunk(upload_url: str, content: bytes, start: int, end: int,
                    total_size: int, mime_type: str) -> int:
    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(len(content)),
        "Content-Range": f"bytes {start}-{end}/{total_size}",
    }
    async with _client(timeout=300) as c:
        resp = await c.put(upload_url, content=content, headers=headers)
    if resp.status_code not in (200, 201, 206):
        try:
            body = resp.json()
            err = body.get("error") or {}
        except ValueError:
            err = {}
        raise TikTokError(err.get("code") or f"upload_http_{resp.status_code}",
                          err.get("message") or "Échec de l'envoi d'un segment vidéo",
                          err.get("log_id") or "", resp.status_code)
    return resp.status_code


async def publish_status(access_token: str, publish_id: str) -> dict:
    return await _api("POST", "/v2/post/publish/status/fetch/", access_token,
                      json={"publish_id": publish_id})


# --------------------------------------------------------------------------
# Découpage en chunks
# --------------------------------------------------------------------------

def chunk_plan(video_size: int) -> tuple[int, int]:
    """(chunk_size, total_chunk_count) conformes aux règles FILE_UPLOAD."""
    if video_size <= 0:
        raise ValueError("Taille de vidéo invalide")
    if video_size < max(MIN_CHUNK, CHUNK_SIZE):
        return video_size, 1
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
    account.access_expires_at = now + timedelta(seconds=int(tok.get("expires_in") or 86400))
    if tok.get("refresh_expires_in"):
        account.refresh_expires_at = now + timedelta(seconds=int(tok["refresh_expires_in"]))
    if tok.get("scope"):
        account.scope = tok["scope"]


class ReconnectRequired(Exception):
    """Le compte doit être reconnecté (refresh token expiré, révoqué ou illisible)."""


async def valid_access_token(db: AsyncSession, account: TikTokAccount) -> str:
    """Access token valide, rafraîchi automatiquement via le refresh token."""
    now = utcnow()
    if account.access_expires_at and account.access_expires_at - REFRESH_MARGIN > now:
        token = decrypt_secret(account.access_token_enc)
        if token:
            return token

    # Verrou de ligne : deux requêtes simultanées ne rafraîchissent pas en double.
    locked = (await db.execute(
        select(TikTokAccount).where(TikTokAccount.id == account.id).with_for_update()
    )).scalar_one_or_none() or account
    if locked.access_expires_at and locked.access_expires_at - REFRESH_MARGIN > now:
        token = decrypt_secret(locked.access_token_enc)
        if token:
            return token

    if locked.refresh_expires_at and locked.refresh_expires_at <= now:
        raise ReconnectRequired("refresh token expiré")
    refresh = decrypt_secret(locked.refresh_token_enc)
    if not refresh:
        raise ReconnectRequired("refresh token illisible")
    try:
        tok = await refresh_tokens(refresh)
    except TikTokError as e:
        if e.code in ("invalid_grant", "invalid_request", "access_token_invalid"):
            raise ReconnectRequired(e.describe())
        raise
    apply_tokens(locked, tok, now)
    await db.commit()
    logger.info("TikTok : access token rafraîchi pour %s", locked.open_id)
    return tok["access_token"]
