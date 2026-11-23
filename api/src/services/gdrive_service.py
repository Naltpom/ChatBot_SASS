"""Client Google Drive du « robot » de Chapote CM (compte de service Google).

Le robot n'a accès à RIEN par défaut : il voit seulement les dossiers que les utilisateurs
lui partagent (comme à un collaborateur), avec le rôle choisi (Lecteur ou Éditeur). Aucune
autorisation OAuth utilisateur, donc aucun accès au reste de leur Drive.

- Jeton : JWT signé RS256 avec la clé du compte de service, échangé sur
  oauth2.googleapis.com/token (grant jwt-bearer), valable 1 h, gardé en mémoire.
- API Drive v3 : files.get, files.list (q « '<dossier>' in parents »), alt=media,
  supportsAllDrives / includeItemsFromAllDrives (Drives partagés Workspace).
- Un compte de service n'a pas d'espace de stockage : il lit tout ce qu'on lui partage, mais
  ne peut CRÉER de fichier que dans un Drive partagé. Déplacer un fichier existant (rangement
  dans « Publié ») demande le rôle Éditeur.

Aucun jeton ni lien de téléchargement n'est loggé.
"""
import asyncio
import base64
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Optional

import httpx
from jose import jwt

from src.core.config import settings

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/drive"
FOLDER_MIME = "application/vnd.google-apps.folder"
PROJECT_MIME = "application/vnd.google-apps.project"   # « projet » Drive : ne contient pas de fichiers
FILE_FIELDS = ("id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,trashed,"
               "thumbnailLink,videoMediaMetadata(width,height,durationMillis)")
FOLDER_FIELDS = "id,name,mimeType,driveId,trashed,capabilities(canEdit,canAddChildren,canListChildren),owners(emailAddress),sharingUser(emailAddress)"
MAX_FILES = 3000
MAX_DEPTH = 3
PUBLISHED_FOLDER = "Publié"

_transport: Optional[httpx.AsyncBaseTransport] = None
_token: dict[str, Any] = {}
_lock = asyncio.Lock()


class DriveError(Exception):
    def __init__(self, code: str, message: str = "", http_status: int = 0):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status

    def describe(self) -> str:
        return {
            "not_shared": "Le robot n'a pas accès à ce dossier : partagez-le avec son adresse (Lecteur suffit), puis réessayez.",
            "not_folder": "Ce lien n'est pas celui d'un dossier Google Drive.",
            "is_project": ("Ce lien est celui d'un « projet » Google Drive, qui ne peut pas contenir de fichiers. "
                           "Créez plutôt un dossier (Nouveau → Nouveau dossier), mettez-y les vidéos, partagez-le "
                           "avec le robot, puis copiez l'adresse du dossier ouvert (…/drive/folders/…)."),
            "bad_link": "Lien de dossier Google Drive non reconnu : copiez l'adresse du dossier ouvert dans Google Drive.",
            "trashed": "Ce dossier est dans la corbeille de Google Drive.",
            "rate_limited": "Google Drive limite les requêtes pour le moment : réessayez dans quelques minutes.",
            "disabled": "La bibliothèque Google Drive n'est pas encore configurée sur Chapote.",
            "no_space": "Le robot ne peut pas créer de fichier dans un dossier de « Mon Drive » (pas d'espace de stockage).",
        }.get(self.code, f"Erreur Google Drive ({self.code}){' : ' + self.message if self.message else ''}")


# --------------------------------------------------------------------------
# Clé et jeton du compte de service
# --------------------------------------------------------------------------

def _key() -> Optional[dict]:
    raw = settings.GDRIVE_SA_KEY_B64
    if not raw:
        return None
    try:
        data = json.loads(base64.b64decode(raw.strip()))
    except (ValueError, TypeError):
        logger.error("Drive : GDRIVE_SA_KEY_B64 illisible (base64 d'un JSON de compte de service attendu)")
        return None
    if data.get("type") != "service_account" or not data.get("client_email") or not data.get("private_key"):
        logger.error("Drive : GDRIVE_SA_KEY_B64 n'est pas une clé de compte de service")
        return None
    return data


def is_enabled() -> bool:
    return _key() is not None


