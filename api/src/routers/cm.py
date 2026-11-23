"""cm.chapote.fr — gestion des réseaux sociaux (TikTok, YouTube, Instagram).

Même compte que chapote.fr (cookie de session partagé). Mêmes règles de tenant
que les modules TikTok et YouTube (routers/tiktok.py) : `org_id` absent = espace
perso ; sinon il faut être MEMBRE de l'organisation ; une ressource d'un autre
tenant répond 404.

Jeton de service : toutes les routes de lecture et de publication acceptent
`Authorization: Bearer <CM_SERVICE_TOKEN>` (routine Claude), au nom de
CM_SERVICE_USER_EMAIL. Les routes /routine/* l'exigent. La connexion et la
déconnexion d'un compte restent réservées à la session.

Publication d'une vidéo sur plusieurs comptes :
  1. POST /posts                -> métadonnées + cibles (compte, heure, options) validées
  2. PUT  /posts/{id}/parts/{n} -> vidéo envoyée à Chapote (morceaux de 8 Mio)
  3. POST /posts/{id}/submit    -> lecture du format et de la durée, cibles programmées
  4. à l'heure de chaque cible, la tâche de fond publie (services/cm_jobs.py)

Instagram : connexion officielle (POST /instagram/oauth/start -> Instagram ->
https://cm.chapote.fr/instagram/callback -> POST /instagram/oauth/exchange) ou
compte « géré par la routine » (publication et chiffres par la routine Claude).
"""
import hmac
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, get_current_user
from src.core.time import utcnow
from src.models.cm import (
    IG_MODE_API,
    IG_MODE_ROUTINE,
    PLATFORMS,
    POST_CANCELLED,
    POST_READY,
    POST_RECEIVING,
    T_AWAITING_ROUTINE,
    T_CANCELLED,
    T_DRAFT,
    T_EDITABLE,
    T_FAILED,
    T_FINAL,
    T_PUBLISHED,
    T_PUBLISHING,
    T_ROUTINE_CLAIMED,
    T_SCHEDULED,
    CmAccountStat,
    CmPost,
    CmTarget,
    CmVideo,
    InstagramAccount,
)
from src.models.user import Membership, Organization, User
from src.routers.tiktok import Tenant, _tenant
from src.services import cm_jobs
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import tiktok_service as tt
from src.services import youtube_service as yt
from src.services.rate_limit import RateLimiter, SingleUseTokens
from src.services.video_probe import ProbeError, probe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cm", tags=["cm"])

STATE_SCOPE = "instagram_oauth"
STATE_TTL_SECONDS = 600
MAX_TARGETS = 12
MAX_RECEIVING = 3

state_store = SingleUseTokens("rl:igstate:", STATE_TTL_SECONDS)
oauth_limiter = RateLimiter("rl:igoauth:", 20, 3600)
post_limiter = RateLimiter("rl:cmpost:", 60, 86400)
sync_limiter = RateLimiter("rl:cmsync:", 6, 3600)


# --------------------------------------------------------------------------
# Authentification : session, ou jeton de service (routine)
# --------------------------------------------------------------------------

def _bearer(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization") or ""
    return auth[7:].strip() if auth[:7].lower() == "bearer " else None


async def _service_user(db: AsyncSession, given: str) -> User:
    token, email = settings.CM_SERVICE_TOKEN, settings.CM_SERVICE_USER_EMAIL
    if not token or not email:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jeton de service cm non configuré")
    if not given or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton invalide")
    user = (await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )).scalar_one_or_none()
    if user is None or not user.is_active:
        logger.error("cm : utilisateur du jeton de service introuvable ou inactif")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jeton de service cm mal configuré")
    return user


async def get_cm_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """Bearer présent = jeton de service (jamais de repli sur le cookie) ; sinon session."""
    given = _bearer(request)
    if given is not None:
        return await _service_user(db, given)
    return await get_current_user(request, db)


async def get_routine_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    given = _bearer(request)
    if given is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton de service requis")
    return await _service_user(db, given)


def _same(row, tenant: Tenant) -> bool:
    if tenant.org_id:
        return row.organization_id == tenant.org_id
    return row.owner_user_id == tenant.owner_user_id


async def _tenant_for_row(db: AsyncSession, user: User, row) -> Optional[Tenant]:
    from src.routers.tiktok import _tenant_of
    return await _tenant_of(db, user, row)


# --------------------------------------------------------------------------
# Santé, configuration, espaces
# --------------------------------------------------------------------------

@router.get("/health")
async def health():
    return {"ok": True, "tiktok": tt.is_enabled(), "youtube": yt.is_enabled(), "instagram_api": ig.is_enabled()}


@router.get("/public-config")
async def public_config():
    """Avant connexion : bouton Google (Client ID public) et lien vers chapote.fr."""
    return {"google_client_id": settings.GOOGLE_CLIENT_ID or None, "app_url": settings.APP_URL}


