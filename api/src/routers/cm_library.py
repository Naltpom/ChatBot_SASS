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

  GET    /api/cm/drive/archive         Drive d'archivage de l'espace (connexion drive.file)
  POST   /api/cm/drive/oauth/start     -> adresse Google ; POST /api/cm/drive/oauth/exchange {code, state}
  DELETE /api/cm/drive/archive         déconnecter (les fichiers déjà archivés restent dans le Drive)

Publier une vidéo de la bibliothèque : POST /api/cm/posts avec `asset_id` (routers/cm.py).
"""
import uuid
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode
from src.core.time import utcnow
from src.models.cm import CmAsset, CmGoogleIdentity, CmGroup, CmPost, CmProposal, CmSource
from src.models.user import User
from src.routers.cm import _capture_account_scope, _same, get_cm_user
from src.routers.tiktok import Tenant, _tenant, _tenant_of
from src.services import cm_access
from src.services import cm_archive
from src.services import cm_service as cm
from src.services import cm_paging as paging
from src.services import cm_library as lib
from src.services import gdrive_service as gd
from src.services.google_oauth import GoogleAuthError, verify_google_id_token
from src.services.rate_limit import RateLimiter, SingleUseTokens

router = APIRouter(prefix="/api/cm", tags=["cm-library"], dependencies=[Depends(_capture_account_scope)])

link_limiter = RateLimiter("rl:cmsrclink:", 30, 3600)
scan_limiter = RateLimiter("rl:cmsrcscan:", 20, 3600)
ident_limiter = RateLimiter("rl:cmgident:", 20, 3600)
analyze_limiter = RateLimiter("rl:cmanalyze:", 20, 3600)


async def _source(db: AsyncSession, tenant: Tenant, source_id: int) -> CmSource:
    s = await db.get(CmSource, source_id)
    if s is None or s.revoked_at is not None or not _same(s, tenant) or not cm_access.group_allowed(tenant, s.group_id):
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


# --------------------------------------------------------------------------
# Adresses Google associées (relier automatiquement les dossiers partagés)
# --------------------------------------------------------------------------

async def _identities_out(db: AsyncSession, user: User) -> dict:
    rows = (await db.execute(select(CmGoogleIdentity).where(CmGoogleIdentity.user_id == user.id)
                             .order_by(CmGoogleIdentity.created_at))).scalars().all()
    return {
        "account_email": user.email,
        "identities": [{"id": i.id, "email": i.email, "org_id": i.organization_id, "created_at": i.created_at.isoformat() + "Z"}
                       for i in rows],
    }


@router.get("/google-identities")
async def list_identities(db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    return await _identities_out(db, user)


class IdentityIn(BaseModel):
    credential: str = Field(min_length=20, max_length=8000)   # ID token Google (Google Identity Services)
    org_id: Optional[int] = None                               # espace où relier les dossiers (vide = perso)


@router.post("/google-identities")
async def add_identity(body: IdentityIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Associe une adresse Google PROUVÉE par Google (ID token vérifié : signature, audience,
    adresse vérifiée) : les dossiers partagés au robot depuis cette adresse sont reliés tout seuls."""
    if not await ident_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais : réessayez dans une heure.")
    if body.org_id is not None:
        cm_access.require(await _tenant(db, user, body.org_id), "admin")   # admin de l'équipe
    try:
        claims = await verify_google_id_token(body.credential)
    except GoogleAuthError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Connexion Google refusée : {e}")
    email = claims["email"].strip().lower()
    row = (await db.execute(select(CmGoogleIdentity).where(CmGoogleIdentity.email == email))).scalar_one_or_none()
    if row is not None and row.user_id != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Cette adresse Google est déjà associée à un autre compte Chapote.")
    if row is None:
        row = CmGoogleIdentity(user_id=user.id, email=email)
        db.add(row)
    row.google_sub = claims.get("sub")
    row.organization_id = body.org_id
    await db.commit()
    return await _identities_out(db, user)


