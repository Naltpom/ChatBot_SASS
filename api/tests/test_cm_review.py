"""cm.chapote.fr : cas limites relevés en revue — périmètre des membres limités (vidéo, couverture, ajout de
cibles), règles de POST /posts/{id}/targets, archivage (réseau coupé, annulation, destination qui change,
conte sans partie, vidéo gardée tant qu'elle n'est pas archivée)."""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmGroup, CmGroupAccount, CmPost, CmSource, CmTarget
from src.services import cm_archive
from src.services import cm_jobs

from test_cm import _ig_routine, _send, _tt_target, cmenv  # noqa: F401  (fixture)
from test_cm_archive import _linked, _post, wdrive  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _org, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)


async def _ready(h, targets, **kw):
    data = mp4_bytes(8_000)
    r = await h.post("/api/cm/posts", json={"title": "x", "file_name": "c.mp4", "video_size": len(data), "targets": targets, **kw})
    assert r.status_code == 200, r.text
    pid = r.json()["post_id"]
    await _send(h, pid, data)
    assert (await h.post(f"/api/cm/posts/{pid}/submit")).status_code == 200
    return pid


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_restricted_member_cannot_reach_other_groups_post(pg_session, cmenv, tiktok):
    boss = await _user(pg_session, "boss@t.dev")
    editor = await _user(pg_session, "edit@t.dev")
    org = await _org(pg_session, boss, (editor, "member"))
    a1 = await _account(pg_session, org=org, by=boss, open_id="o1")
    a2 = await _account(pg_session, org=org, by=boss, open_id="o2")
    g = CmGroup(organization_id=org.id, name="Musique")
    pg_session.add(g)
    await pg_session.flush()
    pg_session.add(CmGroupAccount(group_id=g.id, platform="tiktok", account_id=a1.id))
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        hb = c.as_(boss)
        await hb.patch(f"/api/cm/team/{org.id}/members/edit@t.dev", json={"role": "editor", "group_ids": [g.id]})
        other = await _ready(hb, [_tt_target(a2.id, scheduled_at=later)], org_id=org.id)
        both = await _ready(hb, [_tt_target(a1.id, scheduled_at=later), _tt_target(a2.id, scheduled_at=later)], org_id=org.id)
        he = c.as_(editor)
        q = f"?org_id={org.id}"
        assert (await he.get(f"/api/cm/posts/{other}/video{q}")).status_code == 404
        assert (await he.get(f"/api/cm/posts/{other}/cover{q}")).status_code == 404
        r = await he.post(f"/api/cm/posts/{other}/targets{q}", json={"targets": [_tt_target(a1.id)]})
        assert r.status_code == 404
        assert (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == other))).scalars().all().__len__() == 1
        # Publication partagée : la réponse ne montre que les cibles de son périmètre.
        r = await he.post(f"/api/cm/posts/{both}/targets{q}", json={"targets": [_tt_target(a1.id)]})
        assert r.status_code == 200
        assert [t["account_id"] for t in r.json()["post"]["targets"]] == [a1.id]
        assert (await he.get(f"/api/cm/posts/{both}/video{q}")).status_code == 200


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_add_targets_rules(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    t1 = await _account(pg_session, owner=u, open_id="r1")
    t2 = await _account(pg_session, owner=u, open_id="r2")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _ready(h, [{"platform": "instagram", "account_id": ig.id, "options": {},
                                "scheduled_at": (utcnow() + timedelta(days=1)).isoformat() + "Z"}])
        # Deux comptes de la même plateforme dans la même demande : le 2e est ignoré ; heure vide = tout de suite.
        cmenv.clear()
        r = await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [_tt_target(t1.id), _tt_target(t2.id)]})
        assert r.status_code == 200, r.text
        assert len(r.json()["added"]) == 1 and r.json()["skipped"] == [{"platform": "tiktok", "target_id": None, "status": "DUPLICATE"}]
        assert cmenv == [r.json()["added"][0]["id"]]
        # Vidéo plus disponible (ni fichier, ni bibliothèque, ni archive) : 409.
        post = await pg_session.get(CmPost, pid)
        post.media_path = None
        await pg_session.commit()
        r = await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [{"platform": "youtube", "account": "youtube:@x"}]})
        assert r.status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_archive_edge_cases(pg_session, cmenv, wdrive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        # Réseau coupé pendant l'envoi de la 1re vidéo : elle passe en erreur, la suivante est archivée quand même.
        first = await _post(h, ig, data, "kiwi/a1", title="Premier")
        second = await _post(h, ig, data, "kiwi/a2", title="Second")
        wdrive.fail_uploads = 1
        await cm_archive.sync_due(pg_session)
        p1, p2 = await pg_session.get(CmPost, first), await pg_session.get(CmPost, second)
        await pg_session.refresh(p1)
        await pg_session.refresh(p2)
        assert p1.archive_state == "error" and "injoignable" in p1.archive["error"] and p2.archive_state == "ok"
        # Pas encore archivée : la vidéo reste sur le serveur même quand tout est publié… 7 jours au plus.
        for t in (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == first))).scalars():
            t.status = "PUBLISHED"
        await pg_session.commit()
        await cm_jobs.cleanup(pg_session)
        await pg_session.refresh(p1)
        assert p1.media_path is not None
        p1.created_at = utcnow() - timedelta(days=8)
        await pg_session.commit()
        await cm_jobs.cleanup(pg_session)
        await pg_session.refresh(p1)
        assert p1.media_path is None
        # Annulée avant l'archivage : rien n'est rangé.
        gone = await _post(h, ig, data, "kiwi/a3", title="Annulée")
        assert (await h.delete(f"/api/cm/posts/{gone}")).status_code == 200
        await cm_archive.sync_due(pg_session)
        p3 = await pg_session.get(CmPost, gone)
        await pg_session.refresh(p3)
        assert p3.archive_state is None and not [x for x in wdrive.tree() if "Annulée" in x]
        # Conte sans partie : une entrée dans « parties », l'infos.json partagé n'est jamais écrasé.
        await _post(h, ig, data, "contes/khm-1", title="Le Roi grenouille", archive={"dossier": "KHM-001 — Le Roi grenouille"})
        await cm_archive.sync_due(pg_session)
        infos = wdrive.json_at("cm.chapote.fr archives/contes/KHM-001 — Le Roi grenouille/infos.json")
        assert set(infos["parties"]) == {"khm-1"}
        # Destination qui change alors que la vidéo n'est plus sur le serveur : l'archive reste où elle est.
        p2.media_path = None
        kiwi = wdrive._id()
        wdrive.items[kiwi] = {"name": "kiwi", "parent": "root", "folder": True}
        pg_session.add(CmSource(owner_user_id=u.id, folder_id=kiwi, name="kiwi", role="writer", verified=True, can_upload=True))
        before = dict(p2.archive)
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == second))).scalar_one()
        t.updated_at = utcnow() + timedelta(seconds=5)
        await pg_session.commit()
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(p2)
        assert p2.archive["base"] == before["base"] and p2.archive["video_id"] == before["video_id"] and p2.archive_state == "ok"
