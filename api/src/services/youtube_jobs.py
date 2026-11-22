"""Tâches de fond du module YouTube : envoi des vidéos, suivi du traitement,
vérification quotidienne des chaînes, nettoyage des fichiers temporaires.

- `launch(post_id)` : après validation serveur, ouvre la session d'envoi
  « resumable », envoie le fichier, supprime le fichier (succès comme échec),
  puis suit le traitement YouTube quelques minutes.
- `scheduler_loop()` : 1 tick / min, un seul worker par tick (jeton Redis) :
  suivi des vidéos en traitement, vérification quotidienne des chaînes
  (refresh + nom/avatar à jour ; invalid_grant => « à reconnecter »), abandon
  des envois bloqués, purge des fichiers orphelins et de l'historique ancien.

Aucun jeton ni URL de session d'envoi n'est jamais loggé ni stocké.
"""
import asyncio
import logging
import os
import time
from datetime import timedelta
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.time import utcnow
from src.models.youtube import (
    POST_ACTIVE,
    POST_FAILED,
    POST_PROCESSING,
    POST_PUBLISHED,
    POST_QUEUED,
    POST_RECEIVING,
    POST_UPLOADING,
    YouTubeAccount,
    YouTubePost,
)
from src.services import youtube_service as yt
from src.services.background import spawn_background
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
FOLLOW_INTERVAL = 10
FOLLOW_DURATION = 180
# Vidéo introuvable juste après l'envoi : délai de propagation toléré.
NOT_FOUND_GRACE = timedelta(minutes=15)
PROCESSING_TIMEOUT = timedelta(hours=24)
RECEIVING_TIMEOUT = timedelta(hours=2)
UPLOADING_TIMEOUT = timedelta(hours=3)
ACCOUNT_CHECK_EVERY = timedelta(hours=24)
# Règles des API YouTube : données d'une chaîne dont l'accès est retiré
# supprimées sous 7 jours. Une chaîne « à reconnecter » depuis 7 jours est
# déconnectée (jetons effacés).
RECONNECT_GRACE = timedelta(days=7)
HISTORY_RETENTION = timedelta(days=365)

_tick_lock = SingleUseTokens("rl:youtubesched:", TICK_SECONDS - 5)
_scheduler_task: Optional[asyncio.Task] = None


def tmp_dir() -> Path:
    p = Path(settings.YOUTUBE_TMP_DIR)
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    return p