class IdentityPatch(BaseModel):
    org_id: Optional[int] = None


@router.patch("/google-identities/{identity_id}")
async def update_identity(identity_id: int, body: IdentityPatch, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_cm_user)):
    row = await db.get(CmGoogleIdentity, identity_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adresse introuvable")
    if body.org_id is not None:
        cm_access.require(await _tenant(db, user, body.org_id), "admin")
    row.organization_id = body.org_id
    await db.commit()
    return await _identities_out(db, user)


@router.delete("/google-identities/{identity_id}")
async def remove_identity(identity_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    row = await db.get(CmGoogleIdentity, identity_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adresse introuvable")
    await db.delete(row)
    await db.commit()
    return await _identities_out(db, user)


@router.get("/sources")
async def list_sources(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    rows = (await db.execute(select(CmSource).where(tenant.where(CmSource), CmSource.revoked_at.is_(None))
                             .order_by(CmSource.created_at))).scalars().all()
    rows = [r for r in rows if cm_access.group_allowed(tenant, r.group_id)]
    counts = await lib.source_counts(db, [s.id for s in rows])
    return [lib.source_out(s, counts.get(s.id)) for s in rows]


class SourceIn(BaseModel):
    org_id: Optional[int] = None
    url: str = Field(min_length=5, max_length=1000)
    group_id: Optional[int] = None


@router.post("/sources")
async def add_source(body: SourceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    cm_access.require(tenant, "admin")
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
    cm_access.require(tenant, "admin")
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
    cm_access.require(tenant, "edit")
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
    cm_access.require(tenant, "admin")
    src = await _source(db, tenant, source_id)
    src.revoked_at = utcnow()
    await lib.cancel_pending_of_source(db, src.id)
    await db.commit()
    return {"ok": True, "hint": "Vous pouvez aussi retirer le robot du partage du dossier dans Google Drive."}


ASSET_SORTS = {"recent": "dt", "name": "str", "duration": "float", "size": "int"}


@router.get("/assets")
async def list_assets(response: Response, org_id: Optional[int] = Query(None), source_id: Optional[int] = None,
                      state: Literal["all", "new", "used"] = "all", q: Optional[str] = Query(None, max_length=100),
                      sort: Literal["recent", "name", "duration", "size"] = "recent",
                      order: Optional[Literal["asc", "desc"]] = None,
                      limit: int = Query(40, ge=1, le=100), cursor: Optional[str] = Query(None, max_length=300),
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Vidéos de la bibliothèque : recherche (nom, titre, légende, dossier), tri dans les deux sens,
    pages par curseur. En SQL (index d'expression) pour tenir sur de très gros dossiers."""
    tenant = await _tenant(db, user, org_id)
    sources = {s.id: s for s in (await db.execute(select(CmSource).where(
        tenant.where(CmSource), CmSource.revoked_at.is_(None)))).scalars().all() if cm_access.group_allowed(tenant, s.group_id)}
    if source_id is not None and source_id not in sources:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dossier introuvable")
    ids = [source_id] if source_id is not None else list(sources)
    if not ids:
        return []
    order = order or ("asc" if sort == "name" else "desc")
    col = {"recent": CmAsset.drive_created_at, "name": func.lower(func.coalesce(CmAsset.title, CmAsset.name)),
           "duration": CmAsset.duration_sec, "size": CmAsset.size}[sort]
    key = paging.nulls_last(col, ASSET_SORTS[sort], order).label("_k")
    stmt = select(CmAsset, key).where(CmAsset.source_id.in_(ids), CmAsset.removed_at.is_(None))
    used = select(CmPost.id).where(CmPost.asset_id == CmAsset.id).exists()
    elsewhere = CmAsset.kind.in_(("published", "routine", "waiting"))   # gérées par l'outil de publication
    if state == "new":
        stmt = stmt.where(~used, ~elsewhere | CmAsset.kind.is_(None))
    elif state == "used":
        stmt = stmt.where(used | elsewhere)
    pattern = paging.like(q)
    if pattern:
        stmt = stmt.where(or_(*(c.ilike(pattern, escape="\\") for c in
                                (CmAsset.name, CmAsset.title, CmAsset.caption, CmAsset.folder_path))))
    stmt = paging.apply(stmt, key, ASSET_SORTS[sort], CmAsset.id, order, cursor, limit)
    rows = paging.page(response, list((await db.execute(stmt)).all()), limit, lambda r: r[1], lambda r: r[0].id, cursor)
    rows = [a for a, _ in rows]
    usage = await lib.usage_of(db, [a.id for a in rows])
    return [lib.asset_out(a, sources.get(a.source_id), usage.get(a.id)) for a in rows]


async def _asset(db: AsyncSession, tenant: Tenant, asset_id: int) -> tuple[CmAsset, CmSource]:
    row = (await db.execute(select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
                            .where(CmAsset.id == asset_id))).first()
    if row is None or row[1].revoked_at is not None or not _same(row[1], tenant) \
            or not cm_access.group_allowed(tenant, row[1].group_id):
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
    cm_access.require(tenant, "edit")
    a, src = await _asset(db, tenant, asset_id)
    if body.title is not None:
        a.title = body.title.strip() or None
    if body.caption is not None:
        a.caption = body.caption or None
        a.caption_from = "user"          # le .txt du Drive ne l'écrase plus
    await db.commit()
    usage = await lib.usage_of(db, [a.id])
    return lib.asset_out(a, src, usage.get(a.id))


@router.get("/assets/{asset_id}/stream")
async def stream_asset(asset_id: int, request: Request, org_id: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Lire la vidéo dans cm (lecteur intégré), sans passer par Google Drive."""
    tenant = await _tenant(db, user, org_id)
    a, _ = await _asset(db, tenant, asset_id)
    try:
        code, headers, body = await gd.open_stream(a.file_id, request.headers.get("range"))
    except gd.DriveError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND if e.code in ("not_shared", "not_found") else 502, e.describe())
    headers = {**headers, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300"}
    media = headers.pop("content-type", None) or a.mime_type or "video/mp4"
    return StreamingResponse(body, status_code=206 if code == 206 else 200, media_type=media, headers=headers)


@router.get("/assets/{asset_id}/thumbnail")
async def asset_thumbnail(asset_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Sans org_id (utilisée dans <img>) : l'accès se déduit du dossier (membre de son espace)."""
    row = (await db.execute(select(CmAsset, CmSource).join(CmSource, CmSource.id == CmAsset.source_id)
                            .where(CmAsset.id == asset_id))).first()
    t = await _tenant_of(db, user, row[1]) if row is not None and row[1].revoked_at is None else None
    if t is None or not cm_access.group_allowed(t, row[1].group_id):
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



# --------------------------------------------------------------------------
# Brouillons automatiques : recette par dossier, propositions à valider
# --------------------------------------------------------------------------

async def _names(db: AsyncSession, tenant: Tenant) -> tuple[dict[str, str], dict[str, str]]:
    accounts = {f"{p}:{a.id}": cm.account_name(p, a) for p, a in await cm.tenant_accounts(db, tenant)}
    groups = {f"group:{g.id}": g.name for g in (await db.execute(select(CmGroup).where(tenant.where(CmGroup)))).scalars()}
    return accounts, groups


async def _examples(db: AsyncSession, tenant: Tenant, src: CmSource, recipe: dict, n: int = 4) -> list[dict]:
    from src.services import cm_recipe
    accounts, groups = await _names(db, tenant)
    members = await cm_recipe.group_members(db, tenant.where(CmGroup))
    rows = (await db.execute(select(CmAsset).where(CmAsset.source_id == src.id, CmAsset.removed_at.is_(None))
                             .order_by(CmAsset.drive_created_at.desc().nulls_last(), CmAsset.id.desc()).limit(n))).scalars().all()
    out = []
    for a in rows:
        got = cm_recipe.apply(recipe, a, members, members.get(src.group_id, []) if src.group_id else [])
        out.append({"asset_id": a.id, "path": "/".join(x for x in (a.folder_path, a.name) if x),
                    "accounts": [accounts.get(k, k) for k in got["accounts"]], "folder": got["folder"],
                    "scheduled_at": cm.iso(got["scheduled_at"]), "when_from": got["when_from"],
                    "title": got["title"], "caption": (got["caption"] or "")[:160] or None, "cover": bool(a.cover_file_id)})
    return out


@router.post("/sources/{source_id}/analyze")
async def analyze_source(source_id: int, org_id: Optional[int] = Query(None),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Comprend le rangement du dossier (noms et chemins seulement) et propose une recette."""
    from src.services import cm_recipe
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    src = await _source(db, tenant, source_id)
    if not await analyze_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'analyses : réessayez dans une heure.")
    assets = (await db.execute(select(CmAsset).where(CmAsset.source_id == src.id, CmAsset.removed_at.is_(None))
                               .order_by(CmAsset.drive_created_at.desc().nulls_last()).limit(150))).scalars().all()
    paths = ["/".join(x for x in (a.folder_path, a.name) if x) for a in assets]
    extra = [f"{'/'.join(x for x in (a.folder_path, 'légende.txt') if x)}" for a in assets if a.sidecar_file_id][:40]
    extra += [f"{'/'.join(x for x in (a.folder_path, 'couverture.jpg') if x)}" for a in assets if a.cover_file_id][:40]
    accounts, groups = await _names(db, tenant)
    valid = set(accounts) | set(groups)
    folders = {str(lvl): sorted({p.split("/")[lvl - 1] for p in paths if p.count("/") >= lvl})[:200] for lvl in (1, 2, 3)}
    answer = await cm_recipe.ask_gemini("\n".join(paths + extra), accounts, groups) if paths else None
    engine = "gemini" if answer else "regles"
    recipe = cm_recipe.clean(answer, valid) if answer else cm_recipe.heuristic(paths, accounts, groups)
    explanation = (answer or {}).get("explication") if answer else None
    return {"engine": engine, "recipe": recipe, "explanation": (explanation or "")[:400] or None,
            "examples": await _examples(db, tenant, src, recipe), "folders": folders,
            "accounts": [{"key": k, "name": v} for k, v in accounts.items()],
            "groups": [{"key": k, "name": v} for k, v in groups.items()],
            "patterns": cm_recipe.PATTERN_LABEL, "videos": len(paths)}


class RecipeIn(BaseModel):
    recipe: dict
    auto_drafts: bool = True
    backlog: bool = False             # aussi pour les vidéos déjà dans le dossier


@router.post("/sources/{source_id}/recipe/preview")
async def preview_recipe(source_id: int, body: RecipeIn, org_id: Optional[int] = Query(None),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    from src.services import cm_recipe
    tenant = await _tenant(db, user, org_id)
    src = await _source(db, tenant, source_id)
    accounts, groups = await _names(db, tenant)
    recipe = cm_recipe.clean(body.recipe, set(accounts) | set(groups))
    return {"recipe": recipe, "examples": await _examples(db, tenant, src, recipe)}


@router.put("/sources/{source_id}/recipe")
async def save_recipe(source_id: int, body: RecipeIn, org_id: Optional[int] = Query(None),
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    from src.services import cm_recipe
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    src = await _source(db, tenant, source_id)
    accounts, groups = await _names(db, tenant)
    src.recipe = cm_recipe.clean(body.recipe, set(accounts) | set(groups))
    if body.auto_drafts and not src.auto_drafts:
        src.drafts_since = None if body.backlog else utcnow()
    src.auto_drafts = body.auto_drafts
    await db.commit()
    proposed = await cm_recipe.propose(db, src)
    return {"source": lib.source_out(src), "proposed": proposed}


async def _proposal_out(db: AsyncSession, p: CmProposal, names: dict[str, str]) -> dict:
    a = await db.get(CmAsset, p.asset_id)
    src = await db.get(CmSource, p.source_id)
    return {"id": p.id, "status": p.status, "title": p.title, "caption": p.caption,
            "scheduled_at": cm.iso(p.scheduled_at), "when_from": p.when_from,
            "accounts": [{"key": k, "name": names.get(k), "platform": k.split(":")[0]} for k in p.accounts or [] if k in names],
            "asset": lib.asset_out(a, src) if a else None, "created_at": cm.iso(p.created_at)}


async def _proposal_scope(db: AsyncSession, tenant: Tenant, group_id: Optional[int]):
    """Filtre SQL des brouillons qui visent au moins un compte du groupe / du compte choisi (ou None)."""
    from sqlalchemy import cast
    from sqlalchemy.dialects.postgresql import ARRAY, JSONB
    from sqlalchemy import String as _S, literal
    from src.routers.cm import _ACCOUNT_SCOPE, _tenant_index
    if group_id is None and _ACCOUNT_SCOPE.get() is None:
        return None
    accounts, _ = await _tenant_index(db, tenant, group_id)
    keys = [f"{p}:{a.id}" for p, a in accounts] or ["-"]
    return cast(CmProposal.accounts, JSONB).has_any(literal(keys, ARRAY(_S)))


@router.get("/proposals")
async def list_proposals(response: Response, org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                         limit: int = Query(30, ge=1, le=100), cursor: Optional[str] = Query(None, max_length=300),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Brouillons à valider (heure proposée d'abord) ; filtrés par groupe / compte s'il y en a un."""
    tenant = await _tenant(db, user, org_id)
    key = paging.nulls_last(CmProposal.scheduled_at, "dt", "asc").label("_k")
    stmt = select(CmProposal, key).where(tenant.where(CmProposal), CmProposal.status == "open")
    scope = await _proposal_scope(db, tenant, group_id)
    if scope is not None:
        stmt = stmt.where(scope)
    stmt = paging.apply(stmt, key, "dt", CmProposal.id, "asc", cursor, limit)
    rows = paging.page(response, list((await db.execute(stmt)).all()), limit, lambda r: r[1], lambda r: r[0].id, cursor)
    accounts, _ = await _names(db, tenant)
    out = []
    for p, _ in rows:
        src = await db.get(CmSource, p.source_id)
        if src is None or not cm_access.group_allowed(tenant, src.group_id):
            continue
        out.append(await _proposal_out(db, p, accounts))
    return out


@router.get("/proposals/count")
async def count_proposals(org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Brouillons à valider ; avec un groupe ou un compte (barre de filtres), seulement ceux qui le visent."""
    tenant = await _tenant(db, user, org_id)
    conds = [tenant.where(CmProposal), CmProposal.status == "open"]
    scope = await _proposal_scope(db, tenant, group_id)
    if scope is not None:
        conds.append(scope)
    return {"open": (await db.execute(select(func.count()).select_from(CmProposal).where(*conds))).scalar() or 0}


async def _proposal(db: AsyncSession, tenant: Tenant, proposal_id: int) -> CmProposal:
    p = await db.get(CmProposal, proposal_id)
    if p is None or not _same(p, tenant):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Brouillon introuvable")
    return p


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: int, org_id: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    accounts, _ = await _names(db, tenant)
    return await _proposal_out(db, await _proposal(db, tenant, proposal_id), accounts)


class ArchiveIn(BaseModel):
    source_id: Optional[int] = None


@router.post("/proposals/archive")
async def archive_proposals(body: ArchiveIn, org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Range en archive tous les brouillons « à valider » (de la sélection, ou d'un dossier) : rien n'est publié,
    les vidéos restent dans la bibliothèque et ne sont plus proposées."""
    from sqlalchemy import update as sa_update
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "edit")
    conds = [tenant.where(CmProposal), CmProposal.status == "open"]
    if body.source_id is not None:
        await _source(db, tenant, body.source_id)
        conds.append(CmProposal.source_id == body.source_id)
    scope = await _proposal_scope(db, tenant, group_id)
    if scope is not None:
        conds.append(scope)
    res = await db.execute(sa_update(CmProposal).where(*conds).values(status="archived", updated_at=utcnow())
                           .execution_options(synchronize_session=False))
    await db.commit()
    return {"archived": res.rowcount or 0}


@router.post("/proposals/{proposal_id}/dismiss")
async def dismiss_proposal(proposal_id: int, org_id: Optional[int] = Query(None),
                           db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Écarte le brouillon (la vidéo reste dans la bibliothèque, elle ne sera plus proposée)."""
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "edit")
    p = await _proposal(db, tenant, proposal_id)
    p.status = "dismissed"
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# Drive d'archivage (publications de l'outil rangées par cm, cm_archive)
# --------------------------------------------------------------------------

DRIVE_STATE_SCOPE = "cm_drive_oauth"
drive_state_store = SingleUseTokens("rl:cmdrivestate:", 600)
drive_oauth_limiter = RateLimiter("rl:cmdriveoauth:", 20, 3600)
_BAD_DRIVE_STATE = "Lien de connexion Google Drive invalide ou expiré : relancez « Connecter Google Drive »."


@router.get("/drive/archive")
async def drive_archive(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")     # l'adresse Google reliée n'est montrée qu'aux administrateurs
    return cm_archive.link_out(await cm_archive.active_link(db, tenant.org_id, tenant.owner_user_id))


class DriveStartIn(BaseModel):
    org_id: Optional[int] = None


@router.post("/drive/oauth/start")
async def drive_oauth_start(body: DriveStartIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    if not cm_archive.oauth_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "La connexion Google Drive n'est pas encore configurée sur Chapote.")
    tenant = await _tenant(db, user, body.org_id)
    cm_access.require(tenant, "admin")
    if not await drive_oauth_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez dans une heure.")
    state = _encode({"sub": str(user.id), "scope": DRIVE_STATE_SCOPE, "org": tenant.org_id, "jti": uuid.uuid4().hex},
                    timedelta(seconds=600))
    return {"authorize_url": cm_archive.authorize_url(state)}


class DriveExchangeIn(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=2048)


@router.post("/drive/oauth/exchange")
async def drive_oauth_exchange(body: DriveExchangeIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    if not cm_archive.oauth_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "La connexion Google Drive n'est pas encore configurée sur Chapote.")
    try:
        claims = jwt.decode(body.state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_DRIVE_STATE)
    if claims.get("scope") != DRIVE_STATE_SCOPE or claims.get("sub") != str(user.id) or not claims.get("jti"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_DRIVE_STATE)
    tenant = await _tenant(db, user, claims.get("org"))
    cm_access.require(tenant, "admin")
    if not await drive_state_store.claim(claims["jti"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _BAD_DRIVE_STATE)
    try:
        tok = await cm_archive.exchange_code(body.code)
        link = await cm_archive.connect(db, tenant, user, tok)
    except cm_archive.ArchiveError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST if e.code != "drive_error" else status.HTTP_502_BAD_GATEWAY, e.message)
    return {**cm_archive.link_out(link), "org_id": tenant.org_id}


@router.delete("/drive/archive")
async def drive_disconnect(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    link = await cm_archive.active_link(db, tenant.org_id, tenant.owner_user_id)
    if link is not None:
        await cm_archive.disconnect(db, link)
    return cm_archive.link_out(None)
