"""Module TikTok « Chapote Publisher » de l'Espace client (/app/tiktok).

Chaque tenant (organisation, ou espace perso) connecte SES comptes TikTok
(Login Kit) et y publie SES vidéos (Content Posting API). Tous les appels
TikTok sont faits côté serveur (services/tiktok_service.py) : le navigateur n'a
ni client_secret ni jeton.

Scoping tenant : `org_id` absent = espace perso de l'utilisateur ; sinon il
faut être MEMBRE de l'organisation (pas de passe-droit superadmin : le staff
n'utilise pas les comptes TikTok des clients). Un compte / une publication d'un
autre tenant répond 404 (anti-énumération).

Flux OAuth : POST /oauth/start (state JWT signé, 10 min, usage unique) ->
TikTok -> https://chapote.fr/tiktok/callback (page SPA) -> POST /oauth/exchange.

Flux de publication (rien n'est envoyé à TikTok avant le clic « Publier ») :
  1. GET  /accounts/{id}/creator-info  -> options du créateur (à chaque ouverture)
  2. POST /posts                       -> clic « Publier » : métadonnées validées
  3. PUT  /posts/{id}/parts/{n}        -> vidéo envoyée à Chapote (parts de 8 Mio)
  4. POST /posts/{id}/submit           -> validation serveur, envoi TikTok en tâche de fond
  5. GET  /posts/{id}                  -> statut (suivi par la tâche de fond)
"""
import logging
import os
import shutil
import uuid
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, get_current_user, get_membership
from src.core.time import utcnow
from src.models.tiktok import (
    POST_ACTIVE,
    POST_QUEUED,
    POST_RECEIVING,
    TikTokAccount,
    TikTokPost,
)
from src.models.user import User
from src.services import tiktok_jobs
from src.services import tiktok_service as tt
from src.services.rate_limit import RateLimiter, SingleUseTokens
from src.services.video_probe import ProbeError, probe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tiktok", tags=["tiktok"])

STATE_SCOPE = "tiktok_oauth"
STATE_TTL_SECONDS = 600
# Morceaux de la vidéo envoyés à Chapote : sous la limite de corps du reverse
# proxy (50 Mo) et indépendants du découpage TikTok (fait côté serveur).
PART_SIZE = 8 * 1024 * 1024
# Publications en cours simultanément par tenant (borne aussi le disque).
MAX_ACTIVE_POSTS = 3
# Marge d'espace disque laissée libre après réception d'une vidéo.
DISK_MARGIN = 2 * 1024 * 1024 * 1024

state_store = SingleUseTokens("rl:tiktokstate:", STATE_TTL_SECONDS)
oauth_limiter = RateLimiter("rl:tiktokoauth:", 20, 3600)
post_limiter = RateLimiter("rl:tiktokpost:", 30, 86400)


# --------------------------------------------------------------------------
# Tenant & accès
# --------------------------------------------------------------------------

class Tenant:
    def __init__(self, org_id: Optional[int], owner_user_id: Optional[int], role: Optional[str]):
        self.org_id = org_id
        self.owner_user_id = owner_user_id
        self.role = role   # rôle dans l'org (None = espace perso)

    @property
    def key(self) -> str:
        return f"org:{self.org_id}" if self.org_id else f"user:{self.owner_user_id}"

    def where(self, model):
        if self.org_id:
            return model.organization_id == self.org_id
        return model.owner_user_id == self.owner_user_id


async def _tenant(db: AsyncSession, user: User, org_id: Optional[int]) -> Tenant:
    if org_id is None:
        return Tenant(None, user.id, None)
    membership = await get_membership(org_id, user, db)
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    return Tenant(org_id, None, membership.role)


