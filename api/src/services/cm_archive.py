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
import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
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
from src.services.cm_library import INFOS_NAME
from src.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TZ = ZoneInfo("Europe/Paris")
SYNC_BATCH = 5
RETRY_AFTER = timedelta(minutes=30)
POST_TIMEOUT = timedelta(minutes=25)          # au-delà, la publication est reprise au passage suivant
KEEP_UNARCHIVED_MEDIA = timedelta(days=7)    # vidéo gardée au plus 7 j en attendant l'archivage
PROBE_EVERY = 3600
CONTES = "contes"

_user_tokens: dict[int, tuple[str, float]] = {}
_probed: dict[int, float] = {}
_source_tries: dict[int, float] = {}


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
    if old is not None:                # reconnexion : l'ancien accès est révoqué chez Google et effacé
        await _revoke(old)
        old.revoked_at, old.refresh_token_enc = utcnow(), ""
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
    if user is None:                   # relance planifiée : au plus une fois par heure
        if time.time() - _source_tries.get(link.id, 0) < PROBE_EVERY:
            return
        _source_tries[link.id] = time.time()
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


async def _revoke(link: CmDriveLink) -> None:
    if link.refresh_token_enc:
        try:
            async with gd._client() as c:
                await c.post(REVOKE_URL, data={"token": decrypt_secret(link.refresh_token_enc)})
        except httpx.HTTPError:
            logger.info("cm : révocation Google Drive injoignable (jeton supprimé quand même)")
    _user_tokens.pop(link.id, None)


async def disconnect(db: AsyncSession, link: CmDriveLink) -> None:
    """« Déconnecter Google Drive » : autorisation révoquée chez Google, jeton supprimé de la base.
    Les fichiers déjà archivés restent dans le Drive de l'utilisateur."""
    await _revoke(link)
    await db.delete(link)
    await db.commit()


def link_out(link: Optional[CmDriveLink]) -> dict:
    return {
        "oauth_enabled": oauth_enabled(), "connected": link is not None,
        "email": link.email if link else None, "error": link.error if link else None,
        "folder_url": f"https://drive.google.com/drive/folders/{link.root_folder_id}" if link and link.root_folder_id else None,
        "folder_name": "Dossier d'archives",
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
        partie = str(conte.get("partie") or "").strip() or rid    # toujours une entrée de « parties »
        titre = clean_name(conte.get("titre") or post.title)
        stem = (f"{titre} — version longue" if partie == "longue"
                else f"{titre} — partie {partie}" if partie.isdigit() else titre)
        return [dossier], stem, partie
    live = [t for t in targets if t.status != T_CANCELLED] or targets
    when = _local(min((t.scheduled_at for t in live), default=post.created_at))
    titre = clean_name(post.title)
    return [when.strftime("%Y-%m"), f"{when.strftime('%Y-%m-%d %Hh%M')} — {titre}"], titre, None


class _Dest:
    """Où et comment écrire. `via` :
    - robot  : le robot dépose tout lui-même dans le dossier du compte (Drive partagé) ;
    - mixte  : dossier du compte relié à cm (le robot y est Éditeur) mais le robot ne peut pas déposer de fichier :
               le robot crée les dossiers, les fichiers sont déposés avec la connexion Drive de l'utilisateur dans
               un dossier d'envoi, puis le robot les range à leur place ;
    - oauth  : pas de dossier du compte : tout dans le dossier d'archives créé par cm (<racine>/<compte>/…)."""
    def __init__(self, via, base, prefix, user=None, robot=None, staging_parent=None):
        self.via, self.base, self.prefix = via, base, prefix
        self.user, self.robot, self.staging_parent = user, robot, staging_parent

    @property
    def folders(self) -> str:          # jeton qui crée et voit les dossiers
        return self.robot if self.via in ("robot", "mixte") else self.user

    @property
    def files(self) -> str:            # jeton qui crée les fichiers
        return self.robot if self.via == "robot" else self.user


async def _destination(db: AsyncSession, post: CmPost) -> Optional[_Dest]:
    """None si l'espace n'a aucun Drive où écrire."""
    compte, _ = _split_ref(post.ref)
    srcs = (await db.execute(select(CmSource).where(_tenant_cond(CmSource, post.organization_id, post.owner_user_id),
                                                    CmSource.revoked_at.is_(None)))).scalars().all()
    # Seulement un dossier vérifié (partagé par l'espace lui-même) : jamais celui d'un tiers relié par son lien.
    src = next((s for s in srcs if (s.name or "").strip().lower() == compte.lower() and s.role == "writer"
                and s.verified), None)
    if src is not None and src.can_upload is True:
        return _Dest("robot", src.folder_id, [], robot=await gd.access_token())
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
    if src is not None and gd.is_enabled():
        # Jamais de changement de partage sur la racine : il se propagerait à des dossiers créés par une autre
        # application (rclone…), ce que le droit drive.file interdit. Le robot n'est Éditeur que du dossier
        # d'envoi, qui ne contient que des fichiers créés par cm (voir sync_post).
        return _Dest("mixte", src.folder_id, [], user=token, robot=await gd.access_token(),
                     staging_parent=link.root_folder_id)
    return _Dest("oauth", link.root_folder_id, [clean_name(compte)], user=token)


STAGING = "envoi en cours (cm)"


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:16]


