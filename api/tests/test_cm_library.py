"""Bibliothèque de cm.chapote.fr : dossiers Google Drive partagés avec le robot (compte de service).

Google (jeton du compte de service + API Drive v3) est simulé : AUCUN appel réel.
Couvre : adresse du robot, relier un dossier (lien, accès refusé, déjà relié ailleurs,
vérification de qui a partagé), relecture (vidéos des sous-dossiers, légende depuis le .txt du
même nom, légende modifiée dans cm gardée, vidéo retirée), publication depuis la bibliothèque
(téléchargement UNE fois pour tous les comptes, au moment de publier, copie supprimée à la fin),
rangement dans « Publié », dossier retiré, isolation entre tenants, durée vérifiée.
"""
import base64
import json
import os
from datetime import timedelta
from urllib.parse import parse_qs

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmAsset, CmGoogleIdentity, CmPost, CmSource, CmTarget
from src.services import cm_jobs
from src.services import cm_library as lib
from src.services import gdrive_service as gd
from src.routers import cm_library as lib_router

from test_cm import SERVICE, _ig_routine, _yt_target, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _org, _user, mp4_bytes
from test_youtube import _account as _yt_account
from test_youtube import google  # noqa: F401  (fixture)

ROBOT = "cm-drive@chapote-test.iam.gserviceaccount.com"
FOLDER = "1AbCdEfGhIjKlMnOpQrStUv"
SUB = "1SubFolder0123456789"


class FakeDrive:
    def __init__(self, owner="a@t.dev"):
        self.calls: list[httpx.Request] = []
        self.can_edit = False
        self.sharer = owner
        self.shared = {FOLDER}               # dossiers partagés avec le robot
        self.video = mp4_bytes(30_000)
        self.long_video = mp4_bytes(200_000)
        self.folders = {FOLDER: {"name": "CM – Ghost Hands", "parent": None}, SUB: {"name": "Studio", "parent": FOLDER}}
        self.files = {
            "vid1": {"name": "clip-42.mp4", "mimeType": "video/mp4", "parent": FOLDER, "content": self.video,
                     "durationMillis": "30000", "modifiedTime": "2026-11-20T10:00:00Z"},
            "txt1": {"name": "clip-42.txt", "mimeType": "text/plain", "parent": FOLDER,
                     "content": "Clair de lune au piano 🎹 #piano #debussy".encode(), "modifiedTime": "2026-11-20T10:01:00Z"},
            "vid2": {"name": "long.mov", "mimeType": "video/quicktime", "parent": SUB, "content": self.long_video,
                     "durationMillis": "200000", "modifiedTime": "2026-11-21T10:00:00Z"},
            "pdf1": {"name": "notes.pdf", "mimeType": "application/pdf", "parent": FOLDER, "content": b"%PDF",
                     "modifiedTime": "2026-11-21T10:00:00Z"},
        }
        self.moves: list[dict] = []
        self.created: list[dict] = []

    def _meta(self, fid):
        if fid in self.folders:
            f = self.folders[fid]
            return {"id": fid, "name": f["name"], "mimeType": gd.FOLDER_MIME, "trashed": False,
                    "capabilities": {"canEdit": self.can_edit, "canListChildren": True},
                    "owners": [{"emailAddress": self.sharer}], "sharingUser": {"emailAddress": self.sharer}}
        f = self.files[fid]
        out = {"id": fid, "name": f["name"], "mimeType": f["mimeType"], "size": str(len(f["content"])),
               "parents": [f["parent"]], "createdTime": f["modifiedTime"], "modifiedTime": f["modifiedTime"],
               "thumbnailLink": f"https://lh3.googleusercontent.test/thumb/{fid}"}
        if f.get("durationMillis"):
            out["videoMediaMetadata"] = {"width": 1080, "height": 1920, "durationMillis": f["durationMillis"]}
        return out

    def _visible(self, fid) -> bool:
        while fid:
            if fid in self.shared:
                return True
            fid = (self.folders.get(fid) or self.files.get(fid) or {}).get("parent")
        return False

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        if req.url.host == "oauth2.googleapis.com" and req.url.path == "/token":
            form = parse_qs(req.content.decode())
            assert form["grant_type"] == ["urn:ietf:params:oauth:grant-type:jwt-bearer"]
            return httpx.Response(200, json={"access_token": "ya29.robot", "expires_in": 3600, "token_type": "Bearer"})
        if req.url.host == "lh3.googleusercontent.test":
            return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
        assert req.headers.get("authorization") == "Bearer ya29.robot"
        path = req.url.path
        if path == "/drive/v3/files" and req.method == "GET" and "sharedWithMe" in req.url.params["q"]:
            return httpx.Response(200, json={"files": [self._meta(f) for f in self.shared if f in self.folders]})
        if path == "/drive/v3/files" and req.method == "GET":
            parent = req.url.params["q"].split("'")[1]
            if not self._visible(parent):
                return httpx.Response(404, json={"error": {"code": 404, "message": "File not found"}})
            kids = [self._meta(k) for k, f in {**self.folders, **self.files}.items() if f.get("parent") == parent]
            return httpx.Response(200, json={"files": kids})
        if path == "/drive/v3/files" and req.method == "POST":
            body = json.loads(req.content)
            self.created.append(body)
            self.folders["pub1"] = {"name": body["name"], "parent": body["parents"][0]}
            return httpx.Response(200, json={"id": "pub1"})
        fid = path.rsplit("/", 1)[1]
        if req.method == "PATCH":
            if not self.can_edit:
                return httpx.Response(403, json={"error": {"code": 403, "errors": [{"reason": "insufficientFilePermissions"}]}})
            self.moves.append({"file": fid, **dict(req.url.params)})
            self.files[fid]["parent"] = req.url.params["addParents"]
            return httpx.Response(200, json={"id": fid})
        if (fid not in self.folders and fid not in self.files) or not self._visible(fid):
            return httpx.Response(404, json={"error": {"code": 404, "message": "File not found"}})
        if req.url.params.get("alt") == "media":
            return httpx.Response(200, content=self.files[fid]["content"])
        return httpx.Response(200, json=self._meta(fid))

    def downloads(self, fid):
        return [c for c in self.calls if c.url.path.endswith(f"/files/{fid}") and c.url.params.get("alt") == "media"]


