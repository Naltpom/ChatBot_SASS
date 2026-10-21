"""Tâches de fond du module TikTok : envoi des vidéos, suivi des statuts,
rafraîchissement des jetons, nettoyage des fichiers temporaires.

- `launch(post_id)` : après le clic « Publier » et la validation serveur, envoie
  la vidéo à TikTok (init Direct Post ou brouillon, puis PUT séquentiel des
  chunks depuis le fichier temporaire), supprime le fichier (succès comme
  échec), puis suit le statut quelques minutes.
- `scheduler_loop()` : boucle planifiée (1 tick / min, un seul worker par tick
  via un jeton Redis à usage unique) : refresh des jetons proches de
  l'expiration (compte marqué « à reconnecter » si le refresh échoue), suivi
  des publications en cours, abandon des envois bloqués, purge des fichiers
  orphelins et de l'historique ancien.

Aucun jeton ni upload_url n'est jamais loggé.
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
from src.models.tiktok import (
    POST_ACTIVE,
    POST_COMPLETE,
    POST_FAILED,
    POST_INBOX,
    POST_PROCESSING,
    POST_QUEUED,
    POST_RECEIVING,
    POST_UPLOADING,
    TikTokAccount,
    TikTokPost,
)
from src.services import tiktok_service as tt
from src.services.background import spawn_background
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
# Refresh planifié des access tokens (24 h) qui expirent dans moins de 2 h.
REFRESH_AHEAD = timedelta(hours=2)
# Suivi juste après l'envoi : toutes les 5 s pendant 2 min, puis le scheduler
# prend le relais (status/fetch : 30 requêtes / min / jeton).
FOLLOW_INTERVAL = 5
FOLLOW_DURATION = 120
# Brouillons dans la boîte de réception : statut relu toutes les 10 min, 7 jours.
INBOX_POLL_EVERY = timedelta(minutes=10)
INBOX_FOLLOW_FOR = timedelta(days=7)
# Traitement TikTok sans issue au bout de 24 h -> échec.
PROCESSING_TIMEOUT = timedelta(hours=24)
# Envoi vers Chapote abandonné / envoi TikTok interrompu (redémarrage).
RECEIVING_TIMEOUT = timedelta(hours=2)
UPLOADING_TIMEOUT = timedelta(hours=2)   # upload_url TikTok valable 1 h
# Conservation de l'historique des publications.
HISTORY_RETENTION = timedelta(days=365)

_tick_lock = SingleUseTokens("rl:tiktoksched:", TICK_SECONDS - 5)
_scheduler_task: Optional[asyncio.Task] = None


# --------------------------------------------------------------------------
# Fichiers temporaires
# --------------------------------------------------------------------------

def tmp_dir() -> Path:
    p = Path(settings.TIKTOK_TMP_DIR)
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    return p


def remove_tmp(post: TikTokPost) -> None:
    if post.tmp_path:
        try:
            os.unlink(post.tmp_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("TikTok : suppression du fichier temporaire du post %s impossible (%s)", post.id, e)
        post.tmp_path = None


def _fail(post: TikTokPost, code: str, message: str) -> None:
    post.status = POST_FAILED
    post.fail_reason = code
    post.error_message = message
    remove_tmp(post)


# --------------------------------------------------------------------------
# Envoi d'une publication
# --------------------------------------------------------------------------

def post_info(post: TikTokPost) -> dict:
    return {
        "title": post.title or "",
        "privacy_level": post.privacy_level,
        "disable_comment": post.disable_comment,
        "disable_duet": post.disable_duet,
        "disable_stitch": post.disable_stitch,
        "brand_content_toggle": post.brand_content,
        "brand_organic_toggle": post.brand_organic,
    }


async def process_post(db: AsyncSession, post: TikTokPost) -> None:
    """Init TikTok + envoi des chunks depuis le fichier temporaire. Le fichier
    est supprimé dans tous les cas. Ne lève pas : l'échec est porté par le post."""
    if post.status != POST_QUEUED:
        return
    acc = await db.get(TikTokAccount, post.tiktok_account_id)
    try:
        if acc is None:
            raise tt.ReconnectRequired("compte supprimé")
        post.status = POST_UPLOADING
        await db.commit()
        token = await tt.valid_access_token(db, acc)
        if post.mode == "direct":
            data = await tt.init_direct_post(token, post_info(post), post.video_size)
        else:
            data = await tt.init_inbox_upload(token, post.video_size)
        post.publish_id = data["publish_id"]
        await db.commit()

        chunk_size, total = tt.chunk_plan(post.video_size)
        with open(post.tmp_path, "rb") as f:
            for i in range(total):
                start, end = tt.chunk_range(i, chunk_size, total, post.video_size)
                f.seek(start)
                content = f.read(end - start + 1)
                await tt.put_chunk(data["upload_url"], content, start, end,
                                   post.video_size, post.mime_type)
        post.status = POST_PROCESSING
        post.error_message = None
        remove_tmp(post)
        await db.commit()
    except tt.ReconnectRequired:
        _fail(post, "reconnect_required", tt.ERROR_MESSAGES["access_token_invalid"])
        await db.commit()
    except tt.TikTokError as e:
        logger.warning("TikTok : envoi du post %s refusé (%s, log_id %s)", post.id, e.code, e.log_id)
        _fail(post, e.code, e.describe())
        await db.commit()
    except Exception:
        logger.exception("TikTok : envoi du post %s en échec", post.id)
        _fail(post, "internal_error", "Erreur interne pendant l'envoi de la vidéo à TikTok. Réessayez.")
        await db.commit()
    finally:
        if post.tmp_path:   # filet : jamais de fichier laissé derrière
            remove_tmp(post)
            await db.commit()


