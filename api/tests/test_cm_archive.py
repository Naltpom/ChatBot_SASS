"""cm.chapote.fr : archivage des publications de l'outil (ref « compte/id ») dans le Drive de l'espace,
infos.json tenu à jour, contes (parties), essai d'écriture du robot, relecture pour une nouvelle tentative,
recherche des publications par référence, connexion Google Drive (drive.file)."""
import base64
import json
from datetime import timedelta
from urllib.parse import parse_qs

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmDriveLink, CmPost, CmSource, CmTarget
from src.services import cm_archive
from src.services import cm_jobs
from src.services import gdrive_service as gd
from src.services.crypto import encrypt_secret

from test_cm import _ig_routine, _send, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)

ROBOT = "robot@cm-test.iam.gserviceaccount.com"
FOLDER_MIME = gd.FOLDER_MIME


class WriteDrive:
    """Faux Drive qui accepte l'écriture. Le robot (compte de service) peut créer des dossiers mais pas
    de fichiers, sauf `robot_quota = True` (Drive partagé)."""

    def __init__(self):
        self.items: dict[str, dict] = {"root": {"name": "Mon Drive", "parent": None, "folder": True}}
        self.n = 0
        self.robot_quota = False
        self.perms: list[dict] = []
        self.pending: dict[str, dict] = {}
        self.grant_ok = True
        self.fail_uploads = 0
        self.moves: list[str] = []
        self.refreshes = 0
        self.revoked: list[str] = []

    def _id(self):
        self.n += 1
        return f"drivefile{self.n:06d}"

    def tree(self, fid="root", prefix=""):
        out = []
        for k, v in self.items.items():
            if v.get("parent") == fid:
                p = f"{prefix}{v['name']}"
                out.append(p + ("/" if v.get("folder") else ""))
                if v.get("folder"):
                    out += self.tree(k, p + "/")
        return out

    def find(self, path):
        fid = "root"
        for name in path.split("/"):
            fid = next(k for k, v in self.items.items() if v.get("parent") == fid and v["name"] == name)
        return fid

    def json_at(self, path):
        return json.loads(self.items[self.find(path)]["content"])

    def _new_file(self, token, meta, content):
        if token == "ya29.robot" and not self.robot_quota:
            return httpx.Response(403, json={"error": {"code": 403, "message": "Service Accounts do not have storage quota.",
                                                       "errors": [{"reason": "storageQuotaExceeded"}]}})
        fid = self._id()
        self.items[fid] = {"name": meta["name"], "parent": meta["parents"][0], "content": content, "by": token}
        return httpx.Response(200, json={"id": fid})

    async def handler(self, req: httpx.Request) -> httpx.Response:
        body = await req.aread()
        if req.url.host == "oauth2.googleapis.com":
            if req.url.path == "/revoke":
                self.revoked.append(parse_qs(body.decode())["token"][0])
                return httpx.Response(200)
            form = parse_qs(body.decode())
            g = form["grant_type"][0]
            if g.endswith("jwt-bearer"):
                return httpx.Response(200, json={"access_token": "ya29.robot", "expires_in": 3600})
            if g == "refresh_token" and not self.grant_ok:
                return httpx.Response(400, json={"error": "invalid_grant"})
            if g == "authorization_code" and form["code"][0] == "bad":
                return httpx.Response(400, json={"error": "invalid_grant"})
            if g == "refresh_token":
                self.refreshes += 1
            if g == "authorization_code":
                return httpx.Response(200, json={"access_token": "ya29.user", "refresh_token": "1//refresh",
                                                 "expires_in": 3600, "scope": cm_archive.OAUTH_SCOPE})
            return httpx.Response(200, json={"access_token": "ya29.user", "expires_in": 3600})
        token = (req.headers.get("authorization") or "").removeprefix("Bearer ")
        path, p = req.url.path, req.url.params
        if path == "/drive/v3/about":
            return httpx.Response(200, json={"user": {"emailAddress": "nathan@gmail.test"}})
        if path == "/drive/v3/files" and req.method == "GET":
            q = p["q"]
            parent = q.split("'")[1]
            name = q.split("name = '")[1].split("' and")[0].replace("\\'", "'")
            folder = "mimeType = '" in q
            hits = [{"id": k} for k, v in self.items.items()
                    if v.get("parent") == parent and v["name"] == name and bool(v.get("folder")) == folder]
            return httpx.Response(200, json={"files": hits[:1]})
        if path == "/drive/v3/files" and req.method == "POST":
            meta = json.loads(body)
            fid = self._id()
            self.items[fid] = {"name": meta["name"], "parent": meta["parents"][0], "folder": True}
            return httpx.Response(200, json={"id": fid})
        if path == "/upload/drive/v3/files" and p.get("uploadType") == "multipart":
            boundary = req.headers["content-type"].split("boundary=")[1].encode()
            parts = body.split(b"--" + boundary)
            meta = json.loads(parts[1].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0])
            content = parts[2].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
            return self._new_file(token, meta, content)
        if path == "/upload/drive/v3/files" and p.get("uploadType") == "resumable":
            if token == "ya29.robot" and not self.robot_quota:
                return self._new_file(token, json.loads(body), b"")
            sid = self._id()
            self.pending[sid] = {"meta": json.loads(body), "token": token}
            return httpx.Response(200, headers={"location": f"https://www.googleapis.com/upload/session/{sid}"})
        if path.startswith("/upload/session/"):
            if self.fail_uploads:
                self.fail_uploads -= 1
                raise httpx.ConnectError("réseau coupé")
            job = self.pending.pop(path.rsplit("/", 1)[1])
            return self._new_file(job["token"], job["meta"], body)
        if path.startswith("/upload/drive/v3/files/") and req.method == "PATCH":
            self.items[path.rsplit("/", 1)[1]]["content"] = body
            return httpx.Response(200, json={"id": path.rsplit("/", 1)[1]})
        if req.method == "PATCH" and path.startswith("/drive/v3/files/"):
            fid = path.rsplit("/", 1)[1]
            assert token == "ya29.robot", "seul le robot range les fichiers"
            self.items[fid]["parent"] = p["addParents"]
            self.moves.append(fid)
            return httpx.Response(200, json={"id": fid})
        if path.endswith("/permissions"):
            self.perms.append({"file": path.split("/")[-2], **json.loads(body)})
            return httpx.Response(200, json={"id": "perm1"})
        fid = path.rsplit("/", 1)[1]
        if fid not in self.items:
            return httpx.Response(404, json={"error": {"code": 404, "message": "File not found"}})
        if req.method == "DELETE":
            self.items.pop(fid)
            return httpx.Response(204)
        if p.get("alt") == "media":
            return httpx.Response(200, content=self.items[fid]["content"])
        v = self.items[fid]
        return httpx.Response(200, json={"id": fid, "name": v["name"], "mimeType": FOLDER_MIME if v.get("folder") else "video/mp4",
                                         "trashed": False, "capabilities": {"canEdit": False}, "owners": [{"emailAddress": "nathan@gmail.test"}]})


