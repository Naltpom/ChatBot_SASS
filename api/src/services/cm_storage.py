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


def _archived_bytes():
    return func.coalesce(CmPost.archive["bytes"].as_integer(),
                         case((CmPost.archive["video_id"].as_string().is_not(None), CmPost.video_size), else_=0))


async def used_bytes(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int]) -> int:
    """Octets rangés par cm dans les stockages de l'espace (fichiers pas encore supprimés)."""
    return int((await db.execute(select(func.coalesce(func.sum(_archived_bytes()), 0)).where(
        _tenant_cond(CmPost, org_id, owner_id), CmPost.archive.is_not(None)))).scalar() or 0)


def _link_cond(link: CmDriveLink, first_id: Optional[int]):
    """Publications rangées dans ce stockage (celles d'avant les stockages multiples : dans le premier)."""
    lid = CmPost.archive["link_id"].as_integer()
    return (lid == link.id) | ((lid.is_(None)) & (link.id == first_id)) if first_id is not None else (lid == link.id)


async def link_used(db: AsyncSession, link: CmDriveLink, first_id: Optional[int]) -> int:
    return int((await db.execute(select(func.coalesce(func.sum(_archived_bytes()), 0)).where(
        _tenant_cond(CmPost, link.organization_id, link.owner_user_id), CmPost.archive.is_not(None),
        _link_cond(link, first_id)))).scalar() or 0)


async def refresh_drive(db: AsyncSession, link: CmDriveLink, force: bool = False) -> None:
    """storageQuota du Drive relu (au plus toutes les 10 min) ; une erreur Google garde la dernière valeur."""
    if not force and link.drive_checked_at and utcnow() - link.drive_checked_at < DRIVE_TTL:
        return
    try:
        limit, usage = await gd.storage_quota(await cm_archive.user_token(link))
    except Exception as e:     # noqa: BLE001 — jamais bloquant ; rien n'a été écrit, la transaction reste intacte
        logger.info("cm : espace du Drive illisible (%s)", type(e).__name__)
        return
    link.drive_limit, link.drive_usage, link.drive_checked_at = limit, usage, utcnow()
    await db.commit()


def _free(link: CmDriveLink) -> Optional[int]:
    return None if link.drive_limit is None else max(0, link.drive_limit - (link.drive_usage or 0))


def _room(link: CmDriveLink, used: int) -> Optional[int]:
    """Place restante pour Chapote dans ce stockage (None = pas de limite connue)."""
    room = link.quota_gb * GB - used if link.quota_gb else None
    free = _free(link)
    if free is not None:
        room = free if room is None else min(room, free)
    return None if room is None else max(0, room)


def compute(link: Optional[CmDriveLink], used: int) -> dict:
    if link is None:
        return {"connected": False, "email": None, "folder_url": None, "quota_gb": None, "used_bytes": used, "drive_free_bytes": None,
                "retention": None, "delete_after_days": None, "state": "missing", "max_quota_gb": None}
    free = _free(link)
    room = _room(link, used)
    quota = link.quota_gb * GB if link.quota_gb else None
    full = (quota is not None and used >= quota) or (free is not None and free <= 0)
    almost = (quota is not None and used >= ALMOST * quota) or \
        (link.drive_limit is not None and (link.drive_usage or 0) >= ALMOST * link.drive_limit)
    folder = f"https://drive.google.com/drive/folders/{link.root_folder_id}" if link.root_folder_id else None
    return {"id": link.id, "name": link.name or "Google Drive", "position": link.position,
            "assign": link.assign or None, "room_bytes": room, "error": link.error,
            "connected": True, "email": link.email, "folder_url": folder, "quota_gb": link.quota_gb, "used_bytes": used,
            "drive_free_bytes": free, "retention": link.retention, "delete_after_days": link.delete_after_days,
            "state": "full" if full else "almost_full" if almost else "ok",
            "max_quota_gb": None if free is None else (used + free) // GB}


async def storages(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], refresh: bool = False) -> list[dict]:
    links = await cm_archive.links_of(db, org_id, owner_id)
    first = links[0].id if links else None
    out = []
    for link in links:
        if refresh:
            await refresh_drive(db, link)
        out.append(compute(link, await link_used(db, link, first)))
    return out


async def status_of(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], refresh: bool = False) -> dict:
    """Résumé de l'espace (tous ses stockages) + la liste `storages`. Champs du 1er stockage repris à plat
    (compatibilité : quota_gb, retention…)."""
    items = await storages(db, org_id, owner_id, refresh)
    if not items:
        return {**compute(None, await used_bytes(db, org_id, owner_id)), "storages": []}
    rooms = [i["room_bytes"] for i in items]
    states = [i["state"] for i in items]
    state = "full" if all(x == "full" for x in states) else "almost_full" if any(x != "ok" for x in states) else "ok"
    free = [i["drive_free_bytes"] for i in items if i["drive_free_bytes"] is not None]
    return {**items[0], "used_bytes": sum(i["used_bytes"] for i in items),
            "drive_free_bytes": sum(free) if free else None, "state": state,
            "room_bytes": None if any(r is None for r in rooms) else sum(rooms), "storages": items}


async def _groups_of(db: AsyncSession, accounts: list) -> set:
    from src.models.cm import CmGroupAccount
    if not accounts:
        return set()
    rows = (await db.execute(select(CmGroupAccount.group_id, CmGroupAccount.platform, CmGroupAccount.account_id))).all()
    want = {(p, int(a)) for p, a in accounts}
    return {g for g, p, a in rows if (p, a) in want}