@router.get("/config")
async def config(user: User = Depends(get_cm_user)):
    return {
        "tiktok": tt.is_enabled(),
        "youtube": yt.is_enabled(),
        "instagram_api": ig.is_enabled(),
        "max_upload_bytes": cm.max_upload_bytes(),
        "part_size": cm.PART_SIZE,
        "tiktok_title_max": tt.TITLE_MAX,
        "youtube_title_max": yt.TITLE_MAX,
        "youtube_max_duration_sec": yt.MAX_DURATION_SEC,
        "youtube_daily_posts": settings.YOUTUBE_DAILY_POSTS,
        "instagram_caption_max": ig.CAPTION_MAX,
        "instagram_max_duration_sec": ig.MAX_DURATION_SEC,
        "tiktok_stats": bool({tt.SCOPE_STATS, tt.SCOPE_VIDEO_LIST} & set(tt.scopes().split(","))),
        "google_client_id": settings.GOOGLE_CLIENT_ID or None,
        "app_url": settings.APP_URL,
    }


@router.get("/spaces")
async def spaces(db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Espace perso + organisations dont l'utilisateur est membre."""
    rows = (await db.execute(
        select(Organization, Membership).join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id, Organization.is_active.is_(True)).order_by(Organization.name)
    )).all()
    return [{"org_id": None, "name": "Espace perso", "role": None}] + [
        {"org_id": o.id, "name": o.name, "role": m.role} for o, m in rows]


# --------------------------------------------------------------------------
# Comptes et statistiques
# --------------------------------------------------------------------------

async def _latest_stats(db: AsyncSession, platform: str, account_id: int, days: int):
    rows = (await db.execute(
        select(CmAccountStat).where(CmAccountStat.platform == platform, CmAccountStat.account_id == account_id)
        .order_by(CmAccountStat.day.desc()).limit(days + 1)
    )).scalars().all()
    if not rows:
        return None, None
    since = utcnow().date() - timedelta(days=days)
    previous = next((r for r in rows if r.day <= since), rows[-1] if len(rows) > 1 else None)
    return rows[0], previous


