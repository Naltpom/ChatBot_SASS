"""cm.chapote.fr : compléter un post déjà soumis (POST /posts/{id}/targets) et modifier les textes d'une
cible encore programmée (PATCH /targets/{id} {options})."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmTarget

from test_cm import _ig_routine, _send, _tt_target, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)


def _at(days=1):
    return (utcnow() + timedelta(days=days)).isoformat() + "Z"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_add_targets_to_a_scheduled_post(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    tk = await _account(pg_session, owner=u, open_id="add1")
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/cm/posts", json={
            "title": "Clair de lune", "caption": "Debussy au piano", "file_name": "a.mp4", "video_size": len(data),
            "ref": "ghost-hands/g9",
            "targets": [{"platform": "instagram", "account": f"instagram:@{ig.username}", "scheduled_at": _at(), "options": {}}]})
        pid = r.json()["post_id"]
        # Vidéo encore en envoi : la cible ajoutée attend le submit (DRAFT).
        tt = _tt_target(tk.id, scheduled_at=_at())
        tt["options"]["hashtags"] = ["piano"]
        r = await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [tt]})
        assert r.status_code == 200, r.text
        assert [t["status"] for t in r.json()["added"]] == ["DRAFT"] and r.json()["skipped"] == []
        await _send(h, pid, data)
        assert (await h.post(f"/api/cm/posts/{pid}/submit")).status_code == 200
        rows = {t.platform: t for t in (await pg_session.execute(select(CmTarget))).scalars()}
        assert rows["tiktok"].status == "SCHEDULED" and rows["tiktok"].options["title"] == "Debussy au piano\n\n#piano"
        # Plateforme déjà présente : ignorée ; post prêt : la nouvelle cible est programmée directement.
        body = {"targets": [{"platform": "instagram", "account": f"instagram:@{ig.username}", "options": {}},
                            _tt_target(tk.id, scheduled_at=_at())]}
        r = await h.post(f"/api/cm/posts/{pid}/targets", json=body)
        assert r.status_code == 200 and r.json()["added"] == []
        assert {s["platform"] for s in r.json()["skipped"]} == {"instagram", "tiktok"}
        # TikTok annulé : on peut le rajouter.
        assert (await h.post(f"/api/cm/targets/{rows['tiktok'].id}/cancel")).status_code == 200
        r = await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [_tt_target(tk.id, scheduled_at=_at())]})
        assert r.status_code == 200 and [t["status"] for t in r.json()["added"]] == ["SCHEDULED"]
        assert len(r.json()["post"]["targets"]) == 3
        # Mêmes règles que POST /posts : options invalides → 400, rien ajouté ; compte inconnu → 404.
        n = len((await pg_session.execute(select(CmTarget))).scalars().all())
        assert (await h.post(f"/api/cm/targets/{r.json()['added'][0]['id']}/cancel")).status_code == 200
        bad = _tt_target(tk.id, scheduled_at=_at())
        bad["options"]["hashtags"] = "pas une liste"
        assert (await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [bad]})).status_code == 400
        unknown = {"platform": "youtube", "account": "youtube:@inconnu", "options": {}}
        assert (await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [unknown]})).status_code == 404
        assert len((await pg_session.execute(select(CmTarget))).scalars().all()) == n
        # Post annulé : 409.
        assert (await h.delete(f"/api/cm/posts/{pid}")).status_code == 200
        r = await h.post(f"/api/cm/posts/{pid}/targets", json={"targets": [_tt_target(tk.id)]})
        assert r.status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_patch_target_texts(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/cm/posts", json={
            "title": "Clair", "caption": "Légende commune", "file_name": "a.mp4", "video_size": len(data),
            "targets": [{"platform": "instagram", "account_id": ig.id, "scheduled_at": _at(), "options": {}}]})
        pid = r.json()["post_id"]
        await _send(h, pid, data)
        post = (await h.post(f"/api/cm/posts/{pid}/submit")).json()
        tid = post["targets"][0]["id"]
        patch = {"options": {"caption": "Nouvelle légende", "hashtags": ["piano"]}}
        for _ in range(2):   # renvoyer les mêmes hashtags ne les double pas
            r = await h.patch(f"/api/cm/targets/{tid}", json=patch)
            assert r.status_code == 200, r.text
        t = await pg_session.get(CmTarget, tid)
        await pg_session.refresh(t)
        assert t.options["caption"] == "Nouvelle légende\n\n#piano"
        r = await h.patch(f"/api/cm/targets/{tid}", json={"options": {"collaborators": ["a", "b", "c", "d"]}})
        assert r.status_code == 400
        t.status = "PUBLISHED"
        await pg_session.commit()
        assert (await h.patch(f"/api/cm/targets/{tid}", json=patch)).status_code == 409