def _matches(link: CmDriveLink, accounts: list, groups: set) -> bool:
    a = link.assign or {}
    mine = {(p, int(i)) for p, i in a.get("accounts") or []}
    return bool(mine & {(p, int(i)) for p, i in accounts}) or bool(set(a.get("groups") or []) & groups)


async def pick_link(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], accounts: list,
                    needed: int = 0) -> tuple[Optional[CmDriveLink], Optional[int]]:
    """Stockage d'une publication : d'abord ceux attribués à ses comptes (ou à leurs groupes), sinon ceux qui ne sont
    attribués à personne, dans l'ordre : le premier qui a la place. (lien, place restante du meilleur candidat)."""
    links = await cm_archive.links_of(db, org_id, owner_id)
    if not links:
        return None, None
    groups = await _groups_of(db, accounts)
    cands = [x for x in links if x.assign and _matches(x, accounts, groups)] or \
        [x for x in links if not x.assign] or links
    first = links[0].id
    best = None
    for link in cands:
        await refresh_drive(db, link)
        room = _room(link, await link_used(db, link, first))
        if room is None or needed <= room:
            return link, room
        best = room if best is None else max(best, room)
    return None, best or 0


async def link_for_post(db: AsyncSession, post: CmPost) -> Optional[CmDriveLink]:
    """Stockage d'une publication : celui déjà choisi (archive.link_id), sinon choisi par les règles et retenu."""
    a = dict(post.archive or {})
    if a.get("link_id"):
        link = await db.get(CmDriveLink, a["link_id"])
        if link is not None and link.revoked_at is None:
            return link
    accounts = [(t.platform, t.account_id) for t in (await db.execute(select(CmTarget).where(
        CmTarget.post_id == post.id))).scalars()]
    link, _ = await pick_link(db, post.organization_id, post.owner_user_id, accounts,
                              0 if a.get("video_id") else (post.video_size or 0))
    if link is None:       # rien n'a la place : on range quand même dans le premier candidat (l'erreur Drive dira)
        links = await cm_archive.links_of(db, post.organization_id, post.owner_user_id)
        link = links[0] if links else None
    if link is not None:
        post.archive = {**a, "link_id": link.id}
    return link


def _human(n: Optional[int]) -> str:
    if n is None:
        return "?"
    return f"{n / GB:.1f} Go".replace(".", ",") if n >= GB / 10 else f"{max(1, n // (1024 * 1024))} Mo"


async def check_create(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int], needed: int,
                       accounts: Optional[list] = None, owner_name: Optional[str] = None) -> None:
    """Avant de créer une publication : un stockage relié, et la vidéo tient dans celui que les règles choisissent."""
    if not settings.CM_STORAGE_REQUIRED:
        return
    links = await cm_archive.links_of(db, org_id, owner_id)
    if not links:
        if owner_name:                 # compte d'un groupe partagé : le stockage est chez son propriétaire
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "storage_required", "owner": owner_name, "message":
                                f"{owner_name}, propriétaire de ce compte, n'a pas encore relié de Google Drive : les vidéos "
                                "sont rangées dans son Drive. Demandez-lui de le connecter (Bibliothèque → Stockage)."})
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "storage_required", "message":
                            "Connectez d'abord un Google Drive à cet espace (Bibliothèque → Stockage) : vos vidéos y sont "
                            "rangées. Sans Drive, impossible de créer une publication."})
    if needed <= 0:
        return
    link, room = await pick_link(db, org_id, owner_id, accounts or [], needed)
    if link is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "storage_full", "needed_bytes": needed, "free_bytes": max(0, room or 0),
            "message": f"Stockage plein : cette vidéo fait {_human(needed)}, il reste {_human(max(0, room or 0))}. "
                       "Libérez de la place dans votre Drive, augmentez le quota réservé à Chapote, ajoutez un stockage "
                       "ou choisissez de supprimer les vidéos après publication (Bibliothèque → Stockage)."})


async def update_settings(db: AsyncSession, link: CmDriveLink, quota_gb: Optional[int], retention: str,
                          delete_after_days: Optional[int], name: Optional[str] = None, position: Optional[int] = None,
                          assign: Optional[dict] = None, set_assign: bool = False) -> None:
    if name is not None:
        link.name = name.strip()[:80] or link.name
    if position is not None:
        link.position = position
    if set_assign:
        clean = {"accounts": [[p, int(i)] for p, i in (assign or {}).get("accounts") or []],
                 "groups": [int(g) for g in (assign or {}).get("groups") or []]}
        link.assign = clean if clean["accounts"] or clean["groups"] else None
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
            first = (await cm_archive.links_of(db, link.organization_id, link.owner_user_id))[0].id
            most = (await link_used(db, link, first) + free) // GB
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
        first = (await cm_archive.links_of(db, link.organization_id, link.owner_user_id))[0].id
        posts = (await db.execute(select(CmPost).where(
            _tenant_cond(CmPost, link.organization_id, link.owner_user_id), CmPost.archive_state == "ok",
            CmPost.archive.is_not(None), _link_cond(link, first)).order_by(CmPost.id))).scalars().all()
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
        first = (await cm_archive.links_of(db, link.organization_id, link.owner_user_id))[0].id
        state = compute(link, await link_used(db, link, first))["state"]
        if state in ("almost_full", "full"):
            if link.storage_alert != state:
                link.storage_alert, link.storage_alert_at = state, utcnow()
                link.storage_alert_seq = (link.storage_alert_seq or 0) + 1
        elif link.storage_alert is not None:
            link.storage_alert = None
        await db.commit()