@router.get("/accounts")
async def list_accounts(org_id: Optional[int] = Query(None), days: int = Query(7, ge=1, le=90),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    out = []
    for platform, acc in await cm.tenant_accounts(db, tenant):
        stat, previous = await _latest_stats(db, platform, acc.id, days)
        out.append(cm.account_view(platform, acc, stat, previous if previous is not stat else None))
    return out


@router.post("/accounts/{platform}/{account_id}/sync")
async def sync_account(platform: Literal["tiktok", "youtube", "instagram"], account_id: int,
                       org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    acc = await cm.get_account(db, tenant, platform, account_id)
    if not await sync_limiter.check(f"{platform}:{acc.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Chiffres déjà actualisés récemment : réessayez plus tard.")
    stat = await cm.sync_account(db, platform, acc)
    return cm.account_view(platform, acc, stat)


def _video_out(v: CmVideo, names: dict) -> dict:
    return {
        "id": v.id, "platform": v.platform, "account_id": v.account_id,
        "account_name": names.get((v.platform, v.account_id)), "external_id": v.external_id,
        "title": v.title, "url": v.url, "thumbnail_url": v.thumbnail_url,
        "published_at": cm.iso(v.published_at), "duration_sec": v.duration_sec,
        "views": v.views, "likes": v.likes, "comments": v.comments, "shares": v.shares, "saves": v.saves,
        "via_chapote": v.target_id is not None, "stats_updated_at": cm.iso(v.stats_updated_at),
    }


async def _tenant_index(db: AsyncSession, tenant: Tenant):
    accounts = await cm.tenant_accounts(db, tenant)
    names = {(p, a.id): cm.account_name(p, a) for p, a in accounts}
    return accounts, names


def _account_filter(model, accounts, platform: Optional[str] = None, account_id: Optional[int] = None):
    from sqlalchemy import and_, false, or_
    conds = []
    for p in PLATFORMS:
        if platform and p != platform:
            continue
        ids = [a.id for pl, a in accounts if pl == p and (account_id is None or a.id == account_id)]
        if ids:
            conds.append(and_(model.platform == p, model.account_id.in_(ids)))
    return or_(*conds) if conds else false()


@router.get("/videos")
async def list_videos(org_id: Optional[int] = Query(None), platform: Optional[Literal["tiktok", "youtube", "instagram"]] = None,
                      account_id: Optional[int] = None, sort: Literal["recent", "views"] = "recent",
                      limit: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant)
    order = (CmVideo.views.desc().nulls_last(),) if sort == "views" else (CmVideo.published_at.desc().nulls_last(),)
    rows = (await db.execute(
        select(CmVideo).where(_account_filter(CmVideo, accounts, platform, account_id))
        .order_by(*order, CmVideo.id.desc()).limit(limit)
    )).scalars().all()
    return [_video_out(v, names) for v in rows]


@router.get("/overview")
async def overview(org_id: Optional[int] = Query(None), days: int = Query(30, ge=7, le=365),
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Tableau de bord : totaux, évolution jour par jour, comptes, vidéos phares, à venir."""
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant)
    since = utcnow().date() - timedelta(days=days)
    stats = (await db.execute(
        select(CmAccountStat).where(_account_filter(CmAccountStat, accounts), CmAccountStat.day >= since)
        .order_by(CmAccountStat.day)
    )).scalars().all()

    # Série par jour : dernière valeur connue de chaque compte (report des jours sans relevé).
    by_account: dict = {}
    for s in stats:
        by_account.setdefault((s.platform, s.account_id), {})[s.day] = s
    series = []
    last_known: dict = {}
    day = since
    today = utcnow().date()
    while day <= today:
        point = {"day": day.isoformat(), "views": None, "followers": None, "by_platform": {}}
        for key, per_day in by_account.items():
            if day in per_day and (per_day[day].views is not None or per_day[day].followers is not None):
                last_known[key] = per_day[day]
            s = last_known.get(key)
            if s is None:
                continue
            for field in ("views", "followers"):
                v = getattr(s, field)
                if v is not None:
                    point[field] = (point[field] or 0) + v
            bp = point["by_platform"].setdefault(key[0], {"views": None, "followers": None})
            for field in ("views", "followers"):
                v = getattr(s, field)
                if v is not None:
                    bp[field] = (bp[field] or 0) + v
        series.append(point)
        day += timedelta(days=1)

    account_rows = []
    for p, a in accounts:
        stat, previous = await _latest_stats(db, p, a.id, min(days, 90))
        account_rows.append(cm.account_view(p, a, stat, previous if previous is not stat else None))

    def total(field):
        vals = [r["stats"][field] for r in account_rows if r["stats"] and r["stats"][field] is not None]
        return sum(vals) if vals else None

    first = next((pt for pt in series if pt["views"] is not None), None)
    top = (await db.execute(
        select(CmVideo).where(_account_filter(CmVideo, accounts),
                              CmVideo.published_at >= datetime.combine(since, datetime.min.time()))
        .order_by(CmVideo.views.desc().nulls_last()).limit(6)
    )).scalars().all()
    upcoming = (await db.execute(
        select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), CmTarget.status.in_((T_SCHEDULED, T_AWAITING_ROUTINE)))
    )).scalar() or 0
    published = (await db.execute(
        select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), CmTarget.status == T_PUBLISHED,
               CmTarget.published_at >= datetime.combine(since, datetime.min.time()))
    )).scalar() or 0
    failed = (await db.execute(
        select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), CmTarget.status == T_FAILED,
               CmTarget.updated_at >= utcnow() - timedelta(days=7))
    )).scalar() or 0
    total_views = total("views")
    return {
        "days": days,
        "totals": {
            "views": total_views, "followers": total("followers"), "likes": total("likes"),
            "views_gained": (total_views - first["views"]) if total_views is not None and first else None,
            "accounts": len(accounts), "upcoming": upcoming, "published": published, "failed_recent": failed,
        },
        "series": series,
        "accounts": account_rows,
        "top_videos": [_video_out(v, names) for v in top],
    }


# --------------------------------------------------------------------------
# Instagram : connexion officielle, comptes gérés par la routine, rappels Meta
# --------------------------------------------------------------------------

def _require_ig() -> None:
    if not ig.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "La connexion Instagram n'est pas encore disponible (validation Meta en cours).")


class StartIn(BaseModel):
    org_id: Optional[int] = None


@router.post("/instagram/oauth/start")
async def instagram_start(body: StartIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_ig()
    tenant = await _tenant(db, user, body.org_id)
    if not await oauth_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives de connexion Instagram. Réessayez dans une heure.")
    state = _encode({"sub": str(user.id), "scope": STATE_SCOPE, "org": tenant.org_id, "jti": uuid.uuid4().hex},
                    timedelta(seconds=STATE_TTL_SECONDS))
    return {"authorize_url": ig.authorize_url(state)}


class ExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=1, max_length=2048)


_BAD_STATE = "Lien de connexion Instagram invalide ou expiré : relancez « Connecter Instagram »."


def _ig_http(e: ig.InstagramError) -> HTTPException:
    code = 429 if e.code == "rate_limited" else (400 if 400 <= e.http_status < 500 or e.http_status == 0 else 502)
    return HTTPException(code, e.describe())


def _ig_out(acc: InstagramAccount) -> dict:
    return cm.account_view("instagram", acc)


@router.post("/instagram/oauth/exchange")
async def instagram_exchange(body: ExchangeIn, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    _require_ig()
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
        short = await ig.exchange_code(body.code)
        if not short.get("access_token"):
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Réponse Instagram incomplète : réessayez.")
        long = await ig.long_lived_token(short["access_token"])
        prof = await ig.profile(long["access_token"])
    except ig.InstagramError as e:
        logger.info("Instagram : connexion refusée (%s)", e.code)
        raise _ig_http(e)
    if prof.get("account_type") not in (None, "BUSINESS", "MEDIA_CREATOR"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ig.ERROR_MESSAGES["not_professional"])
    ig_id = str(prof.get("user_id") or short.get("user_id") or prof.get("id") or "")
    if not ig_id:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Réponse Instagram incomplète : réessayez.")
    username = prof.get("username") or ""
    model = InstagramAccount
    acc = (await db.execute(select(model).where(
        tenant.where(model), model.revoked_at.is_(None),
        (model.ig_user_id == ig_id) | (func.lower(model.username) == username.lower()))
        .order_by(model.mode)    # « api » avant « routine »
    )).scalars().first()
    if acc is None:
        acc = InstagramAccount(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id)
        db.add(acc)
    # Un compte « géré par la routine » passe en connexion officielle (même ligne : historique gardé).
    acc.mode = IG_MODE_API
    acc.ig_user_id = ig_id
    acc.username = username or acc.username or ig_id
    acc.name = prof.get("name") or acc.name
    acc.account_type = prof.get("account_type") or acc.account_type
    acc.profile_picture_url = prof.get("profile_picture_url") or acc.profile_picture_url
    acc.scopes = short.get("permissions") or ig.SCOPES
    acc.connected_by_user_id = user.id
    acc.revoked_at = None
    ig.apply_long_token(acc, long)
    await db.commit()
    return {"account": _ig_out(acc), "org_id": tenant.org_id}


class RoutineAccountIn(BaseModel):
    org_id: Optional[int] = None
    username: str = Field(min_length=1, max_length=60)


def _clean_username(u: str) -> str:
    u = u.strip().lstrip("@").strip()
    if not u or any(c.isspace() for c in u) or len(u) > 30:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nom d'utilisateur Instagram invalide.")
    return u


@router.post("/instagram/routine-accounts")
async def add_routine_account(body: RoutineAccountIn, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_cm_user)):
    """Compte Instagram géré par la routine Claude (sans connexion officielle)."""
    tenant = await _tenant(db, user, body.org_id)
    username = _clean_username(body.username)
    acc = (await db.execute(select(InstagramAccount).where(
        tenant.where(InstagramAccount), InstagramAccount.revoked_at.is_(None),
        func.lower(InstagramAccount.username) == username.lower()))).scalars().first()
    if acc is None:
        acc = InstagramAccount(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
                               mode=IG_MODE_ROUTINE, username=username, connected_by_user_id=user.id)
        db.add(acc)
        await db.commit()
    return _ig_out(acc)


@router.delete("/instagram/accounts/{account_id}")
async def remove_instagram(account_id: int, org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    tenant = await _tenant(db, user, org_id)
    acc = await cm.get_account(db, tenant, "instagram", account_id)
    if tenant.org_id and tenant.role != "admin" and acc.connected_by_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Seul le membre qui a connecté ce compte ou un administrateur de l'équipe peut le retirer.")
    ig.clear_tokens(acc)
    acc.revoked_at = utcnow()
    acc.needs_reconnect = False
    # Publications à venir sur ce compte : annulées.
    targets = (await db.execute(select(CmTarget).where(
        CmTarget.platform == "instagram", CmTarget.account_id == acc.id, CmTarget.status.in_(T_EDITABLE)
    ))).scalars().all()
    for t in targets:
        t.status = T_CANCELLED
    await db.commit()
    warning = None
    if acc.mode == IG_MODE_API:
        warning = ("Jetons supprimés de Chapote. Pour retirer aussi l'accès côté Instagram : Paramètres > "
                   "Applications et sites web, dans l'app Instagram.")
    return {"ok": True, "warning": warning}


async def _revoke_ig_user(db: AsyncSession, ig_user_id: str) -> int:
    accounts = (await db.execute(select(InstagramAccount).where(
        InstagramAccount.ig_user_id == ig_user_id, InstagramAccount.revoked_at.is_(None)))).scalars().all()
    for acc in accounts:
        ig.clear_tokens(acc)
        acc.revoked_at = utcnow()
    await db.commit()
    return len(accounts)


@router.post("/instagram/deauthorize")
async def instagram_deauthorize(signed_request: str = Form(...), db: AsyncSession = Depends(get_db)):
    """Rappel Meta : l'utilisateur a retiré l'accès de l'app."""
    data = ig.parse_signed_request(signed_request)
    if not data or not data.get("user_id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signed_request invalide")
    await _revoke_ig_user(db, str(data["user_id"]))
    return {"ok": True}


@router.post("/instagram/data-deletion")
async def instagram_data_deletion(signed_request: str = Form(...), db: AsyncSession = Depends(get_db)):
    """Rappel Meta : demande de suppression des données. Jetons effacés tout de suite ;
    vidéos et chiffres supprimés par le nettoyage planifié (comptes déconnectés)."""
    data = ig.parse_signed_request(signed_request)
    if not data or not data.get("user_id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signed_request invalide")
    await _revoke_ig_user(db, str(data["user_id"]))
    code = secrets.token_hex(8)
    return {"url": f"{settings.APP_URL.rstrip('/')}/legal/instagram-confidentialite#suppression",
            "confirmation_code": code}


# --------------------------------------------------------------------------
# Publications
# --------------------------------------------------------------------------

class TargetIn(BaseModel):
    platform: Literal["tiktok", "youtube", "instagram"]
    account_id: int
    scheduled_at: Optional[datetime] = None      # vide = dès que la vidéo est reçue
    options: dict[str, Any] = Field(default_factory=dict)


class PostIn(BaseModel):
    org_id: Optional[int] = None
    title: str = Field(min_length=1, max_length=200)
    caption: str = Field(default="", max_length=5000)
    file_name: str = Field(default="", max_length=255)
    video_size: int = Field(gt=0)
    targets: list[TargetIn] = Field(min_length=1, max_length=MAX_TARGETS)


def _target_out(t: CmTarget, names: dict) -> dict:
    return {
        "id": t.id, "post_id": t.post_id, "platform": t.platform, "account_id": t.account_id,
        "account_name": names.get((t.platform, t.account_id)),
        "scheduled_at": cm.iso(t.scheduled_at), "options": {k: v for k, v in (t.options or {}).items()},
        "status": t.status, "external_id": t.external_id, "url": t.url,
        "fail_reason": t.fail_reason, "error_message": t.error_message, "notice": t.notice,
        "published_at": cm.iso(t.published_at), "updated_at": cm.iso(t.updated_at),
        "can_edit": t.status in T_EDITABLE, "can_retry": t.status == T_FAILED,
    }


def _post_out(post: CmPost, targets: list[CmTarget], names: dict) -> dict:
    return {
        "id": post.id, "title": post.title, "caption": post.caption, "file_name": post.file_name,
        "video_size": post.video_size, "duration_sec": post.duration_sec, "status": post.status,
        "has_media": bool(post.media_path), "created_at": cm.iso(post.created_at),
        "targets": [_target_out(t, names) for t in sorted(targets, key=lambda x: (x.scheduled_at, x.id))],
    }


async def _get_post(db: AsyncSession, user: User, post_id: int, *, lock: bool = False) -> tuple[CmPost, Tenant]:
    stmt = select(CmPost).where(CmPost.id == post_id)
    if lock:
        stmt = stmt.with_for_update()
    post = (await db.execute(stmt)).scalar_one_or_none()
    tenant = await _tenant_for_row(db, user, post) if post is not None else None
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return post, tenant


async def _get_target(db: AsyncSession, user: User, target_id: int) -> tuple[CmTarget, CmPost, Tenant]:
    t = (await db.execute(select(CmTarget).where(CmTarget.id == target_id).with_for_update())).scalar_one_or_none()
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    post, tenant = await _get_post(db, user, t.post_id)
    return t, post, tenant


async def _targets_of(db: AsyncSession, post_ids: list[int]) -> dict[int, list[CmTarget]]:
    out: dict[int, list[CmTarget]] = {}
    if not post_ids:
        return out
    for t in (await db.execute(select(CmTarget).where(CmTarget.post_id.in_(post_ids)))).scalars().all():
        out.setdefault(t.post_id, []).append(t)
    return out


@router.post("/posts")
async def create_post(body: PostIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    if body.video_size > cm.max_upload_bytes():
        raise HTTPException(413, f"Vidéo trop volumineuse ({settings.CM_MAX_UPLOAD_MB} Mo maximum).")
    title = body.title.strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Donnez un titre à la publication.")
    seen = set()
    planned = []
    for t in body.targets:
        key = (t.platform, t.account_id)
        if key in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un même compte est choisi deux fois.")
        seen.add(key)
        acc = await cm.get_account(db, tenant, t.platform, t.account_id)
        if not cm.can_publish(t.platform, acc):
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"{cm.ACCOUNT_LABEL[t.platform]} « {cm.account_name(t.platform, acc)} » : publication "
                                "impossible pour le moment (compte à reconnecter ou module indisponible).")
        options = cm.normalize_options(t.platform, acc, t.options, title, body.caption)
        planned.append((t, options, cm.check_schedule(t.scheduled_at)))
    receiving = (await db.execute(select(func.count()).select_from(CmPost).where(
        tenant.where(CmPost), CmPost.status == POST_RECEIVING))).scalar() or 0
    if receiving >= MAX_RECEIVING:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Des vidéos sont déjà en cours d'envoi : attendez qu'elles se terminent.")
    if not await post_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Limite quotidienne de publications atteinte. Réessayez demain.")
    cm.check_space(body.video_size)

    path = cm.media_dir() / f"{uuid.uuid4().hex}.part"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    post = CmPost(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id, user_id=user.id,
                  title=title, caption=body.caption or None,
                  file_name=os.path.basename(body.file_name)[:255] or None, video_size=body.video_size,
                  received_bytes=0, media_path=str(path), status=POST_RECEIVING)
    db.add(post)
    await db.flush()
    for t, options, when in planned:
        db.add(CmTarget(post_id=post.id, platform=t.platform, account_id=t.account_id, scheduled_at=when,
                        options=options, status=T_DRAFT))
    await db.commit()
    return {"post_id": post.id, "part_size": cm.PART_SIZE, "part_count": -(-body.video_size // cm.PART_SIZE)}


@router.put("/posts/{post_id}/parts/{index}")
async def upload_part(post_id: int, index: int, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_cm_user)):
    post, _ = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING or not post.media_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'attend plus de vidéo.")
    start = index * cm.PART_SIZE
    if index < 0 or start >= post.video_size:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Morceau hors limites.")
    expected = min(cm.PART_SIZE, post.video_size - start)
    content = await request.body()
    if len(content) != expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Taille du morceau {index} incorrecte ({len(content)} octets, {expected} attendus).")
    if start + expected <= post.received_bytes:
        return {"ok": True, "received_bytes": post.received_bytes}
    if start != post.received_bytes:
        raise HTTPException(status.HTTP_409_CONFLICT, "Morceaux reçus dans le désordre : relancez la publication.")
    with open(post.media_path, "r+b") as f:
        f.seek(start)
        f.write(content)
    post.received_bytes = start + expected
    await db.commit()
    return {"ok": True, "received_bytes": post.received_bytes}


async def _reject(db: AsyncSession, post: CmPost, message: str, http: int = 400):
    post.status = POST_CANCELLED
    cm.remove_media(post)
    for t in (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all():
        cm_jobs.fail_target(t, "invalid_video", message)
    await db.commit()
    raise HTTPException(http, message)


@router.post("/posts/{post_id}/submit")
async def submit_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Vidéo reçue : format et durée vérifiés pour chaque compte, puis programmation."""
    post, tenant = await _get_post(db, user, post_id, lock=True)
    if post.status != POST_RECEIVING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication a déjà été validée.")
    if post.received_bytes != post.video_size or not post.media_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "La vidéo n'a pas été entièrement reçue.")
    if os.path.getsize(post.media_path) != post.video_size:
        await _reject(db, post, "Taille de la vidéo reçue incorrecte : relancez la publication.")
    try:
        video = probe(post.media_path)
    except ProbeError as e:
        await _reject(db, post, f"Vidéo refusée : {e}.")
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
    for t in targets:
        acc = await cm.get_account(db, tenant, t.platform, t.account_id)
        err = cm.check_video_for(t.platform, acc, video.mime_type, video.duration_sec, post.video_size)
        if err:
            await _reject(db, post, err)
    final = post.media_path[:-5] + ".mp4" if post.media_path.endswith(".part") else post.media_path
    os.replace(post.media_path, final)
    post.media_path = final
    post.mime_type = video.mime_type
    post.duration_sec = round(video.duration_sec, 2)
    post.status = POST_READY
    now = utcnow()
    due = []
    for t in targets:
        t.status = T_SCHEDULED
        if t.scheduled_at <= now:
            t.scheduled_at = now
            due.append(t.id)
    await db.commit()
    for target_id in due:
        cm_jobs.launch(target_id)
    _, names = await _tenant_index(db, tenant)
    return _post_out(post, targets, names)


@router.get("/posts")
async def list_posts(org_id: Optional[int] = Query(None), start: Optional[datetime] = None,
                     end: Optional[datetime] = None, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_cm_user)):
    """Planning : publications dont une cible tombe entre `start` et `end` (défaut : -30 j / +90 j)."""
    tenant = await _tenant(db, user, org_id)
    now = utcnow()
    start = cm.to_utc_naive(start) or now - timedelta(days=30)
    end = cm.to_utc_naive(end) or now + timedelta(days=90)
    ids = (await db.execute(
        select(CmTarget.post_id).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), CmTarget.scheduled_at >= start, CmTarget.scheduled_at <= end)
        .distinct()
    )).scalars().all()
    posts = (await db.execute(select(CmPost).where(CmPost.id.in_(ids)))).scalars().all() if ids else []
    targets = await _targets_of(db, [p.id for p in posts])
    _, names = await _tenant_index(db, tenant)
    out = [_post_out(p, targets.get(p.id, []), names) for p in posts if p.status != POST_RECEIVING]
    out.sort(key=lambda p: min((t["scheduled_at"] for t in p["targets"]), default=""))
    return out


@router.get("/posts/{post_id}")
async def get_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    post, tenant = await _get_post(db, user, post_id)
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
    _, names = await _tenant_index(db, tenant)
    return _post_out(post, targets, names)


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Annule toutes les publications pas encore parties de cette vidéo."""
    post, _ = await _get_post(db, user, post_id, lock=True)
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id).with_for_update())).scalars().all()
    for t in targets:
        if t.status in T_EDITABLE:
            t.status = T_CANCELLED
    if all(t.status in T_FINAL for t in targets):
        cm.remove_media(post)
        if post.status == POST_RECEIVING:
            post.status = POST_CANCELLED
    await db.commit()
    return {"ok": True}


class TargetPatch(BaseModel):
    scheduled_at: Optional[datetime] = None
    options: Optional[dict[str, Any]] = None


@router.patch("/targets/{target_id}")
async def update_target(target_id: int, body: TargetPatch, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)
    if t.status not in (T_DRAFT, T_SCHEDULED):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication est déjà partie : elle ne peut plus être modifiée.")
    acc = await cm.get_account(db, tenant, t.platform, t.account_id)
    if body.options is not None:
        merged = {**(t.options or {}), **body.options}
        merged.pop("username", None)
        t.options = cm.normalize_options(t.platform, acc, merged, post.title, post.caption or "")
    if body.scheduled_at is not None:
        t.scheduled_at = cm.check_schedule(body.scheduled_at)
    await db.commit()
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)


@router.post("/targets/{target_id}/publish-now")
async def publish_now(target_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)
    if t.status != T_SCHEDULED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'est pas en attente.")
    t.scheduled_at = utcnow()
    await db.commit()
    cm_jobs.launch(t.id)
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)


