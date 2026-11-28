"""cm.chapote.fr : erreurs Instagram à l'envoi et au suivi (jeton invalidé, erreur passagère avec
nouvel essai, erreur définitive, conteneur ERROR / EXPIRED / trop long), couverture PNG convertie
en JPEG. Meta simulé ; vraie base jetable."""
import io
from datetime import timedelta
from urllib.parse import urlparse

import httpx
import pytest

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmTarget, InstagramAccount
from src.services import cm_jobs
from src.services import instagram_service as ig

from test_cm import IG_ID, _ig_api, _ig_target, _send, cmenv, meta  # noqa: F401  (fixtures)
from test_tiktok import Client, _user, mp4_bytes


def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", (90, 160), (200, 30, 30, 128)).save(buf, "PNG")
    return buf.getvalue()


def _fail_container(monkeypatch, meta, error: dict, http: int = 400):
    """Meta répond `error` à la création du conteneur ; le reste du faux Meta est inchangé."""
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and req.url.path.endswith(f"/{IG_ID}/media"):
            meta.calls.append(req)
            return httpx.Response(http, json={"error": error})
        return meta.handler(req)
    monkeypatch.setattr(ig, "_transport", httpx.MockTransport(handler))


async def _target(pg_session, c, u, acc, cover: bytes = None) -> int:
    h = c.as_(u)
    data = mp4_bytes(30_000)
    r = await h.post("/api/cm/posts", json={"title": "Clair de lune", "file_name": "c.mp4", "video_size": len(data),
                                            "targets": [_ig_target(acc.id)]})
    assert r.status_code == 200, r.text
    pid = r.json()["post_id"]
    await _send(h, pid, data)
    if cover is not None:
        assert (await h.put(f"/api/cm/posts/{pid}/cover", content=cover)).status_code == 200
    r = await h.post(f"/api/cm/posts/{pid}/submit")
    assert r.status_code == 200, r.text
    return r.json()["targets"][0]["id"]


async def _reload(pg_session, model, pk):
    obj = await pg_session.get(model, pk)
    await pg_session.refresh(obj)
    return obj


