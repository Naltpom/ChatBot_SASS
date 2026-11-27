"""Tâches de fond de cm.chapote.fr : publication à l'heure dite, suivi, statistiques.

- `dispatch_target(target_id)` : une cible arrivée à son heure.
  * TikTok / YouTube : vérifie le compte (et, pour TikTok, les options du créateur
    du moment), copie la vidéo dans le dossier temporaire du module, crée la
    publication du module (tiktok_posts / youtube_posts) et la lance : le module
    fait l'envoi comme depuis l'Espace client.
  * Instagram (connexion officielle) : crée le conteneur du Reel avec un lien
    signé vers la vidéo, que Meta télécharge ; le suivi publie quand il est prêt.
  * Instagram (géré par la routine) : passe en « à publier par la routine ».
  Prise en charge atomique (UPDATE … WHERE status = SCHEDULED) : jamais deux envois.
- `scheduler_loop()` : 1 tick / min, un seul worker par tick (jeton Redis) :
  cibles arrivées à leur heure, suivi des envois, jetons Instagram, relevés des
  statistiques (toutes les CM_STATS_EVERY_HOURS), nettoyage des vidéos terminées.

Aucun jeton ni lien signé n'est jamais loggé.
"""
import asyncio
import os
import logging
import shutil
import time
import uuid
from datetime import timedelta
from typing import Callable, Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.time import utcnow
from src.models import tiktok as tk_models
from src.models import youtube as yt_models
from src.models.cm import (
    IG_MODE_API,
    CmComment,
    POST_CANCELLED,
    POST_READY,
    POST_RECEIVING,
    T_AWAITING_ROUTINE,
    T_CANCELLED,
    T_DISPATCHING,
    T_DRAFT,
    T_FAILED,
    T_FINAL,
    T_INBOX,
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
from src.models.tiktok import TikTokAccount, TikTokPost
from src.models.youtube import YouTubeAccount, YouTubePost
from src.services import cm_archive
from src.services import cm_inbox
from src.services import cm_library
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import tiktok_jobs
from src.services import tiktok_service as tt
from src.services import youtube_jobs
from src.services import youtube_service as yt
from src.services.background import spawn_background
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
DISPATCH_BATCH = 20
SYNC_BATCH = 10
MAX_ATTEMPTS = 3
DISPATCHING_TIMEOUT = timedelta(minutes=30)
# Repli TikTok (option fallback_draft) : visibilité refusée tant que l'app n'est pas auditée -> brouillon.
DRAFT_FALLBACK_REASONS = ("unaudited_client_can_only_post_to_private_accounts", "privacy_level_option_mismatch")
DRAFT_FALLBACK_NOTICE = ("TikTok n'a pas accepté la publication directe (application pas encore validée) : "
                         "la vidéo est partie en brouillon dans l'app TikTok, à publier depuis le téléphone.")
CONTAINER_TIMEOUT = timedelta(hours=1)
ROUTINE_CLAIM_TIMEOUT = timedelta(hours=6)
RECEIVING_TIMEOUT = timedelta(hours=2)
# Vidéo gardée après un échec (pour « Réessayer »), puis supprimée.
FAILED_MEDIA_GRACE = timedelta(hours=48)
HISTORY_RETENTION = timedelta(days=365)
# Publications simultanées par tenant dans les modules TikTok / YouTube.
MAX_ACTIVE_POSTS = 3

_tick_lock = SingleUseTokens("rl:cmsched:", TICK_SECONDS - 5)
_scheduler_task: Optional[asyncio.Task] = None


class _Fail(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class _Later(Exception):
    """Cible remise à plus tard (limite d'envois simultanés atteinte)."""


def _tenant_of_post(post: CmPost):
    from src.routers.tiktok import Tenant
    return Tenant(post.organization_id, post.owner_user_id, None)


def fail_target(t: CmTarget, code: str, message: str) -> None:
    t.status = T_FAILED
    t.fail_reason = code
    t.error_message = message


# --------------------------------------------------------------------------
# Envoi d'une cible
# --------------------------------------------------------------------------

async def _copy_media(post: CmPost, folder) -> str:
    dest = folder / f"{uuid.uuid4().hex}.part"
    await asyncio.to_thread(shutil.copyfile, post.media_path, dest)
    dest.chmod(0o600)
    return str(dest)


async def _active_count(db: AsyncSession, model, tenant) -> int:
    return (await db.execute(
        select(func.count()).select_from(model).where(tenant.where(model), model.status.in_(
            tk_models.POST_ACTIVE if model is TikTokPost else yt_models.POST_ACTIVE))
    )).scalar() or 0


def _cover_in_video(ms, duration_sec) -> Optional[int]:
    """Instant de la miniature ramené dans la vidéo (TikTok refuse un instant après la fin)."""
    if ms is None:
        return None
    ms = max(0, int(ms))
    if duration_sec:
        ms = min(ms, max(0, int(duration_sec * 1000) - 50))
    return ms


async def _dispatch_tiktok(db: AsyncSession, t: CmTarget, post: CmPost) -> None:
    from src.routers import tiktok as tiktok_router
    if not tt.is_enabled():
        raise _Fail("disabled", "Le module TikTok n'est pas disponible pour le moment.")
    acc = await db.get(TikTokAccount, t.account_id)
    if acc is None or acc.revoked_at is not None:
        raise _Fail("account_removed", "Ce compte TikTok a été déconnecté.")
    tenant = _tenant_of_post(post)
    if await _active_count(db, TikTokPost, tenant) >= MAX_ACTIVE_POSTS:
        raise _Later()
    o = t.options or {}
    try:
        token = await tt.valid_access_token(db, acc)
        info = await tt.creator_info(token)
    except tt.ReconnectRequired:
        raise _Fail("reconnect_required", tt.ERROR_MESSAGES["access_token_invalid"])
    except tt.TikTokError as e:
        raise _Fail(e.code, e.describe())
    if info.get("creator_username") and acc.username != info["creator_username"]:
        acc.username = info["creator_username"]
    max_dur = min(info.get("max_video_post_duration_sec") or tt.MAX_DURATION_SEC, tt.MAX_DURATION_SEC)
    if (post.duration_sec or 0) > max_dur:
        raise _Fail("duration_check_failed",
                    f"Vidéo trop longue : {int(post.duration_sec)} s pour {max_dur} s maximum sur ce compte.")
    direct = o.get("mode") == "direct"
    if direct and o.get("privacy_level") not in (info.get("privacy_level_options") or []):
        if not o.get("fallback_draft"):
            raise _Fail("privacy_level_option_mismatch", tt.ERROR_MESSAGES["privacy_level_option_mismatch"])
        # Repli demandé : TikTok ne propose pas cette visibilité (app pas encore auditée) -> brouillon.
        direct = False
        t.notice = DRAFT_FALLBACK_NOTICE
    if not await tiktok_router.post_limiter.check(tenant.key):
        raise _Fail("daily_limit", "Limite quotidienne de publications TikTok atteinte pour votre espace.")
    path = await _copy_media(post, tiktok_jobs.tmp_dir())
    tp = TikTokPost(
        organization_id=post.organization_id, owner_user_id=post.owner_user_id,
        tiktok_account_id=acc.id, user_id=post.user_id, mode="direct" if direct else "draft",
        title=o.get("title") if direct else None, privacy_level=o.get("privacy_level") if direct else None,
        disable_comment=not o.get("allow_comment") or bool(info.get("comment_disabled")),
        disable_duet=not o.get("allow_duet") or bool(info.get("duet_disabled")),
        disable_stitch=not o.get("allow_stitch") or bool(info.get("stitch_disabled")),
        brand_organic=direct and bool(o.get("brand_organic")), brand_content=direct and bool(o.get("brand_content")),
        cover_timestamp_ms=_cover_in_video(o.get("cover_timestamp_ms"), post.duration_sec) if direct else None,
        is_aigc=direct and bool(o.get("is_aigc")),
        file_name=post.file_name, mime_type=post.mime_type, video_size=post.video_size,
        received_bytes=post.video_size, duration_sec=post.duration_sec, tmp_path=path,
        status=tk_models.POST_QUEUED,
    )
    db.add(tp)
    await db.flush()
    t.tiktok_post_id = tp.id
    t.options = {**o, "username": info.get("creator_username")}
    t.status = T_PUBLISHING
    await db.commit()
    tiktok_jobs.launch(tp.id)


async def _dispatch_youtube(db: AsyncSession, t: CmTarget, post: CmPost) -> None:
    from src.routers import youtube as youtube_router
    if not yt.is_enabled():
        raise _Fail("disabled", "Le module YouTube n'est pas disponible pour le moment.")
    acc = await db.get(YouTubeAccount, t.account_id)
    if acc is None or acc.revoked_at is not None:
        raise _Fail("account_removed", "Cette chaîne YouTube a été déconnectée.")
    if acc.needs_reconnect:
        raise _Fail("reconnect_required", yt.ERROR_MESSAGES["invalid_grant"])
    tenant = _tenant_of_post(post)
    if await _active_count(db, YouTubePost, tenant) >= MAX_ACTIVE_POSTS:
        raise _Later()
    if not await youtube_router.post_limiter.check(tenant.key):
        raise _Fail("daily_limit", f"Limite de {settings.YOUTUBE_DAILY_POSTS} vidéos YouTube par 24 h atteinte pour votre espace : réessayez plus tard.")
    o = t.options or {}
    path = await _copy_media(post, youtube_jobs.tmp_dir())
    yp = YouTubePost(
        organization_id=post.organization_id, owner_user_id=post.owner_user_id,
        youtube_account_id=acc.id, user_id=post.user_id, title=o.get("title") or post.title,
        description=o.get("description") or None, tags=o.get("tags") or None,
        category_id=o.get("category_id") or yt.DEFAULT_CATEGORY, default_language=o.get("default_language"),
        privacy_status=o.get("privacy_status") or "public", publish_at=None,
        made_for_kids=bool(o.get("made_for_kids")), synthetic_media=bool(o.get("synthetic_media")),
        notify_subscribers=bool(o.get("notify_subscribers", True)),
        file_name=post.file_name, mime_type=post.mime_type, video_size=post.video_size,
        received_bytes=post.video_size, duration_sec=post.duration_sec, tmp_path=path,
        status=yt_models.POST_QUEUED,
    )
    db.add(yp)
    await db.flush()
    t.youtube_post_id = yp.id
    t.status = T_PUBLISHING
    await db.commit()
    youtube_jobs.launch(yp.id)


async def _dispatch_instagram(db: AsyncSession, t: CmTarget, post: CmPost) -> None:
    acc = await db.get(InstagramAccount, t.account_id)
    if acc is None or acc.revoked_at is not None:
        raise _Fail("account_removed", "Ce compte Instagram a été déconnecté.")
    if acc.mode != IG_MODE_API:
        t.status = T_AWAITING_ROUTINE
        await db.commit()
        return
    if not ig.is_enabled():
        raise _Fail("disabled", "La connexion Instagram n'est pas disponible pour le moment.")
    if not ig.can_publish(acc):
        raise _Fail("scope_missing", ig.ERROR_MESSAGES["scope_missing"])
    o = t.options or {}
    try:
        token = await ig.valid_token(db, acc)
        # Le conteneur est créé avec le lien signé : Meta télécharge la vidéo.
        t.status = T_PUBLISHING
        await db.commit()
        await cm_library.ensure_cover(db, post)
        cover = cm.cover_url(t) if post.cover_path and os.path.exists(post.cover_path) else None
        container = await ig.create_reel_container(
            token, acc.ig_user_id, cm.media_url(t, post.mime_type), o.get("caption") or "",
            bool(o.get("share_to_feed", True)), o.get("thumb_offset_ms"), cover, o.get("collaborators") or None)
    except ig.ReconnectRequired:
        raise _Fail("reconnect_required", ig.ERROR_MESSAGES["invalid_token"])
    except ig.InstagramError as e:
        if e.code == "invalid_token":
            acc.needs_reconnect = True
        raise _Fail(e.code, e.describe())
    t.ig_container_id = container
    await db.commit()


_DISPATCH = {"tiktok": _dispatch_tiktok, "youtube": _dispatch_youtube, "instagram": _dispatch_instagram}


async def claim(db: AsyncSession, target_id: int) -> bool:
    """Prise en charge atomique d'une cible arrivée à son heure."""
    res = await db.execute(
        update(CmTarget).where(CmTarget.id == target_id, CmTarget.status == T_SCHEDULED,
                               CmTarget.scheduled_at <= utcnow())
        .values(status=T_DISPATCHING, attempts=CmTarget.attempts + 1, updated_at=utcnow())
    )
    await db.commit()
    return res.rowcount == 1


async def dispatch_target(db: AsyncSession, target_id: int) -> None:
    """Envoie une cible arrivée à son heure. Ne lève pas : l'échec est porté par la cible."""
    if not await claim(db, target_id):
        return
    t = await db.get(CmTarget, target_id)
    await db.refresh(t)
    post = await db.get(CmPost, t.post_id)
    try:
        if post is None or post.status != POST_READY:
            raise _Fail("media_missing", "La vidéo n'est plus disponible : recréez la publication.")
        if not post.media_path or not os.path.exists(post.media_path):
            # Vidéo de la bibliothèque : téléchargée depuis le Drive maintenant (une fois par publication).
            try:
                post = await cm_library.ensure_media(db, post.id)
            except cm_library.MediaError as e:
                raise _Fail(e.code, e.message)
            t = await db.get(CmTarget, target_id)
            err = cm.check_video_for(t.platform, None, post.mime_type, post.duration_sec or 0, post.video_size)
            if err:
                raise _Fail("invalid_video", err)
        await _DISPATCH[t.platform](db, t, post)
    except _Later:
        await db.rollback()
        t = await db.get(CmTarget, target_id)
        t.status = T_SCHEDULED
        t.attempts = max(0, (t.attempts or 1) - 1)
        await db.commit()
    except _Fail as e:
        await db.rollback()
        t = await db.get(CmTarget, target_id)
        fail_target(t, e.code, e.message)
        await db.commit()
    except Exception:
        logger.exception("cm : envoi de la cible %s en échec", target_id)
        await db.rollback()
        t = await db.get(CmTarget, target_id)
        fail_target(t, "internal_error", "Erreur interne pendant la préparation de l'envoi. Réessayez.")
        await db.commit()


async def run_dispatch(target_id: int, session_factory: Callable = AsyncSessionLocal) -> None:
    async with session_factory() as db:
        await dispatch_target(db, target_id)


def launch(target_id: int) -> None:
    """« Publier maintenant » (remplacé dans les tests)."""
    spawn_background(run_dispatch(target_id), error_label=f"cm : envoi de la cible {target_id} en échec")


async def dispatch_due(db: AsyncSession) -> None:
    ids = (await db.execute(
        select(CmTarget.id).where(CmTarget.status == T_SCHEDULED, CmTarget.scheduled_at <= utcnow())
        .order_by(CmTarget.scheduled_at).limit(DISPATCH_BATCH)
    )).scalars().all()
    for target_id in ids:
        await dispatch_target(db, target_id)


# --------------------------------------------------------------------------
# Suivi
# --------------------------------------------------------------------------

def _tiktok_url(t: CmTarget, video_id: str) -> Optional[str]:
    user = (t.options or {}).get("username")
    return f"https://www.tiktok.com/@{user}/video/{video_id}" if user else None


async def _record_published(db: AsyncSession, t: CmTarget, post: Optional[CmPost]) -> None:
    t.status = T_PUBLISHED
    t.published_at = t.published_at or utcnow()
    if t.external_id:
        o = t.options or {}
        await cm.upsert_video(db, t.platform, t.account_id, t.external_id, target_id=t.id, url=t.url,
                              title=o.get("title") or o.get("caption") or (post.title if post else None),
                              published_at=t.published_at, duration_sec=post.duration_sec if post else None)


async def follow_target(db: AsyncSession, t: CmTarget) -> None:
    post = await db.get(CmPost, t.post_id)
    now = utcnow()
    if t.platform == "tiktok" and t.tiktok_post_id:
        tp = await db.get(TikTokPost, t.tiktok_post_id)
        if tp is None:
            fail_target(t, "lost", "Publication TikTok introuvable.")
        elif tp.status == tk_models.POST_COMPLETE:
            ids = tp.post_ids or []
            t.external_id = str(ids[0]) if ids else None
            t.url = _tiktok_url(t, t.external_id) if t.external_id else None
            await _record_published(db, t, post)
        elif tp.status == tk_models.POST_INBOX:
            t.status = T_INBOX
            t.notice = "Vidéo envoyée dans la boîte de réception TikTok : terminez la publication dans l'app."
        elif tp.status == tk_models.POST_FAILED and tp.mode == "direct" and (t.options or {}).get("fallback_draft") \
                and tp.fail_reason in DRAFT_FALLBACK_REASONS:
            # Publication directe refusée : nouvel envoi en brouillon (boîte de réception TikTok).
            t.options = {**(t.options or {}), "mode": "draft"}
            t.tiktok_post_id = None
            t.status = T_SCHEDULED
            t.scheduled_at = now
            t.notice = DRAFT_FALLBACK_NOTICE
        elif tp.status == tk_models.POST_FAILED:
            fail_target(t, tp.fail_reason or "failed", tp.error_message or "Publication refusée par TikTok.")
    elif t.platform == "tiktok":
        fail_target(t, "lost", "Publication TikTok introuvable.")
    elif t.platform == "youtube" and t.youtube_post_id:
        yp = await db.get(YouTubePost, t.youtube_post_id)
        if yp is None:
            fail_target(t, "lost", "Publication YouTube introuvable.")
        elif yp.status == yt_models.POST_PUBLISHED:
            t.external_id = yp.video_id
            t.url = f"https://youtube.com/shorts/{yp.video_id}" if yp.video_id else None
            if yp.fail_reason == "locked_private":
                t.notice = yp.error_message
            await _record_published(db, t, post)
        elif yp.status == yt_models.POST_FAILED:
            fail_target(t, yp.fail_reason or "failed", yp.error_message or "Vidéo refusée par YouTube.")
    elif t.platform == "youtube":
        fail_target(t, "lost", "Publication YouTube introuvable.")
    elif t.platform == "instagram":
        await _follow_instagram(db, t, post, now)
    await db.commit()


async def _already_online(token: str, acc, t: CmTarget) -> bool:
    """Instagram a répondu par une erreur mais le Reel est peut-être en ligne quand même (cas
    connu) : on le cherche parmi les dernières publications (même légende, publiée depuis l'envoi)."""
    caption = ((t.options or {}).get("caption") or "").strip()
    since = (t.updated_at or utcnow()) - timedelta(minutes=30)
    try:
        items = await ig.recent_media(token, acc.ig_user_id, limit=10)
    except ig.InstagramError:
        return False
    for m in items:
        when = cm._parse_time(m.get("timestamp"))
        if (m.get("caption") or "").strip() == caption and when and when >= since \
                and (m.get("media_product_type") in (None, "REELS") or m.get("media_type") == "VIDEO"):
            t.external_id = m.get("id")
            t.url = m.get("permalink")
            return True
    return False


async def _follow_instagram(db: AsyncSession, t: CmTarget, post: Optional[CmPost], now) -> None:
    if not t.ig_container_id:
        if now - t.updated_at > DISPATCHING_TIMEOUT:
            fail_target(t, "container_missing", "L'envoi à Instagram a été interrompu. Réessayez.")
        return
    acc = await db.get(InstagramAccount, t.account_id)
    if acc is None or acc.revoked_at is not None:
        fail_target(t, "account_removed", "Ce compte Instagram a été déconnecté.")
        return
    try:
        token = await ig.valid_token(db, acc)
        st = await ig.container_status(token, t.ig_container_id)
        code = st.get("status_code")
        if code == "FINISHED":
            media_id = await ig.publish_container(token, acc.ig_user_id, t.ig_container_id)
            t.external_id = media_id
            try:
                t.url = (await ig.media_info(token, media_id)).get("permalink")
            except ig.InstagramError:
                pass
            await _record_published(db, t, post)
        elif code == "PUBLISHED":
            await _record_published(db, t, post)
        elif code == "ERROR":
            if await _already_online(token, acc, t):
                await _record_published(db, t, post)
                return
            fail_target(t, "container_error", ig.ERROR_MESSAGES["container_error"]
                        + (f" ({st.get('status')})" if st.get("status") else ""))
        elif code == "EXPIRED":
            fail_target(t, "container_expired", ig.ERROR_MESSAGES["container_expired"])
        elif now - t.updated_at > CONTAINER_TIMEOUT:
            fail_target(t, "container_timeout", ig.ERROR_MESSAGES["container_timeout"])
    except ig.ReconnectRequired:
        fail_target(t, "reconnect_required", ig.ERROR_MESSAGES["invalid_token"])
    except ig.InstagramError as e:
        if e.code == "invalid_token":
            acc.needs_reconnect = True
            fail_target(t, e.code, e.describe())
        elif e.code in ("publish_limit",):
            if await _already_online(token, acc, t):
                await _record_published(db, t, post)
                return
            fail_target(t, e.code, e.describe())
        else:
            if await _already_online(token, acc, t):
                await _record_published(db, t, post)
                return
            logger.info("cm : suivi Instagram de la cible %s en attente (%s)", t.id, e.code)


async def follow_pending(db: AsyncSession) -> None:
    now = utcnow()
    targets = (await db.execute(
        select(CmTarget).where(CmTarget.status.in_((T_PUBLISHING, T_DISPATCHING, T_ROUTINE_CLAIMED)))
    )).scalars().all()
    for t in targets:
        if t.status == T_DISPATCHING:
            # Envoi interrompu (redémarrage) : on retente, puis on abandonne.
            if now - t.updated_at > DISPATCHING_TIMEOUT:
                if (t.attempts or 0) >= MAX_ATTEMPTS:
                    fail_target(t, "dispatch_interrupted", "L'envoi a été interrompu plusieurs fois. Réessayez.")
                else:
                    t.status = T_SCHEDULED
                await db.commit()
            continue
        if t.status == T_ROUTINE_CLAIMED:
            if t.claimed_at and now - t.claimed_at > ROUTINE_CLAIM_TIMEOUT:
                if (t.attempts or 0) >= MAX_ATTEMPTS:
                    fail_target(t, "routine_timeout", "La routine n'a pas confirmé la publication.")
                else:
                    t.status, t.claimed_at = T_AWAITING_ROUTINE, None
                    t.attempts = (t.attempts or 0) + 1
                await db.commit()
            continue
        try:
            await follow_target(db, t)
        except Exception:
            logger.exception("cm : suivi de la cible %s en échec", t.id)
            await db.rollback()


# --------------------------------------------------------------------------
# Statistiques, jetons, nettoyage
# --------------------------------------------------------------------------

async def sync_due(db: AsyncSession) -> None:
    every = timedelta(hours=max(1, settings.CM_STATS_EVERY_HOURS))
    now = utcnow()
    done = 0
    for platform, model in cm.MODELS.items():
        ids = (await db.execute(
            select(model.id).where(model.revoked_at.is_(None), model.needs_reconnect.is_(False))
        )).scalars().all()
        for acc_id in ids:
            if done >= SYNC_BATCH:
                return
            # Relu un par un : le relevé en échec d'un compte fait un rollback, qui expire les autres.
            acc = await db.get(model, acc_id)
            if acc is None or acc.revoked_at is not None or acc.needs_reconnect:
                continue
            if platform == "instagram" and acc.mode != IG_MODE_API:
                continue
            if platform == "tiktok" and not cm.stats_available("tiktok", acc):
                continue
            last = (await db.execute(
                select(func.max(CmAccountStat.updated_at)).where(
                    CmAccountStat.platform == platform, CmAccountStat.account_id == acc.id)
            )).scalar()
            if last is not None and now - last < every:
                continue
            await cm.sync_account(db, platform, acc)
            done += 1


async def refresh_instagram_tokens(db: AsyncSession) -> None:
    accounts = (await db.execute(
        select(InstagramAccount).where(InstagramAccount.mode == IG_MODE_API,
                                       InstagramAccount.revoked_at.is_(None),
                                       InstagramAccount.needs_reconnect.is_(False))
    )).scalars().all()
    for acc in accounts:
        await ig.refresh_if_due(db, acc)


async def cleanup(db: AsyncSession) -> None:
    now = utcnow()
    # Envoi de vidéo abandonné.
    stale = (await db.execute(
        select(CmPost).where(CmPost.status == POST_RECEIVING, CmPost.updated_at < now - RECEIVING_TIMEOUT)
    )).scalars().all()
    for post in stale:
        post.status = POST_CANCELLED
        cm.remove_media(post)
        await db.execute(update(CmTarget).where(CmTarget.post_id == post.id).values(status=T_CANCELLED))
    await db.commit()

    # Vidéos dont toutes les publications sont terminées.
    posts = (await db.execute(
        select(CmPost).where(CmPost.media_path.is_not(None), CmPost.status.in_((POST_READY, POST_CANCELLED)))
        .with_for_update(skip_locked=True)   # un ajout de cible en cours (POST /posts/{id}/targets) garde la vidéo
    )).scalars().all()
    for post in posts:
        targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
        if any(t.status not in T_FINAL for t in targets):
            continue
        failed = [t for t in targets if t.status == T_FAILED]
        last = max([t.updated_at for t in targets] + [post.updated_at])
        if failed and now - last < FAILED_MEDIA_GRACE:
            continue
        if cm_archive.keep_media(post):       # pas encore archivée dans le Drive
            continue
        cm.remove_media(post)
    await db.commit()

    # Fichiers orphelins.
    # Vidéos ET couvertures encore rattachées à une publication : une couverture envoyée la veille au soir
    # (routines) doit survivre jusqu'à l'heure de publication, sinon Instagram prend une image de la vidéo.
    live = {p for p in (await db.execute(select(CmPost.media_path).where(CmPost.media_path.is_not(None)))).scalars()}
    live |= {p for p in (await db.execute(select(CmPost.cover_path).where(CmPost.cover_path.is_not(None)))).scalars()}
    for f in cm.media_dir().iterdir():
        if str(f) not in live and time.time() - f.stat().st_mtime > 3600:
            f.unlink(missing_ok=True)

    # Données des comptes déconnectés (règles des API : suppression des données).
    for platform, model in cm.MODELS.items():
        gone = select(model.id).where(model.revoked_at.is_not(None))
        await db.execute(delete(CmVideo).where(CmVideo.platform == platform, CmVideo.account_id.in_(gone)))
        await db.execute(delete(CmComment).where(CmComment.platform == platform, CmComment.account_id.in_(gone)))
        await db.execute(delete(CmAccountStat).where(CmAccountStat.platform == platform,
                                                     CmAccountStat.account_id.in_(gone)))
        alive = select(model.id)
        await db.execute(delete(CmVideo).where(CmVideo.platform == platform, CmVideo.account_id.not_in(alive)))
        await db.execute(delete(CmComment).where(CmComment.platform == platform, CmComment.account_id.not_in(alive)))
        await db.execute(delete(CmAccountStat).where(CmAccountStat.platform == platform,
                                                     CmAccountStat.account_id.not_in(alive)))
    # Commentaires relevés il y a plus de 12 mois (pages de confidentialité).
    await db.execute(delete(CmComment).where(CmComment.created_at < now - timedelta(days=365)))
    # Historique ancien.
    await db.execute(delete(CmPost).where(CmPost.created_at < now - HISTORY_RETENTION,
                                          CmPost.media_path.is_(None)))
    # Assistant Chapote CM : conversations « mes données » au-delà de la durée de conservation.
    from src.services import cm_assistant
    await cm_assistant.purge_expired(db)
    await db.commit()


async def tick(db: AsyncSession) -> None:
    for step in (dispatch_due, follow_pending, refresh_instagram_tokens, sync_due, cleanup,
                 cm_library.detect_shared, cm_library.scan_due, cm_library.organize_published, cm_inbox.sync_due,
                 cm_archive.launch_due):
        try:
            await step(db)
        except Exception:
            logger.exception("cm : tâche planifiée %s en échec", step.__name__)
            await db.rollback()


async def scheduler_loop() -> None:
    while True:
        try:
            if await _tick_lock.claim(str(int(time.time() // TICK_SECONDS))):
                async with AsyncSessionLocal() as db:
                    await tick(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cm : boucle planifiée en échec")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task is None:
        _scheduler_task = asyncio.create_task(scheduler_loop())


async def stop_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        _scheduler_task = None