async def sync_post(db: AsyncSession, post: CmPost, now=None) -> None:
    """Archive (ou met à jour) une publication. `now` : heure de la réservation (sync_due) ; un changement de
    cible arrivé pendant l'envoi est donc repris au passage suivant."""
    targets = (await db.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars().all()
    a = dict(post.archive or {})
    now = now or utcnow()
    if not a.get("folder_id") and (post.status == POST_CANCELLED or all(t.status == T_CANCELLED for t in targets)):
        post.archive_state = None      # annulée avant d'être archivée : rien à ranger
        await db.commit()
        return
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
    via, base = dest.via, dest.base
    if a.get("base") and a["base"] != base and a.get("video_id") and not post.media_path:
        # Nouvelle destination, mais la vidéo n'est plus sur le serveur : l'archive reste où elle est.
        post.archive_synced_at = now
        await db.commit()
        return
    if a.get("base") != base:          # nouvelle destination : tout est réécrit là-bas
        a = {"conte": a.get("conte"), "base": base, "via": via}

    async def new_file(name: str, data: Optional[bytes] = None, path: Optional[str] = None, mime: str = "") -> str:
        """Fichier créé à sa place (robot, oauth) ou dans le dossier d'envoi puis rangé par le robot (mixte)."""
        parent = folder
        if via == "mixte":
            if not a.get("staging"):
                a["staging"] = await gd.ensure_folder(dest.user, dest.staging_parent, STAGING)
            if not a.get("staging_shared") and gd.robot_email():
                # Le robot range ensuite les fichiers : Éditeur de ce seul dossier (que des fichiers de cm).
                await gd.share_with(dest.user, a["staging"], gd.robot_email(), "writer")
                a["staging_shared"] = True
            parent = a["staging"]
        fid = (await gd.put_file(dest.files, parent, name, path, mime) if path
               else await gd.put_bytes(dest.files, parent, name, data, mime))
        if via == "mixte":
            await gd.move(fid, folder, parent)
        return fid

    async def write(key: str, name: str, data: bytes, mime: str) -> None:
        if not a.get(f"{key}_id"):     # même nom déjà là : remplacé, pas doublé
            found = await gd.find_child(dest.folders, folder, name, False)
            if found:
                a[f"{key}_id"], a[f"{key}_by"] = found, ("robot" if via == "mixte" else None)
        fid = a.get(f"{key}_id")
        if fid:                        # remplacer le contenu (fichier créé par cm, ou existant lu par le robot)
            tok = dest.robot if a.get(f"{key}_by") == "robot" else dest.files
            await gd.put_bytes(tok, folder, name, data, mime, fid)
        else:
            a[f"{key}_id"] = await new_file(name, data=data, mime=mime)

    try:
        names, stem, partie = _layout(post, targets)
        if not a.get("folder_id"):
            a["folder_id"] = await gd.ensure_path(dest.folders, base, dest.prefix + names)
        folder = a["folder_id"]
        ext = "mov" if post.mime_type == "video/quicktime" else "mp4"
        if not a.get("video_id"):      # déjà rangée là (par le PC, ou un essai précédent) : pas de doublon
            a["video_id"] = await gd.find_child(dest.folders, folder, f"{stem}.{ext}", False)
        if not a.get("video_id") and post.media_path:
            a["video_id"] = await new_file(f"{stem}.{ext}", path=post.media_path, mime=post.mime_type or "video/mp4")
        cap = (post.caption or "").encode()
        if a.get("caption_sha") != _sha(cap):
            await write("caption", f"{stem}.txt", cap, "text/plain; charset=utf-8")
            a["caption_sha"] = _sha(cap)
        if not a.get("cover_id") and post.cover_path:
            try:
                with open(post.cover_path, "rb") as f:
                    img = f.read()
                ext = "png" if post.cover_path.endswith(".png") else "jpg"
                cover = "couverture" if partie is None else f"couverture — partie {partie}"
                a["cover_id"] = await new_file(f"{cover}.{ext}", data=img, mime="image/png" if ext == "png" else "image/jpeg")
            except OSError:
                pass
        mine = entry(post, targets)
        if not a.get("infos_id"):
            # infos.json déjà là (autre partie du conte, ou rangé par le PC) : lu et réécrit, jamais en double.
            found = await gd.find_child(dest.folders, folder, INFOS_NAME, False)
            if found:
                a["infos_id"], a["infos_by"] = found, ("robot" if via == "mixte" else None)
        if partie is None:
            infos = mine
        else:
            tok = dest.robot if a.get("infos_by") == "robot" else dest.files
            try:
                infos = json.loads(await gd.get_bytes(tok, a["infos_id"])) if a.get("infos_id") else {}
            except (gd.DriveError, ValueError):
                infos = {}
            infos = infos if isinstance(infos, dict) else {}
            conte = a.get("conte") or {}
            compte, rid = _split_ref(post.ref)
            parts = infos.get("parties") if isinstance(infos.get("parties"), dict) else {}
            parts[partie] = {k: mine[k] for k in ("statut", "heure", "publie_le", "plateformes")} | {"id": rid, "titre": post.title}
            infos = {**infos, "compte": compte, "id": conte.get("id") or infos.get("id") or rid,
                     "titre": conte.get("titre") or infos.get("titre") or post.title, "parties": parts}
        raw = json.dumps(infos, ensure_ascii=False, indent=2).encode()
        if a.get("infos_sha") != _sha(raw) or not a.get("infos_id"):
            await write("infos", INFOS_NAME, raw, "application/json")
            a["infos_sha"] = _sha(raw)
        a.pop("error", None)
        if a.get("video_id"):
            post.archive_state = "ok"
        elif post.media_path:
            post.archive_state = "pending"
        else:
            post.archive_state, a["error"] = "error", ("La vidéo n'est plus sur le serveur : renvoyez-la "
                                                       "(PUT /posts/{id}/video) pour l'archiver.")
    except (httpx.HTTPError, OSError) as e:      # réseau coupé, vidéo effacée pendant l'envoi : réessayé plus tard
        a["error"] = "Google Drive injoignable pendant l'archivage : nouvel essai dans 30 min."
        post.archive_state = "error"
        logger.info("cm : archivage de la publication %s interrompu (%s)", post.id, type(e).__name__)
    except gd.DriveError as e:
        if e.code == "no_space" and via == "robot":
            await db.execute(update(CmSource).where(CmSource.folder_id == base).values(can_upload=False))
        a["error"] = e.describe()
        post.archive_state = "error"
        logger.info("cm : archivage de la publication %s en échec (%s)", post.id, e.code)
    post.archive, post.archive_synced_at = a, now
    await db.commit()


async def sync_due(db: AsyncSession) -> None:
    """Publications à archiver (nouvelles, en échec depuis 30 min) ou dont une cible a changé depuis.
    Chaque publication est d'abord réservée (archive_synced_at avancé) : deux passages simultanés n'envoient
    jamais deux fois la même vidéo."""
    now = utcnow()
    changed = exists().where(CmTarget.post_id == CmPost.id, CmTarget.updated_at > CmPost.archive_synced_at)
    rows = (await db.execute(select(CmPost.id, CmPost.archive_synced_at).where(
        CmPost.ref.is_not(None), CmPost.status != POST_RECEIVING,
        or_((CmPost.archive_state.in_(("pending", "error"))
             & (CmPost.archive_synced_at.is_(None) | (CmPost.archive_synced_at < now - RETRY_AFTER))),
            (CmPost.archive_state == "ok") & changed),
    ).order_by(CmPost.archive_synced_at.is_not(None), CmPost.id)     # jamais essayées d'abord
     .limit(SYNC_BATCH))).all()
    for post_id, seen in rows:
        same = CmPost.archive_synced_at.is_(None) if seen is None else CmPost.archive_synced_at == seen
        claimed = await db.execute(update(CmPost).where(CmPost.id == post_id, same).values(archive_synced_at=now))
        await db.commit()
        if claimed.rowcount != 1:
            continue
        post = await db.get(CmPost, post_id)
        await db.refresh(post)
        try:
            # Un envoi qui traîne ne bloque pas les suivants (repris au passage d'après).
            await asyncio.wait_for(sync_post(db, post, now), POST_TIMEOUT.total_seconds())
        except Exception as e:
            logger.exception("cm : archivage de la publication %s en échec", post_id)
            await db.rollback()
            await _record_failure(db, post_id, now, e)
    # Dossiers d'archives pas encore reliés à la bibliothèque (partage pas encore visible au 1er essai).
    for link in (await db.execute(select(CmDriveLink).where(CmDriveLink.revoked_at.is_(None),
                                                            CmDriveLink.source_id.is_(None)).limit(3))).scalars():
        await _ensure_source(db, link)


async def _record_failure(db: AsyncSession, post_id: int, now, e: Exception) -> None:
    """Erreur inattendue : notée sur la publication (visible dans archive.error), reprise 30 min plus tard."""
    what = "envoi trop long" if isinstance(e, asyncio.TimeoutError) else f"{type(e).__name__}: {str(e)[:200]}"
    try:
        post = await db.get(CmPost, post_id)
        await db.refresh(post)
        post.archive_state, post.archive_synced_at = "error", now
        post.archive = {**(post.archive or {}), "error": f"Erreur pendant l'archivage ({what}) : nouvel essai dans 30 min."}
        await db.commit()
    except Exception:
        await db.rollback()


def retry_now(post: CmPost) -> None:
    """Relance tout de suite (route archive/retry) : reprise au prochain passage, dans la minute."""
    post.archive_state, post.archive_synced_at = "pending", None
    post.archive = {k: v for k, v in (post.archive or {}).items() if k != "error"}


_running: Optional[asyncio.Task] = None


async def launch_due(db: AsyncSession) -> None:
    """Étape de la tâche planifiée : l'archivage (envois de vidéos, parfois longs) tourne à part, pour ne pas
    retarder les publications ; un seul passage à la fois dans ce processus."""
    global _running
    if _running is not None and not _running.done():
        return

    async def run():
        async with AsyncSessionLocal() as session:
            await sync_due(session)
            await probe_sources(session)

    _running = asyncio.create_task(run())
    _running.add_done_callback(lambda t: t.cancelled() or t.exception() is None
                               or logger.error("cm : archivage en échec : %r", t.exception()))


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
    a = post.archive or {}
    if post.archive_state not in ("pending", "error") or a.get("video_id"):
        return False
    since = post.created_at
    if a.get("kept_since"):                    # vidéo renvoyée plus tard (PUT /posts/{id}/video)
        since = max(since, datetime.fromisoformat(a["kept_since"].rstrip("Z")))
    return utcnow() - since < KEEP_UNARCHIVED_MEDIA


def archive_out(post: CmPost) -> Optional[dict]:
    if not post.archive_state:
        return None
    a = post.archive or {}
    return {"state": post.archive_state, "error": a.get("error"), "via": a.get("via"),
            "last_try": (post.archive_synced_at.isoformat() + "Z") if post.archive_synced_at else None,
            "folder_url": f"https://drive.google.com/drive/folders/{a['folder_id']}" if a.get("folder_id") else None,
            "video_id": a.get("video_id")}