async def _tenant_of(db: AsyncSession, user: User, row) -> Optional[Tenant]:
    """Tenant d'une ligne (compte/post) si l'utilisateur y a accès, sinon None."""
    if row.owner_user_id is not None:
        return Tenant(None, user.id, None) if row.owner_user_id == user.id else None
    membership = await get_membership(row.organization_id, user, db)
    return Tenant(row.organization_id, None, membership.role) if membership else None


async def _get_account(db: AsyncSession, user: User, account_id: int) -> tuple[TikTokAccount, Tenant]:
    acc = await db.get(TikTokAccount, account_id)
    tenant = await _tenant_of(db, user, acc) if acc is not None and acc.revoked_at is None else None
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte TikTok introuvable")
    return acc, tenant


async def _get_post(db: AsyncSession, user: User, post_id: int, *, lock: bool = False) -> TikTokPost:
    stmt = select(TikTokPost).where(TikTokPost.id == post_id)
    if lock:
        stmt = stmt.with_for_update()
    post = (await db.execute(stmt)).scalar_one_or_none()
    if post is None or await _tenant_of(db, user, post) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return post


def _require_enabled() -> None:
    if not tt.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Le module TikTok n'est pas disponible pour le moment.")


def _http_error(e: tt.TikTokError) -> HTTPException:
    """Erreur TikTok -> HTTPException lisible. Jamais de 401 (le front
    l'interpréterait comme une session Chapote expirée)."""
    code = 429 if e.http_status == 429 else (400 if 400 <= e.http_status < 500 else 502)
    return HTTPException(code, e.describe())


async def _token(db: AsyncSession, acc: TikTokAccount) -> str:
    try:
        return await tt.valid_access_token(db, acc)
    except tt.ReconnectRequired:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "L'autorisation TikTok de ce compte a expiré ou a été révoquée : reconnectez-le.")
    except tt.TikTokError as e:
        raise _http_error(e)


def _scopes(acc: TikTokAccount) -> set[str]:
    return set((acc.scopes or "").split(","))


def _can_disconnect(acc: TikTokAccount, tenant: Tenant, user: User) -> bool:
    return (acc.owner_user_id == user.id or acc.connected_by_user_id == user.id
            or tenant.role == "admin")


def _account_out(acc: TikTokAccount, tenant: Tenant, user: User) -> dict:
    scopes = _scopes(acc)
    return {
        "id": acc.id,
        "display_name": acc.display_name,
        "avatar_url": acc.avatar_url,
        "can_publish": "video.publish" in scopes,
        "can_upload": "video.upload" in scopes,
        "needs_reconnect": bool(acc.needs_reconnect),
        "connected_at": acc.created_at.isoformat() if acc.created_at else None,
        "can_disconnect": _can_disconnect(acc, tenant, user),
    }


def _post_out(post: TikTokPost, acc: Optional[TikTokAccount]) -> dict:
    return {
        "id": post.id,
        "account_id": post.tiktok_account_id,
        "account_name": acc.display_name if acc else None,
        "mode": post.mode,
        "title": post.title,
        "privacy_level": post.privacy_level,
        "brand_organic": post.brand_organic,
        "brand_content": post.brand_content,
        "file_name": post.file_name,
        "video_size": post.video_size,
        "status": post.status,
        "fail_reason": post.fail_reason,
        "error_message": post.error_message,
        "post_ids": post.post_ids or [],
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
    }


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@router.get("/config")
async def tiktok_config(user: User = Depends(get_current_user)):
    return {
        "enabled": tt.is_enabled(),
        "max_upload_bytes": tt.max_upload_bytes(),
        "max_duration_sec": tt.MAX_DURATION_SEC,
        "part_size": PART_SIZE,
        "title_max": tt.TITLE_MAX,
        "formats": sorted(tt.ALLOWED_MIME),
    }


class StartIn(BaseModel):
    org_id: Optional[int] = None


