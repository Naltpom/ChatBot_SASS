"""Module YouTube « Chapote Publisher » (Shorts, Espace client, multi-tenant).

Google est simulé par un httpx.MockTransport branché sur
youtube_service._transport : AUCUN appel réel. Endpoints testés sur la vraie
base jetable (`real_db`), authentification réelle par le cookie de session.

Couvre : URL d'autorisation, OAuth (state signé à usage unique, scope
manquant, compte sans chaîne), isolation entre tenants, refresh à la volée et
invalid_grant => « à reconnecter », révocation, publication complète (session
resumable, morceaux, 308, reprise après erreur passagère, suppression du
fichier, suivi du traitement, vidéo gardée privée par un projet non audité),
validations (titre, description, mots-clés, durée d'un Short, programmation),
quota épuisé, jeton de service.
"""
import json
import os
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from src.core.config import settings
from src.core.time import utcnow
from src.models.youtube import YouTubeAccount, YouTubePost
from src.routers import youtube as youtube_router
from src.services import youtube_jobs
from src.services import youtube_service as yt
from src.services.crypto import decrypt_secret, encrypt_secret
from src.services.rate_limit import RateLimiter

from test_tiktok import Client, _org, _user, mp4_bytes
from src.core.security import _encode

SESSION_URL = "https://upload.youtube.test/upload/youtube/v3/videos?upload_id=SECRET"
SCOPES = f"{yt.SCOPE_UPLOAD} {yt.SCOPE_READONLY}"


# --------------------------------------------------------------------------
# Faux Google
# --------------------------------------------------------------------------

