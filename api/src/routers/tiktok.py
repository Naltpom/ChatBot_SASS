"""TikTok « Chapote Publisher » — back-office privé du superadmin (/tiktok).

Connexion OAuth des comptes TikTok de l'éditeur, puis publication Direct Post
(Content Posting API, source FILE_UPLOAD). Tous les appels TikTok sont faits ici
(services/tiktok_service.py) : le navigateur n'a ni client_secret ni jeton.

Flux de publication :
  1. GET  /accounts/{open_id}/creator-info    -> options du créateur (UX TikTok)
  2. POST /accounts/{open_id}/publish         -> init TikTok, renvoie le plan de chunks
  3. PUT  /publishes/{publish_id}/chunks/{i}  -> octets du chunk i, relayés vers TikTok
  4. GET  /publishes/{publish_id}/status      -> statut de publication TikTok
"""
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.models.tiktok import TikTokAccount, TikTokPublish
from src.services import tiktok_service as tt
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/tiktok", tags=["tiktok"],
                   dependencies=[Depends(require_superadmin)])

STATE_COOKIE = "chapote_tiktok_state"
STATE_COOKIE_PATH = "/api/admin/tiktok/oauth"
# Préfixe des state émis par le tableau de bord : un state SANS ce préfixe vient
# de scripts/tiktok.py -> la page /tiktok/callback affiche le code (mode manuel).
STATE_PREFIX = "web_"

# Codes creator_info signifiant « ce créateur ne peut pas publier maintenant ».
CANNOT_POST = {
    "spam_risk_too_many_posts": "Ce compte a atteint le nombre maximal de publications autorisées pour le moment. Réessayez plus tard.",
    "spam_risk_user_banned_from_posting": "Ce compte n'est pas autorisé à publier pour le moment.",
    "reached_active_user_cap": "La limite quotidienne d'utilisateurs actifs de l'application est atteinte. Réessayez plus tard.",
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _require_enabled() -> None:
    if not tt.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "TikTok non configuré (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET).")


def _http_error(e: tt.TikTokError) -> HTTPException:
    """Erreur TikTok -> HTTPException lisible. Jamais de 401 (le front
    l'interpréterait comme une session Chapote expirée)."""
    code = 429 if e.http_status == 429 else (400 if 400 <= e.http_status < 500 else 502)
    return HTTPException(code, e.describe())


async def _get_account(db: AsyncSession, open_id: str) -> TikTokAccount:
    acc = (await db.execute(
        select(TikTokAccount).where(TikTokAccount.open_id == open_id)
    )).scalar_one_or_none()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte TikTok introuvable")
    return acc


async def _token(db: AsyncSession, acc: TikTokAccount) -> str:
    try:
        return await tt.valid_access_token(db, acc)
    except tt.ReconnectRequired as e:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Autorisation TikTok expirée ou révoquée : reconnectez le compte ({e}).")
    except tt.TikTokError as e:
        raise _http_error(e)


def _account_out(acc: TikTokAccount) -> dict:
    scopes = set((acc.scope or "").split(","))
    return {
        "open_id": acc.open_id,
        "display_name": acc.display_name,
        "avatar_url": acc.avatar_url,
        "scope": acc.scope,
        "can_publish": {"video.upload", "video.publish"} <= scopes,
        "needs_reconnect": bool(acc.refresh_expires_at and acc.refresh_expires_at <= utcnow()),
        "connected_at": acc.created_at.isoformat() if acc.created_at else None,
    }


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@router.get("/config")
async def tiktok_config():
    return {"enabled": tt.is_enabled(), "redirect_uri": settings.TIKTOK_REDIRECT_URI}


@router.post("/oauth/start")
async def oauth_start(response: Response):
    """URL d'autorisation TikTok + state aléatoire gardé en cookie httpOnly."""
    _require_enabled()
    state = STATE_PREFIX + secrets.token_urlsafe(24)
    response.set_cookie(
        key=STATE_COOKIE, value=state, max_age=600, httponly=True,
        samesite="lax", secure=settings.is_production, path=STATE_COOKIE_PATH,
    )
    return {"authorize_url": tt.authorize_url(state)}


class ExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=512)


