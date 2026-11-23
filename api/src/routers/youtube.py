"""Module YouTube « Chapote Publisher » (Shorts) de l'Espace client (/app/youtube).

Chaque tenant (organisation, ou espace perso) connecte SES chaînes YouTube
(OAuth Google) et y envoie SES vidéos (YouTube Data API v3). Tous les appels
Google sont faits côté serveur (services/youtube_service.py).

Mêmes règles que le module TikTok (routers/tiktok.py, dont on reprend le
scoping tenant) : `org_id` absent = espace perso ; sinon il faut être MEMBRE de
l'organisation ; une ressource d'un autre tenant répond 404.

Jeton de service : les routes de publication (config, chaînes, posts)
acceptent `Authorization: Bearer <YOUTUBE_SERVICE_TOKEN>`, au nom de
YOUTUBE_SERVICE_USER_EMAIL (chaîne de production claude-cloud). Connexion et
déconnexion d'une chaîne : session seulement.

OAuth : POST /oauth/start (state JWT signé, 10 min, usage unique) -> Google ->
https://chapote.fr/youtube/callback (page SPA) -> POST /oauth/exchange.

Publication (rien n'est envoyé à YouTube avant « Publier ») :
  1. POST /posts                 -> métadonnées validées
  2. PUT  /posts/{id}/parts/{n}  -> vidéo envoyée à Chapote (morceaux de 8 Mio)
  3. POST /posts/{id}/submit     -> validation (format, durée Short), envoi en tâche de fond
  4. GET  /posts/{id}            -> statut (video_id, URL du Short)
"""
import hmac
import logging
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, get_current_user
from src.core.time import utcnow
from src.models.user import User
from src.models.youtube import (
    POST_ACTIVE,
    POST_QUEUED,
    POST_RECEIVING,
    YouTubeAccount,
    YouTubePost,
)
from src.routers.tiktok import Tenant, _tenant, _tenant_of
from src.services import youtube_jobs
from src.services import youtube_service as yt
from src.services.crypto import decrypt_secret
from src.services.rate_limit import RateLimiter, SingleUseTokens
from src.services.video_probe import ProbeError, probe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/youtube", tags=["youtube"])

STATE_SCOPE = "youtube_oauth"
STATE_TTL_SECONDS = 600
PART_SIZE = 8 * 1024 * 1024
MAX_ACTIVE_POSTS = 3
DISK_MARGIN = 2 * 1024 * 1024 * 1024
MAX_SCHEDULE_AHEAD = timedelta(days=180)

state_store = SingleUseTokens("rl:youtubestate:", STATE_TTL_SECONDS)
oauth_limiter = RateLimiter("rl:youtubeoauth:", 20, 3600)
post_limiter = RateLimiter("rl:youtubepost:", settings.YOUTUBE_DAILY_POSTS, 86400)


# --------------------------------------------------------------------------
# Authentification : session dashboard, ou jeton de service
# --------------------------------------------------------------------------

async def _service_user(db: AsyncSession, given: str) -> User:
    token, email = settings.YOUTUBE_SERVICE_TOKEN, settings.YOUTUBE_SERVICE_USER_EMAIL
    if not token or not email:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jeton de service YouTube non configuré")
    if not given or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton invalide")
    user = (await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )).scalar_one_or_none()
    if user is None or not user.is_active:
        logger.error("YouTube : utilisateur du jeton de service introuvable ou inactif")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jeton de service YouTube mal configuré")
    return user


async def get_youtube_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """Bearer présent = jeton de service (jamais de repli sur le cookie) ; sinon session."""
    auth = request.headers.get("authorization") or ""
    if auth[:7].lower() == "bearer ":
        return await _service_user(db, auth[7:].strip())
    return await get_current_user(request, db)


# --------------------------------------------------------------------------
# Accès
# --------------------------------------------------------------------------

async def _get_account(db: AsyncSession, user: User, account_id: int) -> tuple[YouTubeAccount, Tenant]:
    acc = await db.get(YouTubeAccount, account_id)
    tenant = await _tenant_of(db, user, acc) if acc is not None and acc.revoked_at is None else None
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chaîne YouTube introuvable")
    return acc, tenant