@router.post("/targets/{target_id}/cancel")
async def cancel_target(target_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)
    if t.status not in T_EDITABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication est déjà partie : elle ne peut plus être annulée.")
    t.status = T_CANCELLED
    await db.commit()
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)


class RetryIn(BaseModel):
    scheduled_at: Optional[datetime] = None


@router.post("/targets/{target_id}/retry")
async def retry_target(target_id: int, body: RetryIn = RetryIn(), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)
    if t.status != T_FAILED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule une publication en échec peut être relancée.")
    if post.status != POST_READY or not post.media_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "La vidéo n'est plus disponible : recréez la publication.")
    acc = await cm.get_account(db, tenant, t.platform, t.account_id)
    if not cm.can_publish(t.platform, acc):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce compte doit d'abord être reconnecté.")
    t.status = T_SCHEDULED
    t.scheduled_at = cm.check_schedule(body.scheduled_at)
    t.fail_reason = t.error_message = t.notice = None
    t.tiktok_post_id = t.youtube_post_id = None
    t.ig_container_id = None
    t.attempts = 0
    await db.commit()
    if t.scheduled_at <= utcnow() + timedelta(seconds=5):
        cm_jobs.launch(t.id)
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)


# --------------------------------------------------------------------------
# Vidéo pour Instagram (lien signé, temporaire)
# --------------------------------------------------------------------------

