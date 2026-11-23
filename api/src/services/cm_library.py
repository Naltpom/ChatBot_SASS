"""Bibliothèque de cm.chapote.fr : vidéos des dossiers Google Drive partagés avec le robot.

- Relier un dossier : l'utilisateur colle son lien. Le robot doit y avoir accès (partage
  Lecteur ou Éditeur). Un dossier n'est relié qu'à un seul espace. `verified` : la personne
  qui a partagé (ou le propriétaire) est l'utilisateur, ou un membre de son équipe.
- Relecture (toutes les GDRIVE_SCAN_MINUTES) : vidéos du dossier et de ses sous-dossiers ;
  un fichier .txt du même nom que la vidéo (clip.txt pour clip.mp4) donne sa légende, tant
  qu'elle n'a pas été modifiée dans cm. Une vidéo qui disparaît du dossier est marquée retirée.
- Publication : la vidéo est téléchargée depuis le Drive à l'heure de la 1re publication
  (une seule fois pour tous les comptes), puis la copie locale est supprimée quand tout est
  terminé. Avec le rôle Éditeur et l'option activée, la vidéo est rangée dans « Publié ».
"""
import logging
import os
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import (
    POST_READY,
    T_CANCELLED,
    T_EDITABLE,
    T_FINAL,
    T_PUBLISHED,
    CmAsset,
    CmGoogleIdentity,
    CmPost,
    CmSource,
    CmTarget,
)
from src.models.user import Membership, User
from src.services import cm_service as cm
from src.services import gdrive_service as gd
from src.services.video_probe import ProbeError, probe

logger = logging.getLogger(__name__)

VIDEO_MIME_PREFIX = "video/"
SIDECAR_EXT = (".txt",)


def _stem(name: str) -> str:
    return os.path.splitext(name)[0].strip().lower()