async def _get_post(db: AsyncSession, user: User, post_id: int, *, lock: bool = False) -> YouTubePost:
    stmt = select(YouTubePost).where(YouTubePost.id == post_id)
    if lock:
        stmt = stmt.with_for_update()
    post = (await db.execute(stmt)).scalar_one_or_none()
    if post is None or await _tenant_of(db, user, post) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return post


def _require_enabled() -> None:
    if not yt.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Le module YouTube n'est pas disponible pour le moment.")


def _http_error(e: yt.YouTubeError) -> HTTPException:
    """Jamais de 401 (le front l'interpréterait comme une session Chapote expirée)."""
    code = 429 if e.http_status == 429 or e.code in ("quotaExceeded", "uploadLimitExceeded") \
        else (400 if 400 <= e.http_status < 500 else 502)
    return HTTPException(code, e.describe())


def _can_disconnect(acc: YouTubeAccount, tenant: Tenant, user: User) -> bool:
    return (acc.owner_user_id == user.id or acc.connected_by_user_id == user.id
            or tenant.role == "admin")


def _account_out(acc: YouTubeAccount, tenant: Tenant, user: User) -> dict:
    return {
        "id": acc.id,
        "channel_id": acc.channel_id,
        "title": acc.title,
        "handle": acc.handle,
        "thumbnail_url": acc.thumbnail_url,
        "can_upload": yt.can_upload(acc),
        "needs_reconnect": bool(acc.needs_reconnect),
        "connected_at": acc.created_at.isoformat() if acc.created_at else None,
        "can_disconnect": _can_disconnect(acc, tenant, user),
    }


def _post_out(post: YouTubePost, acc: Optional[YouTubeAccount]) -> dict:
    return {
        "id": post.id,
        "account_id": post.youtube_account_id,
        "account_name": acc.title if acc else None,
        "title": post.title,
        "privacy_status": post.privacy_status,
        "final_privacy": post.final_privacy,
        "publish_at": post.publish_at.isoformat() if post.publish_at else None,
        "made_for_kids": post.made_for_kids,
        "synthetic_media": post.synthetic_media,
        "file_name": post.file_name,
        "video_size": post.video_size,
        "duration_sec": post.duration_sec,
        "status": post.status,
        "upload_status": post.upload_status,
        "video_id": post.video_id,
        "url": f"https://youtube.com/shorts/{post.video_id}" if post.video_id else None,
        "fail_reason": post.fail_reason,
        "error_message": post.error_message,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
    }


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@router.get("/config")
async def youtube_config(user: User = Depends(get_youtube_user)):
    return {
        "enabled": yt.is_enabled(),
        "max_upload_bytes": yt.max_upload_bytes(),
        "max_duration_sec": yt.MAX_DURATION_SEC,
        "part_size": PART_SIZE,
        "title_max": yt.TITLE_MAX,
        "description_max_bytes": yt.DESCRIPTION_MAX_BYTES,
        "tags_max": yt.TAGS_MAX,
        "daily_posts": settings.YOUTUBE_DAILY_POSTS,
        "formats": sorted(yt.ALLOWED_MIME),
    }


class StartIn(BaseModel):
    org_id: Optional[int] = None
    # Site d'où part la connexion (retour sur chapote.fr ou cm.chapote.fr).
    app: Literal["chapote", "cm"] = "chapote"


@router.post("/oauth/start")
async def oauth_start(body: StartIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    _require_enabled()
    tenant = await _tenant(db, user, body.org_id)
    if not await oauth_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives de connexion YouTube. Réessayez dans une heure.")
    state = _encode({"sub": str(user.id), "scope": STATE_SCOPE, "org": tenant.org_id,
                     "jti": uuid.uuid4().hex, "app": body.app},
                    timedelta(seconds=STATE_TTL_SECONDS))
    return {"authorize_url": yt.authorize_url(state, body.app)}


class ExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=2048)


