"""cm.chapote.fr — bibliothèque : vidéos des dossiers Google Drive partagés avec le robot.

Même authentification et mêmes règles de tenant que routers/cm.py (session ou jeton de la
routine ; `org_id` absent = espace perso ; ressource d'un autre tenant = 404).

  GET    /api/cm/library/robot             adresse du robot à qui partager les dossiers
  GET    /api/cm/sources                   dossiers reliés
  POST   /api/cm/sources                   relier un dossier (lien) -> vérifié et relu tout de suite
  PATCH  /api/cm/sources/{id}              groupe par défaut, rangement dans « Publié »
  POST   /api/cm/sources/{id}/scan         relire maintenant
  DELETE /api/cm/sources/{id}              retirer (publications à venir de ses vidéos annulées)
  GET    /api/cm/assets                    vidéos (filtre dossier / état / recherche, pagination)
  GET    /api/cm/assets/{id}
  PATCH  /api/cm/assets/{id}               titre, légende
  GET    /api/cm/assets/{id}/thumbnail     miniature (relayée depuis Drive)

Publier une vidéo de la bibliothèque : POST /api/cm/posts avec `asset_id` (routers/cm.py).
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.time import utcnow
from src.models.cm import CmAsset, CmGroup, CmPost, CmSource
from src.models.user import User
from src.routers.cm import _decode_cursor, _page, _same, get_cm_user
from src.routers.tiktok import Tenant, _tenant, _tenant_of
from src.services import cm_library as lib
from src.services import gdrive_service as gd
from src.services.rate_limit import RateLimiter

router = APIRouter(prefix="/api/cm", tags=["cm-library"])

link_limiter = RateLimiter("rl:cmsrclink:", 30, 3600)
scan_limiter = RateLimiter("rl:cmsrcscan:", 20, 3600)


async def _source(db: AsyncSession, tenant: Tenant, source_id: int) -> CmSource:
    s = await db.get(CmSource, source_id)
    if s is None or s.revoked_at is not None or not _same(s, tenant):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dossier introuvable")
    return s


async def _check_group(db: AsyncSession, tenant: Tenant, group_id: Optional[int]) -> Optional[int]:
    if group_id is None:
        return None
    g = await db.get(CmGroup, group_id)
    if g is None or not _same(g, tenant):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Groupe introuvable")
    return g.id


@router.get("/library/robot")
async def robot(user: User = Depends(get_cm_user)):
    return {"enabled": gd.is_enabled(), "email": gd.robot_email()}


@router.get("/sources")
async def list_sources(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    rows = (await db.execute(select(CmSource).where(tenant.where(CmSource), CmSource.revoked_at.is_(None))
                             .order_by(CmSource.created_at))).scalars().all()
    counts = await lib.source_counts(db, [s.id for s in rows])
    return [lib.source_out(s, counts.get(s.id)) for s in rows]


class SourceIn(BaseModel):
    org_id: Optional[int] = None
    url: str = Field(min_length=5, max_length=1000)
    group_id: Optional[int] = None


@router.post("/sources")
async def add_source(body: SourceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    if not await link_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais : réessayez dans une heure.")
    group_id = await _check_group(db, tenant, body.group_id)
    src = await lib.link_source(db, tenant, user, body.url, group_id)
    result = await lib.scan_source(db, src)
    counts = await lib.source_counts(db, [src.id])
    return {**lib.source_out(src, counts.get(src.id)), "scan": result}


class SourcePatch(BaseModel):
    group_id: Optional[int] = None
    clear_group: bool = False
    move_published: Optional[bool] = None


@router.patch("/sources/{source_id}")
async def update_source(source_id: int, body: SourcePatch, org_id: Optional[int] = Query(None),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    src = await _source(db, tenant, source_id)
    if body.clear_group:
        src.group_id = None
    elif body.group_id is not None:
        src.group_id = await _check_group(db, tenant, body.group_id)
    if body.move_published is not None:
        if body.move_published and src.role != "writer":
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Pour ranger les vidéos publiées, partagez le dossier avec le robot en Éditeur.")
        src.move_published = body.move_published
    await db.commit()
    counts = await lib.source_counts(db, [src.id])
    return lib.source_out(src, counts.get(src.id))


@router.post("/sources/{source_id}/scan")
async def scan_now(source_id: int, org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    src = await _source(db, tenant, source_id)
    if not await scan_limiter.check(f"{src.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Dossier relu il y a peu : réessayez dans quelques minutes.")
    result = await lib.scan_source(db, src)
    counts = await lib.source_counts(db, [src.id])
    return {**lib.source_out(src, counts.get(src.id)), "scan": result}


@router.delete("/sources/{source_id}")
async def remove_source(source_id: int, org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    src = await _source(db, tenant, source_id)
    src.revoked_at = utcnow()
    await lib.cancel_pending_of_source(db, src.id)
    await db.commit()
    return {"ok": True, "hint": "Vous pouvez aussi retirer le robot du partage du dossier dans Google Drive."}


@router.get("/assets")
async def list_assets(response: Response, org_id: Optional[int] = Query(None), source_id: Optional[int] = None,
                      state: Literal["all", "new", "used"] = "all", q: Optional[str] = Query(None, max_length=100),
                      limit: int = Query(40, ge=1, le=100), cursor: Optional[str] = None,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    sources = {s.id: s for s in (await db.execute(select(CmSource).where(
        tenant.where(CmSource), CmSource.revoked_at.is_(None)))).scalars().all()}
    if source_id is not None and source_id not in sources:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dossier introuvable")
    ids = [source_id] if source_id is not None else list(sources)
    if not ids:
        return []
    stmt = select(CmAsset).where(CmAsset.source_id.in_(ids), CmAsset.removed_at.is_(None))
    used = select(CmPost.asset_id).where(CmPost.asset_id.is_not(None))
    if state == "new":
        stmt = stmt.where(CmAsset.id.not_in(used))
    elif state == "used":
        stmt = stmt.where(CmAsset.id.in_(used))
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(CmAsset.name.ilike(like), CmAsset.title.ilike(like), CmAsset.caption.ilike(like),
                              CmAsset.folder_path.ilike(like)))
    offset = _decode_cursor(cursor)
    rows = (await db.execute(stmt.order_by(CmAsset.drive_created_at.desc().nulls_last(), CmAsset.id.desc())
                             .offset(offset).limit(limit + 1))).scalars().all()
    rows = _page(response, rows, offset, limit)
    usage = await lib.usage_of(db, [a.id for a in rows])
    return [lib.asset_out(a, sources.get(a.source_id), usage.get(a.id)) for a in rows]


async def _asset(db: AsyncSession, tenant: Tenant, asset_id: int) -> tuple[CmAsset, CmSource]:
    row = (await db.execute(select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
                            .where(CmAsset.id == asset_id))).first()
    if row is None or row[1].revoked_at is not None or not _same(row[1], tenant):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vidéo introuvable")
    return row[0], row[1]


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: int, org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    a, src = await _asset(db, tenant, asset_id)
    usage = await lib.usage_of(db, [a.id])
    return lib.asset_out(a, src, usage.get(a.id))


class AssetPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    caption: Optional[str] = Field(default=None, max_length=5000)


@router.patch("/assets/{asset_id}")
async def update_asset(asset_id: int, body: AssetPatch, org_id: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    a, src = await _asset(db, tenant, asset_id)
    if body.title is not None:
        a.title = body.title.strip() or None
    if body.caption is not None:
        a.caption = body.caption or None
        a.caption_from = "user"          # le .txt du Drive ne l'écrase plus
    await db.commit()
    usage = await lib.usage_of(db, [a.id])
    return lib.asset_out(a, src, usage.get(a.id))


@router.get("/assets/{asset_id}/thumbnail")
async def asset_thumbnail(asset_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Sans org_id (utilisée dans <img>) : l'accès se déduit du dossier (membre de son espace)."""
    row = (await db.execute(select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
                            .where(CmAsset.id == asset_id))).first()
    if row is None or row[1].revoked_at is not None or await _tenant_of(db, user, row[1]) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vidéo introuvable")
    a = row[0]
    if not a.thumbnail_link:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pas de miniature")
    try:
        data, ctype = await gd.thumbnail(a.thumbnail_link)
    except gd.DriveError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Miniature indisponible")
    if not ctype.startswith("image/"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Miniature indisponible")
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=3600"})

