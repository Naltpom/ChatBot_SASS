"""cm.chapote.fr : brouillons automatiques depuis la bibliothèque (recette par dossier).

Drive simulé (fixture `drive` de test_cm_library) ; Gemini simulé ; vraie base jetable.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmAsset, CmProposal, CmSource
from src.services import cm_recipe

from test_cm import _ig_routine, cmenv  # noqa: F401  (fixture)
from test_cm_library import FOLDER, _link, drive  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, tiktok  # noqa: F401  (fixture)


def test_apply_reads_dates_titles_and_accounts():
    r = cm_recipe.clean({"account": {"from": "folder", "level": 1, "map": {"kiwi": ["tiktok:1", "group:9"], "x": ["evil:1"]}},
                         "when": {"pattern": "ymd_hm", "default_time": "18:00", "timezone": "Europe/Paris"},
                         "title": {"from": "folder"}, "caption": {"from": "txt"}, "cover": {"from": "image"}},
                        {"tiktok:1", "group:9"})
    assert r["account"]["map"] == {"kiwi": ["group:9", "tiktok:1"]}          # clé inconnue écartée
    a = CmAsset(name="Le phare.mp4", folder_path="kiwi/2026-12/2026-12-24 18h30 — Le phare", caption="Légende #a")
    got = cm_recipe.apply(r, a, {9: ["instagram:4"]}, [])
    assert got["accounts"] == ["instagram:4", "tiktok:1"] and got["folder"] == "kiwi"
    assert got["scheduled_at"] == datetime(2026, 12, 24, 17, 30) and got["when_from"] == "path"   # Paris -> UTC
    assert got["title"] == "Le phare" and got["caption"] == "Légende #a"
    # Date sans heure : heure par défaut ; motif inconnu : rien d'inventé.
    r["when"]["pattern"] = "ymd"
    got = cm_recipe.apply(r, CmAsset(name="clip.mp4", folder_path="kiwi/2026-07-01"), {}, [])
    assert got["scheduled_at"] == datetime(2026, 7, 1, 16, 0) and got["when_from"] == "date"
    assert cm_recipe.clean({"when": {"pattern": "(a+)+$"}}, set())["when"]["pattern"] == "none"
    # Toujours les mêmes comptes, choisis dans la fenêtre.
    same = cm_recipe.clean({"account": {"from": "source", "map": {"*": ["group:9", "tiktok:1"]}}}, {"tiktok:1", "group:9"})
    assert cm_recipe.apply(same, CmAsset(name="x.mp4", folder_path="a/b"), {9: ["instagram:4"]}, ["youtube:7"])["accounts"] == ["instagram:4", "tiktok:1"]


def test_heuristic_understands_a_typical_layout():
    paths = [f"kiwi/2026-12/2026-12-{d:02d} 18h30 — Histoire {d}/Histoire {d}.mp4" for d in range(1, 9)]
    paths += [f"contes/2026-12/2026-12-{d:02d} 12h30 — Conte {d}/Conte {d}.mp4" for d in range(1, 5)]
    r = cm_recipe.heuristic(paths, {"instagram:1": "@kiwi.signal", "tiktok:2": "contes.automne"}, {})
    assert r["when"]["pattern"] == "ymd_hm" and r["title"]["from"] == "folder"
    assert r["account"]["from"] == "folder" and r["account"]["map"] == {"kiwi": ["instagram:1"], "contes": ["tiktok:2"]}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_analyze_save_propose_then_use_or_dismiss(pg_session, cmenv, drive, tiktok, monkeypatch):
    from test_cm_library import SUB
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u, open_id="r1", display_name="studio.piano")
    ig = await _ig_routine(pg_session, owner=u, username="ghosthands.music")
    await pg_session.commit()
    # Rangement : Studio/<date heure — titre>/vidéo + .txt + couverture.
    later = (utcnow() + timedelta(days=3)).strftime("%Y-%m-%d")
    drive.folders["day1"] = {"name": f"{later} 18h30 — Nocturne", "parent": SUB}
    drive.files["vid3"] = {"name": "Nocturne.mp4", "mimeType": "video/mp4", "parent": "day1", "content": drive.video,
                           "durationMillis": "30000", "modifiedTime": "2026-11-22T10:00:00Z"}
    drive.files["txt3"] = {"name": "Nocturne.txt", "mimeType": "text/plain", "parent": "day1", "content": b"Nocturne #piano",
                           "modifiedTime": "2026-11-22T10:00:00Z"}
    drive.files["jpg3"] = {"name": "couverture.jpg", "mimeType": "image/jpeg", "parent": "day1", "content": b"\xff\xd8",
                           "modifiedTime": "2026-11-22T10:00:00Z"}
    # Vidéo d'un créneau déjà passé (déjà publiée) : jamais proposée.
    drive.folders["day0"] = {"name": "2026-01-05 18h30 — Ancienne", "parent": SUB}
    drive.files["vid0"] = {"name": "Ancienne.mp4", "mimeType": "video/mp4", "parent": "day0", "content": drive.video,
                           "durationMillis": "30000", "modifiedTime": "2026-01-05T10:00:00Z"}
    seen = {}

    async def fake_gemini(listing, accounts, groups):
        seen["listing"], seen["accounts"] = listing, accounts
        return {"account": {"from": "folder", "level": 1, "map": {"Studio": [f"tiktok:{acc.id}", f"instagram:{ig.id}", "tiktok:999"]}},
                "when": {"pattern": "ymd_hm", "default_time": "19:00"}, "title": {"from": "folder"},
                "caption": {"from": "txt"}, "cover": {"from": "image"}, "explication": "Un dossier par compte, un par vidéo."}
    monkeypatch.setattr(cm_recipe, "ask_gemini", fake_gemini)
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        r = await h.post(f"/api/cm/sources/{src['id']}/analyze")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["engine"] == "gemini" and "Studio/" in seen["listing"] and ".mp4" in seen["listing"]
        assert d["recipe"]["account"]["map"] == {"Studio": sorted([f"tiktok:{acc.id}", f"instagram:{ig.id}"])}  # 999 écarté
        ex = next(e for e in d["examples"] if e["path"].endswith("Nocturne.mp4"))
        assert ex["title"] == "Nocturne" and ex["when_from"] == "path" and ex["cover"] is True
        assert sorted(ex["accounts"]) == sorted(["studio.piano", "@ghosthands.music"])
        # Enregistrer sans l'arriéré : rien n'est proposé pour les vidéos déjà là.
        r = await h.put(f"/api/cm/sources/{src['id']}/recipe", json={"recipe": d["recipe"], "auto_drafts": True})
        assert r.json()["proposed"] == 0
        # Nouvelle vidéo déposée par le monteur -> brouillon au prochain passage.
        drive.files["vid4"] = {**drive.files["vid3"], "name": "Prélude.mp4"}
        drive.folders["day2"] = {"name": f"{later} 20h00 — Prélude", "parent": SUB}
        drive.files["vid4"]["parent"] = "day2"
        from src.services import cm_library as lib
        source = await pg_session.get(CmSource, src["id"])
        assert (await lib.scan_source(pg_session, source))["proposed"] == 1
        props = (await h.get("/api/cm/proposals")).json()
        assert len(props) == 1 and props[0]["title"] == "Prélude" and props[0]["when_from"] == "path"
        assert {a["platform"] for a in props[0]["accounts"]} == {"tiktok", "instagram"}
        assert (await h.get("/api/cm/proposals/count")).json()["open"] == 1
        # Programmer cette vidéo (comme le composeur) : brouillon utilisé.
        asset_id = props[0]["asset"]["id"]
        at = (utcnow() + timedelta(days=3)).isoformat() + "Z"
        r = await h.post("/api/cm/posts", json={"title": "Prélude", "asset_id": asset_id, "targets": [
            {"platform": "instagram", "account_id": ig.id, "scheduled_at": at, "options": {}}]})
        assert r.status_code == 200, r.text
        assert (await h.get("/api/cm/proposals/count")).json()["open"] == 0
        # Avec l'arriéré : les vidéos déjà là sont proposées ; écarter = plus jamais proposé.
        r = await h.put(f"/api/cm/sources/{src['id']}/recipe", json={"recipe": d["recipe"], "auto_drafts": False})
        r = await h.put(f"/api/cm/sources/{src['id']}/recipe", json={"recipe": d["recipe"], "auto_drafts": True, "backlog": True})
        assert r.json()["proposed"] >= 1
        assert "Ancienne" not in [p["title"] for p in (await h.get("/api/cm/proposals")).json()]
        first = (await h.get("/api/cm/proposals")).json()[0]
        assert (await h.post(f"/api/cm/proposals/{first['id']}/dismiss")).status_code == 200
        await lib.scan_source(pg_session, source)
        ids = [p["id"] for p in (await h.get("/api/cm/proposals")).json()]
        assert first["id"] not in ids
        assets = (await pg_session.execute(select(CmAsset).where(CmAsset.name == "Nocturne.mp4"))).scalar_one()
        assert assets.cover_file_id == "jpg3" and assets.caption == "Nocturne #piano"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_analyze_without_gemini_uses_rules_and_needs_admin(pg_session, cmenv, drive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        d = (await h.post(f"/api/cm/sources/{src['id']}/analyze")).json()
        assert d["engine"] == "regles" and d["recipe"]["version"] == 1 and d["videos"] == 2
        r = await h.post(f"/api/cm/sources/{src['id']}/recipe/preview", json={"recipe": {"title": {"from": "file"}}})
        assert r.status_code == 200 and r.json()["recipe"]["title"]["from"] == "file"
    assert (await pg_session.execute(select(CmProposal))).scalars().all() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_library_cover_downloaded_with_video(pg_session, cmenv, drive, tiktok):
    from test_cm_library import SUB
    from src.models.cm import CmPost
    from src.services import cm_library as lib
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    drive.files["vid5"] = {"name": "Nocturne.mp4", "mimeType": "video/mp4", "parent": SUB, "content": drive.video,
                           "durationMillis": "30000", "modifiedTime": "2026-11-22T10:00:00Z"}
    drive.files["jpg5"] = {"name": "Nocturne.jpg", "mimeType": "image/jpeg", "parent": SUB,
                           "content": b"\xff\xd8\xff\xe0" + b"\x00" * 64, "modifiedTime": "2026-11-22T10:00:00Z"}
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        a = (await pg_session.execute(select(CmAsset).where(CmAsset.file_id == "vid5"))).scalar_one()
        assert a.cover_file_id == "jpg5"
        at = (utcnow() + timedelta(days=1)).isoformat() + "Z"
        r = await h.post("/api/cm/posts", json={"title": "Nocturne", "asset_id": a.id, "targets": [
            {"platform": "instagram", "account_id": ig.id, "scheduled_at": at, "options": {}}]})
        assert r.status_code == 200, r.text
    post = await lib.ensure_media(pg_session, r.json()["post_id"])
    assert post.cover_path and post.cover_path.endswith(".jpg")
    assert open(post.cover_path, "rb").read() == drive.files["jpg5"]["content"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_proposal_count_follows_the_filter(pg_session, cmenv, drive, tiktok):
    from src.models.cm import CmGroup, CmGroupAccount
    u = await _user(pg_session, "a@t.dev")
    a1 = await _account(pg_session, owner=u, open_id="c1")
    a2 = await _account(pg_session, owner=u, open_id="c2")
    g = CmGroup(owner_user_id=u.id, name="Neuron")
    pg_session.add(g)
    await pg_session.flush()
    pg_session.add(CmGroupAccount(group_id=g.id, platform="tiktok", account_id=a1.id))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        await h.post("/api/cm/sources", json={"url": _link()})
        assets = (await pg_session.execute(select(CmAsset))).scalars().all()
        src = (await pg_session.execute(select(CmSource))).scalar_one()
        pg_session.add_all([CmProposal(owner_user_id=u.id, source_id=src.id, asset_id=assets[0].id, accounts=[f"tiktok:{a1.id}"]),
                            CmProposal(owner_user_id=u.id, source_id=src.id, asset_id=assets[1].id, accounts=[f"tiktok:{a2.id}"])])
        await pg_session.commit()
        assert (await h.get("/api/cm/proposals/count")).json()["open"] == 2
        assert (await h.get(f"/api/cm/proposals/count?group_id={g.id}")).json()["open"] == 1
        assert (await h.get(f"/api/cm/proposals/count?account=tiktok:{a2.id}")).json()["open"] == 1
        assert len((await h.get(f"/api/cm/proposals?group_id={g.id}")).json()) == 1
        assert len((await h.get("/api/cm/proposals")).json()) == 2
