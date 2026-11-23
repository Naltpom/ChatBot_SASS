"""cm.chapote.fr : archivage des publications de l'outil (ref « compte/id ») dans le Drive de l'espace.

Arborescence (la même que celle rangée jusqu'ici par le PC) :
  <compte>/<AAAA-MM>/<AAAA-MM-JJ HHhMM — Titre>/  « Titre.mp4 », « Titre.txt » (légende), couverture.jpg, infos.json
  contes/<KHM-NNN — Titre>/                       « Titre — partie N.mp4 » (…txt, couverture — partie N.jpg), infos.json « parties »

Où écrire, dans l'ordre :
  1. le dossier du compte déjà relié à cm (nom du dossier = <compte>), si le robot peut y déposer des fichiers
     (`CmSource.can_upload`, essai réel : Google le refuse en général à un compte de service hors Drive partagé) ;
  2. sinon le Drive connecté par l'utilisateur (`CmDriveLink`, droit « drive.file » : cm ne voit que ce qu'il crée),
     dans « cm.chapote.fr (archives) » / <compte> / … ; ce dossier est partagé en lecture avec le robot et relié
     à la bibliothèque, ce qui permet aussi de relire la vidéo pour une nouvelle tentative.

infos.json est réécrit à chaque changement de statut d'une cible (liens compris). Ces dossiers ne donnent jamais
de brouillon « à valider » (infos.json porte compte + id : voir cm_library.classify). Aucun jeton n'est loggé.
"""
import hashlib
import json
import logging
import time
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import (
    POST_CANCELLED,
    POST_RECEIVING,
    T_CANCELLED,
    T_FAILED,
    T_INBOX,
    T_PUBLISHED,
    CmDriveLink,
    CmPost,
    CmSource,
    CmTarget,
)
from src.services import gdrive_service as gd
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TZ = ZoneInfo("Europe/Paris")
SYNC_BATCH = 5
RETRY_AFTER = timedelta(minutes=30)
KEEP_UNARCHIVED_MEDIA = timedelta(days=7)    # vidéo gardée au plus 7 j en attendant l'archivage
PROBE_EVERY = 3600
CONTES = "contes"

_user_tokens: dict[int, tuple[str, float]] = {}
_probed: dict[int, float] = {}


class ArchiveError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------
# Connexion Google de l'utilisateur (drive.file)
# --------------------------------------------------------------------------

def _client_id() -> Optional[str]:
    return settings.GOOGLE_DRIVE_CLIENT_ID or settings.GDRIVE_OAUTH_CLIENT_ID


def _client_secret() -> Optional[str]:
    return settings.GOOGLE_DRIVE_CLIENT_SECRET or settings.GDRIVE_OAUTH_CLIENT_SECRET


def oauth_enabled() -> bool:
    return bool(_client_id() and _client_secret())


def redirect_uri() -> str:
    return settings.GDRIVE_OAUTH_REDIRECT_URI or f"{settings.CM_URL.rstrip('/')}/drive/callback"


def authorize_url(state: str) -> str:
    return f"{AUTHORIZE_URL}?" + urlencode({
        "client_id": _client_id(), "redirect_uri": redirect_uri(), "response_type": "code",
        "scope": OAUTH_SCOPE, "access_type": "offline", "prompt": "select_account consent", "state": state})


async def _token_post(data: dict) -> dict:
    async with gd._client() as c:
        resp = await c.post(settings.GDRIVE_TOKEN_URL, data={
            "client_id": _client_id(), "client_secret": _client_secret(), **data})
    body = gd._json(resp)
    if resp.status_code >= 400 or not body.get("access_token"):
        code = body.get("error") or f"http_{resp.status_code}"
        raise ArchiveError("revoked" if code == "invalid_grant" else "oauth_failed",
                           "Google a retiré l'accès au Drive : reconnectez-le." if code == "invalid_grant"
                           else f"Connexion Google Drive refusée ({code}).")
    return body