def robot_email() -> Optional[str]:
    k = _key()
    return k["client_email"] if k else None


def _client(**kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=kw.pop("timeout", 30), transport=_transport, follow_redirects=True, **kw)


async def access_token() -> str:
    key = _key()
    if key is None:
        raise DriveError("disabled")
    async with _lock:
        if _token.get("value") and _token.get("exp", 0) - 120 > time.time() and _token.get("email") == key["client_email"]:
            return _token["value"]
        now = int(time.time())
        assertion = jwt.encode({
            "iss": key["client_email"], "scope": SCOPE, "aud": settings.GDRIVE_TOKEN_URL,
            "iat": now, "exp": now + 3600,
        }, key["private_key"], algorithm="RS256", headers={"kid": key.get("private_key_id")} if key.get("private_key_id") else None)
        async with _client() as c:
            resp = await c.post(settings.GDRIVE_TOKEN_URL, data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
        body = _json(resp)
        if resp.status_code >= 400 or not body.get("access_token"):
            logger.error("Drive : jeton du compte de service refusé (HTTP %s, %s)", resp.status_code, body.get("error"))
            raise DriveError("auth_failed", body.get("error_description") or body.get("error") or "", resp.status_code)
        _token.update(value=body["access_token"], exp=now + int(body.get("expires_in") or 3600), email=key["client_email"])
        return _token["value"]


def reset_token() -> None:
    _token.clear()


# --------------------------------------------------------------------------
# Appels
# --------------------------------------------------------------------------

def _json(resp: httpx.Response) -> dict:
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _error(resp: httpx.Response) -> DriveError:
    body = _json(resp)
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    reasons = [e.get("reason") for e in (err.get("errors") or []) if isinstance(e, dict)]
    if resp.status_code == 404:
        return DriveError("not_shared", "", 404)
    if resp.status_code == 429 or "rateLimitExceeded" in reasons or "userRateLimitExceeded" in reasons:
        return DriveError("rate_limited", "", resp.status_code)
    if "storageQuotaExceeded" in reasons:
        return DriveError("no_space", "", resp.status_code)
    return DriveError(reasons[0] if reasons else f"http_{resp.status_code}", err.get("message") or "", resp.status_code)


async def _api(method: str, path: str, *, params: Optional[dict] = None, json_body: Any = None) -> dict:
    token = await access_token()
    params = {"supportsAllDrives": "true", **(params or {})}
    async with _client() as c:
        resp = await c.request(method, f"{settings.GDRIVE_API_BASE}/drive/v3{path}", params=params, json=json_body,
                               headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 401:
        reset_token()
    if resp.status_code >= 400:
        raise _error(resp)
    return _json(resp)


def folder_id_from_link(link: str) -> str:
    """Identifiant d'un dossier à partir de son lien (ou l'identifiant lui-même)."""
    link = (link or "").strip()
    if re.search(r"/drive/(?:u/\d+/)?project/", link):
        raise DriveError("is_project")
    for pattern in (r"/folders/([A-Za-z0-9_-]{10,})", r"[?&]id=([A-Za-z0-9_-]{10,})"):
        m = re.search(pattern, link)
        if m:
            return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,200}", link):
        return link
    raise DriveError("bad_link")


async def get_folder(folder_id: str) -> dict:
    meta = await _api("GET", f"/files/{folder_id}", params={"fields": FOLDER_FIELDS})
    if meta.get("mimeType") == PROJECT_MIME:
        raise DriveError("is_project")
    if meta.get("mimeType") != FOLDER_MIME:
        raise DriveError("not_folder")
    if meta.get("trashed"):
        raise DriveError("trashed")
    return meta


async def list_children(folder_id: str) -> list[dict]:
    out: list[dict] = []
    page = None
    while True:
        params = {"q": f"'{folder_id}' in parents and trashed = false", "fields": f"nextPageToken,files({FILE_FIELDS})",
                  "pageSize": "1000", "includeItemsFromAllDrives": "true", "orderBy": "createdTime desc"}
        if page:
            params["pageToken"] = page
        body = await _api("GET", "/files", params=params)
        out.extend(f for f in body.get("files") or [] if isinstance(f, dict))
        page = body.get("nextPageToken")
        if not page or len(out) >= MAX_FILES:
            return out


async def shared_folders(limit: int = 200) -> list[dict]:
    """Dossiers partagés avec le robot (les plus récents d'abord), avec qui les a partagés."""
    body = await _api("GET", "/files", params={
        "q": f"sharedWithMe = true and mimeType = '{FOLDER_MIME}' and trashed = false",
        "fields": "files(id,name,driveId,owners(emailAddress),sharingUser(emailAddress),capabilities(canEdit))",
        "pageSize": str(limit), "orderBy": "sharedWithMeTime desc", "includeItemsFromAllDrives": "true",
    })
    return [f for f in body.get("files") or [] if isinstance(f, dict)]


async def walk(folder_id: str) -> list[tuple[str, dict]]:
    """(chemin du sous-dossier, fichier) de tout le dossier, sous-dossiers compris (3 niveaux)."""
    out: list[tuple[str, dict]] = []
    todo = [(folder_id, "", 0)]
    while todo and len(out) < MAX_FILES:
        fid, path, depth = todo.pop(0)
        for f in await list_children(fid):
            if f.get("mimeType") == FOLDER_MIME:
                if depth + 1 < MAX_DEPTH:
                    todo.append((f["id"], f"{path}/{f['name']}" if path else f["name"], depth + 1))
            else:
                out.append((path, f))
    return out


async def download(file_id: str, dest: str, max_bytes: int) -> int:
    """Télécharge le fichier vers `dest` (flux). Lève DriveError si trop gros ou refusé."""
    token = await access_token()
    total = 0
    async with _client(timeout=httpx.Timeout(30, read=300)) as c:
        async with c.stream("GET", f"{settings.GDRIVE_API_BASE}/drive/v3/files/{file_id}",
                            params={"alt": "media", "supportsAllDrives": "true", "acknowledgeAbuse": "true"},
                            headers={"Authorization": f"Bearer {token}"}) as resp:
            if resp.status_code >= 400:
                await resp.aread()
                raise _error(resp)
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(1024 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise DriveError("too_large", "fichier trop volumineux")
                    f.write(chunk)
    return total


async def read_text(file_id: str, max_bytes: int = 20000) -> str:
    token = await access_token()
    async with _client() as c:
        resp = await c.get(f"{settings.GDRIVE_API_BASE}/drive/v3/files/{file_id}",
                           params={"alt": "media", "supportsAllDrives": "true"},
                           headers={"Authorization": f"Bearer {token}"})
    if resp.status_code >= 400:
        raise _error(resp)
    data = resp.content[:max_bytes]
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc).strip()
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace").strip()


async def thumbnail(link: str) -> tuple[bytes, str]:
    token = await access_token()
    async with _client() as c:
        resp = await c.get(link, headers={"Authorization": f"Bearer {token}"})
    if resp.status_code >= 400:
        raise DriveError(f"http_{resp.status_code}", "", resp.status_code)
    return resp.content[:2_000_000], resp.headers.get("content-type", "image/jpeg")


async def ensure_published_folder(parent_id: str, existing: Optional[str]) -> str:
    """Sous-dossier « Publié » du dossier relié (créé au besoin : rôle Éditeur requis)."""
    if existing:
        try:
            meta = await _api("GET", f"/files/{existing}", params={"fields": "id,trashed"})
            if not meta.get("trashed"):
                return existing
        except DriveError:
            pass
    for f in await list_children(parent_id):
        if f.get("mimeType") == FOLDER_MIME and f.get("name") == PUBLISHED_FOLDER:
            return f["id"]
    created = await _api("POST", "/files", params={"fields": "id"},
                         json_body={"name": PUBLISHED_FOLDER, "mimeType": FOLDER_MIME, "parents": [parent_id]})
    return created["id"]


async def move(file_id: str, add_parent: str, remove_parent: Optional[str]) -> None:
    params = {"addParents": add_parent, "fields": "id,parents"}
    if remove_parent:
        params["removeParents"] = remove_parent
    await _api("PATCH", f"/files/{file_id}", params=params, json_body={})


def parse_time(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None