class FakeGoogle:
    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.channel = {"id": "UC123", "snippet": {"title": "Ghost Hands", "customUrl": "@ghosthands.music",
                                                   "thumbnails": {"default": {"url": "https://yt3.ggpht/a.jpg"}}}}
        self.scope = SCOPES
        self.refresh_error = None
        self.insert_error = None
        self.received = 0
        self.put_failures: list[int] = []     # codes HTTP (0 = coupure réseau) avant succès
        self.video_status = {"uploadStatus": "processed", "privacyStatus": "public"}
        self.refresh_count = 0
        self.revoked: list[str] = []

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        path = req.url.path
        if req.url.host == "oauth2.googleapis.com" and path == "/token":
            form = parse_qs(req.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                if self.refresh_error:
                    return httpx.Response(400, json={"error": self.refresh_error, "error_description": "Token has been expired or revoked."})
                self.refresh_count += 1
                return httpx.Response(200, json={"access_token": f"ya29.new{self.refresh_count}", "expires_in": 3599,
                                                 "scope": self.scope, "token_type": "Bearer"})
            if form["code"] == ["bad"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Bad Request"})
            return httpx.Response(200, json={"access_token": "ya29.1", "refresh_token": "1//rt", "expires_in": 3599,
                                             "scope": self.scope, "token_type": "Bearer"})
        if req.url.host == "oauth2.googleapis.com" and path == "/revoke":
            self.revoked.append(parse_qs(req.content.decode())["token"][0])
            return httpx.Response(200, content=b"")
        if path == "/youtube/v3/channels":
            return httpx.Response(200, json={"items": [self.channel] if self.channel else []})
        if path == "/upload/youtube/v3/videos" and req.method == "POST":
            if self.insert_error:
                code, reason = self.insert_error
                return httpx.Response(code, json={"error": {"code": code, "message": "nope",
                                                            "errors": [{"reason": reason, "domain": "youtube"}]}})
            self.received = 0
            return httpx.Response(200, headers={"Location": SESSION_URL})
        if req.url.host == "upload.youtube.test":
            rng = req.headers["Content-Range"]
            total = int(rng.rsplit("/", 1)[1])
            if rng.startswith("bytes */"):          # demande d'état
                return self._progress(total)
            if self.put_failures:
                code = self.put_failures.pop(0)
                if code == 0:
                    raise httpx.ConnectError("coupure", request=req)
                return httpx.Response(code, text="Service Unavailable")
            start, end = (int(x) for x in rng.split(" ")[1].split("/")[0].split("-"))
            assert start == self.received, (start, self.received)
            self.received = end + 1
            return self._progress(total)
        if path == "/youtube/v3/videos":
            return httpx.Response(200, json={"items": [{"id": "vid42", "status": self.video_status,
                                                        "processingDetails": {"processingStatus": "succeeded"}}]})
        return httpx.Response(404, json={"error": {"code": 404, "message": path}})

    def _progress(self, total: int) -> httpx.Response:
        if self.received >= total:
            return httpx.Response(200, json={"id": "vid42", "status": {"uploadStatus": "uploaded", "privacyStatus": "private"}})
        headers = {"Range": f"bytes=0-{self.received - 1}"} if self.received else {}
        return httpx.Response(308, headers=headers)

    def last(self, path):
        return [c for c in self.calls if c.url.path == path][-1]


@pytest.fixture
def google(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "YOUTUBE_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "YOUTUBE_CLIENT_SECRET", "GOCSPX-test")
    monkeypatch.setattr(settings, "YOUTUBE_TMP_DIR", str(tmp_path / "yt"))
    fake = FakeGoogle()
    monkeypatch.setattr(yt, "_transport", httpx.MockTransport(fake.handler))
    fake.launched = []
    monkeypatch.setattr(youtube_jobs, "launch", lambda post_id: fake.launched.append(post_id))
    monkeypatch.setattr(youtube_router, "PART_SIZE", 1024)
    monkeypatch.setattr(youtube_router, "post_limiter", RateLimiter("rl:test-ytpost:", 1000, 86400))
    monkeypatch.setattr(yt, "CHUNK_RETRY_DELAYS", (0, 0, 0))
    return fake


async def _account(db, *, org=None, owner=None, by=None, channel_id="UC123", **kw) -> YouTubeAccount:
    now = utcnow()
    acc = YouTubeAccount(
        organization_id=org.id if org else None, owner_user_id=owner.id if owner else None,
        connected_by_user_id=(by or owner).id if (by or owner) else None,
        channel_id=channel_id, title="Ghost Hands", scopes=SCOPES,
        access_token_enc=encrypt_secret("ya29.1"), refresh_token_enc=encrypt_secret("1//rt"),
        access_token_expires_at=now + timedelta(minutes=50),
    )
    for k, v in kw.items():
        setattr(acc, k, v)
    db.add(acc)
    await db.flush()
    return acc


def _state(user_id, org_id=None, **over) -> str:
    claims = {"sub": str(user_id), "scope": "youtube_oauth", "org": org_id, "jti": os.urandom(8).hex()}
    claims.update(over)
    return _encode(claims, timedelta(minutes=10))


def _post(acc_id, size, **kw):
    body = {"account_id": acc_id, "title": "Clair de lune — Beginner to Expert", "description": "Piano #shorts",
            "tags": ["piano", "ghost hands"], "category_id": "10", "default_language": "en",
            "privacy_status": "public", "made_for_kids": False, "synthetic_media": True,
            "file_name": "video.mp4", "video_size": size}
    body.update(kw)
    return body


async def _send(h, post_id: int, data: bytes, part: int = 1024):
    for i in range(0, len(data), part):
        r = await h.put(f"/api/youtube/posts/{post_id}/parts/{i // part}", content=data[i:i + part])
        assert r.status_code == 200, r.text


# --------------------------------------------------------------------------
# Unitaires
# --------------------------------------------------------------------------

def test_authorize_url_asks_offline_upload(monkeypatch):
    monkeypatch.setattr(settings, "YOUTUBE_CLIENT_ID", "cid")
    q = parse_qs(urlparse(yt.authorize_url("ST")).query)
    assert q["access_type"] == ["offline"] and "consent" in q["prompt"][0]
    assert q["redirect_uri"] == [settings.YOUTUBE_REDIRECT_URI] and q["state"] == ["ST"]
    assert set(q["scope"][0].split()) == {yt.SCOPE_UPLOAD, yt.SCOPE_READONLY}


def test_tags_length_counts_like_youtube():
    assert youtube_router._tags_length(["a", "b c"]) == 1 + 5 + 1


def test_video_resource_forces_private_when_scheduled():
    p = YouTubePost(title="T", description=None, tags=["x"], category_id="10", default_language="en",
                    privacy_status="public", publish_at=utcnow().replace(microsecond=0),
                    made_for_kids=False, synthetic_media=True)
    r = yt.video_resource(p)
    assert r["status"]["privacyStatus"] == "private" and r["status"]["publishAt"].endswith(".000Z")
    assert r["status"]["containsSyntheticMedia"] is True and r["snippet"]["tags"] == ["x"]


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disabled_without_keys(pg_session, monkeypatch):
    monkeypatch.setattr(settings, "YOUTUBE_CLIENT_ID", None)
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        assert (await c.as_(u).post("/api/youtube/oauth/start", json={})).status_code == 503
        assert (await c.as_(u).get("/api/youtube/config")).json()["enabled"] is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_oauth_start_and_exchange_into_org(pg_session, google):
    owner = await _user(pg_session, "owner@t.dev")
    member = await _user(pg_session, "member@t.dev")
    org = await _org(pg_session, owner, (member, "member"))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(member)
        r = await h.post("/api/youtube/oauth/start", json={"org_id": org.id})
        assert r.status_code == 200
        state = parse_qs(urlparse(r.json()["authorize_url"]).query)["state"][0]
        r = await h.post("/api/youtube/oauth/exchange", json={"code": "ok", "state": state})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["org_id"] == org.id and out["account"]["title"] == "Ghost Hands"
        assert out["account"]["handle"] == "@ghosthands.music" and out["account"]["can_upload"] is True
        assert "token" not in json.dumps(out)
        # state à usage unique
        r = await h.post("/api/youtube/oauth/exchange", json={"code": "ok", "state": state})
        assert r.status_code == 400
        acc = (await pg_session.execute(
            YouTubeAccount.__table__.select())).first()
        assert acc.organization_id == org.id and acc.channel_id == "UC123"
        assert decrypt_secret(acc.refresh_token_enc) == "1//rt"
        # L'owner (même org) voit la chaîne ; un tiers non.
        assert len((await c.as_(owner).get(f"/api/youtube/accounts?org_id={org.id}")).json()) == 1
        outsider = await _user(pg_session, "x@t.dev")
        await pg_session.commit()
        assert (await c.as_(outsider).get(f"/api/youtube/accounts?org_id={org.id}")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["scope", "no_channel", "bad_code", "other_user"])
async def test_exchange_refusals(pg_session, google, case):
    u = await _user(pg_session, "a@t.dev")
    other = await _user(pg_session, "b@t.dev")
    await pg_session.commit()
    code, state = "ok", _state(u.id)
    if case == "scope":
        google.scope = yt.SCOPE_READONLY
    elif case == "no_channel":
        google.channel = None
    elif case == "bad_code":
        code = "bad"
    else:
        state = _state(other.id)
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/youtube/oauth/exchange", json={"code": code, "state": state})
        assert r.status_code == 400, r.text
        if case == "no_channel":
            assert "chaîne YouTube" in r.json()["detail"]
        assert (await c.as_(u).get("/api/youtube/accounts")).json() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tenant_isolation(pg_session, google):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    acc = await _account(pg_session, owner=a)
    await pg_session.commit()
    data = mp4_bytes(30_000)
    async with Client(pg_session) as c:
        hb = c.as_(b)
        assert (await hb.get("/api/youtube/accounts")).json() == []
        assert (await hb.post("/api/youtube/posts", json=_post(acc.id, len(data)))).status_code == 404
        assert (await hb.delete(f"/api/youtube/accounts/{acc.id}")).status_code == 404
        r = await c.as_(a).post("/api/youtube/posts", json=_post(acc.id, len(data)))
        pid = r.json()["post_id"]
        assert (await c.as_(b).get(f"/api/youtube/posts/{pid}")).status_code == 404
        assert (await c.as_(b).put(f"/api/youtube/posts/{pid}/parts/0", content=data[:1024])).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_refresh_on_the_fly_and_invalid_grant(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u, access_token_expires_at=utcnow() - timedelta(minutes=1))
    await pg_session.commit()
    assert await yt.valid_access_token(pg_session, acc) == "ya29.new1"
    assert decrypt_secret(acc.refresh_token_enc) == "1//rt"     # le refresh token reste
    google.refresh_error = "invalid_grant"
    with pytest.raises(yt.ReconnectRequired):
        await yt.valid_access_token(pg_session, acc, force_refresh=True)
    await pg_session.refresh(acc)
    assert acc.needs_reconnect is True
    assert acc.access_token_enc is None and acc.refresh_token_enc is None   # accès retiré : jetons effacés (§7)
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/youtube/posts", json=_post(acc.id, 1000))
        assert r.status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_invalid_client_does_not_mark_reconnect(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    google.refresh_error = "invalid_client"
    with pytest.raises(yt.YouTubeError):
        await yt.valid_access_token(pg_session, acc, force_refresh=True)
    await pg_session.refresh(acc)
    assert acc.needs_reconnect is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disconnect_revokes_refresh_token(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).delete(f"/api/youtube/accounts/{acc.id}")
        assert r.status_code == 200 and r.json()["warning"] is None
    assert google.revoked == ["1//rt"]
    await pg_session.refresh(acc)
    assert acc.revoked_at is not None and acc.refresh_token_enc is None and acc.access_token_enc is None


# --------------------------------------------------------------------------
# Publication
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_full_flow(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(95_000, mdat=5000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/youtube/posts", json=_post(acc.id, len(data)))
        assert r.status_code == 200, r.text
        pid = r.json()["post_id"]
        assert not any(x.url.path.startswith("/upload") for x in google.calls)   # rien chez YouTube
        await _send(h, pid, data)
        r = await h.post(f"/api/youtube/posts/{pid}/submit")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "QUEUED" and google.launched == [pid]

        post = await pg_session.get(YouTubePost, pid)
        tmp = post.tmp_path
        assert post.duration_sec == 95.0 and post.mime_type == "video/mp4"
        # Morceaux YouTube de 2 Ko (le dernier plus court) : plusieurs 308 puis 200.
        orig = yt.upload_file

        async def _small(url, path, size, mime, chunk_size=0):
            return await orig(url, path, size, mime, chunk_size=2048)
        yt_upload = yt.upload_file
        yt.upload_file = _small
        try:
            await youtube_jobs.process_post(pg_session, post)
        finally:
            yt.upload_file = yt_upload

        ins = [x for x in google.calls if x.method == "POST" and x.url.path == "/upload/youtube/v3/videos"][-1]
        assert ins.url.params["uploadType"] == "resumable" and ins.url.params["notifySubscribers"] == "true"
        assert ins.headers["X-Upload-Content-Length"] == str(len(data))
        assert ins.headers["X-Upload-Content-Type"] == "video/mp4"
        meta = json.loads(ins.content)
        assert meta["snippet"]["title"] == "Clair de lune — Beginner to Expert"
        assert meta["snippet"]["categoryId"] == "10" and meta["snippet"]["tags"] == ["piano", "ghost hands"]
        assert meta["status"] == {"privacyStatus": "public", "selfDeclaredMadeForKids": False,
                                  "containsSyntheticMedia": True, "embeddable": True}
        puts = [x for x in google.calls if x.url.host == "upload.youtube.test"]
        assert len(puts) == -(-len(data) // 2048) and b"".join(p.content for p in puts) == data
        assert post.status == "PROCESSING" and post.video_id == "vid42"
        assert not os.path.exists(tmp) and post.tmp_path is None

        await youtube_jobs.poll_post(pg_session, post)
        out = (await h.get(f"/api/youtube/posts/{pid}")).json()
        assert out["status"] == "PUBLISHED" and out["url"] == "https://youtube.com/shorts/vid42"
        assert out["error_message"] is None
        assert "SECRET" not in json.dumps((await h.get("/api/youtube/posts")).json())


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_unaudited_project_keeps_video_private(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    post = YouTubePost(owner_user_id=u.id, youtube_account_id=acc.id, title="T", privacy_status="public",
                       made_for_kids=False, synthetic_media=False, notify_subscribers=True,
                       video_size=10, received_bytes=10, video_id="vid42", status="PROCESSING")
    pg_session.add(post)
    await pg_session.commit()
    google.video_status = {"uploadStatus": "processed", "privacyStatus": "private"}
    await youtube_jobs.poll_post(pg_session, post)
    assert post.status == "PUBLISHED" and post.fail_reason == "locked_private"
    assert "audit" in post.error_message


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("st, reason", [
    ({"uploadStatus": "rejected", "rejectionReason": "duplicate"}, "duplicate"),
    ({"uploadStatus": "failed", "failureReason": "codec"}, "codec"),
])
async def test_processing_failure_translated(pg_session, google, st, reason):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    post = YouTubePost(owner_user_id=u.id, youtube_account_id=acc.id, title="T", privacy_status="public",
                       made_for_kids=False, synthetic_media=False, notify_subscribers=True,
                       video_size=10, received_bytes=10, video_id="vid42", status="PROCESSING")
    pg_session.add(post)
    await pg_session.commit()
    google.video_status = st
    await youtube_jobs.poll_post(pg_session, post)
    assert post.status == "FAILED" and post.fail_reason == reason
    assert post.error_message == yt.ERROR_MESSAGES[reason]


@pytest.mark.asyncio
@pytest.mark.parametrize("failures", [[503], [0], [500, 0]])
async def test_upload_resumes_after_transient_error(google, tmp_path, failures):
    data = os.urandom(5000)
    p = tmp_path / "v.mp4"
    p.write_bytes(data)
    google.put_failures = list(failures)
    google.received = 0
    out = await yt.upload_file(SESSION_URL, str(p), len(data), "video/mp4", chunk_size=2048)
    assert out["id"] == "vid42" and google.received == len(data)


@pytest.mark.asyncio
async def test_upload_gives_up_in_french(google, tmp_path):
    p = tmp_path / "v.mp4"
    p.write_bytes(b"x" * 100)
    google.put_failures = [503] * 10
    with pytest.raises(yt.YouTubeError) as e:
        await yt.upload_file(SESSION_URL, str(p), 100, "video/mp4")
    assert e.value.code == "upload_unavailable" and "YouTube" in e.value.describe()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_quota_exceeded_reported(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    path = youtube_jobs.tmp_dir() / "q.part"
    data = mp4_bytes(10_000)
    path.write_bytes(data)
    post = YouTubePost(owner_user_id=u.id, youtube_account_id=acc.id, title="T", privacy_status="public",
                       made_for_kids=False, synthetic_media=False, notify_subscribers=True,
                       video_size=len(data), received_bytes=len(data), mime_type="video/mp4",
                       tmp_path=str(path), status="QUEUED")
    pg_session.add(post)
    await pg_session.commit()
    google.insert_error = (403, "quotaExceeded")
    await youtube_jobs.process_post(pg_session, post)
    assert post.status == "FAILED" and post.fail_reason == "quotaExceeded"
    assert "quota" in post.error_message and not path.exists()


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("override, fragment", [
    ({"title": "a" * 101}, "Titre"),
    ({"title": "<b>"}, "Titre"),
    ({"description": "é" * 2600}, "Description"),
    ({"tags": ["x" * 499, "yy"]}, "Mots-clés"),
    ({"publish_at": "2020-01-01T00:00:00Z"}, "programmée"),
])
async def test_create_post_validation(pg_session, google, override, fragment):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/youtube/posts", json=_post(acc.id, 1000, **override))
        assert r.status_code == 400 and fragment in r.json()["detail"], r.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_scheduled_post_is_private_until_publish_at(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    when = (utcnow() + timedelta(hours=3)).replace(microsecond=0).isoformat() + "Z"
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/youtube/posts", json=_post(acc.id, 1000, publish_at=when))
        assert r.status_code == 200, r.text
    post = await pg_session.get(YouTubePost, r.json()["post_id"])
    assert post.privacy_status == "private" and post.publish_at is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_too_long_for_a_short(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(181_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = (await h.post("/api/youtube/posts", json=_post(acc.id, len(data)))).json()["post_id"]
        await _send(h, pid, data)
        r = await h.post(f"/api/youtube/posts/{pid}/submit")
        assert r.status_code == 400 and "Short" in r.json()["detail"]
    post = await pg_session.get(YouTubePost, pid)
    assert post.status == "FAILED" and post.tmp_path is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cleanup_and_tick(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u, updated_at=utcnow() - timedelta(days=2))
    post = YouTubePost(owner_user_id=u.id, youtube_account_id=acc.id, title="T", privacy_status="public",
                       made_for_kids=False, synthetic_media=False, notify_subscribers=True,
                       video_size=10, received_bytes=0, status="RECEIVING")
    pg_session.add(post)
    await pg_session.commit()
    post.updated_at = utcnow() - timedelta(hours=3)
    await pg_session.commit()
    await youtube_jobs.tick(pg_session)
    await pg_session.refresh(post)
    await pg_session.refresh(acc)
    assert post.status == "FAILED" and post.fail_reason == "upload_abandoned"
    assert google.refresh_count == 1 and acc.handle == "@ghosthands.music"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_revoked_access_dropped_after_7_days(pg_session, google):
    u = await _user(pg_session, "a@t.dev")
    old = await _account(pg_session, owner=u, needs_reconnect=True)
    recent = await _account(pg_session, owner=u, channel_id="UC2", needs_reconnect=True)
    await pg_session.commit()
    old.updated_at = utcnow() - timedelta(days=8)
    await pg_session.commit()
    await youtube_jobs.cleanup_stale(pg_session)
    await pg_session.refresh(old)
    await pg_session.refresh(recent)
    assert old.revoked_at is not None and old.refresh_token_enc is None
    assert recent.revoked_at is None and recent.refresh_token_enc is not None


# --------------------------------------------------------------------------
# Jeton de service
# --------------------------------------------------------------------------

SERVICE = "svc-yt-test"


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(settings, "YOUTUBE_SERVICE_TOKEN", SERVICE)
    monkeypatch.setattr(settings, "YOUTUBE_SERVICE_USER_EMAIL", "Prod@T.dev")


def _bearer(c, token=SERVICE):
    c.http.cookies.clear()
    c.http.headers["Authorization"] = f"Bearer {token}"
    return c.http


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_service_token_publishes_and_is_scoped(pg_session, google, service):
    u = await _user(pg_session, "prod@t.dev")
    other = await _user(pg_session, "other@t.dev")
    acc = await _account(pg_session, owner=u)
    foreign = await _account(pg_session, owner=other, channel_id="UC999")
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = _bearer(c)
        assert [a["id"] for a in (await h.get("/api/youtube/accounts")).json()] == [acc.id]
        assert (await h.post("/api/youtube/posts", json=_post(foreign.id, len(data)))).status_code == 404
        pid = (await h.post("/api/youtube/posts", json=_post(acc.id, len(data)))).json()["post_id"]
        await _send(h, pid, data)
        assert (await h.post(f"/api/youtube/posts/{pid}/submit")).json()["status"] == "QUEUED"
        assert (await pg_session.get(YouTubePost, pid)).user_id == u.id
        # Connexion / déconnexion : jamais par le jeton de service.
        assert (await h.post("/api/youtube/oauth/start", json={})).status_code == 401
        assert (await h.delete(f"/api/youtube/accounts/{acc.id}")).status_code == 401
        assert (await _bearer(c, "faux").get("/api/youtube/accounts")).status_code == 401
        # Le jeton TikTok n'ouvre pas YouTube.
        settings.TIKTOK_SERVICE_TOKEN = "tt-only"
        try:
            assert (await _bearer(c, "tt-only").get("/api/youtube/accounts")).status_code == 401
        finally:
            settings.TIKTOK_SERVICE_TOKEN = None