_BAD_STATE = "Lien de connexion YouTube invalide ou expiré : relancez « Se connecter avec Google » depuis l'Espace client."


@router.post("/oauth/exchange")
async def oauth_exchange(body: ExchangeIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    _require_enabled()
    try:
        claims = jwt.decode(body.state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_STATE)
    if claims.get("scope") != STATE_SCOPE or claims.get("sub") != str(user.id) or not claims.get("jti"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_STATE)
    tenant = await _tenant(db, user, claims.get("org"))
    if not await state_store.claim(claims["jti"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_STATE)

    try:
        tok = await yt.exchange_code(body.code, "cm" if claims.get("app") == "cm" else "chapote")
    except yt.YouTubeError as e:
        logger.info("YouTube : échange du code refusé (%s)", e.code)
        raise _http_error(e)
    if not tok.get("access_token"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Réponse Google incomplète : réessayez.")
    if yt.SCOPE_UPLOAD not in (tok.get("scope") or "").split():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, yt.ERROR_MESSAGES["scope_missing"])
    try:
        ch = await yt.my_channel(tok["access_token"])
    except yt.YouTubeError as e:
        raise _http_error(e)

    acc = (await db.execute(
        select(YouTubeAccount).where(tenant.where(YouTubeAccount), YouTubeAccount.channel_id == ch["id"])
    )).scalar_one_or_none()
    if acc is None:
        if not tok.get("refresh_token"):
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Google n'a pas fourni d'accès durable : réessayez.")
        acc = YouTubeAccount(channel_id=ch["id"], organization_id=tenant.org_id,
                             owner_user_id=tenant.owner_user_id)
        db.add(acc)
    acc.connected_by_user_id = user.id
    acc.revoked_at = None
    yt.apply_tokens(acc, tok)
    acc.title = ch["title"] or acc.title
    acc.handle = ch["handle"] or acc.handle
    acc.thumbnail_url = ch["thumbnail_url"] or acc.thumbnail_url
    await db.commit()
    return {"account": _account_out(acc, tenant, user), "org_id": tenant.org_id}


# --------------------------------------------------------------------------
# Chaînes
# --------------------------------------------------------------------------

@router.get("/accounts")
async def list_accounts(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_youtube_user)):
    tenant = await _tenant(db, user, org_id)
    accounts = (await db.execute(
        select(YouTubeAccount).where(tenant.where(YouTubeAccount), YouTubeAccount.revoked_at.is_(None))
        .order_by(YouTubeAccount.created_at)
    )).scalars().all()
    return [_account_out(a, tenant, user) for a in accounts]


@router.delete("/accounts/{account_id}")
async def disconnect_account(account_id: int, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    """Révoque l'autorisation chez Google puis efface les jetons stockés."""
    acc, tenant = await _get_account(db, user, account_id)
    if not _can_disconnect(acc, tenant, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Seul le membre qui a connecté cette chaîne ou un administrateur de l'équipe peut la déconnecter.")
    warning = None
    if yt.is_enabled() and acc.refresh_token_enc:
        try:
            # Révoquer le refresh token retire toute l'autorisation.
            await yt.revoke(decrypt_secret(acc.refresh_token_enc))
        except yt.YouTubeError as e:
            logger.warning("YouTube : révocation de la chaîne %s en échec (%s)", acc.id, e.code)
            warning = ("La révocation chez Google a échoué : jetons supprimés de Chapote. Vous pouvez aussi "
                       "retirer l'accès sur myaccount.google.com/connections.")
    yt.clear_tokens(acc)
    acc.revoked_at = utcnow()
    acc.needs_reconnect = False
    await db.commit()
    return {"ok": True, "warning": warning}


# --------------------------------------------------------------------------
# Publications
# --------------------------------------------------------------------------

def _tags_length(tags: list[str]) -> int:
    """Longueur comptée par YouTube : virgules entre les mots-clés, guillemets
    autour d'un mot-clé qui contient un espace."""
    return sum(len(t) + (2 if " " in t else 0) for t in tags) + max(len(tags) - 1, 0)


class PostIn(BaseModel):
    account_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=100)
    category_id: str = Field(default=yt.DEFAULT_CATEGORY, pattern=r"^\d{1,3}$")
    default_language: Optional[str] = Field(default=None, pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$")
    privacy_status: Literal["public", "unlisted", "private"]
    publish_at: Optional[datetime] = None
    made_for_kids: bool
    synthetic_media: bool = False
    notify_subscribers: bool = True
    file_name: str = Field(default="", max_length=255)
    video_size: int = Field(gt=0)


@router.post("/posts")
async def create_post(body: PostIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_youtube_user)):
    """Clic « Publier » : valide la demande et prépare la réception de la vidéo."""
    _require_enabled()
    acc, tenant = await _get_account(db, user, body.account_id)
    if acc.needs_reconnect:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette chaîne YouTube doit être reconnectée.")
    if not yt.can_upload(acc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, yt.ERROR_MESSAGES["scope_missing"])
    if body.video_size > yt.max_upload_bytes():
        raise HTTPException(413, f"Vidéo trop volumineuse ({yt.max_upload_bytes() // (1024 * 1024)} Mo maximum).")
    title = body.title.strip()
    if not title or len(title) > yt.TITLE_MAX or "<" in title or ">" in title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, yt.ERROR_MESSAGES["invalidTitle"])
    desc = body.description
    if len(desc.encode("utf-8")) > yt.DESCRIPTION_MAX_BYTES or "<" in desc or ">" in desc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, yt.ERROR_MESSAGES["invalidDescription"])
    tags = [t.strip().lstrip("#") for t in body.tags if t.strip().lstrip("#")]
    if _tags_length(tags) > yt.TAGS_MAX or any("<" in t or ">" in t or "," in t for t in tags):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, yt.ERROR_MESSAGES["invalidTags"])
    publish_at = None
    if body.publish_at is not None:
        pa = body.publish_at
        pa = pa.astimezone(timezone.utc).replace(tzinfo=None) if pa.tzinfo else pa
        now = utcnow()
        if pa < now + timedelta(minutes=5) or pa > now + MAX_SCHEDULE_AHEAD:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "La mise en ligne programmée doit être entre 5 minutes et 6 mois à l'avance.")
        publish_at = pa

    active = (await db.execute(
        select(func.count()).select_from(YouTubePost)
        .where(tenant.where(YouTubePost), YouTubePost.status.in_(POST_ACTIVE))
    )).scalar() or 0
    if active >= MAX_ACTIVE_POSTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Des publications sont déjà en cours d'envoi : attendez qu'elles se terminent.")
    if not await post_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite quotidienne de vidéos YouTube atteinte pour votre espace. Réessayez demain.")
    folder = youtube_jobs.tmp_dir()
    if shutil.disk_usage(folder).free < body.video_size + DISK_MARGIN:
        logger.error("YouTube : espace disque insuffisant pour une vidéo de %s octets", body.video_size)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Envoi impossible pour le moment (capacité temporairement atteinte). Réessayez plus tard.")

    path = folder / f"{uuid.uuid4().hex}.part"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    post = YouTubePost(
        organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
        youtube_account_id=acc.id, user_id=user.id,
        title=title, description=desc or None, tags=tags or None,
        category_id=body.category_id, default_language=body.default_language,
        privacy_status="private" if publish_at else body.privacy_status, publish_at=publish_at,
        made_for_kids=body.made_for_kids, synthetic_media=body.synthetic_media,
        notify_subscribers=body.notify_subscribers,
        file_name=os.path.basename(body.file_name)[:255] or None,
        video_size=body.video_size, received_bytes=0, tmp_path=str(path), status=POST_RECEIVING,
    )
    db.add(post)
    await db.commit()
    parts = -(-body.video_size // PART_SIZE)
    return {"post_id": post.id, "part_size": PART_SIZE, "part_count": parts}


@router.put("/posts/{post_id}/parts/{index}")
async def upload_part(post_id: int, index: int, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_youtube_user)):
    """Reçoit le morceau `index` de la vidéo (corps brut, envoi séquentiel)."""
    post = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING or not post.tmp_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'attend plus de vidéo.")
    start = index * PART_SIZE
    if index < 0 or start >= post.video_size:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Morceau hors limites.")
    expected = min(PART_SIZE, post.video_size - start)
    content = await request.body()
    if len(content) != expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Taille du morceau {index} incorrecte ({len(content)} octets, {expected} attendus).")
    if start + expected <= post.received_bytes:
        return {"ok": True, "received_bytes": post.received_bytes}
    if start != post.received_bytes:
        raise HTTPException(status.HTTP_409_CONFLICT, "Morceaux reçus dans le désordre : relancez la publication.")
    with open(post.tmp_path, "r+b") as f:
        f.seek(start)
        f.write(content)
    post.received_bytes = start + expected
    await db.commit()
    return {"ok": True, "received_bytes": post.received_bytes}


