"""cm.chapote.fr : couverture personnalisée (Instagram cover_url, routine) et Reel « déjà en ligne »
malgré une erreur Instagram. Meta simulé ; vraie base jetable."""
from datetime import datetime, timezone
from urllib.parse import urlparse

import pytest

from src.core.time import utcnow
from src.models.cm import CmTarget
from src.services import cm_jobs
from src.services import instagram_service as ig

from test_cm import _ig_api, _ig_routine, _ig_target, _send, _service, cmenv, meta  # noqa: F401  (fixtures)
from test_tiktok import Client, _user, mp4_bytes

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200


async def _create(h, targets, data):
    r = await h.post("/api/cm/posts", json={"title": "Clair de lune", "file_name": "c.mp4", "video_size": len(data),
                                            "targets": targets})
    assert r.status_code == 200, r.text
    pid = r.json()["post_id"]
    await _send(h, pid, data)
    return pid


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cover_sent_to_instagram_by_signed_link(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    data = mp4_bytes(30_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _create(h, [_ig_target(acc.id)], data)
        assert (await h.put(f"/api/cm/posts/{pid}/cover", content=b"pas une image")).status_code == 400
        assert (await h.put(f"/api/cm/posts/{pid}/cover", content=JPEG)).status_code == 200
        r = await h.post(f"/api/cm/posts/{pid}/submit")
        tid = r.json()["targets"][0]["id"]
        await cm_jobs.dispatch_target(pg_session, tid)
        sent = meta.created[0]
        assert "thumb_offset" not in sent
        cover = sent["cover_url"][0]
        assert cover.startswith("https://cm.chapote.test/api/cm/cover/")
        c.http.cookies.clear()
        path = urlparse(cover).path
        got = await c.http.get(path)
        assert got.status_code == 200 and got.content == JPEG and got.headers["content-type"] == "image/jpeg"
        assert (await c.http.get(path.replace(path.rsplit("/", 1)[1][:4], "0000"))).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_error_but_reel_online_is_published(pg_session, cmenv, meta, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _create(h, [_ig_target(acc.id)], mp4_bytes(30_000))
        tid = (await h.post(f"/api/cm/posts/{pid}/submit")).json()["targets"][0]["id"]
    await cm_jobs.dispatch_target(pg_session, tid)
    meta.container_states = ["ERROR"]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+0000")

    async def recent(token, ig_user_id, limit=50):
        return [{"id": "media77", "caption": "Clair de lune #piano", "media_type": "VIDEO", "media_product_type": "REELS",
                 "permalink": "https://www.instagram.com/reel/XYZ/", "timestamp": now}]
    monkeypatch.setattr(ig, "recent_media", recent)
    await cm_jobs.follow_pending(pg_session)
    t = await pg_session.get(CmTarget, tid)
    await pg_session.refresh(t)
    assert t.status == "PUBLISHED" and t.external_id == "media77" and t.url.endswith("/XYZ/")


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_downloads_cover(pg_session, cmenv):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _create(h, [_ig_target(acc.id)], mp4_bytes(30_000))
        await h.put(f"/api/cm/posts/{pid}/cover", content=JPEG)
        tid = (await h.post(f"/api/cm/posts/{pid}/submit")).json()["targets"][0]["id"]
        s = _service(c.http)
        await cm_jobs.dispatch_target(pg_session, tid)
        r = await s.get(f"/api/cm/routine/targets/{tid}/cover")
        assert r.status_code == 200 and r.content == JPEG