@router.get("/media/{target_id}/{exp}/{sig}")
async def media(target_id: int, exp: int, sig: str, db: AsyncSession = Depends(get_db)):
    sig = sig.rsplit(".", 1)[0]
    if not cm.check_media_link(target_id, exp, sig):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Introuvable")
    t = await db.get(CmTarget, target_id)
    post = await db.get(CmPost, t.post_id) if t is not None else None
    if t is None or t.platform != "instagram" or t.status != T_PUBLISHING or post is None \
            or not post.media_path or not os.path.exists(post.media_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Introuvable")
    return FileResponse(post.media_path, media_type=post.mime_type or "video/mp4",
                        headers={"Cache-Control": "private, no-store"})


# --------------------------------------------------------------------------
# Routine Claude (jeton de service) : Instagram géré par la routine
# --------------------------------------------------------------------------

async def _routine_target(db: AsyncSession, user: User, target_id: int) -> tuple[CmTarget, CmPost, InstagramAccount]:
    t, post, tenant = await _get_target(db, user, target_id)
    acc = await db.get(InstagramAccount, t.account_id) if t.platform == "instagram" else None
    if acc is None or acc.mode != IG_MODE_ROUTINE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return t, post, acc


def _routine_out(t: CmTarget, post: CmPost, acc: InstagramAccount) -> dict:
    o = t.options or {}
    return {
        "id": t.id, "status": t.status, "username": acc.username, "account_id": acc.id,
        "scheduled_at": cm.iso(t.scheduled_at), "title": post.title, "caption": o.get("caption") or "",
        "share_to_feed": o.get("share_to_feed", True), "thumb_offset_ms": o.get("thumb_offset_ms"),
        "duration_sec": post.duration_sec, "video_size": post.video_size, "mime_type": post.mime_type,
        "video_url": f"/api/cm/routine/targets/{t.id}/video" if post.media_path else None,
    }


@router.get("/routine/due")
async def routine_due(org_id: Optional[int] = Query(None), ahead_minutes: int = Query(0, ge=0, le=1440),
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    """Publications Instagram à faire par la routine : arrivées à leur heure (AWAITING_ROUTINE),
    prises en charge non confirmées, et celles prévues dans les `ahead_minutes` à venir."""
    tenant = await _tenant(db, user, org_id)
    accounts = {a.id: a for a in (await db.execute(select(InstagramAccount).where(
        tenant.where(InstagramAccount), InstagramAccount.mode == IG_MODE_ROUTINE,
        InstagramAccount.revoked_at.is_(None)))).scalars().all()}
    if not accounts:
        return []
    # Les cibles arrivées à leur heure passent d'abord en AWAITING_ROUTINE.
    now = utcnow()
    due = (await db.execute(select(CmTarget.id).where(
        CmTarget.platform == "instagram", CmTarget.account_id.in_(list(accounts)),
        CmTarget.status == T_SCHEDULED, CmTarget.scheduled_at <= now))).scalars().all()
    for target_id in due:
        await cm_jobs.dispatch_target(db, target_id)
    rows = (await db.execute(select(CmTarget).where(
        CmTarget.platform == "instagram", CmTarget.account_id.in_(list(accounts)),
        (CmTarget.status.in_((T_AWAITING_ROUTINE, T_ROUTINE_CLAIMED)))
        | ((CmTarget.status == T_SCHEDULED) & (CmTarget.scheduled_at <= now + timedelta(minutes=ahead_minutes))))
        .order_by(CmTarget.scheduled_at))).scalars().all()
    out = []
    for t in rows:
        post = await db.get(CmPost, t.post_id)
        if post is not None and post.status == POST_READY:
            out.append(_routine_out(t, post, accounts[t.account_id]))
    return out


@router.get("/routine/targets/{target_id}/video")
async def routine_video(target_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    t, post, acc = await _routine_target(db, user, target_id)
    if t.status not in (T_SCHEDULED, T_AWAITING_ROUTINE, T_ROUTINE_CLAIMED) or not post.media_path \
            or not os.path.exists(post.media_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vidéo indisponible")
    await db.commit()
    return FileResponse(post.media_path, media_type=post.mime_type or "video/mp4",
                        filename=f"cm-{t.id}.{'mov' if post.mime_type == 'video/quicktime' else 'mp4'}")


@router.post("/routine/targets/{target_id}/claim")
async def routine_claim(target_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    t, post, acc = await _routine_target(db, user, target_id)
    if t.status == T_ROUTINE_CLAIMED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Publication déjà prise en charge.")
    if t.status != T_AWAITING_ROUTINE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'est pas à faire maintenant.")
    t.status, t.claimed_at = T_ROUTINE_CLAIMED, utcnow()
    await db.commit()
    return _routine_out(t, post, acc)


class RoutineDoneIn(BaseModel):
    url: Optional[str] = Field(default=None, max_length=500)
    external_id: Optional[str] = Field(default=None, max_length=100)
    published_at: Optional[datetime] = None


@router.post("/routine/targets/{target_id}/done")
async def routine_done(target_id: int, body: RoutineDoneIn, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_routine_user)):
    t, post, acc = await _routine_target(db, user, target_id)
    if t.status not in (T_AWAITING_ROUTINE, T_ROUTINE_CLAIMED):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'est pas en cours.")
    if body.url and not body.url.startswith("https://"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien de la publication invalide.")
    t.url = body.url
    t.external_id = body.external_id or (body.url.rstrip("/").rsplit("/", 1)[-1] if body.url else None)
    t.published_at = cm.to_utc_naive(body.published_at) or utcnow()
    t.status = T_PUBLISHED
    if t.external_id:
        await cm.upsert_video(db, "instagram", acc.id, t.external_id, target_id=t.id, url=t.url,
                              title=(t.options or {}).get("caption") or post.title, published_at=t.published_at,
                              duration_sec=post.duration_sec)
    await db.commit()
    return _routine_out(t, post, acc)


class RoutineFailedIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)


@router.post("/routine/targets/{target_id}/failed")
async def routine_failed(target_id: int, body: RoutineFailedIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_routine_user)):
    t, post, acc = await _routine_target(db, user, target_id)
    if t.status not in (T_AWAITING_ROUTINE, T_ROUTINE_CLAIMED):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication n'est pas en cours.")
    cm_jobs.fail_target(t, "routine_failed", f"Routine : {body.message}")
    await db.commit()
    return _routine_out(t, post, acc)


class RoutineVideoIn(BaseModel):
    external_id: Optional[str] = Field(default=None, max_length=255)
    url: Optional[str] = Field(default=None, max_length=500)
    caption: Optional[str] = Field(default=None, max_length=5000)
    thumbnail_url: Optional[str] = Field(default=None, max_length=1000)
    published_at: Optional[datetime] = None
    duration_sec: Optional[float] = None
    views: Optional[int] = Field(default=None, ge=0)
    likes: Optional[int] = Field(default=None, ge=0)
    comments: Optional[int] = Field(default=None, ge=0)
    shares: Optional[int] = Field(default=None, ge=0)
    saves: Optional[int] = Field(default=None, ge=0)


class RoutineStatsIn(BaseModel):
    org_id: Optional[int] = None
    username: str = Field(min_length=1, max_length=60)
    followers: Optional[int] = Field(default=None, ge=0)
    media_count: Optional[int] = Field(default=None, ge=0)
    views: Optional[int] = Field(default=None, ge=0)
    likes: Optional[int] = Field(default=None, ge=0)
    videos: list[RoutineVideoIn] = Field(default_factory=list, max_length=500)


@router.post("/routine/stats")
async def routine_stats(body: RoutineStatsIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_routine_user)):
    """Chiffres d'un compte Instagram (et de ses vidéos) relevés par la routine. Le compte
    « géré par la routine » est créé s'il n'existe pas. Un compte connecté officiellement
    garde ses propres relevés : refusé."""
    tenant = await _tenant(db, user, body.org_id)
    username = _clean_username(body.username)
    acc = (await db.execute(select(InstagramAccount).where(
        tenant.where(InstagramAccount), InstagramAccount.revoked_at.is_(None),
        func.lower(InstagramAccount.username) == username.lower()).order_by(InstagramAccount.mode)
    )).scalars().first()
    if acc is not None and acc.mode == IG_MODE_API:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Ce compte est connecté à l'API Instagram : ses chiffres sont relevés directement.")
    if acc is None:
        acc = InstagramAccount(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
                               mode=IG_MODE_ROUTINE, username=username, connected_by_user_id=user.id)
        db.add(acc)
        await db.flush()
    payload = body.model_dump()
    payload["videos"] = [v.model_dump() for v in body.videos]
    stat = await cm.ingest_routine_stats(db, acc, payload)
    return cm.account_view("instagram", acc, stat)
