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
from contextvars import ContextVar
import logging
import os
import secrets
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
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
    CmAsset,
    CmGroup,
    CmGroupAccount,
    CmPost,
    CmSource,
    CmTarget,
    CmVideo,
    InstagramAccount,
)
from src.models.user import Membership, Organization, User
from src.routers.tiktok import Tenant, _tenant
from src.services import cm_access
from src.services import cm_paging as paging
from src.services import cm_jobs
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import tiktok_service as tt
from src.services import youtube_service as yt
from src.services.rate_limit import RateLimiter, SingleUseTokens
from src.services.video_probe import ProbeError, probe

logger = logging.getLogger(__name__)

# Périmètre « un seul compte » (?account=tiktok:12) : lu une fois pour toutes les routes et appliqué
# au même endroit que le filtre de groupe (_tenant_index / _scoped).
_ACCOUNT_SCOPE: ContextVar[Optional[tuple]] = ContextVar("cm_account_scope", default=None)


async def _capture_account_scope(account: Optional[str] = Query(None, max_length=40)):
    scope = None
    if account:
        platform, _, raw = account.partition(":")
        if platform not in PLATFORMS or not raw.isdigit():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Compte invalide.")
        scope = (platform, int(raw))
    _ACCOUNT_SCOPE.set(scope)


def _only_account(accounts):
    scope = _ACCOUNT_SCOPE.get()
    if scope is None:
        return accounts
    kept = [(p, a) for p, a in accounts if (p, a.id) == scope]
    if not kept:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte introuvable")
    return kept


router = APIRouter(prefix="/api/cm", tags=["cm"], dependencies=[Depends(_capture_account_scope)])

STATE_SCOPE = "instagram_oauth"
STATE_TTL_SECONDS = 600
MAX_TARGETS = 12
MAX_RECEIVING = 3

state_store = SingleUseTokens("rl:igstate:", STATE_TTL_SECONDS)
oauth_limiter = RateLimiter("rl:igoauth:", 20, 3600)
post_limiter = RateLimiter("rl:cmpost:", 60, 86400)
sync_limiter = RateLimiter("rl:cmsync:", 6, 3600)
# Relecture complète (tous les Reels d'un coup) : une fois par heure et par compte, sinon par tournées.
full_sync_limiter = RateLimiter("rl:cmsyncfull:", 1, 3600)


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
# Pagination : `limit` + `cursor` (opaque). Le corps reste une liste (compatible avec les
# clients existants) ; la page suivante est annoncée par l'en-tête X-Next-Cursor.
# --------------------------------------------------------------------------

def _decode_cursor(cursor: Optional[str]) -> int:
    if not cursor:
        return 0
    import base64
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        kind, _, value = raw.partition(":")
        if kind != "o":
            raise ValueError
        offset = int(value)
        if offset < 0 or offset > 100_000:
            raise ValueError
        return offset
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Curseur de pagination invalide.")


def _encode_cursor(offset: int) -> str:
    import base64
    return base64.urlsafe_b64encode(f"o:{offset}".encode()).decode().rstrip("=")


def _page(response: Response, rows: list, offset: int, limit: int) -> list:
    """`rows` lus avec limit + 1 : coupe à `limit` et pose X-Next-Cursor s'il en reste."""
    if len(rows) > limit:
        response.headers["X-Next-Cursor"] = _encode_cursor(offset + limit)
        return rows[:limit]
    return rows

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
    """Espace perso + organisations dont l'utilisateur est membre. `accounts` : nombre de comptes
    connectés (l'interface n'affiche que les espaces utiles : un seul, la plupart du temps)."""
    from src.services.cm_access import MODELS

    async def count(org_id, owner_id) -> int:
        n = 0
        for model in MODELS.values():
            cond = model.organization_id == org_id if org_id else (
                (model.owner_user_id == owner_id) & model.organization_id.is_(None))
            n += (await db.execute(select(func.count()).select_from(model).where(cond, model.revoked_at.is_(None)))).scalar() or 0
        return n

    rows = (await db.execute(
        select(Organization, Membership).join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id, Organization.is_active.is_(True)).order_by(Organization.name)
    )).all()
    out = [{"org_id": None, "name": "Espace perso", "role": None, "cm_role": "admin", "group_ids": None,
            "owner": True, "owner_name": None, "accounts": await count(None, user.id)}]
    for o, m in rows:
        t = await cm_access.enrich(db, Tenant(o.id, None, m.role), user, m.role)
        owner = await db.get(User, o.owner_user_id) if o.owner_user_id != user.id else None
        out.append({"org_id": o.id, "name": o.name, "role": m.role, "cm_role": t.cm_role, "group_ids": t.group_ids,
                    "owner": o.owner_user_id == user.id,
                    "owner_name": (owner.name or owner.email) if owner else None,
                    "accounts": await count(o.id, None)})
    return out


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


async def _latest_stats_bulk(db: AsyncSession, accounts, days: int) -> dict:
    """Comme `_latest_stats`, pour tous les comptes en 3 requêtes (au lieu d'une par compte) :
    {(plateforme, id): (dernier relevé, relevé de référence il y a `days` jours ou None)}."""
    if not accounts:
        return {}
    since = utcnow().date() - timedelta(days=days)
    scope = _account_filter(CmAccountStat, accounts)

    async def distinct(*conds, newest: bool):
        order = CmAccountStat.day.desc() if newest else CmAccountStat.day.asc()
        rows = (await db.execute(
            select(CmAccountStat).where(scope, *conds)
            .distinct(CmAccountStat.platform, CmAccountStat.account_id)
            .order_by(CmAccountStat.platform, CmAccountStat.account_id, order))).scalars().all()
        return {(r.platform, r.account_id): r for r in rows}

    latest = await distinct(newest=True)
    before = await distinct(CmAccountStat.day <= since, newest=True)
    after = await distinct(CmAccountStat.day > since, newest=False)
    out = {}
    for k, stat in latest.items():
        prev = before.get(k) or after.get(k)
        out[k] = (stat, prev if prev is not None and prev.id != stat.id else None)
    return out


async def _fill_tiktok_usernames(db: AsyncSession, accounts, limit: int = 5) -> None:
    """Pseudo TikTok (pour « tiktok:@pseudo ») : lu une fois auprès de TikTok, sans permission en plus."""
    todo = [a for p, a in accounts if p == "tiktok" and not a.username and not a.needs_reconnect][:limit]
    for a in todo:
        try:
            info = await tt.creator_info(await tt.valid_access_token(db, a))
            if info.get("creator_username"):
                a.username = info["creator_username"]
        except Exception:                       # jeton, réseau : on réessaiera plus tard
            continue
    if todo:
        await db.commit()