async def poll_post(db: AsyncSession, post: TikTokPost) -> None:
    """Relit le statut TikTok (post/publish/status/fetch) et met à jour le post."""
    if not post.publish_id or post.status not in (POST_PROCESSING, POST_INBOX):
        return
    acc = await db.get(TikTokAccount, post.tiktok_account_id)
    if acc is None:
        return
    post.updated_at = utcnow()
    try:
        token = await tt.valid_access_token(db, acc)
        data = await tt.publish_status(token, post.publish_id)
    except tt.ReconnectRequired:
        await db.commit()
        return
    except tt.TikTokError as e:
        if e.code in ("invalid_publish_id", "token_not_authorized_for_specified_publish_id"):
            _fail(post, e.code, e.describe())
        await db.commit()
        return
    status = data.get("status")
    if status == POST_FAILED:
        reason = data.get("fail_reason") or "failed"
        _fail(post, reason, tt.ERROR_MESSAGES.get(reason, f"Publication refusée par TikTok ({reason})."))
    elif status in (POST_PROCESSING, POST_INBOX, POST_COMPLETE):
        post.status = status
        if data.get("publicaly_available_post_id"):
            post.post_ids = [str(x) for x in data["publicaly_available_post_id"]]
    await db.commit()


async def run_post(post_id: int, session_factory: Callable = AsyncSessionLocal) -> None:
    async with session_factory() as db:
        post = await db.get(TikTokPost, post_id)
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
    spawn_background(run_post(post_id), error_label=f"TikTok : publication {post_id} en échec")


# --------------------------------------------------------------------------
# Tâches planifiées
# --------------------------------------------------------------------------

async def refresh_due_tokens(db: AsyncSession) -> None:
    now = utcnow()
    accounts = (await db.execute(
        select(TikTokAccount).where(
            TikTokAccount.revoked_at.is_(None),
            TikTokAccount.needs_reconnect.is_(False),
            TikTokAccount.access_token_expires_at < now + REFRESH_AHEAD,
        )
    )).scalars().all()
    for acc in accounts:
        try:
            token = await tt.valid_access_token(db, acc, margin=REFRESH_AHEAD)
        except tt.ReconnectRequired:
            continue
        except tt.TikTokError as e:
            logger.warning("TikTok : refresh planifié du compte %s en échec (%s)", acc.id, e.code)
            continue
        try:  # profil à jour (pseudo/avatar) à chaque refresh quotidien
            info = await tt.user_info(token)
            acc.display_name = info.get("display_name") or acc.display_name
            acc.avatar_url = info.get("avatar_url") or acc.avatar_url
            await db.commit()
        except tt.TikTokError:
            pass


async def poll_pending(db: AsyncSession) -> None:
    now = utcnow()
    posts = (await db.execute(
        select(TikTokPost).where(TikTokPost.status.in_((POST_PROCESSING, POST_INBOX)))
    )).scalars().all()
    for post in posts:
        if post.status == POST_PROCESSING and now - post.created_at > PROCESSING_TIMEOUT:
            _fail(post, "timeout", "TikTok n'a pas terminé le traitement de la vidéo dans les 24 h.")
            await db.commit()
            continue
        if post.status == POST_INBOX:
            if now - post.created_at > INBOX_FOLLOW_FOR or now - post.updated_at < INBOX_POLL_EVERY:
                continue
        await poll_post(db, post)


async def cleanup_stale(db: AsyncSession) -> None:
    now = utcnow()
    posts = (await db.execute(
        select(TikTokPost).where(TikTokPost.status.in_(POST_ACTIVE))
    )).scalars().all()
    for post in posts:
        if post.status == POST_RECEIVING and now - post.updated_at > RECEIVING_TIMEOUT:
            _fail(post, "upload_abandoned", "Envoi de la vidéo vers Chapote interrompu.")
        elif post.status in (POST_QUEUED, POST_UPLOADING) and now - post.updated_at > UPLOADING_TIMEOUT:
            _fail(post, "upload_interrupted", "Envoi de la vidéo vers TikTok interrompu. Relancez la publication.")
    await db.commit()

    # Fichiers orphelins (post supprimé, redémarrage…)
    live = {p.tmp_path for p in (await db.execute(
        select(TikTokPost).where(TikTokPost.tmp_path.is_not(None))
    )).scalars().all()}
    for f in tmp_dir().iterdir():
        if str(f) not in live and time.time() - f.stat().st_mtime > 3600:
            f.unlink(missing_ok=True)


async def purge_history(db: AsyncSession) -> None:
    """Historique conservé 12 mois ; comptes déconnectés supprimés quand plus
    aucune publication ne les référence."""
    await db.execute(delete(TikTokPost).where(TikTokPost.created_at < utcnow() - HISTORY_RETENTION))
    used = select(TikTokPost.tiktok_account_id)
    await db.execute(delete(TikTokAccount).where(
        TikTokAccount.revoked_at.is_not(None), TikTokAccount.id.not_in(used)))
    await db.commit()


async def tick(db: AsyncSession) -> None:
    for step in (refresh_due_tokens, poll_pending, cleanup_stale, purge_history):
        try:
            await step(db)
        except Exception:
            logger.exception("TikTok : tâche planifiée %s en échec", step.__name__)
            await db.rollback()


async def scheduler_loop() -> None:
    while True:
        try:
            # Un seul worker exécute chaque tick (jeton Redis à usage unique).
            if await _tick_lock.claim(str(int(time.time() // TICK_SECONDS))):
                async with AsyncSessionLocal() as db:
                    await tick(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("TikTok : boucle planifiée en échec")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _scheduler_task
    if tt.is_enabled() and _scheduler_task is None:
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