def test_error_parsing_transient_and_trace():
    req = httpx.Request("POST", "https://graph.instagram.com/v23.0/1/media")
    def err(body, status=400):
        return ig._error(httpx.Response(status, json=body, request=req), body)
    e = err({"error": {"message": "x", "code": 2, "fbtrace_id": "Abc123"}})
    assert e.transient and e.fbtrace_id == "Abc123" and "fbtrace_id=Abc123" in e.log_ref()
    assert err({"error": {"message": "x", "code": 100, "is_transient": True}}).transient
    assert err({"error": {"message": "x", "code": 4}}).transient and err({"error": {"code": 4}}).code == "rate_limited"
    assert not err({"error": {"message": "x", "code": 100}}).transient
    assert not err({"error": {"message": "x", "code": 190}}, 401).transient
    assert err({}, 503).transient


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_invalid_token_at_dispatch_marks_account_to_reconnect(pg_session, cmenv, meta, monkeypatch):
    """Le marquage « à reconnecter » survit au rollback de l'envoi."""
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    _fail_container(monkeypatch, meta, {"message": "Session expired", "type": "OAuthException", "code": 190}, 401)
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        await cm_jobs.dispatch_target(pg_session, tid)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "FAILED" and t.fail_reason == "invalid_token"
    acc = await _reload(pg_session, InstagramAccount, acc.id)
    assert acc.needs_reconnect is True


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_transient_error_retried_with_backoff_then_failed(pg_session, cmenv, meta, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    _fail_container(monkeypatch, meta, {"message": "Service temporarily unavailable", "code": 2,
                                        "is_transient": True, "fbtrace_id": "T1"}, 500)
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        delays = []
        for _ in range(cm_jobs.MAX_ATTEMPTS - 1):
            before = utcnow()
            await cm_jobs.dispatch_target(pg_session, tid)
            t = await _reload(pg_session, CmTarget, tid)
            assert t.status == "SCHEDULED" and "Nouvel essai automatique" in t.notice
            delays.append(round((t.scheduled_at - before).total_seconds() / 60))
            # Pas encore l'heure : rien n'est renvoyé.
            n = len(meta.calls)
            await cm_jobs.dispatch_due(pg_session)
            assert len(meta.calls) == n
            t.scheduled_at = utcnow() - timedelta(seconds=1)
            await pg_session.commit()
        assert delays == [1, 5]
        await cm_jobs.dispatch_target(pg_session, tid)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "FAILED" and t.fail_reason == "ig_2"
    acc = await _reload(pg_session, InstagramAccount, acc.id)
    assert acc.needs_reconnect is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_transient_error_then_success_clears_notice(pg_session, cmenv, meta, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    _fail_container(monkeypatch, meta, {"message": "Application request limit reached", "code": 4})
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        await cm_jobs.dispatch_target(pg_session, tid)
        t = await _reload(pg_session, CmTarget, tid)
        assert t.status == "SCHEDULED"
        monkeypatch.setattr(ig, "_transport", httpx.MockTransport(meta.handler))      # Meta répond de nouveau
        t.scheduled_at = utcnow() - timedelta(seconds=1)
        await pg_session.commit()
        await cm_jobs.dispatch_target(pg_session, tid)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "PUBLISHING" and t.ig_container_id == "cont1" and t.notice is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_definitive_error_fails_at_once(pg_session, cmenv, meta, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    _fail_container(monkeypatch, meta, {"message": "Invalid parameter", "code": 100, "fbtrace_id": "T2"})
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        await cm_jobs.dispatch_target(pg_session, tid)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "FAILED" and t.fail_reason == "ig_100" and t.attempts == 1


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("state,reason", [("ERROR", "container_error"), ("EXPIRED", "container_expired"),
                                          ("IN_PROGRESS", "container_timeout")])
async def test_container_error_expired_and_timeout(pg_session, cmenv, meta, state, reason):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    meta.container_states = [state]
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        await cm_jobs.dispatch_target(pg_session, tid)
        t = await _reload(pg_session, CmTarget, tid)
        if state == "IN_PROGRESS":
            meta.container_states = ["IN_PROGRESS"]
            t.updated_at = utcnow() - cm_jobs.CONTAINER_TIMEOUT - timedelta(minutes=1)
            await pg_session.commit()
        await cm_jobs.follow_pending(pg_session)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "FAILED" and t.fail_reason == reason


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_png_cover_converted_to_jpeg(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc, cover=_png())
        await cm_jobs.dispatch_target(pg_session, tid)
        cover = meta.created[0]["cover_url"][0]
        c.http.cookies.clear()
        got = await c.http.get(urlparse(cover).path)
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg"
    assert got.content[:3] == b"\xff\xd8\xff"
    from PIL import Image
    assert Image.open(io.BytesIO(got.content)).size == (90, 160)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_publishing_quota_checked_before_container(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    meta.quota_usage = 100
    async with Client(pg_session) as c:
        tid = await _target(pg_session, c, u, acc)
        await cm_jobs.dispatch_target(pg_session, tid)
    t = await _reload(pg_session, CmTarget, tid)
    assert t.status == "FAILED" and t.fail_reason == "publish_limit" and meta.created == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_caption_mentions_limited_to_20(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        def body(caption):
            return {"title": "t", "file_name": "c.mp4", "video_size": 30_000,
                    "targets": [{"platform": "instagram", "account_id": acc.id, "options": {"caption": caption}}]}
        ok = " ".join(f"@compte{i}" for i in range(20)) + " contact@chapote.fr"   # une adresse n'est pas une mention
        assert (await h.post("/api/cm/posts", json=body(ok))).status_code == 200
        r = await h.post("/api/cm/posts", json=body(ok + " @compte20"))
        assert r.status_code == 400 and "20 mentions" in r.json()["detail"]