ACCOUNT_SORTS = ("name", "followers", "views", "connected", "platform")


def _sort_rows(rows: list, sort: str, order: str, value) -> list:
    """Tri stable, valeurs absentes toujours en fin de liste."""
    present = [r for r in rows if value(r) is not None]
    missing = [r for r in rows if value(r) is None]
    present.sort(key=value, reverse=order == "desc")
    return present + missing


@router.get("/accounts")
async def list_accounts(org_id: Optional[int] = Query(None), days: int = Query(7, ge=1, le=90),
                        group_id: Optional[int] = Query(None), q: Optional[str] = Query(None, max_length=100),
                        sort: Optional[Literal["name", "followers", "views", "connected", "platform"]] = None,
                        order: Literal["asc", "desc"] = "asc",
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Comptes du périmètre. `q` : nom ou pseudo ; `sort` : nom, abonnés, vues, date de connexion."""
    tenant = await _tenant(db, user, org_id)
    accounts = await _scoped(db, tenant, group_id)
    await _fill_tiktok_usernames(db, accounts)
    stats = await _latest_stats_bulk(db, accounts, days)
    out = [cm.account_view(p, a, *stats.get((p, a.id), (None, None))) for p, a in accounts]
    needle = (q or "").strip().lower().lstrip("@")
    if needle:
        out = [v for v in out if needle in " ".join(str(v.get(f) or "") for f in ("name", "handle", "username")).lower()]
    if sort:
        value = {"name": lambda v: (v.get("name") or "").lower().lstrip("@"),
                 "followers": lambda v: (v.get("stats") or {}).get("followers"),
                 "views": lambda v: (v.get("stats") or {}).get("views"),
                 "connected": lambda v: v.get("connected_at"),
                 "platform": lambda v: v["platform"]}[sort]
        out = _sort_rows(out, sort, order, value)
    return out


@router.post("/accounts/{platform}/{account_id}/sync")
async def sync_account(platform: Literal["tiktok", "youtube", "instagram"], account_id: int,
                       org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    acc = await cm.get_account(db, tenant, platform, account_id)
    cm_access.require(tenant, "edit")
    if not await sync_limiter.check(f"{platform}:{acc.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Chiffres déjà actualisés récemment : réessayez plus tard.")
    full = platform == "instagram" and await full_sync_limiter.check(f"{platform}:{acc.id}")
    stat = await cm.sync_account(db, platform, acc, full=full)
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


async def _tenant_index(db: AsyncSession, tenant: Tenant, group_id: Optional[int] = None):
    """(comptes du périmètre, noms de TOUS les comptes du tenant)."""
    accounts = await cm.tenant_accounts(db, tenant)
    names = {(p, a.id): cm.account_name(p, a) for p, a in accounts}
    if group_id is not None:
        accounts = await _in_group(db, tenant, group_id, accounts)
    return _only_account(accounts), names


async def _get_group(db: AsyncSession, tenant: Tenant, group_id: int, *, lock: bool = False) -> CmGroup:
    stmt = select(CmGroup).where(CmGroup.id == group_id, tenant.where(CmGroup))
    if lock:
        stmt = stmt.with_for_update()
    group = (await db.execute(stmt)).scalar_one_or_none()
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Groupe introuvable")
    return group


async def _in_group(db: AsyncSession, tenant: Tenant, group_id: int, accounts):
    await _get_group(db, tenant, group_id)
    members = set((await db.execute(
        select(CmGroupAccount.platform, CmGroupAccount.account_id).where(CmGroupAccount.group_id == group_id)
    )).all())
    return [(p, a) for p, a in accounts if (p, a.id) in members]


async def _scoped(db: AsyncSession, tenant: Tenant, group_id: Optional[int]):
    """Comptes actifs du tenant, restreints au groupe s'il est donné."""
    accounts = await cm.tenant_accounts(db, tenant)
    return _only_account(accounts if group_id is None else await _in_group(db, tenant, group_id, accounts))


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


VIDEO_SORTS = {"recent": "dt", "views": "int", "likes": "int", "comments": "int", "shares": "int",
               "engagement": "int", "title": "str"}


def _video_sort_key(sort: str, order: str):
    engagement = (func.coalesce(CmVideo.likes, 0) + func.coalesce(CmVideo.comments, 0)
                  + func.coalesce(CmVideo.shares, 0) + func.coalesce(CmVideo.saves, 0))
    col = {"recent": CmVideo.published_at, "views": CmVideo.views, "likes": CmVideo.likes,
           "comments": CmVideo.comments, "shares": CmVideo.shares, "engagement": engagement,
           "title": func.lower(CmVideo.title)}[sort]
    return paging.nulls_last(col, VIDEO_SORTS[sort], order)


@router.get("/videos")
async def list_videos(org_id: Optional[int] = Query(None), platform: Optional[Literal["tiktok", "youtube", "instagram"]] = None,
                      account_id: Optional[int] = None,
                      sort: Literal["recent", "views", "likes", "comments", "shares", "engagement", "title"] = "recent",
                      order: Literal["asc", "desc"] = Query(None),
                      q: Optional[str] = Query(None, max_length=100),
                      group_id: Optional[int] = Query(None), days: Optional[int] = Query(None, ge=1, le=365),
                      limit: int = Query(50, ge=1, le=200), cursor: Optional[str] = Query(None, max_length=300),
                      response: Response = None, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_cm_user)):
    """Vidéos relevées : recherche (titre), tri dans les deux sens, pages par curseur (X-Next-Cursor).
    Tout est fait en SQL (index d'expression par tri) : tient sur des millions de vidéos."""
    order = order or ("asc" if sort == "title" else "desc")
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    key = _video_sort_key(sort, order).label("_k")
    conds = [_account_filter(CmVideo, accounts, platform, account_id)]
    if days:
        conds.append(CmVideo.published_at >= utcnow() - timedelta(days=days))
    pattern = paging.like(q)
    if pattern:
        conds.append(CmVideo.title.ilike(pattern, escape="\\"))
    stmt = paging.apply(select(CmVideo, key).where(*conds), key, VIDEO_SORTS[sort], CmVideo.id, order, cursor, limit)
    rows = list((await db.execute(stmt)).all())
    rows = paging.page(response, rows, limit, lambda r: r[1], lambda r: r[0].id, cursor)
    return [_video_out(v, names) for v, _ in rows]