@router.post("/oauth/start")
async def oauth_start(body: StartIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """URL d'autorisation TikTok. Le state est un JWT signé (tenant + utilisateur
    + jti), valable 10 min et consommé une seule fois au retour."""
    _require_enabled()
    tenant = await _tenant(db, user, body.org_id)
    if not await oauth_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives de connexion TikTok. Réessayez dans une heure.")
    state = _encode({"sub": str(user.id), "scope": STATE_SCOPE, "org": tenant.org_id,
                     "jti": uuid.uuid4().hex}, timedelta(seconds=STATE_TTL_SECONDS))
    return {"authorize_url": tt.authorize_url(state)}


class ExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=2048)


_BAD_STATE = "Lien de connexion TikTok invalide ou expiré : relancez « Se connecter avec TikTok » depuis l'Espace client."


@router.post("/oauth/exchange")
async def oauth_exchange(body: ExchangeIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """Vérifie le state, échange le code contre les jetons, enregistre le compte
    dans le tenant d'origine (upsert tenant + open_id)."""
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
        tok = await tt.exchange_code(body.code)
    except tt.TikTokError as e:
        logger.info("TikTok : échange du code refusé (%s, log_id %s)", e.code, e.log_id)
        raise _http_error(e)
    open_id = tok.get("open_id")
    if not open_id or not tok.get("access_token") or not tok.get("refresh_token"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Réponse TikTok incomplète : réessayez.")

    acc = (await db.execute(
        select(TikTokAccount).where(tenant.where(TikTokAccount), TikTokAccount.open_id == open_id)
    )).scalar_one_or_none()
    if acc is None:
        acc = TikTokAccount(open_id=open_id, organization_id=tenant.org_id,
                            owner_user_id=tenant.owner_user_id)
        db.add(acc)
    acc.connected_by_user_id = user.id
    acc.revoked_at = None
    tt.apply_tokens(acc, tok)
    try:
        info = await tt.user_info(tok["access_token"])
        acc.display_name = info.get("display_name") or acc.display_name
        acc.avatar_url = info.get("avatar_url") or acc.avatar_url
    except tt.TikTokError as e:
        logger.warning("TikTok : user/info en échec après connexion (%s)", e.code)
    await db.commit()
    return {"account": _account_out(acc, tenant, user), "org_id": tenant.org_id}


# --------------------------------------------------------------------------
# Comptes
# --------------------------------------------------------------------------

@router.get("/accounts")
async def list_accounts(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    tenant = await _tenant(db, user, org_id)
    accounts = (await db.execute(
        select(TikTokAccount).where(tenant.where(TikTokAccount), TikTokAccount.revoked_at.is_(None))
        .order_by(TikTokAccount.created_at)
    )).scalars().all()
    return [_account_out(a, tenant, user) for a in accounts]


@router.delete("/accounts/{account_id}")
async def disconnect_account(account_id: int, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    """Révoque l'autorisation chez TikTok puis efface les jetons stockés."""
    acc, tenant = await _get_account(db, user, account_id)
    if not _can_disconnect(acc, tenant, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Seul le membre qui a connecté ce compte ou un administrateur de l'équipe peut le déconnecter.")
    warning = None
    if tt.is_enabled() and acc.refresh_token_enc:
        try:
            token = await tt.valid_access_token(db, acc)
            await tt.revoke(token)
        except tt.ReconnectRequired:
            warning = "L'autorisation avait déjà expiré côté TikTok : jetons supprimés de Chapote."
        except tt.TikTokError as e:
            logger.warning("TikTok : révocation du compte %s en échec (%s)", acc.id, e.code)
            warning = "La révocation chez TikTok a échoué : jetons supprimés de Chapote. Vous pouvez aussi retirer l'accès depuis l'app TikTok (Paramètres > Sécurité > Applications)."
    tt.clear_tokens(acc)
    acc.revoked_at = utcnow()
    acc.needs_reconnect = False
    await db.commit()
    return {"ok": True, "warning": warning}


async def _creator_info(db: AsyncSession, acc: TikTokAccount) -> dict:
    """creator_info normalisé ; can_post=False si TikTok refuse la publication."""
    token = await _token(db, acc)
    try:
        info = await tt.creator_info(token)
    except tt.TikTokError as e:
        if e.code in tt.CANNOT_POST:
            return {"can_post": False, "reason_code": e.code, "message": e.describe(), "creator": None}
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


@router.get("/accounts/{account_id}/creator-info")
async def get_creator_info(account_id: int, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    _require_enabled()
    acc, _ = await _get_account(db, user, account_id)
    return await _creator_info(db, acc)


# --------------------------------------------------------------------------
# Publications
# --------------------------------------------------------------------------

def _utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


class PostIn(BaseModel):
    account_id: int
    mode: Literal["direct", "draft"]
    title: str = Field(default="", max_length=4400)
    privacy_level: Optional[str] = None
    allow_comment: bool = False
    allow_duet: bool = False
    allow_stitch: bool = False
    brand_organic: bool = False      # « Votre marque »
    brand_content: bool = False      # « Contenu de marque »
    file_name: str = Field(default="", max_length=255)
    video_size: int = Field(gt=0)


@router.post("/posts")
async def create_post(body: PostIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Clic « Publier » : valide la demande et prépare la réception de la vidéo."""
    _require_enabled()
    acc, tenant = await _get_account(db, user, body.account_id)
    if acc.needs_reconnect:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce compte TikTok doit être reconnecté.")
    needed = "video.publish" if body.mode == "direct" else "video.upload"
    if needed not in _scopes(acc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, tt.ERROR_MESSAGES["scope_not_authorized"])
    if body.video_size > tt.max_upload_bytes():
        raise HTTPException(413,
                            f"Vidéo trop volumineuse ({tt.max_upload_bytes() // (1024 * 1024)} Mo maximum).")
    if body.mode == "direct":
        if not body.privacy_level:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choisissez qui peut voir cette vidéo.")
        if body.brand_content and body.privacy_level == "SELF_ONLY":
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "La visibilité d'un contenu de marque ne peut pas être privée.")
        if _utf16_len(body.title) > tt.TITLE_MAX:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Titre trop long ({tt.TITLE_MAX} caractères maximum).")

    active = (await db.execute(
        select(func.count()).select_from(TikTokPost)
        .where(tenant.where(TikTokPost), TikTokPost.status.in_(POST_ACTIVE))
    )).scalar() or 0
    if active >= MAX_ACTIVE_POSTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Des publications sont déjà en cours d'envoi : attendez qu'elles se terminent.")
    if not await post_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite quotidienne de publications atteinte pour votre espace. Réessayez demain.")
    folder = tiktok_jobs.tmp_dir()
    if shutil.disk_usage(folder).free < body.video_size + DISK_MARGIN:
        logger.error("TikTok : espace disque insuffisant pour une vidéo de %s octets", body.video_size)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Envoi impossible pour le moment (capacité temporairement atteinte). Réessayez plus tard.")

    direct = body.mode == "direct"
    path = folder / f"{uuid.uuid4().hex}.part"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    post = TikTokPost(
        organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
        tiktok_account_id=acc.id, user_id=user.id, mode=body.mode,
        title=body.title if direct else None,
        privacy_level=body.privacy_level if direct else None,
        disable_comment=not body.allow_comment, disable_duet=not body.allow_duet,
        disable_stitch=not body.allow_stitch,
        brand_organic=direct and body.brand_organic, brand_content=direct and body.brand_content,
        file_name=os.path.basename(body.file_name)[:255] or None,
        video_size=body.video_size, received_bytes=0, tmp_path=str(path), status=POST_RECEIVING,
    )
    db.add(post)
    await db.commit()
    parts = -(-body.video_size // PART_SIZE)
    return {"post_id": post.id, "part_size": PART_SIZE, "part_count": parts}


@router.put("/posts/{post_id}/parts/{index}")
async def upload_part(post_id: int, index: int, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
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
        return {"ok": True, "received_bytes": post.received_bytes}   # renvoi d'un morceau déjà reçu
    if start != post.received_bytes:
        raise HTTPException(status.HTTP_409_CONFLICT, "Morceaux reçus dans le désordre : relancez la publication.")
    with open(post.tmp_path, "r+b") as f:
        f.seek(start)
        f.write(content)
    post.received_bytes = start + expected
    await db.commit()
    return {"ok": True, "received_bytes": post.received_bytes}


async def _reject(db: AsyncSession, post: TikTokPost, code: str, message: str, http: int = 400):
    tiktok_jobs._fail(post, code, message)
    await db.commit()
    raise HTTPException(http, message)


@router.post("/posts/{post_id}/submit")
async def submit_post(post_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Vidéo reçue : validation serveur (format, taille, durée, options du
    créateur), puis envoi à TikTok en tâche de fond."""
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
    if video.mime_type not in tt.ALLOWED_MIME:
        await _reject(db, post, "invalid_video", "Format non pris en charge (MP4, MOV ou WebM).")
    post.mime_type = video.mime_type
    post.duration_sec = round(video.duration_sec, 2)

    acc = await db.get(TikTokAccount, post.tiktok_account_id)
    if acc is None or acc.revoked_at is not None:
        await _reject(db, post, "account_removed", "Ce compte TikTok a été déconnecté.", 409)
    try:
        info = await _creator_info(db, acc)
    except HTTPException as e:
        await _reject(db, post, "creator_info_failed", str(e.detail), e.status_code)
    if not info["can_post"]:
        await _reject(db, post, info["reason_code"], info["message"], 409)
    creator = info["creator"]
    max_dur = min(creator["max_video_post_duration_sec"] or tt.MAX_DURATION_SEC, tt.MAX_DURATION_SEC)
    if video.duration_sec > max_dur:
        await _reject(db, post, "duration_check_failed",
                      f"Vidéo trop longue : {int(video.duration_sec)} s pour {max_dur} s maximum sur ce compte.")
    if post.mode == "direct":
        if post.privacy_level not in creator["privacy_level_options"]:
            await _reject(db, post, "privacy_level_option_mismatch",
                          tt.ERROR_MESSAGES["privacy_level_option_mismatch"])
        # Une interaction désactivée par le créateur reste désactivée.
        post.disable_comment = post.disable_comment or creator["comment_disabled"]
        post.disable_duet = post.disable_duet or creator["duet_disabled"]
        post.disable_stitch = post.disable_stitch or creator["stitch_disabled"]

    post.status = POST_QUEUED
    await db.commit()
    tiktok_jobs.launch(post.id)
    return _post_out(post, acc)


@router.delete("/posts/{post_id}")
async def cancel_post(post_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Annule une publication dont la vidéo est encore en cours d'envoi vers Chapote."""
    post = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication ne peut plus être annulée.")
    tiktok_jobs._fail(post, "cancelled", "Publication annulée.")
    await db.commit()
    return {"ok": True}


@router.get("/posts")
async def list_posts(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    tenant = await _tenant(db, user, org_id)
    posts = (await db.execute(
        select(TikTokPost).where(tenant.where(TikTokPost))
        .order_by(TikTokPost.created_at.desc(), TikTokPost.id.desc()).limit(100)
    )).scalars().all()
    accounts = {a.id: a for a in (await db.execute(
        select(TikTokAccount).where(tenant.where(TikTokAccount))
    )).scalars().all()}
    return [_post_out(p, accounts.get(p.tiktok_account_id)) for p in posts]


@router.get("/posts/{post_id}")
async def get_post(post_id: int, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    post = await _get_post(db, user, post_id)
    return _post_out(post, await db.get(TikTokAccount, post.tiktok_account_id))

