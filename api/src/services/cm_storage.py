"""cm.chapote.fr : stockage des vidéos dans le Google Drive de l'espace (obligatoire pour publier).

Même connexion que l'archivage (CmDriveLink, droit drive.file : cm ne voit et ne supprime que ce qu'il a créé).
- État par espace : connecté ou non, Go réservés à Chapote (`quota_gb`, null = tout l'espace libre du Drive),
  octets rangés par cm (somme des fichiers archivés des publications), espace libre du Drive (storageQuota,
  relu au plus toutes les 10 min), conservation (`keep` | `delete_after_publish` | `delete_after_days`).
- `state` : missing (pas de Drive) | full (quota ou Drive plein) | almost_full (≥ 90 %) | ok.
- Création d'une publication : 409 storage_required sans Drive, 409 storage_full si la vidéo ne tient pas.
- Conservation : une fois toutes les cibles terminées (au moins une publiée), la vidéo, la couverture et la légende
  rangées par cm vont à la corbeille du Drive (tout de suite ou après N jours) ; infos.json reste.
- Alertes : passage à 90 % / 100 % noté sur le lien (une fois par passage), envoyé en push par cm_push.
"""
import logging
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import T_FINAL, T_INBOX, T_PUBLISHED, CmDriveLink, CmPost, CmTarget
from src.services import cm_archive
from src.services import gdrive_service as gd

logger = logging.getLogger(__name__)

GB = 1024 ** 3
DRIVE_TTL = timedelta(minutes=10)
ALMOST = 0.9
RETENTIONS = ("keep", "delete_after_publish", "delete_after_days")


def _tenant_cond(model, org_id, owner_id):
    return cm_archive._tenant_cond(model, org_id, owner_id)


async def used_bytes(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int]) -> int:
    """Octets rangés par cm dans le Drive de l'espace (fichiers pas encore supprimés)."""
    archived = func.coalesce(CmPost.archive["bytes"].as_integer(),
                             case((CmPost.archive["video_id"].as_string().is_not(None), CmPost.video_size), else_=0))
    return int((await db.execute(select(func.coalesce(func.sum(archived), 0)).where(
        _tenant_cond(CmPost, org_id, owner_id), CmPost.archive.is_not(None)))).scalar() or 0)


async def refresh_drive(db: AsyncSession, link: CmDriveLink, force: bool = False) -> None:
    """storageQuota du Drive relu (au plus toutes les 10 min) ; une erreur Google garde la dernière valeur."""
    if not force and link.drive_checked_at and utcnow() - link.drive_checked_at < DRIVE_TTL:
        return
    try:
        link.drive_limit, link.drive_usage = await gd.storage_quota(await cm_archive.user_token(link))
        link.drive_checked_at = utcnow()
        await db.commit()
    except (cm_archive.ArchiveError, gd.DriveError, Exception) as e:     # noqa: BLE001 — jamais bloquant
        logger.info("cm : espace du Drive illisible (%s)", type(e).__name__)
        await db.rollback()


def _free(link: CmDriveLink) -> Optional[int]:
    return None if link.drive_limit is None else max(0, link.drive_limit - (link.drive_usage or 0))


def compute(link: Optional[CmDriveLink], used: int) -> dict:
    if link is None:
        return {"connected": False, "email": None, "folder_url": None, "quota_gb": None, "used_bytes": used, "drive_free_bytes": None,
                "retention": None, "delete_after_days": None, "state": "missing", "max_quota_gb": None}
    free = _free(link)
    quota = link.quota_gb * GB if link.quota_gb else None
    full = (quota is not None and used >= quota) or (free is not None and free <= 0)
    almost = (quota is not None and used >= ALMOST * quota) or \
        (link.drive_limit is not None and (link.drive_usage or 0) >= ALMOST * link.drive_limit)
    folder = f"https://drive.google.com/drive/folders/{link.root_folder_id}" if link.root_folder_id else None
    return {"connected": True, "email": link.email, "folder_url": folder, "quota_gb": link.quota_gb, "used_bytes": used,
            "drive_free_bytes": free, "retention": link.retention, "delete_after_days": link.delete_after_days,
            "state": "full" if full else "almost_full" if almost else "ok",
            "max_quota_gb": None if free is None else (used + free) // GB}


async def status_of(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], refresh: bool = False) -> dict:
    link = await cm_archive.active_link(db, org_id, owner_id)
    if link is not None and refresh:
        await refresh_drive(db, link)
    return compute(link, await used_bytes(db, org_id, owner_id))


def _human(n: Optional[int]) -> str:
    if n is None:
        return "?"
    return f"{n / GB:.1f} Go".replace(".", ",") if n >= GB / 10 else f"{max(1, n // (1024 * 1024))} Mo"