def remove_tmp(post: YouTubePost) -> None:
    if post.tmp_path:
        try:
            os.unlink(post.tmp_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("YouTube : suppression du fichier temporaire du post %s impossible (%s)", post.id, e)
        post.tmp_path = None


def _fail(post: YouTubePost, code: str, message: str) -> None:
    post.status = POST_FAILED
    post.fail_reason = code
    post.error_message = message
    remove_tmp(post)


# --------------------------------------------------------------------------
# Envoi d'une publication
# --------------------------------------------------------------------------

async def process_post(db: AsyncSession, post: YouTubePost) -> None:
    """Session d'envoi + morceaux depuis le fichier temporaire. Le fichier est
    supprimé dans tous les cas. Ne lève pas : l'échec est porté par le post."""
    if post.status != POST_QUEUED:
        return
    acc = await db.get(YouTubeAccount, post.youtube_account_id)
    try:
        if acc is None:
            raise yt.ReconnectRequired("chaîne supprimée")
        post.status = POST_UPLOADING
        await db.commit()
        token = await yt.valid_access_token(db, acc)
        session_url = await yt.start_upload(token, yt.video_resource(post), post.video_size,
                                            post.mime_type, post.notify_subscribers)
        video = await yt.upload_file(session_url, post.tmp_path, post.video_size, post.mime_type)
        if not video.get("id"):
            raise yt.YouTubeError("invalid_response", "Identifiant de vidéo absent")
        post.video_id = video["id"]
        st = video.get("status") or {}
        post.upload_status = st.get("uploadStatus")
        post.final_privacy = st.get("privacyStatus")
        post.status = POST_PROCESSING
        post.error_message = None
        remove_tmp(post)
        await db.commit()
    except yt.ReconnectRequired:
        _fail(post, "reconnect_required", yt.ERROR_MESSAGES["invalid_grant"])
        await db.commit()
    except yt.YouTubeError as e:
        logger.warning("YouTube : envoi du post %s refusé (%s, HTTP %s)", post.id, e.code, e.http_status)
        _fail(post, e.code, e.describe())
        await db.commit()
    except Exception:
        logger.exception("YouTube : envoi du post %s en échec", post.id)
        _fail(post, "internal_error", "Erreur interne pendant l'envoi de la vidéo à YouTube. Réessayez.")
        await db.commit()
    finally:
        if post.tmp_path:
            remove_tmp(post)
            await db.commit()


def apply_video_status(post: YouTubePost, item: Optional[dict]) -> None:
    """Met à jour le post d'après la ressource vidéo relue chez YouTube."""
    now = utcnow()
    if item is None:
        if now - post.created_at > NOT_FOUND_GRACE:
            _fail(post, "deleted", yt.ERROR_MESSAGES["deleted"])
        return
    st = item.get("status") or {}
    upload = st.get("uploadStatus")
    post.upload_status = upload
    post.final_privacy = st.get("privacyStatus") or post.final_privacy
    if upload == "processed":
        post.status = POST_PUBLISHED
        # Projet non audité : YouTube force « private ».
        if post.privacy_status != "private" and not post.publish_at and post.final_privacy == "private":
            post.fail_reason = "locked_private"
            post.error_message = yt.ERROR_MESSAGES["locked_private"]
    elif upload == "failed":
        reason = st.get("failureReason") or "failed"
        _fail(post, reason, yt.ERROR_MESSAGES.get(reason, f"Traitement refusé par YouTube ({reason})."))
    elif upload == "rejected":
        reason = st.get("rejectionReason") or "rejected"
        _fail(post, reason, yt.ERROR_MESSAGES.get(reason, f"Vidéo refusée par YouTube ({reason})."))
    elif upload == "deleted":
        _fail(post, "deleted", yt.ERROR_MESSAGES["deleted"])


async def poll_post(db: AsyncSession, post: YouTubePost) -> None:
    if not post.video_id or post.status != POST_PROCESSING:
        return
    acc = await db.get(YouTubeAccount, post.youtube_account_id)
    if acc is None:
        return
    post.updated_at = utcnow()
    try:
        token = await yt.valid_access_token(db, acc)
        item = await yt.video_status(token, post.video_id)
    except yt.ReconnectRequired:
        await db.commit()
        return
    except yt.YouTubeError as e:
        logger.info("YouTube : statut du post %s illisible (%s)", post.id, e.code)
        await db.commit()
        return
    apply_video_status(post, item)
    await db.commit()


async def run_post(post_id: int, session_factory: Callable = AsyncSessionLocal) -> None:
    async with session_factory() as db:
        post = await db.get(YouTubePost, post_id)
        if post is None:
            return
        await process_post(db, post)
        started = time.monotonic()
        while post.status == POST_PROCESSING and time.monotonic() - started < FOLLOW_DURATION:
            await asyncio.sleep(FOLLOW_INTERVAL)
            await db.refresh(post)
            await poll_post(db, post)


def launch(post_id: int) -> None:
    """Point d'entrée du routeur (remplacé dans les tests)."""
    spawn_background(run_post(post_id), error_label=f"YouTube : publication {post_id} en échec")


# --------------------------------------------------------------------------
# Tâches planifiées
# --------------------------------------------------------------------------

async def check_accounts(db: AsyncSession) -> None:
    """Une fois par jour et par chaîne : refresh forcé (détecte une
    autorisation retirée) et nom / avatar à jour."""
    accounts = (await db.execute(
        select(YouTubeAccount).where(
            YouTubeAccount.revoked_at.is_(None),
            YouTubeAccount.needs_reconnect.is_(False),
            YouTubeAccount.updated_at < utcnow() - ACCOUNT_CHECK_EVERY,
        )
    )).scalars().all()
    for acc in accounts:
        try:
            token = await yt.valid_access_token(db, acc, force_refresh=True)
            ch = await yt.my_channel(token)
            acc.title = ch["title"] or acc.title
            acc.handle = ch["handle"] or acc.handle
            acc.thumbnail_url = ch["thumbnail_url"] or acc.thumbnail_url
            acc.updated_at = utcnow()
            await db.commit()
        except yt.ReconnectRequired:
            continue
        except yt.YouTubeError as e:
            logger.warning("YouTube : vérification de la chaîne %s en échec (%s)", acc.id, e.code)


async def poll_pending(db: AsyncSession) -> None:
    now = utcnow()
    posts = (await db.execute(select(YouTubePost).where(YouTubePost.status == POST_PROCESSING))).scalars().all()
    for post in posts:
        if now - post.created_at > PROCESSING_TIMEOUT:
            _fail(post, "timeout", "YouTube n'a pas terminé le traitement de la vidéo dans les 24 h.")
            await db.commit()
            continue
        await poll_post(db, post)


async def cleanup_stale(db: AsyncSession) -> None:
    now = utcnow()
    posts = (await db.execute(select(YouTubePost).where(YouTubePost.status.in_(POST_ACTIVE)))).scalars().all()
    for post in posts:
        if post.status == POST_RECEIVING and now - post.updated_at > RECEIVING_TIMEOUT:
            _fail(post, "upload_abandoned", "Envoi de la vidéo vers Chapote interrompu.")
        elif post.status in (POST_QUEUED, POST_UPLOADING) and now - post.updated_at > UPLOADING_TIMEOUT:
            _fail(post, "upload_interrupted", "Envoi de la vidéo vers YouTube interrompu. Relancez la publication.")
    await db.commit()
    stale = (await db.execute(select(YouTubeAccount).where(
        YouTubeAccount.revoked_at.is_(None), YouTubeAccount.needs_reconnect.is_(True),
        YouTubeAccount.updated_at < now - RECONNECT_GRACE,
    ))).scalars().all()
    for acc in stale:
        yt.clear_tokens(acc)
        acc.revoked_at = now
        acc.needs_reconnect = False
    await db.commit()

    live = {p.tmp_path for p in (await db.execute(
        select(YouTubePost).where(YouTubePost.tmp_path.is_not(None))
    )).scalars().all()}
    for f in tmp_dir().iterdir():
        if str(f) not in live and time.time() - f.stat().st_mtime > 3600:
            f.unlink(missing_ok=True)


async def purge_history(db: AsyncSession) -> None:
    await db.execute(delete(YouTubePost).where(YouTubePost.created_at < utcnow() - HISTORY_RETENTION))
    used = select(YouTubePost.youtube_account_id)
    await db.execute(delete(YouTubeAccount).where(
        YouTubeAccount.revoked_at.is_not(None), YouTubeAccount.id.not_in(used)))
    await db.commit()


async def tick(db: AsyncSession) -> None:
    for step in (poll_pending, check_accounts, cleanup_stale, purge_history):
        try:
            await step(db)
        except Exception:
            logger.exception("YouTube : tâche planifiée %s en échec", step.__name__)
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
            logger.exception("YouTube : boucle planifiée en échec")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _scheduler_task
    if yt.is_enabled() and _scheduler_task is None:
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
