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


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_inbox_published_by_hand_and_resend(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="ib1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        tt = _tt_target(tk.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")
        tt["options"].update({"mode": "draft", "caption": "Clair de lune", "hashtags": ["piano"]})
        pid = await _ready(h, [tt])
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        # Pas encore un brouillon dans l'app : refusé.
        assert (await h.post(f"/api/cm/targets/{t.id}/published", json={})).status_code == 409
        assert (await h.post(f"/api/cm/targets/{t.id}/resend-draft")).status_code == 409
        t.status = "INBOX"
        await pg_session.commit()
        out = (await h.get(f"/api/cm/posts/{pid}")).json()["targets"][0]
        assert out["is_draft"] is True and out["options"]["title"] == "Clair de lune\n\n#piano"
        # Brouillon supprimé dans l'app : renvoyé tout de suite, en brouillon.
        cmenv.clear()
        r = await h.post(f"/api/cm/targets/{t.id}/resend-draft")
        assert r.status_code == 200 and r.json()["status"] == "SCHEDULED" and r.json()["options"]["mode"] == "draft"
        assert cmenv == [t.id]
        # Publié à la main : lien vérifié, cible publiée.
        t.status = "INBOX"
        await pg_session.commit()
        bad = await h.post(f"/api/cm/targets/{t.id}/published", json={"url": "https://exemple.com/x"})
        assert bad.status_code == 400
        r = await h.post(f"/api/cm/targets/{t.id}/published",
                         json={"url": "https://www.tiktok.com/@ghosthands.music/video/7312345678901234567"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "PUBLISHED" and r.json()["external_id"] == "7312345678901234567" and r.json()["published_at"]
        # Sans lien aussi (lien facultatif), une seule fois.
        assert (await h.post(f"/api/cm/targets/{t.id}/published", json={})).status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_short_link_is_resolved(pg_session, cmenv, tiktok, monkeypatch):
    from src.routers import cm as cm_router
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="ib2")
    await pg_session.commit()

    async def fake(url):
        assert url == "https://vm.tiktok.com/ZGdXTpbyA/"
        return "https://www.tiktok.com/@ghosthands.music/video/7711132447085317408"
    monkeypatch.setattr(cm_router, "resolve_tiktok_link", fake)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _ready(h, [_tt_target(tk.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")])
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        t.status = "INBOX"
        await pg_session.commit()
        r = await h.post(f"/api/cm/targets/{t.id}/published", json={"url": "https://vm.tiktok.com/ZGdXTpbyA/"})
        assert r.status_code == 200, r.text
        assert r.json()["url"] == "https://www.tiktok.com/@ghosthands.music/video/7711132447085317408"
        assert r.json()["external_id"] == "7711132447085317408"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_calendar_search(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="cs1")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=60)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        await _ready(h, [_tt_target(tk.id, scheduled_at=later)], title="Bumblebee (Piano)")
        await _ready(h, [_tt_target(tk.id, scheduled_at=later)], title="Clair de lune")
        start = (utcnow() - timedelta(days=365)).isoformat() + "Z"
        end = (utcnow() + timedelta(days=180)).isoformat() + "Z"
        r = await h.get("/api/cm/calendar", params={"start": start, "end": end, "q": "bumble"})
        assert r.status_code == 200, r.text
        assert [i["title"] for i in r.json()["items"]] == ["Bumblebee (Piano)"] and r.json()["days"] == []
        # Sans recherche, la période reste limitée.
        assert (await h.get("/api/cm/calendar", params={"start": start, "end": end})).status_code == 400


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_ref_set_later_and_video_resent(pg_session, cmenv, wdrive, tiktok):
    """Post créé sans ref et déjà publié : ref posée après coup (doublon refusé), vidéo plus sur le serveur
    renvoyée en morceaux, puis archivée dans le Drive comme les autres."""
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        taken = await _post(h, ig, data, "kiwi/k5", title="Déjà là")
        pid = await _post(h, ig, data, None, title="Ancienne")
        post = await pg_session.get(CmPost, pid)
        assert post.archive_state is None
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        t.status, t.url, t.published_at = "PUBLISHED", "https://www.instagram.com/reel/OLD/", utcnow()
        await pg_session.commit()
        await cm_jobs.cleanup(pg_session)          # tout est parti : vidéo effacée du serveur
        await pg_session.refresh(post)
        assert post.media_path is None
        # Ref déjà prise par un autre post : refusée ; format invalide : refusé.
        r = await h.patch(f"/api/cm/posts/{pid}", json={"ref": "kiwi/k5"})
        assert r.status_code == 409 and r.json()["detail"]["post_id"] == taken
        assert (await h.patch(f"/api/cm/posts/{pid}", json={"ref": "sans-compte"})).status_code == 400
        r = await h.patch(f"/api/cm/posts/{pid}", json={"ref": "kiwi/k6"})
        assert r.status_code == 200 and r.json()["ref"] == "kiwi/k6" and r.json()["archive"]["state"] == "pending"
        # Sans la vidéo : archivage impossible, l'erreur dit quoi faire.
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "error" and "PUT /posts/{id}/video" in post.archive["error"]
        # Renvoi de la vidéo, même découpage que la création.
        assert (await h.post(f"/api/cm/posts/{pid}/video/complete")).status_code == 409
        r = await h.put(f"/api/cm/posts/{pid}/video", json={"video_size": len(data)})
        assert r.status_code == 200, r.text
        await _send_video(h, pid, data, r.json()["part_size"])
        r = await h.post(f"/api/cm/posts/{pid}/video/complete")
        assert r.status_code == 200 and r.json()["has_media"] is True
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "ok" and post.archive["video_id"]
        infos = wdrive.json_at(next(x for x in wdrive.tree() if "Ancienne" in x and x.endswith("infos.json")))
        assert infos["id"] == "k6" and infos["statut"] == "publiee" and infos["plateformes"]["instagram"]["url"].endswith("/OLD/")
        # Vidéo encore là : pas de renvoi.
        assert (await h.put(f"/api/cm/posts/{pid}/video", json={"video_size": len(data)})).status_code == 409


async def _send_video(h, post_id, data, part):
    for i in range(0, len(data), part):
        r = await h.put(f"/api/cm/posts/{post_id}/video/parts/{i // part}", content=data[i:i + part])
        assert r.status_code == 200, r.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_archive_retry_routes_and_unexpected_errors(pg_session, cmenv, wdrive, tiktok, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    await _linked(pg_session, u, wdrive)
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = await _post(h, ig, data, "kiwi/r1", title="Relance")
        # Erreur inattendue pendant l'archivage : notée sur la publication (plus de « pending » muet).
        real = cm_archive.sync_post

        async def boom(*a, **k):
            raise KeyError("champ manquant")
        monkeypatch.setattr(cm_archive, "sync_post", boom)
        await cm_archive.sync_due(pg_session)
        post = await pg_session.get(CmPost, pid)
        await pg_session.refresh(post)
        assert post.archive_state == "error" and "KeyError" in post.archive["error"]
        out = (await h.get(f"/api/cm/posts/{pid}")).json()["archive"]
        assert out["state"] == "error" and out["last_try"]
        # Pas repris tout seul avant 30 min…
        monkeypatch.setattr(cm_archive, "sync_post", real)
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "error"
        # … mais tout de suite après une relance (une publication, ou toutes celles en erreur de l'espace).
        assert (await h.post("/api/cm/archive/retry", json={})).json() == {"relaunched": 1}
        await cm_archive.sync_due(pg_session)
        await pg_session.refresh(post)
        assert post.archive_state == "ok" and "error" not in post.archive
        r = await h.post(f"/api/cm/posts/{pid}/archive/retry")
        assert r.status_code == 200 and r.json()["archive"]["state"] == "pending"