async def check_create(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], needed: int) -> None:
    """Avant de créer une publication : Drive connecté, et la vidéo tient dans le quota et l'espace libre."""
    if not settings.CM_STORAGE_REQUIRED:
        return
    link = await cm_archive.active_link(db, org_id, owner_id)
    if link is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "storage_required", "message":
                            "Connectez d'abord un Google Drive à cet espace (Bibliothèque → Stockage) : vos vidéos y sont "
                            "rangées. Sans Drive, impossible de créer une publication."})
    if needed <= 0:
        return
    await refresh_drive(db, link)
    used = await used_bytes(db, org_id, owner_id)
    free = _free(link)
    room = None
    if link.quota_gb:
        room = link.quota_gb * GB - used
    if free is not None:
        room = free if room is None else min(room, free)
    if room is not None and needed > room:
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "storage_full", "needed_bytes": needed, "free_bytes": max(0, room),
            "message": f"Stockage plein : cette vidéo fait {_human(needed)}, il reste {_human(max(0, room))}. "
                       "Libérez de la place dans votre Drive, augmentez le quota réservé à Chapote ou choisissez de "
                       "supprimer les vidéos après publication (Bibliothèque → Stockage)."})


async def update_settings(db: AsyncSession, link: CmDriveLink, quota_gb: Optional[int], retention: str,
                          delete_after_days: Optional[int]) -> None:
    if retention not in RETENTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Conservation inconnue.")
    if retention == "delete_after_days" and not (delete_after_days and 1 <= delete_after_days <= 365):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indiquez un nombre de jours entre 1 et 365.")
    if quota_gb is not None:
        if quota_gb < 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Quota : 1 Go au moins (ou vide = tout l'espace libre).")
        await refresh_drive(db, link, force=True)
        free = _free(link)
        if free is not None:
            most = (await used_bytes(db, link.organization_id, link.owner_user_id) + free) // GB
            if quota_gb > most:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Votre Drive n'a que {most} Go disponibles pour Chapote.")
    link.quota_gb, link.retention = quota_gb, retention
    link.delete_after_days = delete_after_days if retention == "delete_after_days" else None
    await db.commit()


async def purge_due(db: AsyncSession, batch: int = 10) -> None:
    """Conservation : fichiers des publications terminées mis à la corbeille du Drive (selon le réglage de l'espace)."""
    links = (await db.execute(select(CmDriveLink).where(CmDriveLink.revoked_at.is_(None),
                                                        CmDriveLink.retention != "keep"))).scalars().all()
    now = utcnow()
    for link in links:
        posts = (await db.execute(select(CmPost).where(
            _tenant_cond(CmPost, link.organization_id, link.owner_user_id), CmPost.archive_state == "ok",
            CmPost.archive.is_not(None)).order_by(CmPost.id))).scalars().all()
        done = 0
        for post in posts:
            a = dict(post.archive or {})
            if a.get("purged_at") or not any(a.get(k) and a.get(k.replace("_id", "_ours"))
                                             for k in ("video_id", "cover_id", "caption_id")):
                continue
            targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
            if any(t.status not in T_FINAL for t in targets):
                continue
            published = [t.published_at or t.updated_at for t in targets if t.status in (T_PUBLISHED, T_INBOX)]
            if not published:
                continue
            if link.retention == "delete_after_days" and max(published) + timedelta(days=link.delete_after_days or 0) > now:
                continue
            await _purge(db, link, post, a)
            done += 1
            if done >= batch:
                break


async def _purge(db: AsyncSession, link: CmDriveLink, post: CmPost, a: dict) -> None:
    try:
        token = await gd.access_token() if a.get("via") == "robot" else await cm_archive.user_token(link)
        for key in ("video_id", "cover_id", "caption_id"):
            if a.get(key) and a.get(key.replace("_id", "_ours")):     # jamais un fichier rangé par quelqu'un d'autre
                try:
                    await gd.trash(token, a[key])
                except gd.DriveError as e:
                    if e.code != "not_shared":          # déjà supprimé à la main : on continue
                        raise
                a.pop(key)
                a.pop(key.replace("_id", "_ours"), None)
        a.pop("caption_sha", None)
        a["bytes"], a["purged_at"] = 0, cm_archive.iso_now()
        post.archive = a
        await db.commit()
    except Exception as e:                          # noqa: BLE001 — réessayé au passage suivant
        await db.rollback()
        logger.info("cm : suppression des fichiers de la publication %s en échec (%s)", post.id, type(e).__name__)


async def alerts(db: AsyncSession) -> None:
    """Seuils 90 % / 100 % : noté une fois par passage (storage_alert), envoyé par cm_push."""
    for link in (await db.execute(select(CmDriveLink).where(CmDriveLink.revoked_at.is_(None)))).scalars().all():
        await refresh_drive(db, link)
        state = compute(link, await used_bytes(db, link.organization_id, link.owner_user_id))["state"]
        if state in ("almost_full", "full"):
            if link.storage_alert != state:
                link.storage_alert, link.storage_alert_at = state, utcnow()
                link.storage_alert_seq = (link.storage_alert_seq or 0) + 1
        elif link.storage_alert is not None:
            link.storage_alert = None
        await db.commit()
