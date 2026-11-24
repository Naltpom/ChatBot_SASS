"""cm.chapote.fr : stockage Drive obligatoire (storage_required), quota et espace libre (storage_full), réglages,
conservation (corbeille du Drive après publication), alertes 90 % / 100 % et notification « storage »."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmDriveLink, CmPost, CmTarget
from src.services import cm_archive, cm_push, cm_storage

from test_cm import _ig_routine, _send, cmenv  # noqa: F401  (fixture)
from test_cm_archive import _linked, _post, wdrive  # noqa: F401  (fixture)
from test_cm_mobile import _device
from test_tiktok import Client, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)

GB = 1024 ** 3


@pytest.fixture
def required(monkeypatch):
    monkeypatch.setattr(settings, "CM_STORAGE_REQUIRED", True)
    monkeypatch.setattr(settings, "CM_MAX_UPLOAD_MB", 4096)


def _ig(ig, later):
    return [{"platform": "instagram", "account_id": ig.id, "options": {}, "scheduled_at": later}]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_storage_required_and_full(pg_session, cmenv, wdrive, tiktok, required):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        # Sans Drive : pas de publication, et l'espace le dit.
        r = await h.post("/api/cm/posts", json={"title": "x", "video_size": 100, "targets": _ig(ig, later)})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "storage_required"
        assert (await h.get("/api/cm/spaces")).json()[0]["storage"]["state"] == "missing"
        await _linked(pg_session, u, wdrive)
        st = (await h.get("/api/cm/drive/storage")).json()
        assert st["connected"] and st["state"] == "ok" and st["drive_free_bytes"] == 14 * GB and st["retention"] == "keep"
        # Quota réservé à Chapote, borné par l'espace libre du Drive.
        assert (await h.put("/api/cm/drive/storage", json={"quota_gb": 200, "retention": "keep"})).status_code == 400
        assert (await h.put("/api/cm/drive/storage", json={"quota_gb": 1, "retention": "delete_after_days"})).status_code == 400
        r = await h.put("/api/cm/drive/storage", json={"quota_gb": 1, "retention": "delete_after_days", "delete_after_days": 7})
        assert r.status_code == 200 and r.json()["quota_gb"] == 1 and r.json()["delete_after_days"] == 7
        # Vidéo plus grosse que la place restante : 409 storage_full, avec les tailles.
        r = await h.post("/api/cm/posts", json={"title": "x", "video_size": 2 * GB, "targets": _ig(ig, later)})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "storage_full"
        assert r.json()["detail"]["needed_bytes"] == 2 * GB and r.json()["detail"]["free_bytes"] == GB
        # Drive presque plein (au-delà du quota) : l'espace libre du Drive limite aussi.
        await h.put("/api/cm/drive/storage", json={"quota_gb": None, "retention": "keep"})
        wdrive.quota = {"limit": 15 * GB, "usage": 15 * GB - 500}
        link = (await pg_session.execute(select(CmDriveLink))).scalar_one()
        link.drive_checked_at = None
        await pg_session.commit()
        r = await h.post("/api/cm/posts", json={"title": "x", "video_size": 1000, "targets": _ig(ig, later)})
        assert r.status_code == 409 and r.json()["detail"]["free_bytes"] == 500
        assert (await h.get("/api/cm/spaces")).json()[0]["storage"]["state"] == "almost_full"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_retention_alerts_and_push(pg_session, cmenv, wdrive, tiktok, required):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    link = await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _post(h, ig, data, "kiwi/s1", title="Conservée")
        await cm_archive.sync_due(pg_session)
        assert (await h.get("/api/cm/drive/storage")).json()["used_bytes"] >= len(data)
        post = await pg_session.get(CmPost, pid)
        video_id = post.archive["video_id"]
        # « keep » : rien n'est supprimé même publiée.
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        t.status, t.published_at = "PUBLISHED", utcnow()
        await pg_session.commit()
        await cm_storage.purge_due(pg_session)
        assert wdrive.trashed == []
        # « supprimer après publication » : vidéo, couverture et légende de cm à la corbeille ; infos.json reste.
        await h.put("/api/cm/drive/storage", json={"retention": "delete_after_publish"})
        await cm_storage.purge_due(pg_session)
        await pg_session.refresh(post)
        assert video_id in [f for f, _ in wdrive.trashed] and post.archive["purged_at"] and post.archive["bytes"] == 0
        assert "video_id" not in post.archive and post.archive.get("infos_id")
        assert (await h.get("/api/cm/drive/storage")).json()["used_bytes"] == 0
        # Une mise à jour ensuite ne renvoie pas la vidéo.
        n = len(wdrive.items)
        t.updated_at = utcnow() + timedelta(seconds=5)
        await pg_session.commit()
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "ok" and len(wdrive.items) == n
        # Alertes : 90 % puis 100 %, une notification « storage » par passage de seuil.
        dev = await _device(pg_session, u, "ExponentPushToken[aaaaaaaaaaaa]")
        await pg_session.commit()
        for usage, state in ((14 * GB, "almost_full"), (15 * GB, "full")):
            wdrive.quota = {"limit": 15 * GB, "usage": usage}
            await pg_session.refresh(link)
            link.drive_checked_at = None
            await pg_session.commit()
            await cm_storage.alerts(pg_session)
            await pg_session.refresh(link)
            assert link.storage_alert == state
            msgs = [m for m in await cm_push.collect(pg_session) if m["data"].get("type") == "storage"]
            assert len(msgs) == 1 and msgs[0]["to"] == dev.push_token and msgs[0]["data"]["state"] == state
            assert [m for m in await cm_push.collect(pg_session) if m["data"].get("type") == "storage"] == []