def _mask(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return email
    local, domain = email.split("@", 1)
    return f"{local[:2]}{'•' * max(1, len(local) - 2)}@{domain}"


# --------------------------------------------------------------------------
# Sorties
# --------------------------------------------------------------------------

def source_out(s: CmSource, counts: Optional[dict] = None) -> dict:
    c = counts or {}
    return {
        "id": s.id, "provider": s.provider, "folder_id": s.folder_id, "name": s.name,
        "url": f"https://drive.google.com/drive/folders/{s.folder_id}",
        "role": s.role, "can_organize": s.role == "writer", "shared_by": _mask(s.shared_by), "verified": s.verified,
        "group_id": s.group_id, "move_published": s.move_published,
        "last_scan_at": cm.iso(s.last_scan_at), "last_error": s.last_error,
        "videos": c.get("videos", 0), "new": c.get("new", 0), "created_at": cm.iso(s.created_at),
    }


def asset_out(a: CmAsset, source: Optional[CmSource], usage: Optional[dict] = None) -> dict:
    u = usage or {}
    return {
        "id": a.id, "source_id": a.source_id, "source_name": source.name if source else None,
        "group_id": source.group_id if source else None,
        "name": a.name, "title": a.title or os.path.splitext(a.name)[0][:200], "caption": a.caption,
        "caption_from": a.caption_from, "folder": a.folder_path or None, "mime_type": a.mime_type, "size": a.size,
        "duration_sec": a.duration_sec, "width": a.width, "height": a.height,
        "drive_created_at": cm.iso(a.drive_created_at),
        "thumbnail": f"/api/cm/assets/{a.id}/thumbnail" if a.thumbnail_link else None,
        "drive_url": f"https://drive.google.com/file/d/{a.file_id}/view",
        "removed": a.removed_at is not None, "moved_published": a.moved_published_at is not None,
        "scheduled": u.get("scheduled", 0), "published": u.get("published", 0),
        "last_published_at": cm.iso(u.get("last_published_at")),
    }


async def usage_of(db: AsyncSession, asset_ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    if not asset_ids:
        return out
    rows = (await db.execute(
        select(CmPost.asset_id, CmTarget.status, func.count(), func.max(CmTarget.published_at))
        .join(CmTarget, CmTarget.post_id == CmPost.id)
        .where(CmPost.asset_id.in_(asset_ids)).group_by(CmPost.asset_id, CmTarget.status)
    )).all()
    for asset_id, st, n, last in rows:
        u = out.setdefault(asset_id, {"scheduled": 0, "published": 0, "last_published_at": None})
        if st == T_PUBLISHED:
            u["published"] += n
            if last and (u["last_published_at"] is None or last > u["last_published_at"]):
                u["last_published_at"] = last
        elif st not in T_FINAL:
            u["scheduled"] += n
    return out


async def source_counts(db: AsyncSession, source_ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {sid: {"videos": 0, "new": 0} for sid in source_ids}
    if not source_ids:
        return out
    rows = (await db.execute(
        select(CmAsset.source_id, func.count()).where(CmAsset.source_id.in_(source_ids), CmAsset.removed_at.is_(None))
        .group_by(CmAsset.source_id))).all()
    for sid, n in rows:
        out[sid]["videos"] = n
    used = select(CmPost.asset_id).where(CmPost.asset_id.is_not(None))
    rows = (await db.execute(
        select(CmAsset.source_id, func.count()).where(CmAsset.source_id.in_(source_ids), CmAsset.removed_at.is_(None),
                                                      CmAsset.id.not_in(used)).group_by(CmAsset.source_id))).all()
    for sid, n in rows:
        out[sid]["new"] = n
    return out


# --------------------------------------------------------------------------
# Relier un dossier
# --------------------------------------------------------------------------

async def _tenant_emails(db: AsyncSession, tenant, user: User) -> set[str]:
    user_ids = [user.id]
    if tenant.org_id:
        user_ids = list((await db.execute(select(Membership.user_id).where(
            Membership.organization_id == tenant.org_id))).scalars())
    emails = {e.lower() for e in (await db.execute(select(User.email).where(User.id.in_(user_ids)))).scalars() if e}
    emails |= set((await db.execute(select(CmGoogleIdentity.email).where(CmGoogleIdentity.user_id.in_(user_ids)))).scalars())
    return emails | {user.email.lower()}


async def link_source(db: AsyncSession, tenant, user: User, link: str, group_id: Optional[int]) -> CmSource:
    if not gd.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, gd.DriveError("disabled").describe())
    try:
        folder_id = gd.folder_id_from_link(link)
        meta = await gd.get_folder(folder_id)
    except gd.DriveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST if e.code != "rate_limited" else 429, e.describe())
    taken = (await db.execute(select(CmSource).where(CmSource.folder_id == folder_id, CmSource.revoked_at.is_(None))
                              )).scalars().all()
    mine = next((s for s in taken if (tenant.org_id and s.organization_id == tenant.org_id)
                 or (not tenant.org_id and s.owner_user_id == tenant.owner_user_id)), None)
    if mine is not None:
        return mine
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Ce dossier est déjà relié à un autre espace Chapote. Retirez-le de cet espace d'abord.")
    sharer = ((meta.get("sharingUser") or {}).get("emailAddress") or "").lower()
    owners = [(o.get("emailAddress") or "").lower() for o in meta.get("owners") or []]
    known = await _tenant_emails(db, tenant, user)
    verified = bool(({sharer} | set(owners)) & known - {""})
    caps = meta.get("capabilities") or {}
    src = CmSource(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id, created_by_user_id=user.id,
                   provider="gdrive", folder_id=folder_id, name=meta.get("name"), drive_id=meta.get("driveId"),
                   role="writer" if caps.get("canEdit") else "reader", shared_by=sharer or (owners[0] if owners else None),
                   verified=verified, group_id=group_id)
    db.add(src)
    await db.commit()
    return src


# --------------------------------------------------------------------------
# Détection automatique : dossiers partagés avec le robot
# --------------------------------------------------------------------------

async def owner_of_email(db: AsyncSession, email: str):
    """(utilisateur, org_id cible) pour une adresse : adresse Google associée (prouvée par
    Google) en priorité, sinon adresse du compte Chapote. None si inconnue."""
    email = (email or "").strip().lower()
    if not email:
        return None
    ident = (await db.execute(select(CmGoogleIdentity).where(CmGoogleIdentity.email == email))).scalar_one_or_none()
    if ident is not None:
        user = await db.get(User, ident.user_id)
        if user is None or not user.is_active:
            return None
        org_id = ident.organization_id
        if org_id is not None:
            member = (await db.execute(select(Membership.id).where(
                Membership.user_id == user.id, Membership.organization_id == org_id))).first()
            org_id = org_id if member else None
        return user, org_id
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user, None


async def detect_shared(db: AsyncSession, batch: int = 10) -> int:
    """Relie tout seul les dossiers nouvellement partagés avec le robot, à l'espace de la
    personne qui les a partagés (adresse prouvée). Un dossier déjà relié une fois (même retiré
    depuis) n'est jamais relié de nouveau automatiquement. Renvoie le nombre de dossiers reliés."""
    if not gd.is_enabled():
        return 0
    try:
        folders = await gd.shared_folders()
    except gd.DriveError as e:
        logger.info("cm : lecture des dossiers partagés en échec (%s)", e.code)
        return 0
    if not folders:
        return 0
    known = set((await db.execute(select(CmSource.folder_id).where(
        CmSource.folder_id.in_([f["id"] for f in folders])))).scalars())
    linked = 0
    for f in folders:
        if f["id"] in known or linked >= batch:
            continue
        sharer = ((f.get("sharingUser") or {}).get("emailAddress") or "").lower()
        owners = [(o.get("emailAddress") or "").lower() for o in f.get("owners") or []]
        found = None
        for email in [sharer] + owners:
            found = await owner_of_email(db, email)
            if found:
                break
        if not found:
            continue
        user, org_id = found
        caps = f.get("capabilities") or {}
        src = CmSource(organization_id=org_id, owner_user_id=None if org_id else user.id, created_by_user_id=user.id,
                       provider="gdrive", folder_id=f["id"], name=f.get("name"), drive_id=f.get("driveId"),
                       role="writer" if caps.get("canEdit") else "reader", shared_by=sharer or (owners[0] if owners else None),
                       verified=True)
        db.add(src)
        await db.commit()
        known.add(f["id"])
        linked += 1
        logger.info("cm : dossier Drive relié automatiquement (source %s)", src.id)
        await scan_source(db, src)
    return linked


# --------------------------------------------------------------------------
# Relecture d'un dossier
# --------------------------------------------------------------------------

async def scan_source(db: AsyncSession, src: CmSource) -> dict:
    """Relit le dossier. Ne lève pas : l'erreur est notée sur la source."""
    now = utcnow()
    try:
        meta = await gd.get_folder(src.folder_id)
        files = await gd.walk(src.folder_id)
    except gd.DriveError as e:
        src.last_scan_at = now
        src.last_error = e.describe()
        await db.commit()
        logger.info("cm : relecture du dossier %s en échec (%s)", src.id, e.code)
        return {"ok": False, "error": src.last_error}
    src.name = meta.get("name") or src.name
    caps = meta.get("capabilities") or {}
    src.role = "writer" if caps.get("canEdit") else "reader"

    by_folder_stem: dict[tuple[str, str], dict] = {}
    videos: list[tuple[str, dict]] = []
    for path, f in files:
        name = f.get("name") or ""
        if (f.get("mimeType") or "").startswith(VIDEO_MIME_PREFIX):
            videos.append((path, f))
        elif name.lower().endswith(SIDECAR_EXT):
            by_folder_stem[(path, _stem(name))] = f

    existing = {a.file_id: a for a in (await db.execute(select(CmAsset).where(CmAsset.source_id == src.id))).scalars()}
    seen = set()
    added = 0
    for path, f in videos:
        seen.add(f["id"])
        a = existing.get(f["id"])
        if a is None:
            a = CmAsset(source_id=src.id, file_id=f["id"], name=f.get("name") or f["id"])
            db.add(a)
            added += 1
        vm = f.get("videoMediaMetadata") or {}
        a.name = (f.get("name") or a.name)[:500]
        a.mime_type = f.get("mimeType")
        a.size = int(f["size"]) if f.get("size") else a.size
        a.md5 = f.get("md5Checksum") or a.md5
        if vm.get("durationMillis"):
            a.duration_sec = round(int(vm["durationMillis"]) / 1000, 2)
        a.width, a.height = vm.get("width") or a.width, vm.get("height") or a.height
        a.folder_path = path[:500] or None
        a.parent_id = (f.get("parents") or [None])[0]
        a.thumbnail_link = f.get("thumbnailLink") or a.thumbnail_link
        a.drive_created_at = gd.parse_time(f.get("createdTime")) or a.drive_created_at
        a.drive_modified_at = gd.parse_time(f.get("modifiedTime")) or a.drive_modified_at
        a.removed_at = None
        side = by_folder_stem.get((path, _stem(a.name)))
        if side and a.caption_from != "user":
            modified = gd.parse_time(side.get("modifiedTime"))
            if a.sidecar_file_id != side["id"] or a.sidecar_modified_at != modified:
                try:
                    a.caption = (await gd.read_text(side["id"]))[:5000] or None
                    a.caption_from = "txt"
                    a.sidecar_file_id, a.sidecar_modified_at = side["id"], modified
                except gd.DriveError as e:
                    logger.info("cm : légende %s illisible (%s)", side["id"], e.code)
    for file_id, a in existing.items():
        if file_id not in seen and a.removed_at is None:
            a.removed_at = now
    src.last_scan_at = now
    src.last_error = None
    await db.commit()
    return {"ok": True, "videos": len(videos), "added": added}


async def scan_due(db: AsyncSession, batch: int = 10) -> None:
    if not gd.is_enabled():
        return
    every = timedelta(minutes=max(1, settings.GDRIVE_SCAN_MINUTES))
    rows = (await db.execute(select(CmSource).where(CmSource.revoked_at.is_(None)).order_by(CmSource.last_scan_at.nullsfirst())
                             .limit(batch * 3))).scalars().all()
    done = 0
    for src in rows:
        if done >= batch:
            return
        if src.last_scan_at and utcnow() - src.last_scan_at < every:
            continue
        await scan_source(db, src)
        done += 1


# --------------------------------------------------------------------------
# Publication depuis la bibliothèque
# --------------------------------------------------------------------------

class MediaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def ensure_media(db: AsyncSession, post_id: int) -> CmPost:
    """Télécharge la vidéo de la bibliothèque si la publication n'a pas encore son fichier.
    Verrou de ligne : une seule copie pour tous les comptes de la publication."""
    post = (await db.execute(select(CmPost).where(CmPost.id == post_id).with_for_update())).scalar_one()
    if post.media_path and os.path.exists(post.media_path):
        await db.commit()
        return post
    if not post.asset_id:
        await db.commit()
        raise MediaError("media_missing", "La vidéo n'est plus disponible : recréez la publication.")
    asset = await db.get(CmAsset, post.asset_id)
    src = await db.get(CmSource, asset.source_id) if asset else None
    if asset is None or src is None or src.revoked_at is not None:
        await db.commit()
        raise MediaError("source_removed", "Le dossier Drive de cette vidéo a été retiré de Chapote.")
    if asset.removed_at is not None:
        await db.commit()
        raise MediaError("asset_removed", "La vidéo n'est plus dans le dossier Drive.")
    size = asset.size or 0
    try:
        cm.check_space(size)
    except HTTPException as e:
        await db.commit()
        raise MediaError("no_space", str(e.detail))
    path = str(cm.media_dir() / f"{uuid.uuid4().hex}.mp4")
    try:
        got = await gd.download(asset.file_id, path, cm.max_upload_bytes())
        video = probe(path)
    except gd.DriveError as e:
        _unlink(path)
        await db.commit()
        if e.code == "not_shared":
            raise MediaError("drive_access", "Le robot n'a plus accès à cette vidéo : vérifiez le partage du dossier Drive.")
        if e.code == "too_large":
            raise MediaError("too_large", f"Vidéo trop volumineuse ({settings.CM_MAX_UPLOAD_MB} Mo maximum).")
        raise MediaError("drive_error", e.describe())
    except ProbeError as e:
        _unlink(path)
        await db.commit()
        raise MediaError("invalid_video", f"Vidéo refusée : {e}.")
    os.chmod(path, 0o600)
    post.media_path = path
    post.video_size = got
    post.received_bytes = got
    post.mime_type = video.mime_type
    post.duration_sec = round(video.duration_sec, 2)
    await db.commit()
    return post


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


async def organize_published(db: AsyncSession) -> None:
    """Range dans « Publié » les vidéos dont toutes les publications sont terminées (au moins une
    publiée), si le dossier est relié en Éditeur avec l'option activée. Au mieux : un échec est
    noté sur la source et retenté plus tard."""
    if not gd.is_enabled():
        return
    rows = (await db.execute(
        select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
        .where(CmSource.revoked_at.is_(None), CmSource.move_published.is_(True), CmSource.role == "writer",
               CmAsset.moved_published_at.is_(None), CmAsset.removed_at.is_(None),
               CmAsset.id.in_(select(CmPost.asset_id).join(CmTarget, CmTarget.post_id == CmPost.id)
                              .where(CmTarget.status == T_PUBLISHED)))
        .limit(20)
    )).all()
    for asset, src in rows:
        pending = (await db.execute(select(func.count()).select_from(CmTarget).join(CmPost, CmPost.id == CmTarget.post_id)
                                    .where(CmPost.asset_id == asset.id, CmTarget.status.not_in(T_FINAL)))).scalar() or 0
        if pending:
            continue
        try:
            folder = await gd.ensure_published_folder(src.folder_id, src.published_folder_id)
            src.published_folder_id = folder
            if asset.parent_id != folder:
                await gd.move(asset.file_id, folder, asset.parent_id)
                asset.parent_id = folder
                asset.folder_path = gd.PUBLISHED_FOLDER
            asset.moved_published_at = utcnow()
        except gd.DriveError as e:
            src.last_error = f"Rangement dans « {gd.PUBLISHED_FOLDER} » impossible : {e.describe()}"
            logger.info("cm : rangement de la vidéo %s en échec (%s)", asset.id, e.code)
        await db.commit()


async def cancel_pending_of_source(db: AsyncSession, source_id: int) -> None:
    """Dossier retiré : les publications pas encore parties de ses vidéos sont annulées."""
    post_ids = select(CmPost.id).where(CmPost.asset_id.in_(select(CmAsset.id).where(CmAsset.source_id == source_id)),
                                       CmPost.media_path.is_(None))
    await db.execute(update(CmTarget).where(CmTarget.post_id.in_(post_ids), CmTarget.status.in_(T_EDITABLE))
                     .values(status=T_CANCELLED, updated_at=utcnow()))


def post_ready_without_media(post: CmPost) -> bool:
    return post.status == POST_READY and post.asset_id is not None and not post.media_path
