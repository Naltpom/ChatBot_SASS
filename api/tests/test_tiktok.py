"""TikTok « Chapote Publisher » : OAuth (state), comptes, publication Direct Post.

TikTok est simulé par un httpx.MockTransport branché sur
tiktok_service._transport ; la base par la FakeSession du conftest.
"""
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from src.core.config import settings
from src.core.time import utcnow
from src.models.tiktok import TikTokAccount, TikTokPublish
from src.services import tiktok_service as tt
from src.services.crypto import decrypt_secret, encrypt_secret

MB = 1024 * 1024
API = "https://open.tiktokapis.com"
UPLOAD_URL = "https://upload.tiktok.test/video/?token=xyz"


class FakeTikTok:
    """Faux serveur TikTok : enregistre les requêtes, réponses configurables."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.creator = {
            "creator_nickname": "Kiwi Signal", "creator_username": "kiwi.signal",
            "creator_avatar_url": "https://p16.tiktok/a.jpg",
            "privacy_level_options": ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
            "comment_disabled": False, "duet_disabled": True, "stitch_disabled": False,
            "max_video_post_duration_sec": 600,
        }
        self.creator_error = None
        self.refresh_error = None

    @staticmethod
    def ok(data):
        return httpx.Response(200, json={"data": data, "error": {"code": "ok", "message": "", "log_id": "L"}})

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        path = req.url.path
        if path == "/v2/oauth/token/":
            form = parse_qs(req.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                if self.refresh_error:
                    return httpx.Response(400, json={"error": self.refresh_error, "error_description": "bad", "log_id": "R"})
                return httpx.Response(200, json={"access_token": "act.new", "refresh_token": "rft.new",
                                                 "expires_in": 86400, "refresh_expires_in": 31536000,
                                                 "open_id": "oid-1", "scope": "user.info.basic,video.upload,video.publish"})
            if form["code"] == ["bad"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Code expired", "log_id": "X1"})
            return httpx.Response(200, json={"access_token": "act.1", "refresh_token": "rft.1", "expires_in": 86400,
                                             "refresh_expires_in": 31536000, "open_id": "oid-1",
                                             "scope": "user.info.basic,video.upload,video.publish", "token_type": "Bearer"})
        if path == "/v2/oauth/revoke/":
            return httpx.Response(200, content=b"")  # corps vide, comme TikTok
        if path == "/v2/user/info/":
            return self.ok({"user": {"open_id": "oid-1", "display_name": "kiwi.signal", "avatar_url": "https://p16.tiktok/a.jpg"}})
        if path == "/v2/post/publish/creator_info/query/":
            if self.creator_error:
                return httpx.Response(200, json={"data": {}, "error": {"code": self.creator_error, "message": "nope", "log_id": "C"}})
            return self.ok(self.creator)
        if path == "/v2/post/publish/video/init/":
            return self.ok({"publish_id": "v_pub_file~1", "upload_url": UPLOAD_URL})
        if req.url.host == "upload.tiktok.test":
            last = req.headers["Content-Range"].split("/")
            end = int(last[0].split("-")[1])
            return httpx.Response(201 if end + 1 == int(last[1]) else 206)
        if path == "/v2/post/publish/status/fetch/":
            return self.ok({"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [123]})
        return httpx.Response(404, json={"error": {"code": "not_found", "message": path}})

    def last(self, path):
        return [c for c in self.calls if c.url.path == path][-1]


@pytest.fixture
def tiktok(monkeypatch, current_user):
    current_user.is_superadmin = True
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_KEY", "ck_test")
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_SECRET", "cs_test")
    fake = FakeTikTok()
    monkeypatch.setattr(tt, "_transport", httpx.MockTransport(fake.handler))
    return fake


def _account(db, **kw):
    now = utcnow()
    acc = TikTokAccount(
        open_id="oid-1", display_name="kiwi.signal", scope="user.info.basic,video.upload,video.publish",
        access_token_enc=encrypt_secret("act.1"), refresh_token_enc=encrypt_secret("rft.1"),
        access_expires_at=now + timedelta(hours=10), refresh_expires_at=now + timedelta(days=300),
        created_at=now, **kw)
    db.seed(acc)
    return acc


# --------------------------------------------------------------------------
# Découpage
# --------------------------------------------------------------------------

def test_chunk_plan_rules():
    assert tt.chunk_plan(3 * MB) == (3 * MB, 1)            # < 5 Mo : un seul chunk
    assert tt.chunk_plan(8 * MB) == (8 * MB, 1)
    size = 47 * MB + 123
    cs, n = tt.chunk_plan(size)
    assert (cs, n) == (10 * MB, 4)
    assert tt.chunk_range(3, cs, n, size) == (30 * MB, size - 1)   # le dernier absorbe le reste
    assert size - 30 * MB < 2 * cs
    assert 5 * MB <= cs <= 64 * MB


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_disabled_without_keys(overrides, client, current_user, monkeypatch):
    current_user.is_superadmin = True
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_KEY", None)
    r = await client.post("/api/admin/tiktok/oauth/start")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_non_admin_forbidden(overrides, client, tiktok, current_user):
    current_user.is_superadmin = False
    assert (await client.get("/api/admin/tiktok/accounts")).status_code == 403


@pytest.mark.asyncio
async def test_oauth_start_and_exchange(overrides, client, tiktok, db):
    r = await client.post("/api/admin/tiktok/oauth/start")
    assert r.status_code == 200
    url = urlparse(r.json()["authorize_url"])
    q = parse_qs(url.query)
    assert url.netloc == "www.tiktok.com" and url.path == "/v2/auth/authorize/"
    assert q["client_key"] == ["ck_test"]
    assert q["scope"] == ["user.info.basic,video.upload,video.publish"]
    assert q["response_type"] == ["code"]
    assert q["redirect_uri"] == ["https://chapote.fr/tiktok/callback"]
    state = q["state"][0]
    assert state.startswith("web_")
    assert "cs_test" not in r.text

    r = await client.post("/api/admin/tiktok/oauth/exchange", json={"code": "c0de", "state": state},
                          cookies={"chapote_tiktok_state": state})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["open_id"] == "oid-1" and body["display_name"] == "kiwi.signal" and body["can_publish"]
    assert "act" not in r.text and "rft" not in r.text  # aucun jeton renvoyé

    form = parse_qs(tiktok.last("/v2/oauth/token/").content.decode())
    assert form["client_secret"] == ["cs_test"]
    assert form["redirect_uri"] == ["https://chapote.fr/tiktok/callback"]

    [acc] = db.rows(TikTokAccount)
    assert acc.access_token_enc != "act.1" and decrypt_secret(acc.access_token_enc) == "act.1"
    assert decrypt_secret(acc.refresh_token_enc) == "rft.1"


@pytest.mark.asyncio
async def test_exchange_rejects_bad_state(overrides, client, tiktok, db):
    r = await client.post("/api/admin/tiktok/oauth/exchange", json={"code": "c", "state": "web_a"},
                          cookies={"chapote_tiktok_state": "web_b"})
    assert r.status_code == 400
    r = await client.post("/api/admin/tiktok/oauth/exchange", json={"code": "c", "state": "web_a"})
    assert r.status_code == 400
    assert not db.rows(TikTokAccount)
    assert not tiktok.calls


@pytest.mark.asyncio
async def test_exchange_shows_tiktok_error_code(overrides, client, tiktok):
    r = await client.post("/api/admin/tiktok/oauth/exchange", json={"code": "bad", "state": "web_s"},
                          cookies={"chapote_tiktok_state": "web_s"})
    assert r.status_code == 400
    assert "invalid_grant" in r.json()["detail"] and "X1" in r.json()["detail"]


# --------------------------------------------------------------------------
# Comptes / jetons
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_expired_access_token_is_refreshed(overrides, client, tiktok, db):
    acc = _account(db)
    acc.access_expires_at = utcnow() - timedelta(minutes=1)
    r = await client.get("/api/admin/tiktok/accounts")
    assert r.status_code == 200
    assert decrypt_secret(acc.access_token_enc) == "act.new"
    assert decrypt_secret(acc.refresh_token_enc) == "rft.new"
    assert tiktok.last("/v2/user/info/").headers["Authorization"] == "Bearer act.new"


@pytest.mark.asyncio
async def test_revoked_refresh_token_asks_reconnect(overrides, client, tiktok, db):
    acc = _account(db)
    acc.access_expires_at = utcnow() - timedelta(minutes=1)
    tiktok.refresh_error = "invalid_grant"
    r = await client.get("/api/admin/tiktok/accounts")
    assert r.status_code == 200
    assert "reconnectez" in r.json()[0]["error"]
    r = await client.get("/api/admin/tiktok/accounts/oid-1/creator-info")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_disconnect_revokes_and_deletes(overrides, client, tiktok, db):
    _account(db)
    r = await client.delete("/api/admin/tiktok/accounts/oid-1")
    assert r.status_code == 200 and r.json()["warning"] is None
    form = parse_qs(tiktok.last("/v2/oauth/revoke/").content.decode())
    assert form["token"] == ["act.1"] and form["client_secret"] == ["cs_test"]
    assert not db.rows(TikTokAccount)


# --------------------------------------------------------------------------
# Publication
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_creator_info_and_cannot_post(overrides, client, tiktok, db):
    _account(db)
    r = await client.get("/api/admin/tiktok/accounts/oid-1/creator-info")
    c = r.json()
    assert c["can_post"] and c["creator"]["nickname"] == "Kiwi Signal"
    assert c["creator"]["duet_disabled"] is True

    tiktok.creator_error = "spam_risk_too_many_posts"
    r = await client.get("/api/admin/tiktok/accounts/oid-1/creator-info")
    assert r.status_code == 200
    assert r.json()["can_post"] is False and "spam_risk_too_many_posts" in r.json()["message"]


def _publish_body(**kw):
    body = {"title": "Ma vidéo #test", "privacy_level": "PUBLIC_TO_EVERYONE", "allow_comment": True,
            "allow_duet": True, "allow_stitch": False, "video_size": 23 * MB + 5,
            "mime_type": "video/mp4", "duration_sec": 42}
    body.update(kw)
    return body


@pytest.mark.asyncio
async def test_publish_full_flow(overrides, client, tiktok, db):
    _account(db)
    size = 23 * MB + 5
    r = await client.post("/api/admin/tiktok/accounts/oid-1/publish", json=_publish_body(video_size=size))
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan == {"publish_id": "v_pub_file~1", "chunk_size": 10 * MB, "total_chunk_count": 2, "video_size": size}

    init = json.loads(tiktok.last("/v2/post/publish/video/init/").content)
    assert init["source_info"] == {"source": "FILE_UPLOAD", "video_size": size,
                                   "chunk_size": 10 * MB, "total_chunk_count": 2}
    pi = init["post_info"]
    assert pi["privacy_level"] == "PUBLIC_TO_EVERYONE" and pi["title"] == "Ma vidéo #test"
    assert pi["disable_comment"] is False
    assert pi["disable_duet"] is True        # désactivé par le créateur malgré allow_duet
    assert pi["disable_stitch"] is True      # non coché
    assert pi["brand_content_toggle"] is False and pi["brand_organic_toggle"] is False

    [pub] = db.rows(TikTokPublish)
    assert pub.upload_url_enc != UPLOAD_URL

    r = await client.put("/api/admin/tiktok/publishes/v_pub_file~1/chunks/0", content=b"\0" * (10 * MB))
    assert r.status_code == 200 and r.json()["http_status"] == 206
    put = tiktok.calls[-1]
    assert str(put.url) == UPLOAD_URL
    assert put.headers["Content-Range"] == f"bytes 0-{10 * MB - 1}/{size}"
    assert put.headers["Content-Type"] == "video/mp4"

    r = await client.put("/api/admin/tiktok/publishes/v_pub_file~1/chunks/1", content=b"\0" * (size - 10 * MB))
    assert r.status_code == 200 and r.json()["http_status"] == 201
    assert tiktok.calls[-1].headers["Content-Range"] == f"bytes {10 * MB}-{size - 1}/{size}"

    r = await client.get("/api/admin/tiktok/publishes/v_pub_file~1/status")
    assert r.json()["status"] == "PUBLISH_COMPLETE"
    assert pub.status == "PUBLISH_COMPLETE"


@pytest.mark.asyncio
async def test_chunk_size_mismatch_rejected(overrides, client, tiktok, db):
    _account(db)
    await client.post("/api/admin/tiktok/accounts/oid-1/publish", json=_publish_body(video_size=3 * MB))
    n = len(tiktok.calls)
    r = await client.put("/api/admin/tiktok/publishes/v_pub_file~1/chunks/0", content=b"\0" * 10)
    assert r.status_code == 400
    r = await client.put("/api/admin/tiktok/publishes/v_pub_file~1/chunks/1", content=b"\0" * 10)
    assert r.status_code == 400
    assert len(tiktok.calls) == n  # rien relayé vers TikTok


@pytest.mark.asyncio
@pytest.mark.parametrize("override, fragment", [
    ({"privacy_level": "FOLLOWER_OF_CREATOR"}, "confidentialité"),
    ({"privacy_level": "SELF_ONLY", "brand_content_toggle": True}, "Moi uniquement"),
    ({"mime_type": "video/webm"}, "MP4"),
    ({"duration_sec": 900}, "trop longue"),
])
async def test_publish_validation(overrides, client, tiktok, db, override, fragment):
    _account(db)
    r = await client.post("/api/admin/tiktok/accounts/oid-1/publish", json=_publish_body(**override))
    assert r.status_code == 400
    assert fragment in r.json()["detail"]
    assert not any(c.url.path == "/v2/post/publish/video/init/" for c in tiktok.calls)


@pytest.mark.asyncio
async def test_publish_blocked_when_creator_cannot_post(overrides, client, tiktok, db):
    _account(db)
    tiktok.creator_error = "spam_risk_too_many_posts"
    r = await client.post("/api/admin/tiktok/accounts/oid-1/publish", json=_publish_body())
    assert r.status_code == 409