@pytest.fixture
def drive(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    sa = {"type": "service_account", "client_email": ROBOT, "private_key": pem, "private_key_id": "k1"}
    monkeypatch.setattr(settings, "GDRIVE_SA_KEY_B64", base64.b64encode(json.dumps(sa).encode()).decode())
    fake = FakeDrive()
    monkeypatch.setattr(gd, "_transport", httpx.MockTransport(fake.handler))
    gd.reset_token()
    yield fake
    gd.reset_token()


def _link(fid=FOLDER):
    return f"https://drive.google.com/drive/u/0/folders/{fid}?usp=sharing"


# --------------------------------------------------------------------------
# Robot et dossiers
# --------------------------------------------------------------------------

def test_folder_links_are_understood():
    assert gd.folder_id_from_link(_link()) == FOLDER
    assert gd.folder_id_from_link(f"https://drive.google.com/open?id={FOLDER}") == FOLDER
    assert gd.folder_id_from_link(FOLDER) == FOLDER
    with pytest.raises(gd.DriveError):
        gd.folder_id_from_link("https://exemple.com/pas-un-dossier")
    with pytest.raises(gd.DriveError) as e:
        gd.folder_id_from_link("https://drive.google.com/drive/project/17xF8OD0H58as2o_hjsU2npoXIVJQ3Nk6")
    assert e.value.code == "is_project" and "Nouveau dossier" in e.value.describe()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_robot_and_link_folder(pg_session, cmenv, drive, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        assert (await h.get("/api/cm/library/robot")).json() == {"enabled": True, "email": ROBOT}
        r = await h.post("/api/cm/sources", json={"url": _link()})
        assert r.status_code == 200, r.text
        src = r.json()
        assert src["name"] == "CM – Ghost Hands" and src["role"] == "reader" and src["verified"] is True
        assert src["videos"] == 2 and src["new"] == 2 and src["scan"]["ok"] is True
        # Relier à nouveau le même dossier : la même source.
        assert (await h.post("/api/cm/sources", json={"url": FOLDER})).json()["id"] == src["id"]

        assets = (await h.get("/api/cm/assets")).json()
        by = {a["name"]: a for a in assets}
        assert set(by) == {"clip-42.mp4", "long.mov"}                       # le PDF et le .txt sont ignorés
        clip = by["clip-42.mp4"]
        assert clip["caption"] == "Clair de lune au piano 🎹 #piano #debussy" and clip["caption_from"] == "txt"
        assert clip["title"] == "clip-42" and clip["duration_sec"] == 30.0 and clip["folder"] is None
        assert by["long.mov"]["folder"] == "Studio"
        assert (await h.get(f"/api/cm/assets?q=debussy")).json()[0]["id"] == clip["id"]
        thumb = await h.get(clip["thumbnail"])
        assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/png"

    monkeypatch.setattr(settings, "GDRIVE_SA_KEY_B64", None)
    async with Client(pg_session) as c:
        assert (await c.as_(u).get("/api/cm/library/robot")).json()["enabled"] is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_link_refused_when_not_shared_or_already_linked(pg_session, cmenv, drive):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(a).post("/api/cm/sources", json={"url": _link("1NotSharedFolder000")})
        assert r.status_code == 400 and "partagez-le" in r.json()["detail"]
        r = await c.as_(a).post("/api/cm/sources", json={"url": "https://exemple.com"})
        assert r.status_code == 400 and "non reconnu" in r.json()["detail"]
        assert (await c.as_(a).post("/api/cm/sources", json={"url": _link()})).status_code == 200
        r = await c.as_(b).post("/api/cm/sources", json={"url": _link()})
        assert r.status_code == 409 and "autre espace" in r.json()["detail"]
        # b ne voit ni le dossier, ni ses vidéos, ni leurs miniatures.
        assert (await c.as_(b).get("/api/cm/sources")).json() == []
        assert (await c.as_(b).get("/api/cm/assets")).json() == []
        asset = (await pg_session.execute(select(CmAsset))).scalars().first()
        assert (await c.as_(b).get(f"/api/cm/assets/{asset.id}/thumbnail")).status_code == 404
        assert (await c.as_(b).patch(f"/api/cm/assets/{asset.id}", json={"caption": "x"})).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_folder_shared_by_a_teammate_is_verified(pg_session, cmenv, drive):
    owner = await _user(pg_session, "owner@t.dev")
    editor = await _user(pg_session, "monteur@t.dev")
    org = await _org(pg_session, owner, (editor, "member"))
    await pg_session.commit()
    drive.sharer = "monteur@t.dev"
    async with Client(pg_session) as c:
        r = await c.as_(owner).post("/api/cm/sources", json={"org_id": org.id, "url": _link()})
        assert r.status_code == 200 and r.json()["verified"] is True and r.json()["shared_by"] == "mo•••••@t.dev"


# --------------------------------------------------------------------------
# Relecture
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_rescan_updates_captions_and_removed_videos(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        clip = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "clip-42.mp4")
        # Le monteur modifie le .txt : la légende suit.
        drive.files["txt1"].update(content=b"Nouvelle legende #piano", modifiedTime="2026-11-22T09:00:00Z")
        src = (await pg_session.execute(select(CmSource))).scalar_one()
        await lib.scan_source(pg_session, src)
        assert (await h.get(f"/api/cm/assets/{clip['id']}")).json()["caption"] == "Nouvelle legende #piano"
        # Légende modifiée dans cm : le .txt ne l'écrase plus.
        r = await h.patch(f"/api/cm/assets/{clip['id']}", json={"caption": "Ma légende", "title": "Clair de lune"})
        assert r.json()["caption_from"] == "user" and r.json()["title"] == "Clair de lune"
        drive.files["txt1"].update(content=b"Encore autre", modifiedTime="2026-11-22T10:00:00Z")
        await lib.scan_source(pg_session, src)
        assert (await h.get(f"/api/cm/assets/{clip['id']}")).json()["caption"] == "Ma légende"
        # Vidéo supprimée du Drive : retirée de la bibliothèque. Accès retiré : erreur notée.
        del drive.files["vid2"]
        await lib.scan_source(pg_session, src)
        assert [a["name"] for a in (await h.get("/api/cm/assets")).json()] == ["clip-42.mp4"]
        drive.shared.clear()
        await lib.scan_source(pg_session, src)
        out = (await h.get("/api/cm/sources")).json()[0]
        assert "partagez-le" in out["last_error"] and out["videos"] == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_scan_due_respects_interval(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")
    pg_session.add(CmSource(owner_user_id=u.id, folder_id=FOLDER, provider="gdrive", last_scan_at=utcnow()))
    await pg_session.commit()
    await lib.scan_due(pg_session)
    assert not [c for c in drive.calls if c.url.path.startswith("/drive")]
    src = (await pg_session.execute(select(CmSource))).scalar_one()
    src.last_scan_at = utcnow() - timedelta(minutes=10)
    await pg_session.commit()
    await lib.scan_due(pg_session)
    assert len((await pg_session.execute(select(CmAsset))).scalars().all()) == 2


# --------------------------------------------------------------------------
# Publication depuis la bibliothèque
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_publish_from_library_downloads_once_then_cleans(pg_session, cmenv, drive, google):
    u = await _user(pg_session, "a@t.dev")
    yacc = await _yt_account(pg_session, owner=u)
    iacc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        clip = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "clip-42.mp4")
        r = await h.post("/api/cm/posts", json={
            "title": clip["title"], "caption": clip["caption"], "asset_id": clip["id"],
            "targets": [_yt_target(yacc.id), {"platform": "instagram", "account_id": iacc.id, "options": {}}]})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ready"] is True and {t["status"] for t in out["post"]["targets"]} == {"SCHEDULED"}
        assert sorted(cmenv) == sorted(t["id"] for t in out["post"]["targets"])
        assert drive.downloads("vid1") == []                      # rien téléchargé avant l'heure
        post = await pg_session.get(CmPost, out["post_id"])
        assert post.media_path is None and post.asset_id == clip["id"]

        for t in out["post"]["targets"]:
            await cm_jobs.dispatch_target(pg_session, t["id"])
        assert len(drive.downloads("vid1")) == 1                  # une seule fois pour les deux comptes
        await pg_session.refresh(post)
        assert post.media_path and open(post.media_path, "rb").read() == drive.video
        assert post.duration_sec == 30.0 and post.mime_type == "video/mp4"
        statuses = {t.platform: t.status for t in (await pg_session.execute(
            select(CmTarget).where(CmTarget.post_id == post.id))).scalars()}
        assert statuses == {"youtube": "PUBLISHING", "instagram": "AWAITING_ROUTINE"}
        assert len(google.launched) == 1

        assets = {a["id"]: a for a in (await h.get("/api/cm/assets?state=used")).json()}
        assert assets[clip["id"]]["scheduled"] == 2
        assert (await h.get("/api/cm/assets?state=new")).json()[0]["name"] == "long.mov"

        # Tout se termine : la copie locale est supprimée, la vidéo reste dans le Drive (réutilisable).
        media = post.media_path
        for t in (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == post.id))).scalars():
            t.status, t.published_at = "PUBLISHED", utcnow()
        await pg_session.commit()
        await cm_jobs.cleanup(pg_session)
        await pg_session.refresh(post)
        assert post.media_path is None and not os.path.exists(media)
        a = (await h.get(f"/api/cm/assets/{clip['id']}")).json()
        assert a["published"] == 2 and a["last_published_at"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_library_video_too_long_for_a_short(pg_session, cmenv, drive, google):
    u = await _user(pg_session, "a@t.dev")
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        long = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "long.mov")
        r = await h.post("/api/cm/posts", json={"title": "x", "asset_id": long["id"], "targets": [_yt_target(yacc.id)]})
        assert r.status_code == 400 and "trop longue pour un Short" in r.json()["detail"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_drive_access_lost_fails_with_clear_message(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")
    iacc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        clip = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "clip-42.mp4")
        r = await h.post("/api/cm/posts", json={"title": "x", "asset_id": clip["id"],
                                                "targets": [{"platform": "instagram", "account_id": iacc.id, "options": {}}]})
        tid = r.json()["post"]["targets"][0]["id"]
    drive.shared.clear()
    await cm_jobs.dispatch_target(pg_session, tid)
    t = await pg_session.get(CmTarget, tid)
    await pg_session.refresh(t)
    assert t.status == "FAILED" and t.fail_reason == "drive_access" and "partage" in t.error_message
    # Partage rétabli : « Réessayer » retélécharge.
    drive.shared.add(FOLDER)
    async with Client(pg_session) as c:
        r = await c.as_(u).post(f"/api/cm/targets/{tid}/retry", json={})
        assert r.status_code == 200, r.text
    await cm_jobs.dispatch_target(pg_session, tid)
    await pg_session.refresh(t)
    assert t.status == "AWAITING_ROUTINE"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_published_videos_moved_when_robot_is_editor(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")
    iacc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        r = await h.patch(f"/api/cm/sources/{src['id']}", json={"move_published": True})
        assert r.status_code == 400 and "Éditeur" in r.json()["detail"]
        drive.can_edit = True
        await h.post(f"/api/cm/sources/{src['id']}/scan")
        r = await h.patch(f"/api/cm/sources/{src['id']}", json={"move_published": True})
        assert r.status_code == 200 and r.json()["move_published"] is True and r.json()["can_organize"] is True
        clip = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "clip-42.mp4")
        r = await h.post("/api/cm/posts", json={"title": "x", "asset_id": clip["id"],
                                                "targets": [{"platform": "instagram", "account_id": iacc.id, "options": {}}]})
        tid = r.json()["post"]["targets"][0]["id"]
    t = await pg_session.get(CmTarget, tid)
    t.status, t.published_at = "PUBLISHED", utcnow()
    await pg_session.commit()
    await lib.organize_published(pg_session)
    assert drive.created == [{"name": "Publié", "mimeType": gd.FOLDER_MIME, "parents": [FOLDER]}]
    assert drive.moves == [{"file": "vid1", "addParents": "pub1", "removeParents": FOLDER, "fields": "id,parents",
                            "supportsAllDrives": "true"}]
    a = await pg_session.get(CmAsset, clip["id"])
    await pg_session.refresh(a)
    assert a.moved_published_at is not None and a.folder_path == "Publié"
    await lib.organize_published(pg_session)
    assert len(drive.moves) == 1                                  # une seule fois


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_removing_folder_cancels_upcoming_posts(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")
    iacc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        clip = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "clip-42.mp4")
        r = await h.post("/api/cm/posts", json={"title": "x", "asset_id": clip["id"], "targets": [
            {"platform": "instagram", "account_id": iacc.id, "scheduled_at": later, "options": {}}]})
        tid = r.json()["post"]["targets"][0]["id"]
        assert (await h.delete(f"/api/cm/sources/{src['id']}")).status_code == 200
        assert (await h.get("/api/cm/sources")).json() == [] and (await h.get("/api/cm/assets")).json() == []
        r = await h.post("/api/cm/posts", json={"title": "x", "asset_id": clip["id"], "targets": [
            {"platform": "instagram", "account_id": iacc.id, "options": {}}]})
        assert r.status_code == 404
    t = await pg_session.get(CmTarget, tid)
    await pg_session.refresh(t)
    assert t.status == "CANCELLED"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_can_publish_from_library(pg_session, cmenv, drive):
    """La routine (jeton de service) lit la bibliothèque et programme depuis une vidéo du Drive."""
    u = await _user(pg_session, "a@t.dev")
    iacc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        await c.as_(u).post("/api/cm/sources", json={"url": _link()})
        c.http.cookies.clear()
        c.http.headers["Authorization"] = f"Bearer {SERVICE}"
        assets = (await c.http.get("/api/cm/assets?state=new")).json()
        assert len(assets) == 2
        r = await c.http.post("/api/cm/posts", json={"title": "x", "asset_id": assets[0]["id"], "targets": [
            {"platform": "instagram", "account_id": iacc.id, "options": {}}]})
        assert r.status_code == 200 and r.json()["ready"] is True


# --------------------------------------------------------------------------
# Détection automatique des dossiers partagés
# --------------------------------------------------------------------------

@pytest.fixture
def google_id(monkeypatch):
    """Faux ID token Google : « tok:<email> » est accepté pour <email>."""
    async def verify(token):
        if not token.startswith("tok:"):
            raise lib_router.GoogleAuthError("jeton invalide")
        return {"email": token[4:], "email_verified": True, "sub": "sub-" + token[4:]}
    monkeypatch.setattr(lib_router, "verify_google_id_token", verify)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_google_identity_is_proven_and_unique(pg_session, cmenv, drive, google_id):
    u = await _user(pg_session, "chapote@t.dev")
    other = await _user(pg_session, "autre@t.dev")
    stranger = await _user(pg_session, "x@t.dev")
    org = await _org(pg_session, stranger)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/cm/google-identities", json={"credential": "tok:nathan.drive@gmail.com"})
        assert r.status_code == 200, r.text
        assert r.json()["account_email"] == "chapote@t.dev"
        assert [i["email"] for i in r.json()["identities"]] == ["nathan.drive@gmail.com"]
        assert (await h.post("/api/cm/google-identities", json={"credential": "faux-jeton-sans-preuve"})).status_code == 400
        # Espace d'une équipe dont on n'est pas membre : refusé.
        r = await h.post("/api/cm/google-identities", json={"credential": "tok:autre.adresse@gmail.com", "org_id": org.id})
        assert r.status_code == 404
        # La même adresse ne peut pas être associée à un 2e compte Chapote.
        r = await c.as_(other).post("/api/cm/google-identities", json={"credential": "tok:nathan.drive@gmail.com"})
        assert r.status_code == 409
        ident = (await c.as_(u).get("/api/cm/google-identities")).json()["identities"][0]
        assert (await c.as_(other).delete(f"/api/cm/google-identities/{ident['id']}")).status_code == 404
        assert (await c.as_(u).delete(f"/api/cm/google-identities/{ident['id']}")).json()["identities"] == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_shared_folder_is_linked_automatically(pg_session, cmenv, drive, google_id):
    owner = await _user(pg_session, "chapote@t.dev")
    teammate = await _user(pg_session, "coeq@t.dev")
    org = await _org(pg_session, owner, (teammate, "member"))
    await pg_session.commit()
    drive.sharer = "nathan.drive@gmail.com"          # adresse Google différente du compte Chapote
    # Adresse inconnue : rien n'est relié.
    assert await lib.detect_shared(pg_session) == 0
    assert (await pg_session.execute(select(CmSource))).scalars().all() == []
    async with Client(pg_session) as c:
        r = await c.as_(owner).post("/api/cm/google-identities", json={"credential": "tok:nathan.drive@gmail.com",
                                                                      "org_id": org.id})
        assert r.status_code == 200
    assert await lib.detect_shared(pg_session) == 1
    src = (await pg_session.execute(select(CmSource))).scalar_one()
    assert src.organization_id == org.id and src.owner_user_id is None and src.verified is True
    assert src.created_by_user_id == owner.id and src.name == "CM – Ghost Hands"
    assert len((await pg_session.execute(select(CmAsset))).scalars().all()) == 2      # relu tout de suite
    # Pas de doublon ; les membres de l'équipe le voient, pas l'espace perso.
    assert await lib.detect_shared(pg_session) == 0
    async with Client(pg_session) as c:
        assert len((await c.as_(teammate).get(f"/api/cm/sources?org_id={org.id}")).json()) == 1
        assert (await c.as_(owner).get("/api/cm/sources")).json() == []
        # Retiré par l'utilisateur : jamais relié de nouveau automatiquement.
        assert (await c.as_(owner).delete(f"/api/cm/sources/{src.id}?org_id={org.id}")).status_code == 200
    assert await lib.detect_shared(pg_session) == 0
    assert len((await pg_session.execute(select(CmSource).where(CmSource.revoked_at.is_(None)))).scalars().all()) == 0


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_shared_from_chapote_email_goes_to_personal_space(pg_session, cmenv, drive):
    u = await _user(pg_session, "a@t.dev")                # drive.sharer = a@t.dev par défaut
    await pg_session.commit()
    assert await lib.detect_shared(pg_session) == 1
    src = (await pg_session.execute(select(CmSource))).scalar_one()
    assert src.owner_user_id == u.id and src.organization_id is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_left_team_falls_back_to_personal_space(pg_session, cmenv, drive):
    """Adresse associée à une équipe que l'utilisateur a quittée : dossier relié à son espace perso."""
    owner = await _user(pg_session, "boss@t.dev")
    u = await _user(pg_session, "stagiaire@t.dev")
    org = await _org(pg_session, owner)
    pg_session.add(CmGoogleIdentity(user_id=u.id, email="stagiaire.drive@gmail.com", organization_id=org.id))
    await pg_session.commit()
    drive.sharer = "stagiaire.drive@gmail.com"
    assert await lib.detect_shared(pg_session) == 1
    src = (await pg_session.execute(select(CmSource))).scalar_one()
    assert src.organization_id is None and src.owner_user_id == u.id