def _embed(v: CmVideo) -> Optional[str]:
    """Lecteur officiel de la plateforme (aucune API, aucune donnée envoyée par cm)."""
    import re as _re
    if v.platform == "youtube":
        return f"https://www.youtube-nocookie.com/embed/{v.external_id}?rel=0"
    if v.platform == "tiktok":
        return f"https://www.tiktok.com/embed/v2/{v.external_id}"
    m = _re.search(r"instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)", v.url or "")
    return f"https://www.instagram.com/reel/{m.group(1)}/embed" if m else None


@router.get("/videos/{video_id}/sheet")
async def video_sheet(video_id: int, org_id: Optional[int] = Query(None),
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Fiche d'une vidéo : la même vidéo sur chaque plateforme (publiée ensemble depuis Chapote),
    chiffres par plateforme et au total, lecteurs intégrés, vidéo source et dossier Drive."""
    from src.models.cm import CmAsset, CmComment, CmSource
    from src.services import cm_library as lib
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant)
    allowed = {(p, a.id) for p, a in accounts}
    v = await db.get(CmVideo, video_id)
    if v is None or (v.platform, v.account_id) not in allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vidéo introuvable")
    post, siblings = None, [v]
    if v.target_id:
        t = await db.get(CmTarget, v.target_id)
        post = await db.get(CmPost, t.post_id) if t else None
        if post:
            tids = select(CmTarget.id).where(CmTarget.post_id == post.id)
            siblings = [x for x in (await db.execute(select(CmVideo).where(CmVideo.target_id.in_(tids))
                                                     .order_by(CmVideo.platform))).scalars()
                        if (x.platform, x.account_id) in allowed] or [v]
    counts = dict((await db.execute(select(CmComment.media_id, func.count()).where(
        CmComment.media_id.in_([x.external_id for x in siblings])).group_by(CmComment.media_id))).all())
    rows = [{**_video_out(x, names), "embed": _embed(x), "comments_stored": counts.get(x.external_id, 0)} for x in siblings]
    total = {f: (sum(getattr(x, f) or 0 for x in siblings) if any(getattr(x, f) is not None for x in siblings) else None)
             for f in ("views", "likes", "comments", "shares", "saves")}
    asset = None
    if post and post.asset_id:
        a = await db.get(CmAsset, post.asset_id)
        src = await db.get(CmSource, a.source_id) if a else None
        if a and src and src.revoked_at is None and cm_access.group_allowed(tenant, src.group_id):
            asset = lib.asset_out(a, src)
    return {"id": v.id, "title": (post.title if post else None) or v.title, "caption": post.caption if post else None,
            "post_id": post.id if post else None, "videos": rows, "totals": total, "asset": asset}


async def _daily_series(db: AsyncSession, accounts, since, until) -> list[dict]:
    """Série jour par jour (du `since` au `until` inclus) : dernière valeur connue de
    chaque compte (report des jours sans relevé), totalisée et par plateforme."""
    stats = (await db.execute(
        select(CmAccountStat).where(_account_filter(CmAccountStat, accounts), CmAccountStat.day <= until)
        .where(CmAccountStat.day >= since - timedelta(days=7))
        .order_by(CmAccountStat.day)
    )).scalars().all()
    by_account: dict = {}
    for s in stats:
        by_account.setdefault((s.platform, s.account_id), {})[s.day] = s
    series = []
    last_known: dict = {}
    # Report des valeurs relevées juste avant `since` (jusqu'à 7 jours).
    for key, per_day in by_account.items():
        before = [d for d in per_day if d < since and (per_day[d].views is not None or per_day[d].followers is not None)]
        if before:
            last_known[key] = per_day[max(before)]
    day = since
    while day <= until:
        point = {"day": day.isoformat(), "views": None, "followers": None, "by_platform": {}}
        for key, per_day in by_account.items():
            if day in per_day and (per_day[day].views is not None or per_day[day].followers is not None):
                last_known[key] = per_day[day]
            s = last_known.get(key)
            if s is None:
                continue
            bp = point["by_platform"].setdefault(key[0], {"views": None, "followers": None})
            for field in ("views", "followers"):
                v = getattr(s, field)
                if v is not None:
                    point[field] = (point[field] or 0) + v
                    bp[field] = (bp[field] or 0) + v
        series.append(point)
        day += timedelta(days=1)
    return series


@router.get("/overview")
async def overview(org_id: Optional[int] = Query(None), days: int = Query(30, ge=7, le=365),
                   group_id: Optional[int] = Query(None),
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Tableau de bord : totaux, évolution jour par jour, comptes, vidéos phares, à venir."""
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    since = utcnow().date() - timedelta(days=days)
    series = await _daily_series(db, accounts, since, utcnow().date())

    account_rows = []
    bulk = await _latest_stats_bulk(db, accounts, min(days, 90))
    for p, a in accounts:
        stat, previous = bulk.get((p, a.id), (None, None))
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
        .where(tenant.where(CmPost), _account_filter(CmTarget, accounts), CmTarget.status.in_((T_SCHEDULED, T_AWAITING_ROUTINE)))
    )).scalar() or 0
    published = (await db.execute(
        select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), _account_filter(CmTarget, accounts), CmTarget.status == T_PUBLISHED,
               CmTarget.published_at >= datetime.combine(since, datetime.min.time()))
    )).scalar() or 0
    failed = (await db.execute(
        select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), _account_filter(CmTarget, accounts), CmTarget.status == T_FAILED,
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
# Groupes de comptes : un groupe réunit plusieurs comptes (toutes plateformes),
# un compte peut appartenir à plusieurs groupes. Filtre partout (?group_id=).
# --------------------------------------------------------------------------

MAX_GROUPS = 50
MAX_GROUP_ACCOUNTS = 200
GROUP_COLORS = ("blue", "orange", "green", "purple", "pink", "teal", "amber", "slate", "red", "indigo", "cyan", "lime", "rose", "sky", "emerald", "brown")


class GroupAccountIn(BaseModel):
    platform: Literal["tiktok", "youtube", "instagram"]
    account_id: int


class GroupIn(BaseModel):
    org_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=60)
    color: Optional[Literal["blue", "orange", "green", "purple", "pink", "teal", "amber", "slate", "red", "indigo", "cyan", "lime", "rose", "sky", "emerald", "brown"]] = None
    accounts: list[GroupAccountIn] = Field(default_factory=list, max_length=MAX_GROUP_ACCOUNTS)


class GroupPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    color: Optional[Literal["blue", "orange", "green", "purple", "pink", "teal", "amber", "slate", "red", "indigo", "cyan", "lime", "rose", "sky", "emerald", "brown"]] = None
    accounts: Optional[list[GroupAccountIn]] = Field(default=None, max_length=MAX_GROUP_ACCOUNTS)


async def _groups_out(db: AsyncSession, tenant: Tenant, groups: list[CmGroup]) -> list[dict]:
    active = {(p, a.id) for p, a in await cm.tenant_accounts(db, tenant)}
    members: dict[int, list[dict]] = {}
    if groups:
        rows = (await db.execute(
            select(CmGroupAccount).where(CmGroupAccount.group_id.in_([g.id for g in groups]))
            .order_by(CmGroupAccount.id)
        )).scalars().all()
        for m in rows:
            if (m.platform, m.account_id) in active:     # compte déconnecté : ignoré
                members.setdefault(m.group_id, []).append({"platform": m.platform, "id": m.account_id})
    return [{"id": g.id, "name": g.name, "color": g.color, "accounts": members.get(g.id, []),
             "created_at": cm.iso(g.created_at)} for g in groups]


async def _validate_members(db: AsyncSession, tenant: Tenant, accounts: list[GroupAccountIn]) -> list[tuple[str, int]]:
    """Comptes demandés, dédoublonnés ; 404 si l'un n'est pas un compte actif du tenant."""
    active = {(p, a.id) for p, a in await cm.tenant_accounts(db, tenant)}
    wanted: list[tuple[str, int]] = []
    for a in accounts:
        key = (a.platform, a.account_id)
        if key not in active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{cm.ACCOUNT_LABEL[a.platform]} introuvable.")
        if key not in wanted:
            wanted.append(key)
    return wanted


async def _set_members(db: AsyncSession, group: CmGroup, wanted: list[tuple[str, int]]) -> None:
    current = (await db.execute(select(CmGroupAccount).where(CmGroupAccount.group_id == group.id))).scalars().all()
    for m in current:
        if (m.platform, m.account_id) not in wanted:
            await db.delete(m)
    have = {(m.platform, m.account_id) for m in current}
    for p, aid in wanted:
        if (p, aid) not in have:
            db.add(CmGroupAccount(group_id=group.id, platform=p, account_id=aid))


def _group_name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Donnez un nom au groupe.")
    return name