async def _reject(db: AsyncSession, post: YouTubePost, code: str, message: str, http: int = 400):
    youtube_jobs._fail(post, code, message)
    await db.commit()
    raise HTTPException(http, message)


@router.post("/posts/{post_id}/submit")
async def submit_post(post_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_youtube_user)):
    """Vidéo reçue : validation (format, taille, durée d'un Short), puis envoi en tâche de fond."""
    _require_enabled()
    post = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication a déjà été envoyée.")
    if post.received_bytes != post.video_size or not post.tmp_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "La vidéo n'a pas été entièrement reçue.")
    if os.path.getsize(post.tmp_path) != post.video_size:
        await _reject(db, post, "size_mismatch", "Taille de la vidéo reçue incorrecte : relancez la publication.")
    try:
        video = probe(post.tmp_path)
    except ProbeError as e:
        await _reject(db, post, "invalid_video", f"Vidéo refusée : {e}.")
    if video.mime_type not in yt.ALLOWED_MIME:
        await _reject(db, post, "invalid_video", "Format non pris en charge (MP4, MOV ou WebM).")
    if video.duration_sec > yt.MAX_DURATION_SEC:
        await _reject(db, post, "duration_check_failed",
                      f"Vidéo trop longue pour un Short : {int(video.duration_sec)} s pour {yt.MAX_DURATION_SEC} s maximum.")
    post.mime_type = video.mime_type
    post.duration_sec = round(video.duration_sec, 2)
    acc = await db.get(YouTubeAccount, post.youtube_account_id)
    if acc is None or acc.revoked_at is not None:
        await _reject(db, post, "account_removed", "Cette chaîne YouTube a été déconnectée.", 409)
    if acc.needs_reconnect:
        await _reject(db, post, "reconnect_required", yt.ERROR_MESSAGES["invalid_grant"], 409)
    post.status = POST_QUEUED
    await db.commit()
    youtube_jobs.launch(post.id)
    return _post_out(post, acc)


@router.delete("/posts/{post_id}")
async def cancel_post(post_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_youtube_user)):
    post = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication ne peut plus être annulée.")
    youtube_jobs._fail(post, "cancelled", "Publication annulée.")
    await db.commit()
    return {"ok": True}


@router.get("/posts")
async def list_posts(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_youtube_user)):
    tenant = await _tenant(db, user, org_id)
    posts = (await db.execute(
        select(YouTubePost).where(tenant.where(YouTubePost))
        .order_by(YouTubePost.created_at.desc(), YouTubePost.id.desc()).limit(100)
    )).scalars().all()
    accounts = {a.id: a for a in (await db.execute(
        select(YouTubeAccount).where(tenant.where(YouTubeAccount))
    )).scalars().all()}
    return [_post_out(p, accounts.get(p.youtube_account_id)) for p in posts]


@router.get("/posts/{post_id}")
async def get_post(post_id: int, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_youtube_user)):
    post = await _get_post(db, user, post_id)
    return _post_out(post, await db.get(YouTubeAccount, post.youtube_account_id))