async def exchange_code(code: str) -> dict:
    return await _token_post({"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri()})


async def user_token(link: CmDriveLink) -> str:
    cached = _user_tokens.get(link.id)
    if cached and cached[1] - 120 > time.time():
        return cached[0]
    if not link.refresh_token_enc:
        raise ArchiveError("revoked", "Google Drive déconnecté : reconnectez-le.")
    body = await _token_post({"grant_type": "refresh_token", "refresh_token": decrypt_secret(link.refresh_token_enc)})
    _user_tokens[link.id] = (body["access_token"], time.time() + int(body.get("expires_in") or 3600))
    return body["access_token"]


def _tenant_cond(model, org_id: Optional[int], owner_id: Optional[int]):
    if org_id:
        return model.organization_id == org_id
    return (model.owner_user_id == owner_id) & model.organization_id.is_(None)


async def active_link(db: AsyncSession, org_id: Optional[int], owner_id: Optional[int]) -> Optional[CmDriveLink]:
    return (await db.execute(select(CmDriveLink).where(_tenant_cond(CmDriveLink, org_id, owner_id),
                                                       CmDriveLink.revoked_at.is_(None)))).scalar_one_or_none()


async def connect(db: AsyncSession, tenant, user, tok: dict) -> CmDriveLink:
    """Après l'accord Google : dossier racine créé par cm, partagé en lecture avec le robot, relié à la bibliothèque."""
    if not tok.get("refresh_token"):
        raise ArchiveError("no_refresh", "Google n'a pas fourni d'accès durable : réessayez.")
    if OAUTH_SCOPE not in (tok.get("scope") or "").split():
        raise ArchiveError("scope_missing", "L'accès au Drive n'a pas été accordé : cochez la case de Google Drive.")
    token = tok["access_token"]
    try:
        about = gd._json(await gd._call(token, "GET", f"{settings.GDRIVE_API_BASE}/drive/v3/about",
                                        params={"fields": "user(emailAddress)"}))
        root = await gd.ensure_folder(token, "root", settings.GDRIVE_ARCHIVE_ROOT_NAME)
        if gd.robot_email():
            await gd.share_with(token, root, gd.robot_email(), "reader")
    except gd.DriveError as e:
        raise ArchiveError("drive_error", e.describe())
    old = await active_link(db, tenant.org_id, tenant.owner_user_id)
    if old is not None:
        old.revoked_at = utcnow()
        await db.flush()
    link = CmDriveLink(organization_id=tenant.org_id, owner_user_id=tenant.owner_user_id, connected_by_user_id=user.id,
                       email=((about.get("user") or {}).get("emailAddress") or "")[:255] or None,
                       refresh_token_enc=encrypt_secret(tok["refresh_token"]), root_folder_id=root)
    db.add(link)
    # Publications de l'outil encore sur le serveur : archivées aussi.
    await db.execute(update(CmPost).where(_tenant_cond(CmPost, tenant.org_id, tenant.owner_user_id),
                                          CmPost.ref.is_not(None), CmPost.archive_state.is_(None),
                                          CmPost.asset_id.is_(None), CmPost.media_path.is_not(None))
                     .values(archive_state="pending"))
    await db.commit()
    await db.refresh(link)
    _user_tokens[link.id] = (token, time.time() + int(tok.get("expires_in") or 3600))
    await _ensure_source(db, link, user)
    return link


async def _ensure_source(db: AsyncSession, link: CmDriveLink, user=None) -> None:
    """Dossier d'archives relié à la bibliothèque (lecture par le robot) : vidéos visibles, relecture possible."""
    if link.source_id or not link.root_folder_id or not gd.is_enabled():
        return
    from fastapi import HTTPException
    from src.routers.tiktok import Tenant
    from src.models.user import User
    from src.services import cm_library
    if user is None:
        user = await db.get(User, link.connected_by_user_id or link.owner_user_id) if (
            link.connected_by_user_id or link.owner_user_id) else None
        if user is None:
            return
    try:
        src = await cm_library.link_source(db, Tenant(link.organization_id, link.owner_user_id, None), user,
                                           link.root_folder_id, None)
    except HTTPException as e:              # partage pas encore visible par le robot : réessayé plus tard
        logger.info("cm : dossier d'archives pas encore lisible par le robot (%s)", e.status_code)
        return
    link.source_id = src.id
    src.can_upload = False
    await db.commit()


REVOKE_URL = "https://oauth2.googleapis.com/revoke"


async def disconnect(db: AsyncSession, link: CmDriveLink) -> None:
    """« Déconnecter Google Drive » : autorisation révoquée chez Google, jeton supprimé de la base.
    Les fichiers déjà archivés restent dans le Drive de l'utilisateur."""
    if link.refresh_token_enc:
        try:
            async with gd._client() as c:
                await c.post(REVOKE_URL, data={"token": decrypt_secret(link.refresh_token_enc)})
        except httpx.HTTPError:
            logger.info("cm : révocation Google Drive injoignable (jeton supprimé quand même)")
    _user_tokens.pop(link.id, None)
    await db.delete(link)
    await db.commit()


def link_out(link: Optional[CmDriveLink]) -> dict:
    return {
        "oauth_enabled": oauth_enabled(), "connected": link is not None,
        "email": link.email if link else None, "error": link.error if link else None,
        "folder_url": f"https://drive.google.com/drive/folders/{link.root_folder_id}" if link and link.root_folder_id else None,
        "folder_name": settings.GDRIVE_ARCHIVE_ROOT_NAME,
    }


# --------------------------------------------------------------------------
# Contenu archivé
# --------------------------------------------------------------------------

def clean_name(s: str, limit: int = 120) -> str:
    s = "".join(" " if (c in '/\\:*?"<>|' or ord(c) < 32) else c for c in (s or "")).strip(" .")
    return " ".join(s.split())[:limit] or "Sans titre"


def _split_ref(ref: str) -> tuple[str, str]:
    compte, _, rid = (ref or "").partition("/")
    return compte.strip(), rid.strip()


def _local(dt):
    return dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(TZ) if dt else None


T_STATUT = {T_PUBLISHED: "publiee", T_INBOX: "publiee", T_FAILED: "ratee", T_CANCELLED: "annulee"}


def _target_statut(t: CmTarget) -> str:
    return T_STATUT.get(t.status) or ("en_cours" if t.status in ("DISPATCHING", "PUBLISHING", "ROUTINE_CLAIMED") else "prete")


def post_statut(targets: list[CmTarget]) -> str:
    live = [t for t in targets if t.status != T_CANCELLED]
    if not live:
        return "annulee"
    st = [_target_statut(t) for t in live]
    if all(s == "publiee" for s in st):
        return "publiee"
    if "ratee" in st and not {"prete", "en_cours"} & set(st):
        return "ratee"
    return "prete"


def entry(post: CmPost, targets: list[CmTarget]) -> dict:
    """infos.json d'une publication (ou d'une partie de conte)."""
    compte, rid = _split_ref(post.ref)
    live = [t for t in targets if t.status != T_CANCELLED] or targets
    first = min((t.scheduled_at for t in live), default=None)
    published = [t.published_at for t in targets if t.published_at]
    plats: dict = {}
    for t in sorted(targets, key=lambda x: (x.status != T_CANCELLED, x.id)):
        plats[t.platform] = {"statut": _target_statut(t), "url": t.url,
                             "publie_le": _local(t.published_at).isoformat() if t.published_at else None}
    return {"compte": compte, "id": rid, "titre": post.title,
            "heure": _local(first).isoformat() if first else None, "statut": post_statut(targets),
            "publie_le": _local(max(published)).isoformat() if published else None, "plateformes": plats}


def _layout(post: CmPost, targets: list[CmTarget]) -> tuple[list[str], str, Optional[str]]:
    """(dossiers sous le compte, nom de base des fichiers, partie de conte ou None)."""
    compte, rid = _split_ref(post.ref)
    conte = (post.archive or {}).get("conte") or {}
    if compte == CONTES:
        dossier = clean_name(conte.get("dossier") or f"{conte.get('id') or rid} — {conte.get('titre') or post.title}")
        partie = str(conte.get("partie") or "").strip() or None
        titre = clean_name(conte.get("titre") or post.title)
        stem = titre if not partie else (f"{titre} — version longue" if partie == "longue" else f"{titre} — partie {partie}")
        return [dossier], stem, partie
    live = [t for t in targets if t.status != T_CANCELLED] or targets
    when = _local(min((t.scheduled_at for t in live), default=post.created_at))
    titre = clean_name(post.title)
    return [when.strftime("%Y-%m"), f"{when.strftime('%Y-%m-%d %Hh%M')} — {titre}"], titre, None


async def _destination(db: AsyncSession, post: CmPost) -> Optional[tuple[str, str, str, list[str]]]:
    """(via, jeton, dossier de base, préfixe) ; None si l'espace n'a aucun Drive où écrire."""
    compte, _ = _split_ref(post.ref)
    srcs = (await db.execute(select(CmSource).where(_tenant_cond(CmSource, post.organization_id, post.owner_user_id),
                                                    CmSource.revoked_at.is_(None), CmSource.can_upload.is_(True))
                             )).scalars().all()
    src = next((s for s in srcs if (s.name or "").strip().lower() == compte.lower()), None)
    if src is not None:
        return "robot", await gd.access_token(), src.folder_id, []
    link = await active_link(db, post.organization_id, post.owner_user_id)
    if link is None or not link.root_folder_id:
        return None
    try:
        token = await user_token(link)
    except ArchiveError as e:
        link.error = e.message
        if e.code == "revoked":          # accès retiré chez Google : déconnecté, jeton effacé
            link.revoked_at, link.refresh_token_enc = utcnow(), ""
            _user_tokens.pop(link.id, None)
        await db.commit()
        raise
    if link.error:
        link.error = None
    return "oauth", token, link.root_folder_id, [clean_name(compte)]


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:16]


async def sync_post(db: AsyncSession, post: CmPost) -> None:
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
    a = dict(post.archive or {})
    now = utcnow()
    try:
        dest = await _destination(db, post)
    except (ArchiveError, gd.DriveError) as e:
        post.archive_state, post.archive_synced_at = "error", now
        post.archive = {**a, "error": getattr(e, "message", None) or str(e)}
        await db.commit()
        return
    if dest is None:
        post.archive_synced_at = now
        post.archive = {**a, "error": "Aucun Drive d'archivage : connectez Google Drive dans la Bibliothèque."}
        await db.commit()
        return
    via, token, base, prefix = dest
    if a.get("base") != base:          # nouvelle destination : tout est réécrit là-bas
        a = {"conte": a.get("conte"), "base": base, "via": via}
    try:
        names, stem, partie = _layout(post, targets)
        if not a.get("folder_id"):
            a["folder_id"] = await gd.ensure_path(token, base, prefix + names)
        folder = a["folder_id"]
        if not a.get("video_id") and post.media_path:
            ext = "mov" if post.mime_type == "video/quicktime" else "mp4"
            a["video_id"] = await gd.put_file(token, folder, f"{stem}.{ext}", post.media_path, post.mime_type or "video/mp4")
        cap = (post.caption or "").encode()
        if a.get("caption_sha") != _sha(cap):
            a["caption_id"] = await gd.put_bytes(token, folder, f"{stem}.txt", cap, "text/plain; charset=utf-8",
                                                 a.get("caption_id"))
            a["caption_sha"] = _sha(cap)
        if not a.get("cover_id") and post.cover_path:
            try:
                with open(post.cover_path, "rb") as f:
                    img = f.read()
                ext = "png" if post.cover_path.endswith(".png") else "jpg"
                cover = "couverture" if partie is None else f"couverture — partie {partie}"
                a["cover_id"] = await gd.put_bytes(token, folder, f"{cover}.{ext}", img,
                                                   "image/png" if ext == "png" else "image/jpeg")
            except OSError:
                pass
        mine = entry(post, targets)
        if partie is None:
            infos = mine
        else:
            infos_id = a.get("infos_id") or await gd.find_child(token, folder, lib_infos_name(), False)
            try:
                infos = json.loads(await gd.get_bytes(token, infos_id)) if infos_id else {}
            except (gd.DriveError, ValueError):
                infos = {}
            infos = infos if isinstance(infos, dict) else {}
            conte = a.get("conte") or {}
            compte, rid = _split_ref(post.ref)
            parts = infos.get("parties") if isinstance(infos.get("parties"), dict) else {}
            parts[partie] = {k: mine[k] for k in ("statut", "heure", "publie_le", "plateformes")} | {"id": rid, "titre": post.title}
            infos = {**infos, "compte": compte, "id": conte.get("id") or infos.get("id") or rid,
                     "titre": conte.get("titre") or infos.get("titre") or post.title, "parties": parts}
            a["infos_id"] = infos_id
        raw = json.dumps(infos, ensure_ascii=False, indent=2).encode()
        if a.get("infos_sha") != _sha(raw) or not a.get("infos_id"):
            a["infos_id"] = await gd.put_bytes(token, folder, lib_infos_name(), raw, "application/json", a.get("infos_id"))
            a["infos_sha"] = _sha(raw)
        a.pop("error", None)
        post.archive_state = "ok" if (a.get("video_id") or not post.media_path) else "pending"
    except gd.DriveError as e:
        if e.code == "no_space" and via == "robot":
            await db.execute(update(CmSource).where(CmSource.folder_id == base).values(can_upload=False))
        a["error"] = e.describe()
        post.archive_state = "error"
        logger.info("cm : archivage de la publication %s en échec (%s)", post.id, e.code)
    post.archive, post.archive_synced_at = a, now
    await db.commit()


def lib_infos_name() -> str:
    from src.services.cm_library import INFOS_NAME
    return INFOS_NAME


async def sync_due(db: AsyncSession) -> None:
    """Publications à archiver (nouvelles, en échec depuis 30 min) ou dont une cible a changé depuis."""
    now = utcnow()
    changed = exists().where(CmTarget.post_id == CmPost.id, CmTarget.updated_at > CmPost.archive_synced_at)
    rows = (await db.execute(select(CmPost).where(
        CmPost.ref.is_not(None), CmPost.status.not_in((POST_RECEIVING,)),
        or_((CmPost.archive_state.in_(("pending", "error"))
             & (CmPost.archive_synced_at.is_(None) | (CmPost.archive_synced_at < now - RETRY_AFTER))),
            (CmPost.archive_state == "ok") & changed),
    ).order_by(CmPost.id).limit(SYNC_BATCH))).scalars().all()
    for post in rows:
        if post.status == POST_CANCELLED and not (post.archive or {}).get("folder_id"):
            post.archive_state = None
            await db.commit()
            continue
        await sync_post(db, post)
    # Dossiers d'archives pas encore reliés à la bibliothèque (partage pas encore visible au 1er essai).
    for link in (await db.execute(select(CmDriveLink).where(CmDriveLink.revoked_at.is_(None),
                                                            CmDriveLink.source_id.is_(None)).limit(3))).scalars():
        await _ensure_source(db, link)


async def probe_sources(db: AsyncSession, batch: int = 3) -> None:
    """Essai réel, une fois par dossier Éditeur : le robot peut-il y déposer des fichiers ?"""
    if not gd.is_enabled():
        return
    now = time.time()
    srcs = (await db.execute(select(CmSource).where(CmSource.revoked_at.is_(None), CmSource.role == "writer",
                                                    CmSource.can_upload.is_(None)).order_by(CmSource.id))).scalars().all()
    for src in [s for s in srcs if now - _probed.get(s.id, 0) > PROBE_EVERY][:batch]:
        _probed[src.id] = now
        try:
            res = await gd.probe_upload(src.folder_id)
        except gd.DriveError:
            continue
        if res is not None:
            src.can_upload = res
            await db.commit()


def keep_media(post: CmPost) -> bool:
    """Vidéo encore à archiver : gardée sur le serveur (7 j au plus)."""
    if post.archive_state not in ("pending", "error") or (post.archive or {}).get("video_id"):
        return False
    return utcnow() - post.created_at < KEEP_UNARCHIVED_MEDIA


def archive_out(post: CmPost) -> Optional[dict]:
    if not post.archive_state:
        return None
    a = post.archive or {}
    return {"state": post.archive_state, "error": a.get("error"), "via": a.get("via"),
            "folder_url": f"https://drive.google.com/drive/folders/{a['folder_id']}" if a.get("folder_id") else None,
            "video_id": a.get("video_id")}