@router.get("/groups")
async def list_groups(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    groups = (await db.execute(
        select(CmGroup).where(tenant.where(CmGroup)).order_by(func.lower(CmGroup.name), CmGroup.id)
    )).scalars().all()
    groups = [g for g in groups if cm_access.group_allowed(tenant, g.id)]
    return await _groups_out(db, tenant, list(groups))


@router.post("/groups")
async def create_group(body: GroupIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    cm_access.require(tenant, "admin")
    count = (await db.execute(select(func.count()).select_from(CmGroup).where(tenant.where(CmGroup)))).scalar() or 0
    if count >= MAX_GROUPS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{MAX_GROUPS} groupes au plus par espace.")
    name = _group_name(body.name)
    wanted = await _validate_members(db, tenant, body.accounts)
    group = CmGroup(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
                    name=name, color=body.color or GROUP_COLORS[count % len(GROUP_COLORS)])
    db.add(group)
    await db.flush()
    await _set_members(db, group, wanted)
    await db.commit()
    return (await _groups_out(db, tenant, [group]))[0]


@router.patch("/groups/{group_id}")
async def update_group(group_id: int, body: GroupPatch, org_id: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    group = await _get_group(db, tenant, group_id, lock=True)
    name = _group_name(body.name) if body.name is not None else None
    wanted = await _validate_members(db, tenant, body.accounts) if body.accounts is not None else None
    if name is not None:
        group.name = name
    if body.color is not None:
        group.color = body.color
    if wanted is not None:
        await _set_members(db, group, wanted)
    group.updated_at = utcnow()
    await db.commit()
    return (await _groups_out(db, tenant, [group]))[0]


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    """Supprime le groupe seulement : les comptes et leurs publications restent."""
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    group = await _get_group(db, tenant, group_id, lock=True)
    await db.delete(group)
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# Calendrier (rétrospective + planning) et statistiques détaillées
# --------------------------------------------------------------------------

CALENDAR_MAX_DAYS = 120
# Chiffres que chaque plateforme fournit réellement par vidéo (API officielles).
METRICS = {
    "tiktok": ["followers", "views", "likes", "comments", "shares"],
    "youtube": ["followers", "views", "likes", "comments"],
    "instagram": ["followers", "views", "likes", "comments", "shares", "saves"],
}


@router.get("/calendar")
async def calendar(org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                   start: Optional[datetime] = None, end: Optional[datetime] = None,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Calendrier : vidéos réellement publiées sur les comptes (relevées chez TikTok,
    YouTube et Instagram, publiées ou non depuis Chapote, avec leurs chiffres),
    publications Chapote programmées, et évolution des abonnés jour par jour."""
    tenant = await _tenant(db, user, org_id)
    now = utcnow()
    start = cm.to_utc_naive(start) or now - timedelta(days=30)
    end = cm.to_utc_naive(end) or now + timedelta(days=30)
    if end <= start:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Période invalide.")
    if end - start > timedelta(days=CALENDAR_MAX_DAYS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Période de {CALENDAR_MAX_DAYS} jours au plus.")
    accounts, names = await _tenant_index(db, tenant, group_id)

    videos = (await db.execute(
        select(CmVideo).where(_account_filter(CmVideo, accounts), CmVideo.published_at >= start,
                              CmVideo.published_at < end)
        .order_by(CmVideo.published_at).limit(1000)
    )).scalars().all()
    seen = {(v.platform, v.account_id, v.external_id) for v in videos}
    # Regroupement : la même vidéo sur plusieurs plateformes = une ligne (même publication cm, sinon
    # même titre le même jour pour les vidéos publiées ailleurs).
    tids = [v.target_id for v in videos if v.target_id]
    post_of = dict((await db.execute(select(CmTarget.id, CmTarget.post_id).where(CmTarget.id.in_(tids)))).all()) if tids else {}

    def video_group(v: CmVideo) -> str:
        if v.target_id and post_of.get(v.target_id):
            return f"p{post_of[v.target_id]}"
        title = re.sub(r"\s+", " ", re.split(r"[#\n]", (v.title or ""))[0]).strip().lower()[:80]
        return f"t{title}|{v.published_at.date() if v.published_at else ''}" if title else f"v{v.id}"
    items: list[dict] = [{"kind": "video", "at": cm.iso(v.published_at), "group": video_group(v), **_video_out(v, names)}
                         for v in videos]

    rows = (await db.execute(
        select(CmTarget, CmPost).join(CmPost, CmPost.id == CmTarget.post_id)
        .where(tenant.where(CmPost), _account_filter(CmTarget, accounts), CmPost.status != POST_RECEIVING,
               CmTarget.status != T_CANCELLED,
               func.coalesce(CmTarget.published_at, CmTarget.scheduled_at) >= start,
               func.coalesce(CmTarget.published_at, CmTarget.scheduled_at) < end)
        .limit(1000)
    )).all()
    for t, post in rows:
        if t.external_id and (t.platform, t.account_id, t.external_id) in seen:
            continue      # déjà là avec ses chiffres (vidéo relevée)
        items.append({"kind": "target", "at": cm.iso(t.published_at or t.scheduled_at), "title": post.title,
                      "group": f"p{post.id}", **_target_out(t, names)})
    items.sort(key=lambda i: i["at"] or "")

    first, last = start.date(), min(end, now).date()
    days = []
    if first <= last:
        series = await _daily_series(db, accounts, first - timedelta(days=1), last)
        for prev, pt in zip(series, series[1:]):
            days.append({
                "day": pt["day"], "followers": pt["followers"], "views": pt["views"],
                "followers_delta": cm._delta(pt["followers"], prev["followers"]),
                "views_delta": cm._delta(pt["views"], prev["views"]),
            })
    return {"start": cm.iso(start), "end": cm.iso(end), "items": items, "days": days}


def _blank() -> dict:
    return {"posts": 0, "views": None, "likes": None, "comments": None, "shares": None, "saves": None}


def _add(acc: dict, v: CmVideo) -> None:
    acc["posts"] += 1
    for f in ("views", "likes", "comments", "shares", "saves"):
        val = getattr(v, f)
        if val is not None:
            acc[f] = (acc[f] or 0) + val


def _rates(row: dict) -> dict:
    inter = sum(row[f] or 0 for f in ("likes", "comments", "shares", "saves"))
    row["interactions"] = inter if any(row[f] is not None for f in ("likes", "comments", "shares", "saves")) else None
    row["engagement_rate"] = round(inter / row["views"], 4) if row["views"] else None
    row["avg_views"] = round(row["views"] / row["posts"]) if row["views"] is not None and row["posts"] else None
    return row


STAT_SORTS = ("views", "posts", "engagement_rate", "followers", "followers_delta", "likes", "name")


@router.get("/stats")
async def detailed_stats(org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                         days: int = Query(30, ge=7, le=365),
                         q: Optional[str] = Query(None, max_length=100),
                         sort: Literal["views", "posts", "engagement_rate", "followers", "followers_delta", "likes", "name"] = "views",
                         order: Literal["asc", "desc"] = "desc",
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Statistiques sur la période : par plateforme, par compte et au total.
    Vues et interactions = chiffres actuels des vidéos PUBLIÉES dans la période (sommés en SQL) ;
    abonnés = dernier relevé et évolution sur la période. `q`/`sort`/`order` : tableau par compte
    (les totaux portent toujours sur tout le périmètre)."""
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    since = utcnow() - timedelta(days=days)
    in_period = (_account_filter(CmVideo, accounts), CmVideo.published_at >= since)
    agg = (await db.execute(
        select(CmVideo.platform, CmVideo.account_id, func.count(CmVideo.id),
               *(func.sum(getattr(CmVideo, f)) for f in ("views", "likes", "comments", "shares", "saves")))
        .where(*in_period).group_by(CmVideo.platform, CmVideo.account_id)
    )).all()
    per_account = {(r[0], r[1]): {"posts": r[2], "views": r[3], "likes": r[4], "comments": r[5],
                                  "shares": r[6], "saves": r[7]} for r in agg}
    recent = (await db.execute(
        select(CmVideo.platform, CmVideo.published_at, CmVideo.views, CmVideo.likes, CmVideo.comments,
               CmVideo.shares, CmVideo.saves)
        .where(*in_period).order_by(CmVideo.published_at.desc()).limit(1000)
    )).all()

    stats = await _latest_stats_bulk(db, accounts, days)
    account_rows, platforms = [], {}
    total = {**_blank(), "accounts": 0, "followers": None, "followers_delta": None}
    for p, a in accounts:
        stat, previous = stats.get((p, a.id), (None, None))
        view = cm.account_view(p, a, stat, previous)
        row = {**_blank(), **{k: (int(v) if v is not None else None) for k, v in per_account.get((p, a.id), {}).items()},
               "platform": p, "id": a.id, "name": view["name"],
               "avatar_url": view["avatar_url"], "stats_available": view["stats_available"],
               "followers": (view["stats"] or {}).get("followers"),
               "followers_delta": (view["stats"] or {}).get("delta_followers")}
        account_rows.append(_rates(row))
        plat = platforms.setdefault(p, {**_blank(), "platform": p, "accounts": 0, "followers": None,
                                        "followers_delta": None, "metrics": METRICS[p]})
        for agg_row in (plat, total):
            agg_row["accounts"] += 1
            agg_row["posts"] += row["posts"]
            for f in ("views", "likes", "comments", "shares", "saves", "followers", "followers_delta"):
                if row[f] is not None:
                    agg_row[f] = (agg_row[f] or 0) + row[f]
    needle = (q or "").strip().lower().lstrip("@")
    shown = [r for r in account_rows if not needle or needle in (r["name"] or "").lower()]
    value = (lambda r: (r["name"] or "").lower().lstrip("@")) if sort == "name" else (lambda r: r[sort])
    return {
        "days": days,
        "totals": _rates(total),
        "platforms": [_rates(platforms[p]) for p in PLATFORMS if p in platforms],
        "accounts": _sort_rows(shown, sort, order, value),
        # Une ligne par vidéo pour la carte « meilleurs moments » (heure locale côté navigateur).
        "posts": [{"platform": r[0], "published_at": cm.iso(r[1]), "views": r[2],
                   "interactions": sum(x or 0 for x in r[3:7])} for r in reversed(recent)],
        "metrics": METRICS,
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
    cm_access.require(tenant, "admin")
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
    cm_access.require(tenant, "admin")
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
    taken = (await cm_access.taken_elsewhere(db, "instagram", ig_id, tenant)
             or (await cm_access.taken_elsewhere(db, "instagram", None, tenant, username=username) if username else None))
    if taken is not None:
        await cm_access.refuse_taken(db, "instagram", taken, user, claim_tokens={
            **long, "_profile": {k: prof.get(k) for k in ("user_id", "username", "name", "account_type", "profile_picture_url")},
            "_ig_id": ig_id, "_scopes": short.get("permissions") or ig.SCOPES})
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
    cm_access.require(tenant, "admin")
    username = _clean_username(body.username)
    acc = (await db.execute(select(InstagramAccount).where(
        tenant.where(InstagramAccount), InstagramAccount.revoked_at.is_(None),
        func.lower(InstagramAccount.username) == username.lower()))).scalars().first()
    if acc is None:
        taken = await cm_access.taken_elsewhere(db, "instagram", None, tenant, username=username)
        if taken is not None:
            await cm_access.refuse_taken(db, "instagram", taken, user)
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
    cm_access.require(tenant, "admin")
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
    account_id: Optional[int] = None
    account: Optional[str] = Field(None, max_length=120)   # nom lisible : « tiktok:@pseudo » (au lieu de l'id)
    scheduled_at: Optional[datetime] = None      # vide = dès que la vidéo est reçue
    options: dict[str, Any] = Field(default_factory=dict)


class PostIn(BaseModel):
    org_id: Optional[int] = None
    title: str = Field(min_length=1, max_length=200)
    caption: str = Field(default="", max_length=5000)
    file_name: str = Field(default="", max_length=255)
    # Vidéo envoyée depuis l'appareil (video_size) OU vidéo de la bibliothèque Drive (asset_id).
    video_size: int = Field(default=0, ge=0)
    asset_id: Optional[int] = None
    # Référence de l'outil qui publie (« compte/id », ex. claude-cloud) : relie la publication à sa vidéo
    # du Drive (infos.json) et refuse un doublon tant qu'une publication active porte la même référence.
    ref: Optional[str] = Field(None, max_length=200)
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
        "id": post.id, "ref": post.ref, "title": post.title, "caption": post.caption, "file_name": post.file_name,
        "video_size": post.video_size, "duration_sec": post.duration_sec, "status": post.status,
        "has_media": bool(post.media_path), "asset_id": post.asset_id, "created_at": cm.iso(post.created_at),
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
    if not cm_access.account_allowed(tenant, t.platform, t.account_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    return t, post, tenant


async def _targets_of(db: AsyncSession, post_ids: list[int]) -> dict[int, list[CmTarget]]:
    out: dict[int, list[CmTarget]] = {}
    if not post_ids:
        return out
    for t in (await db.execute(select(CmTarget).where(CmTarget.post_id.in_(post_ids)))).scalars().all():
        out.setdefault(t.post_id, []).append(t)
    return out


async def _get_asset(db: AsyncSession, tenant: Tenant, asset_id: int) -> CmAsset:
    row = (await db.execute(select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
                            .where(CmAsset.id == asset_id))).first()
    if row is None or row[1].revoked_at is not None or not _same(row[1], tenant) \
            or not cm_access.group_allowed(tenant, row[1].group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vidéo introuvable dans la bibliothèque.")
    return row[0]


async def _create_from_asset(db: AsyncSession, tenant: Tenant, user: User, asset: CmAsset, title: str,
                             caption: str, planned: list, ref: Optional[str] = None) -> dict:
    """Publication d'une vidéo de la bibliothèque : rien à envoyer, prête tout de suite. Le
    fichier sera téléchargé depuis le Drive à l'heure de la 1re publication."""
    if not await post_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Limite quotidienne de publications atteinte. Réessayez demain.")
    post = CmPost(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id, user_id=user.id,
                  title=title, caption=caption or None, file_name=asset.name[:255], video_size=asset.size or 0,
                  received_bytes=asset.size or 0, mime_type=asset.mime_type, duration_sec=asset.duration_sec,
                  media_path=None, asset_id=asset.id, status=POST_READY, ref=ref)
    db.add(post)
    await db.flush()
    now = utcnow()
    targets, due = [], []
    for t, options, when in planned:
        row = CmTarget(post_id=post.id, platform=t.platform, account_id=t.account_id, scheduled_at=max(when, now),
                       options=options, status=T_SCHEDULED)
        db.add(row)
        targets.append(row)
    # Brouillon automatique de cette vidéo : utilisé.
    from sqlalchemy import update as sa_update
    from src.models.cm import CmProposal
    await db.execute(sa_update(CmProposal).where(CmProposal.asset_id == asset.id, CmProposal.status == "open")
                     .values(status="used"))
    await db.commit()
    for row in targets:
        if row.scheduled_at <= now:
            due.append(row.id)
    for target_id in due:
        cm_jobs.launch(target_id)
    _, names = await _tenant_index(db, tenant)
    return {"post_id": post.id, "ready": True, "post": _post_out(post, targets, names)}


async def _asset_by_ref(db: AsyncSession, tenant: Tenant, ref: Optional[str]) -> Optional[int]:
    """Vidéo du Drive (infos.json) qui porte cette référence, dans l'espace (ou None)."""
    if not ref:
        return None
    from src.models.cm import CmSource
    return (await db.execute(select(CmAsset.id).join(CmSource, CmSource.id == CmAsset.source_id).where(
        CmAsset.origin_ref == ref, CmAsset.removed_at.is_(None), CmSource.revoked_at.is_(None),
        tenant.where(CmSource)).limit(1))).scalar_one_or_none()


async def _account_by_slug(db: AsyncSession, tenant: Tenant, platform: str, slug: Optional[str]) -> int:
    if not slug:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cible sans compte : donnez « account » (ex. tiktok:@pseudo) ou « account_id ».")
    if not slug.lower().startswith(f"{platform}:"):
        slug = f"{platform}:{slug}"
    for p, a in await cm.tenant_accounts(db, tenant):
        if p == platform and cm.same_slug(slug, p, a):
            return a.id
    raise HTTPException(status.HTTP_404_NOT_FOUND, f"Compte « {slug} » introuvable dans cet espace (voir GET /api/cm/accounts → slug).")


async def _plan_targets(db: AsyncSession, tenant: Tenant, targets: list, title: str, caption: str,
                        mime: Optional[str], duration: Optional[float], size: int) -> list:
    """Règles communes des cibles (POST /posts et POST /posts/{id}/targets) : compte (slug ou id), publication
    possible, options normalisées, vidéo compatible si connue, heure. Tout est vérifié avant d'écrire."""
    seen = set()
    planned = []
    for t in targets:
        if t.account_id is None:
            t.account_id = await _account_by_slug(db, tenant, t.platform, t.account)
        key = (t.platform, t.account_id)
        if key in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un même compte est choisi deux fois.")
        seen.add(key)
        acc = await cm.get_account(db, tenant, t.platform, t.account_id)
        if not cm.can_publish(t.platform, acc):
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"{cm.ACCOUNT_LABEL[t.platform]} « {cm.account_name(t.platform, acc)} » : publication "
                                "impossible pour le moment (compte à reconnecter ou module indisponible).")
        options = cm.normalize_options(t.platform, acc, t.options, title, caption or "")
        if duration and mime:
            err = cm.check_video_for(t.platform, acc, mime, duration, size)
            if err:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, err)
        planned.append((t, options, cm.check_schedule(t.scheduled_at)))
    return planned


@router.post("/posts")
async def create_post(body: PostIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    cm_access.require(tenant, "edit")
    asset = None
    if body.asset_id is not None:
        asset = await _get_asset(db, tenant, body.asset_id)
        if asset.removed_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cette vidéo n'est plus dans le dossier Drive.")
    elif body.video_size <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choisissez une vidéo.")
    size = (asset.size or 0) if asset else body.video_size
    if size > cm.max_upload_bytes():
        raise HTTPException(413, f"Vidéo trop volumineuse ({settings.CM_MAX_UPLOAD_MB} Mo maximum).")
    title = body.title.strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Donnez un titre à la publication.")
    ref = (body.ref or "").strip() or None
    if ref:
        dup = (await db.execute(select(CmPost.id).join(CmTarget, CmTarget.post_id == CmPost.id).where(
            tenant.where(CmPost), CmPost.ref == ref, CmPost.status != POST_CANCELLED,
            CmTarget.status != T_CANCELLED).limit(1))).scalar_one_or_none()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "duplicate_ref", "post_id": dup,
                                                           "message": f"Une publication active porte déjà la référence « {ref} »."})
    planned = await _plan_targets(db, tenant, body.targets, title, body.caption,
                                  asset.mime_type if asset else None, asset.duration_sec if asset else None, size)
    if asset is not None:
        return await _create_from_asset(db, tenant, user, asset, title, body.caption, planned, ref)
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
                  received_bytes=0, media_path=str(path), status=POST_RECEIVING, ref=ref,
                  asset_id=await _asset_by_ref(db, tenant, ref))
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
    post, tenant = await _get_post(db, user, post_id, lock=True)
    cm_access.require(tenant, "edit")
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


@router.put("/posts/{post_id}/cover")
async def upload_cover(post_id: int, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    """Couverture personnalisée (JPEG ou PNG, 8 Mo max), utilisée par Instagram (`cover_url`)."""
    post, tenant = await _get_post(db, user, post_id, lock=True)
    cm_access.require(tenant, "edit")
    if post.status == POST_CANCELLED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Publication annulée.")
    data = await request.body()
    if not data or len(data) > cm.COVER_MAX_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Couverture : image JPEG ou PNG de 8 Mo au plus.")
    kind = cm.image_kind(data)
    if kind is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Couverture : seules les images JPEG ou PNG sont acceptées.")
    cm.remove_cover(post)
    path = str(cm.media_dir() / f"{uuid.uuid4().hex}.{'jpg' if kind == 'jpeg' else 'png'}")
    with open(path, "wb") as f:
        f.write(data)
    os.chmod(path, 0o600)
    post.cover_path = path
    await db.commit()
    return {"ok": True, "size": len(data)}


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
    cm_access.require(tenant, "edit")
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


class TargetsAddIn(BaseModel):
    targets: list[TargetIn] = Field(min_length=1, max_length=MAX_TARGETS)


@router.post("/posts/{post_id}/targets")
async def add_targets(post_id: int, body: TargetsAddIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_cm_user)):
    """Complète un post déjà créé (ex. TikTok / YouTube ajoutés à un Reel programmé). Mêmes règles que les cibles
    de POST /posts ; une plateforme déjà présente (cible non annulée) est ignorée et listée dans `skipped`."""
    post, tenant = await _get_post(db, user, post_id, lock=True)
    cm_access.require(tenant, "edit")
    if post.status == POST_CANCELLED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication est annulée : recréez-la.")
    if post.status == POST_READY and not (post.media_path or post.asset_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "La vidéo n'est plus disponible : recréez la publication.")
    existing = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
    active = {t.platform: t for t in existing if t.status != T_CANCELLED}
    wanted, skipped = [], []
    for t in body.targets:
        if t.platform in active:
            had = active[t.platform]
            skipped.append({"platform": t.platform, "target_id": had.id, "status": had.status})
        elif any(w.platform == t.platform for w in wanted):
            skipped.append({"platform": t.platform, "target_id": None, "status": "DUPLICATE"})
        else:
            wanted.append(t)
    if len(active) + len(wanted) > MAX_TARGETS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{MAX_TARGETS} comptes au plus par publication.")
    planned = await _plan_targets(db, tenant, wanted, post.title, post.caption or "", post.mime_type,
                                  post.duration_sec, post.video_size or 0)
    now = utcnow()
    ready = post.status == POST_READY
    added = []
    for t, options, when in planned:
        row = CmTarget(post_id=post.id, platform=t.platform, account_id=t.account_id,
                       scheduled_at=max(when, now) if ready else when, options=options,
                       status=T_SCHEDULED if ready else T_DRAFT)
        db.add(row)
        added.append(row)
    await db.commit()
    if ready:
        for row in added:
            if row.scheduled_at <= now:
                cm_jobs.launch(row.id)
    _, names = await _tenant_index(db, tenant)
    return {"added": [_target_out(r, names) for r in added], "skipped": skipped,
            "post": _post_out(post, list(existing) + added, names)}


@router.get("/posts")
async def list_posts(org_id: Optional[int] = Query(None), start: Optional[datetime] = None,
                     end: Optional[datetime] = None, group_id: Optional[int] = Query(None),
                     q: Optional[str] = Query(None, max_length=100),
                     status_: Optional[Literal["upcoming", "published", "failed"]] = Query(None, alias="status"),
                     order: Literal["asc", "desc"] = "asc",
                     limit: int = Query(200, ge=1, le=500), cursor: Optional[str] = Query(None, max_length=300),
                     response: Response = None,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Planning : publications dont une cible tombe entre `start` et `end` (défaut : -30 j / +90 j),
    triées par première heure prévue (asc ou desc), recherche dans titre et légende, pages par curseur.
    Avec un groupe / un compte, seules leurs cibles sont renvoyées. Tout le filtrage est en SQL."""
    tenant = await _tenant(db, user, org_id)
    now = utcnow()
    start = cm.to_utc_naive(start) or now - timedelta(days=30)
    end = cm.to_utc_naive(end) or now + timedelta(days=90)
    conds = [tenant.where(CmPost), CmPost.status != POST_RECEIVING,
             CmTarget.scheduled_at >= start, CmTarget.scheduled_at <= end]
    accounts, names = await _tenant_index(db, tenant, group_id)
    narrowed = group_id is not None or tenant.allowed is not None or _ACCOUNT_SCOPE.get() is not None
    if narrowed:
        conds.append(_account_filter(CmTarget, accounts))
    if status_ == "upcoming":
        conds.append(CmTarget.status.not_in(T_FINAL))
    elif status_ == "published":
        conds.append(CmTarget.status == T_PUBLISHED)
    elif status_ == "failed":
        conds.append(CmTarget.status == T_FAILED)
    pattern = paging.like(q)
    if pattern:
        conds.append(or_(CmPost.title.ilike(pattern, escape="\\"), CmPost.caption.ilike(pattern, escape="\\")))
    first = func.min(CmTarget.scheduled_at)
    sub = (select(CmTarget.post_id.label("pid"), first.label("first_at"))
           .join(CmPost, CmPost.id == CmTarget.post_id).where(*conds).group_by(CmTarget.post_id).subquery())
    stmt = paging.apply(select(sub.c.pid, sub.c.first_at), sub.c.first_at, "dt", sub.c.pid, order, cursor, limit)
    page = paging.page(response, list((await db.execute(stmt)).all()), limit, lambda r: r[1], lambda r: r[0], cursor)
    ids = [r[0] for r in page]
    posts = {p.id: p for p in (await db.execute(select(CmPost).where(CmPost.id.in_(ids)))).scalars()} if ids else {}
    targets = await _targets_of(db, ids)
    if narrowed:
        keep = {(p, a.id) for p, a in accounts}
        targets = {pid: [t for t in ts if (t.platform, t.account_id) in keep] for pid, ts in targets.items()}
    return [_post_out(posts[i], targets.get(i, []), names) for i in ids if i in posts]


@router.get("/posts/{post_id}")
async def get_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    post, tenant = await _get_post(db, user, post_id)
    targets = [t for t in (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
               if cm_access.account_allowed(tenant, t.platform, t.account_id)]
    if not targets:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Publication introuvable")
    _, names = await _tenant_index(db, tenant)
    return _post_out(post, targets, names)


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Annule toutes les publications pas encore parties de cette vidéo."""
    post, tenant = await _get_post(db, user, post_id, lock=True)
    cm_access.require(tenant, "edit")
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id).with_for_update())).scalars().all()
    for t in targets:
        if t.status in T_EDITABLE and cm_access.account_allowed(tenant, t.platform, t.account_id):
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
    """Heure et/ou textes d'une cible pas encore partie (DRAFT, SCHEDULED). `options` partielles, fusionnées avec
    les options de la cible puis revérifiées (mêmes règles que POST /posts) ; une clé à null revient au texte
    commun du post ; les hashtags ne sont ajoutés que s'ils manquent."""
    t, post, tenant = await _get_target(db, user, target_id)
    cm_access.require(tenant, "edit")
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
    cm_access.require(tenant, "edit")
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
    cm_access.require(tenant, "edit")
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
    cm_access.require(tenant, "edit")
    if t.status != T_FAILED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule une publication en échec peut être relancée.")
    if post.status != POST_READY or not (post.media_path or post.asset_id):
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


@router.get("/cover/{target_id}/{exp}/{sig}")
async def cover(target_id: int, exp: int, sig: str, db: AsyncSession = Depends(get_db)):
    sig = sig.rsplit(".", 1)[0]
    if not cm.check_cover_link(target_id, exp, sig):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Introuvable")
    t = await db.get(CmTarget, target_id)
    post = await db.get(CmPost, t.post_id) if t is not None else None
    if t is None or t.platform != "instagram" or t.status != T_PUBLISHING or post is None \
            or not post.cover_path or not os.path.exists(post.cover_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Introuvable")
    return FileResponse(post.cover_path, media_type="image/png" if post.cover_path.endswith(".png") else "image/jpeg",
                        headers={"Cache-Control": "private, no-store"})


# --------------------------------------------------------------------------
# Routine Claude (jeton de service) : Instagram géré par la routine
# --------------------------------------------------------------------------

async def _routine_target(db: AsyncSession, user: User, target_id: int) -> tuple[CmTarget, CmPost, InstagramAccount]:
    t, post, tenant = await _get_target(db, user, target_id)
    cm_access.require(tenant, "edit")
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
        "collaborators": o.get("collaborators") or [],
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


@router.get("/routine/targets/{target_id}/cover")
async def routine_cover(target_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    t, post, acc = await _routine_target(db, user, target_id)
    if not post.cover_path or not os.path.exists(post.cover_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pas de couverture")
    await db.commit()
    return FileResponse(post.cover_path, media_type="image/png" if post.cover_path.endswith(".png") else "image/jpeg",
                        filename=f"cm-{t.id}-couverture.{post.cover_path.rsplit('.', 1)[-1]}")


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
        taken = await cm_access.taken_elsewhere(db, "instagram", None, tenant, username=username)
        if taken is not None:
            await cm_access.refuse_taken(db, "instagram", taken, user)
        acc = InstagramAccount(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id,
                               mode=IG_MODE_ROUTINE, username=username, connected_by_user_id=user.id)
        db.add(acc)
        await db.flush()
    payload = body.model_dump()
    payload["videos"] = [v.model_dump() for v in body.videos]
    stat = await cm.ingest_routine_stats(db, acc, payload)
    return cm.account_view("instagram", acc, stat)
