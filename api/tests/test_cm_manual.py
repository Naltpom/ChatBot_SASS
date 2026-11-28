"""cm.chapote.fr : publication faite à la main (POST /targets/{id}/published-by-hand) — prévue, ratée, brouillon."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmTarget
from src.routers.cm_manual import LINKS, video_id
from src.services import cm_jobs

from test_cm import _tt_target, cmenv  # noqa: F401  (fixture)
from test_cm_review import _ready
from test_tiktok import Client, _account, _user, tiktok  # noqa: F401  (fixture)


def test_links_and_ids():
    assert LINKS["instagram"].match("https://www.instagram.com/reel/DAbc_12-x/")
    assert LINKS["instagram"].match("https://www.instagram.com/ghosthands.music/p/DAbc12/?igsh=x")
    assert not LINKS["instagram"].match("https://exemple.com/reel/x")
    assert LINKS["youtube"].match("https://youtube.com/shorts/abcDEF12345?si=x")
    assert LINKS["youtube"].match("https://youtu.be/abcDEF12345")
    assert not LINKS["youtube"].match("https://youtube.com/@chaine")
    assert video_id("youtube", "https://www.youtube.com/watch?v=abcDEF12345&t=3") == "abcDEF12345"
    assert video_id("tiktok", "https://www.tiktok.com/@a/video/7312345678901234567") == "7312345678901234567"
    assert video_id("instagram", "https://www.instagram.com/reel/DAbc/") is None
    assert video_id("youtube", None) is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_scheduled_and_failed_published_by_hand(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="bh1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _ready(h, [_tt_target(tk.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")])
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        assert t.status == "SCHEDULED"
        # Prévue : lien vérifié, puis publiée à la main ; l'envoi programmé ne la prend plus.
        bad = await h.post(f"/api/cm/targets/{t.id}/published-by-hand", json={"url": "https://exemple.com/x"})
        assert bad.status_code == 400
        r = await h.post(f"/api/cm/targets/{t.id}/published-by-hand",
                         json={"url": "https://www.tiktok.com/@ghosthands.music/video/7312345678901234567"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "PUBLISHED" and r.json()["external_id"] == "7312345678901234567" and r.json()["published_at"]
        t.scheduled_at = utcnow() - timedelta(minutes=1)
        await pg_session.commit()
        assert await cm_jobs.claim(pg_session, t.id) is False
        assert (await h.post(f"/api/cm/targets/{t.id}/published-by-hand", json={})).status_code == 409
        # Ratée : publiée à la main sans lien, l'erreur disparaît.
        t.status, t.error_message, t.fail_reason, t.published_at, t.url, t.external_id = "FAILED", "Refusé", "x", None, None, None
        await pg_session.commit()
        r = await h.post(f"/api/cm/targets/{t.id}/published-by-hand", json={})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "PUBLISHED" and not r.json().get("error_message")
        # L'ancienne route reste réservée aux brouillons TikTok.
        t.status = "FAILED"
        await pg_session.commit()
        assert (await h.post(f"/api/cm/targets/{t.id}/published", json={})).status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_published_by_hand_needs_edit_right(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    other = await _user(pg_session, "b@t.dev")
    tk = await _account(pg_session, owner=u, open_id="bh2")
    await pg_session.commit()
    async with Client(pg_session) as c:
        pid = await _ready(c.as_(u), [_tt_target(tk.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")])
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        r = await c.as_(other).post(f"/api/cm/targets/{t.id}/published-by-hand", json={})
        assert r.status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_fix_link_of_published(pg_session, cmenv, tiktok):
    from src.models.cm import CmVideo
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="bh3")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _ready(h, [_tt_target(tk.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")])
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        # Pas encore publiée : rien à corriger.
        assert (await h.put(f"/api/cm/targets/{t.id}/link", json={"url": None})).status_code == 409
        wrong = "https://www.tiktok.com/@ghosthands.music/video/1111111111111111111"
        assert (await h.post(f"/api/cm/targets/{t.id}/published-by-hand", json={"url": wrong})).status_code == 200
        acc_id, tid = tk.id, t.id
        vids = lambda: pg_session.execute(select(CmVideo.external_id, CmVideo.target_id).where(CmVideo.account_id == acc_id))
        assert [tuple(r) for r in (await vids()).all()] == [("1111111111111111111", t.id)]
        assert (await h.put(f"/api/cm/targets/{t.id}/link", json={"url": "https://exemple.com/x"})).status_code == 400
        good = "https://www.tiktok.com/@ghosthands.music/video/2222222222222222222"
        r = await h.put(f"/api/cm/targets/{t.id}/link", json={"url": good})
        assert r.status_code == 200, r.text
        assert r.json()["url"] == good and r.json()["external_id"] == "2222222222222222222" and r.json()["status"] == "PUBLISHED"
        pg_session.expire_all()
        assert [tuple(r) for r in (await vids()).all()] == [("2222222222222222222", tid)]   # mauvaise fiche effacée
        # Lien retiré : plus de lien ni d'identifiant tiré du lien.
        r = await h.put(f"/api/cm/targets/{tid}/link", json={"url": ""})
        assert r.status_code == 200 and r.json()["url"] is None and r.json()["external_id"] is None