@router.post("/oauth/exchange")
async def oauth_exchange(body: ExchangeIn, request: Request, response: Response,
                         db: AsyncSession = Depends(get_db),
                         user=Depends(require_superadmin)):
    """Vérifie le state, échange le code contre les jetons et enregistre le compte."""
    _require_enabled()
    expected = request.cookies.get(STATE_COOKIE)
    response.delete_cookie(STATE_COOKIE, path=STATE_COOKIE_PATH, samesite="lax",
                           secure=settings.is_production)
    if not expected or not secrets.compare_digest(expected, body.state):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "State OAuth invalide ou expiré : relancez « Se connecter avec TikTok ».")
    try:
        tok = await tt.exchange_code(body.code)
    except tt.TikTokError as e:
        raise _http_error(e)
    open_id = tok.get("open_id")
    if not open_id or not tok.get("access_token") or not tok.get("refresh_token"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Réponse TikTok incomplète (open_id/jetons absents)")

    acc = (await db.execute(
        select(TikTokAccount).where(TikTokAccount.open_id == open_id)
    )).scalar_one_or_none()
    if acc is None:
        acc = TikTokAccount(open_id=open_id, connected_by_user_id=user.id)
        db.add(acc)
    tt.apply_tokens(acc, tok)
    if acc.refresh_expires_at is None:
        acc.refresh_expires_at = utcnow()
    try:
        info = await tt.user_info(tok["access_token"])
        acc.display_name = info.get("display_name") or acc.display_name
        acc.avatar_url = info.get("avatar_url") or acc.avatar_url
    except tt.TikTokError as e:
        logger.warning("TikTok user/info en échec après connexion : %s", e.describe())
    await db.commit()
    return _account_out(acc)


# --------------------------------------------------------------------------
# Comptes
# --------------------------------------------------------------------------

@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """Comptes connectés ; profil (avatar, display_name) rafraîchi via /v2/user/info/."""
    accounts = (await db.execute(
        select(TikTokAccount).order_by(TikTokAccount.created_at)
    )).scalars().all()
    out = []
    for acc in accounts:
        error = None
        if tt.is_enabled():
            try:
                token = await tt.valid_access_token(db, acc)
                info = await tt.user_info(token)
                acc.display_name = info.get("display_name") or acc.display_name
                acc.avatar_url = info.get("avatar_url") or acc.avatar_url
            except tt.ReconnectRequired:
                error = "Autorisation expirée ou révoquée : reconnectez ce compte."
            except tt.TikTokError as e:
                error = e.describe()
        item = _account_out(acc)
        item["error"] = error
        out.append(item)
    await db.commit()
    return out


@router.delete("/accounts/{open_id}")
async def disconnect_account(open_id: str, db: AsyncSession = Depends(get_db)):
    """Révoque l'autorisation chez TikTok puis supprime les jetons stockés."""
    acc = await _get_account(db, open_id)
    warning = None
    if tt.is_enabled():
        try:
            token = await tt.valid_access_token(db, acc)
            await tt.revoke(token)
        except tt.ReconnectRequired:
            warning = "Autorisation déjà expirée côté TikTok : jetons supprimés localement."
        except tt.TikTokError as e:
            warning = f"Révocation TikTok en échec ({e.describe()}) : jetons supprimés localement."
    await db.delete(acc)
    await db.commit()
    return {"ok": True, "warning": warning}


@router.get("/accounts/{open_id}/creator-info")
async def get_creator_info(open_id: str, db: AsyncSession = Depends(get_db)):
    _require_enabled()
    acc = await _get_account(db, open_id)
    token = await _token(db, acc)
    try:
        info = await tt.creator_info(token)
    except tt.TikTokError as e:
        if e.code in CANNOT_POST:
            return {"can_post": False, "reason_code": e.code,
                    "message": f"{CANNOT_POST[e.code]} ({e.code})", "creator": None}
        raise _http_error(e)
    return {
        "can_post": True,
        "creator": {
            "nickname": info.get("creator_nickname"),
            "username": info.get("creator_username"),
            "avatar_url": info.get("creator_avatar_url"),
            "privacy_level_options": info.get("privacy_level_options") or [],
            "comment_disabled": bool(info.get("comment_disabled")),
            "duet_disabled": bool(info.get("duet_disabled")),
            "stitch_disabled": bool(info.get("stitch_disabled")),
            "max_video_post_duration_sec": info.get("max_video_post_duration_sec"),
        },
    }


# --------------------------------------------------------------------------
# Publication
# --------------------------------------------------------------------------

class PublishIn(BaseModel):
    title: str = Field(default="", max_length=2200)
    privacy_level: str = Field(min_length=1)
    allow_comment: bool = False
    allow_duet: bool = False
    allow_stitch: bool = False
    brand_organic_toggle: bool = False   # « Votre marque »
    brand_content_toggle: bool = False   # « Contenu de marque »
    video_size: int = Field(gt=0)
    mime_type: str
    duration_sec: Optional[float] = None


@router.post("/accounts/{open_id}/publish")
async def publish_init(open_id: str, body: PublishIn, db: AsyncSession = Depends(get_db)):
    """Valide la demande contre creator_info puis initialise le Direct Post."""
    _require_enabled()
    if body.mime_type not in tt.ALLOWED_MIME:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format non pris en charge (MP4 ou MOV uniquement).")
    if body.video_size > tt.MAX_VIDEO_SIZE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vidéo trop volumineuse (4 Go maximum).")
    if body.brand_content_toggle and body.privacy_level == "SELF_ONLY":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Le contenu de marque ne peut pas être publié en « Moi uniquement ».")

    acc = await _get_account(db, open_id)
    token = await _token(db, acc)
    try:
        info = await tt.creator_info(token)
    except tt.TikTokError as e:
        if e.code in CANNOT_POST:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{CANNOT_POST[e.code]} ({e.code})")
        raise _http_error(e)
    if body.privacy_level not in (info.get("privacy_level_options") or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Niveau de confidentialité non proposé par TikTok pour ce compte.")
    max_dur = info.get("max_video_post_duration_sec")
    if max_dur and body.duration_sec and body.duration_sec > max_dur:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Vidéo trop longue : {int(body.duration_sec)} s pour {max_dur} s maximum.")

    post_info = {
        "title": body.title,
        "privacy_level": body.privacy_level,
        # Une interaction désactivée par le créateur reste désactivée.
        "disable_comment": info.get("comment_disabled") or not body.allow_comment,
        "disable_duet": info.get("duet_disabled") or not body.allow_duet,
        "disable_stitch": info.get("stitch_disabled") or not body.allow_stitch,
        "brand_content_toggle": body.brand_content_toggle,
        "brand_organic_toggle": body.brand_organic_toggle,
    }
    try:
        data, chunk_size, total = await tt.init_video(token, post_info, body.video_size)
    except tt.TikTokError as e:
        raise _http_error(e)

    db.add(TikTokPublish(
        publish_id=data["publish_id"], open_id=acc.open_id, title=body.title,
        privacy_level=body.privacy_level, upload_url_enc=encrypt_secret(data["upload_url"]),
        mime_type=body.mime_type, video_size=body.video_size, chunk_size=chunk_size,
        total_chunk_count=total, status="UPLOADING",
    ))
    await db.commit()
    return {"publish_id": data["publish_id"], "chunk_size": chunk_size,
            "total_chunk_count": total, "video_size": body.video_size}


async def _get_publish(db: AsyncSession, publish_id: str) -> TikTokPublish:
    pub = (await db.execute(
        select(TikTokPublish).where(TikTokPublish.publish_id == publish_id)
    )).scalar_one_or_none()
    if pub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return pub


@router.put("/publishes/{publish_id}/chunks/{index}")
async def upload_chunk(publish_id: str, index: int, request: Request,
                       db: AsyncSession = Depends(get_db)):
    """Relaie le chunk `index` (corps brut) vers l'upload_url TikTok."""
    pub = await _get_publish(db, publish_id)
    try:
        start, end = tt.chunk_range(index, pub.chunk_size, pub.total_chunk_count, pub.video_size)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    content = await request.body()
    if len(content) != end - start + 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Taille du segment {index} incorrecte ({len(content)} octets, {end - start + 1} attendus).")
    upload_url = decrypt_secret(pub.upload_url_enc)
    if not upload_url:
        raise HTTPException(status.HTTP_409_CONFLICT, "URL d'envoi TikTok illisible : relancez la publication.")
    try:
        code = await tt.put_chunk(upload_url, content, start, end, pub.video_size, pub.mime_type)
    except tt.TikTokError as e:
        pub.status, pub.fail_reason = "FAILED", e.code
        await db.commit()
        raise _http_error(e)
    if index == pub.total_chunk_count - 1:
        pub.status = "PROCESSING_UPLOAD"
        await db.commit()
    return {"ok": True, "index": index, "http_status": code}


@router.get("/publishes/{publish_id}/status")
async def get_publish_status(publish_id: str, db: AsyncSession = Depends(get_db)):
    pub = await _get_publish(db, publish_id)
    acc = await _get_account(db, pub.open_id)
    token = await _token(db, acc)
    try:
        data = await tt.publish_status(token, publish_id)
    except tt.TikTokError as e:
        raise _http_error(e)
    pub.status = data.get("status") or pub.status
    pub.fail_reason = data.get("fail_reason") or pub.fail_reason
    await db.commit()
    return {
        "status": pub.status,
        "fail_reason": data.get("fail_reason"),
        "uploaded_bytes": data.get("uploaded_bytes"),
        "post_ids": data.get("publicaly_available_post_id") or [],
    }