@pytest.fixture
def wdrive(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    sa = {"type": "service_account", "client_email": ROBOT, "private_key": pem, "private_key_id": "k1"}
    monkeypatch.setattr(settings, "GDRIVE_SA_KEY_B64", base64.b64encode(json.dumps(sa).encode()).decode())
    monkeypatch.setattr(settings, "GDRIVE_OAUTH_CLIENT_ID", "drive-client")
    monkeypatch.setattr(settings, "GDRIVE_OAUTH_CLIENT_SECRET", "drive-secret")
    fake = WriteDrive()
    monkeypatch.setattr(gd, "_transport", httpx.MockTransport(fake.handler))
    gd.reset_token()
    cm_archive._user_tokens.clear()
    cm_archive._probed.clear()
    yield fake
    gd.reset_token()
    cm_archive._user_tokens.clear()


async def _linked(db, u, fake):
    root = fake._id()
    fake.items[root] = {"name": settings.GDRIVE_ARCHIVE_ROOT_NAME, "parent": "root", "folder": True}
    link = CmDriveLink(owner_user_id=u.id, refresh_token_enc=encrypt_secret("1//refresh"), root_folder_id=root,
                       email="nathan@gmail.test")
    db.add(link)
    await db.commit()
    return link


async def _post(h, ig, data, ref, title="Clair de lune", when=None, **extra):
    r = await h.post("/api/cm/posts", json={
        "title": title, "caption": "Debussy au piano #piano", "file_name": "a.mp4", "video_size": len(data), "ref": ref,
        "targets": [{"platform": "instagram", "account_id": ig.id, "options": {},
                     "scheduled_at": when or "2026-12-02T17:30:00Z"}], **extra})
    assert r.status_code == 200, r.text
    pid = r.json()["post_id"]
    await _send(h, pid, data)
    assert (await h.post(f"/api/cm/posts/{pid}/submit")).status_code == 200
    return pid


def test_statut_mapping():
    def t(s):
        return CmTarget(status=s)
    assert cm_archive.post_statut([t("SCHEDULED"), t("PUBLISHED")]) == "prete"
    assert cm_archive.post_statut([t("PUBLISHED"), t("CANCELLED")]) == "publiee"
    assert cm_archive.post_statut([t("FAILED"), t("PUBLISHED")]) == "ratee"
    assert cm_archive.post_statut([t("CANCELLED")]) == "annulee"
    assert cm_archive.clean_name("A/B: c?") == "A B c"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_archive_in_connected_drive_and_infos_follow_status(pg_session, cmenv, wdrive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _post(h, ig, data, "kiwi/k1", title="Le phare : épisode 2")
        post = await pg_session.get(CmPost, pid)
        assert post.archive_state == "pending" and cm_archive.keep_media(post)
        await cm_archive.sync_due(pg_session)
        base = f"{settings.GDRIVE_ARCHIVE_ROOT_NAME}/kiwi/2026-12/2026-12-02 18h30 — Le phare épisode 2"
        tree = wdrive.tree()
        for f in ("Le phare épisode 2.mp4", "Le phare épisode 2.txt", "infos.json"):
            assert f"{base}/{f}" in tree, tree
        assert wdrive.items[wdrive.find(f"{base}/Le phare épisode 2.mp4")]["content"] == data
        infos = wdrive.json_at(f"{base}/infos.json")
        assert infos["compte"] == "kiwi" and infos["id"] == "k1" and infos["statut"] == "prete"
        assert infos["heure"].startswith("2026-12-02T18:30") and infos["plateformes"]["instagram"]["statut"] == "prete"
        await pg_session.refresh(post)
        assert post.archive_state == "ok" and not cm_archive.keep_media(post)
        out = (await h.get(f"/api/cm/posts/{pid}")).json()["archive"]
        assert out["state"] == "ok" and out["folder_url"].startswith("https://drive.google.com/drive/folders/")
        # Publication : infos.json réécrit avec le lien.
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        t.status, t.url, t.published_at = "PUBLISHED", "https://www.instagram.com/reel/XYZ/", utcnow()
        t.updated_at = utcnow() + timedelta(seconds=5)
        await pg_session.commit()
        await cm_archive.sync_due(pg_session)
        infos = wdrive.json_at(f"{base}/infos.json")
        assert infos["statut"] == "publiee" and infos["plateformes"]["instagram"]["url"] == "https://www.instagram.com/reel/XYZ/"
        assert [x for x in wdrive.tree() if x.endswith("infos.json")] == [f"{base}/infos.json"]
        # Toutes les cibles terminées et vidéo archivée : le ménage peut effacer le fichier du serveur.
        await cm_jobs.cleanup(pg_session)
        await pg_session.refresh(post)
        assert post.media_path is None
        # Nouvelle tentative : la vidéo est relue depuis l'archive.
        t.status = "FAILED"
        await pg_session.commit()
        r = await h.post(f"/api/cm/targets/{t.id}/retry")
        assert r.status_code == 200, r.text
        v = await h.get(f"/api/cm/posts/{pid}/video")
        assert v.status_code == 200 and v.content == data


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_contes_parts_share_one_infos(pg_session, cmenv, wdrive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        conte = {"dossier": "KHM-040 — Le Voleur", "id": "khm-040", "titre": "Le Voleur"}
        await _post(h, ig, data, "contes/khm-040-p1", archive={**conte, "partie": "1"})
        await _post(h, ig, data, "contes/khm-040-p2", archive={**conte, "partie": "2"}, when="2026-12-03T11:30:00Z")
        await cm_archive.sync_due(pg_session)
        base = f"{settings.GDRIVE_ARCHIVE_ROOT_NAME}/contes/KHM-040 — Le Voleur"
        tree = wdrive.tree()
        assert f"{base}/Le Voleur — partie 1.mp4" in tree and f"{base}/Le Voleur — partie 2.mp4" in tree
        infos = wdrive.json_at(f"{base}/infos.json")
        assert infos["compte"] == "contes" and infos["id"] == "khm-040" and set(infos["parties"]) == {"1", "2"}
        assert infos["parties"]["2"]["id"] == "khm-040-p2" and infos["parties"]["2"]["statut"] == "prete"
        assert len([x for x in tree if x.endswith("infos.json")]) == 1
        # Recherche des publications par référence (sans fenêtre de dates).
        rows = (await h.get("/api/cm/posts?ref_prefix=contes/")).json()
        assert {p["ref"] for p in rows} == {"contes/khm-040-p1", "contes/khm-040-p2"}
        assert [p["ref"] for p in (await h.get("/api/cm/posts?ref=contes/khm-040-p2")).json()] == ["contes/khm-040-p2"]
        assert (await h.get("/api/cm/posts?ref_prefix=kiwi/")).json() == []
        assert (await h.get("/api/cm/posts?ref_prefix=contes/&status=published")).json() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_robot_probe_and_direct_archive(pg_session, cmenv, wdrive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    kiwi = wdrive._id()
    wdrive.items[kiwi] = {"name": "kiwi", "parent": "root", "folder": True}
    src = CmSource(owner_user_id=u.id, folder_id=kiwi, name="kiwi", role="writer", verified=True)
    pg_session.add(src)
    await pg_session.commit()
    # Google refuse au robot de créer un fichier : noté, l'archivage attend une connexion Drive.
    await cm_archive.probe_sources(pg_session)
    await pg_session.refresh(src)
    assert src.can_upload is False
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _post(h, ig, data, "kiwi/k7")
        await cm_archive.sync_due(pg_session)
        post = await pg_session.get(CmPost, pid)
        assert post.archive_state == "pending" and "connectez Google Drive" in post.archive["error"]
        assert cm_archive.keep_media(post)
        # Drive partagé (le robot peut déposer) : archivé directement dans le dossier du compte.
        wdrive.robot_quota = True
        src.can_upload = None
        cm_archive._probed.clear()
        await pg_session.commit()
        await cm_archive.probe_sources(pg_session)
        await pg_session.refresh(src)
        assert src.can_upload is True and "kiwi/cm-essai-ecriture.txt" not in wdrive.tree()
        post.archive_synced_at = utcnow() - timedelta(hours=1)
        await pg_session.commit()
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "ok" and post.archive["via"] == "robot"
        assert "kiwi/2026-12/2026-12-02 18h30 — Clair de lune/Clair de lune.mp4" in wdrive.tree()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_connect_drive(pg_session, cmenv, wdrive, tiktok, monkeypatch):
    from src.routers import cm_library as r
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        assert (await h.get("/api/cm/drive/archive")).json()["connected"] is False
        start = (await h.post("/api/cm/drive/oauth/start", json={})).json()["authorize_url"]
        assert "drive.file" in start and "drive-client" in start
        state = parse_qs(start.split("?", 1)[1])["state"][0]
        r = await h.post("/api/cm/drive/oauth/exchange", json={"code": "4/abc", "state": state})
        assert r.status_code == 200, r.text
        assert r.json()["connected"] is True and r.json()["email"] == "nathan@gmail.test"
        assert f"{settings.GDRIVE_ARCHIVE_ROOT_NAME}/" in wdrive.tree()
        assert wdrive.perms and wdrive.perms[0]["emailAddress"] == ROBOT and wdrive.perms[0]["role"] == "reader"
        link = (await pg_session.execute(select(CmDriveLink))).scalar_one()
        assert link.source_id is not None and "1//refresh" not in link.refresh_token_enc
        # State déjà utilisé, ou faux : refusé.
        assert (await h.post("/api/cm/drive/oauth/exchange", json={"code": "4/abc", "state": state})).status_code == 400
        assert (await h.post("/api/cm/drive/oauth/exchange", json={"code": "4/abc", "state": "faux"})).status_code == 400
        # Code refusé par Google (accès refusé, code expiré) : 400, rien n'est relié de plus.
        start2 = (await h.post("/api/cm/drive/oauth/start", json={})).json()["authorize_url"]
        state2 = parse_qs(start2.split("?", 1)[1])["state"][0]
        assert (await h.post("/api/cm/drive/oauth/exchange", json={"code": "bad", "state": state2})).status_code == 400
        # Déconnexion : révocation chez Google et jeton supprimé de la base.
        assert (await h.delete("/api/cm/drive/archive")).json()["connected"] is False
        assert wdrive.revoked == ["1//refresh"]
        assert (await pg_session.execute(select(CmDriveLink))).scalars().all() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_drive_token_refresh_and_revoked_access(pg_session, cmenv, wdrive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    link = await _linked(pg_session, u, wdrive)
    # Jeton d'accès expiré : rafraîchi tout seul avec le jeton d'actualisation.
    assert await cm_archive.user_token(link) == "ya29.user" and wdrive.refreshes == 1
    cm_archive._user_tokens[link.id] = ("ya29.vieux", 0)
    assert await cm_archive.user_token(link) == "ya29.user" and wdrive.refreshes == 2
    # Accès retiré depuis le compte Google (invalid_grant) : Drive marqué déconnecté, jeton effacé.
    cm_archive._user_tokens.clear()
    wdrive.grant_ok = False
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _post(h, ig, mp4_bytes(42_000), "kiwi/k9")
        await cm_archive.sync_due(pg_session)
        post = await pg_session.get(CmPost, pid)
        assert post.archive_state == "error" and "reconnectez" in post.archive["error"]
        await pg_session.refresh(link)
        assert link.revoked_at is not None and link.refresh_token_enc == ""
        assert (await h.get("/api/cm/drive/archive")).json()["connected"] is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_existing_account_folders_are_used(pg_session, cmenv, wdrive, tiktok):
    """Dossiers des comptes rangés par l'utilisateur dans le dossier d'archives : cm écrit dedans (pas de 2e
    « kiwi »), dépose avec la connexion Drive, le robot range ; ce que le PC avait déjà rangé est réutilisé."""
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    link = await _linked(pg_session, u, wdrive)
    kiwi = wdrive._id()
    wdrive.items[kiwi] = {"name": "kiwi", "parent": link.root_folder_id, "folder": True}
    month = wdrive._id()
    wdrive.items[month] = {"name": "2026-12", "parent": kiwi, "folder": True}
    day = wdrive._id()
    wdrive.items[day] = {"name": "2026-12-03 18h30 — Ancienne", "parent": month, "folder": True}
    old_video = wdrive._id()
    wdrive.items[old_video] = {"name": "Ancienne.mp4", "parent": day, "content": b"pc"}
    old_infos = wdrive._id()
    wdrive.items[old_infos] = {"name": "infos.json", "parent": day, "content": b'{"compte": "kiwi", "id": "k2", "statut": "prete"}'}
    pg_session.add(CmSource(owner_user_id=u.id, folder_id=kiwi, name="kiwi", role="writer", verified=True, can_upload=False))
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        await _post(h, ig, data, "kiwi/k1")
        await _post(h, ig, data, "kiwi/k2", title="Ancienne", when="2026-12-03T17:30:00Z")
        await cm_archive.sync_due(pg_session)
    root = settings.GDRIVE_ARCHIVE_ROOT_NAME
    tree = wdrive.tree()
    assert [x for x in tree if x.endswith("kiwi/")] == [f"{root}/kiwi/"]
    new = f"{root}/kiwi/2026-12/2026-12-02 18h30 — Clair de lune"
    assert f"{new}/Clair de lune.mp4" in tree and f"{new}/infos.json" in tree
    assert wdrive.items[wdrive.find(f"{new}/Clair de lune.mp4")]["by"] == "ya29.user"
    assert not [x for x in tree if "envoi en cours" in x and not x.endswith("/")]   # tout a été rangé
    # Vidéo déjà rangée par le PC : ni renvoyée ni doublée ; son infos.json est mis à jour par le robot.
    old = f"{root}/kiwi/2026-12/2026-12-03 18h30 — Ancienne"
    files = sorted(x for x in tree if x.startswith(old + "/") and not x.endswith("/"))
    assert files == sorted([f"{old}/Ancienne.mp4", f"{old}/infos.json", f"{old}/Ancienne.txt"])
    assert wdrive.items[old_video]["content"] == b"pc"
    infos = json.loads(wdrive.items[old_infos]["content"])
    assert infos["id"] == "k2" and infos["plateformes"]["instagram"]["statut"] == "prete"
    assert any(p["role"] == "writer" and p["emailAddress"] == ROBOT for p in wdrive.perms)
