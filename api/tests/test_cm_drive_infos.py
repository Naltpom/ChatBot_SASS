"""cm.chapote.fr : infos.json des dossiers rangés par l'outil (claude-cloud) — archives publiées, vidéos
programmées par l'API, réserves ; référence des publications ; archivage en masse ; champs par plateforme."""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmAsset, CmPost, CmProposal, CmSource
from src.services import cm_library as lib
from src.services import cm_recipe

from test_cm import _ig_routine, _tt_target, cmenv  # noqa: F401  (fixture)
from test_cm_library import FOLDER, SUB, _link, drive  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)


def test_classify():
    assert lib.classify({"compte": "kiwi", "id": "k1", "statut": "publiee"}, "kiwi/2026-11/x") == ("published", "kiwi/k1")
    assert lib.classify({"statut": "prete", "plateformes": {"instagram": {"lien": "https://www.instagram.com/reel/A/"}}}, "a")[0] == "published"
    assert lib.classify({"compte": "kiwi", "id": "k2", "statut": "prete", "heure": "2026-12-01T18:30:00+01:00"}, "a") == ("routine", "kiwi/k2")
    assert lib.classify({"statut": "prete"}, "kiwi/réserves/r1 — Titre")[0] == "reserve"
    assert lib.classify(None, "kiwi/Réserves/x") == ("reserve", None)
    assert lib.classify(None, "kiwi/2026-11/x") == (None, None)
    conte = {"compte": "contes", "id": "khm-40", "parties": {"1": {"statut": "publiee"}, "2": {"statut": "prete", "heure": "x"}}}
    assert lib.classify(lib.infos_for(conte, "Le Voleur — partie 1.mp4"), "contes/KHM-040")[0] == "published"
    assert lib.classify(lib.infos_for(conte, "Le Voleur — partie 2.mp4"), "contes/KHM-040")[0] == "routine"
    contes = {"compte": "contes", "id": "khm-040", "parties": {
        "1": {"statut": "publiee", "id": "khm-040-p1"}, "2": {"statut": "prete", "heure": None, "id": "khm-040-p2"},
        "3": {"statut": None, "heure": None, "id": "khm-040-p3"}, "longue": {"statut": None, "id": "khm-040-longue"}}}
    assert lib.classify(lib.infos_for(contes, "Le Voleur — partie 2.mp4"), "contes/KHM-040") == ("routine", "contes/khm-040-p2")
    assert lib.classify(lib.infos_for(contes, "Le Voleur — partie 3.mp4"), "contes/KHM-040") == ("waiting", "contes/khm-040-p3")
    assert lib.classify(lib.infos_for(contes, "Le Voleur — version longue.mp4"), "contes/KHM-040") == ("waiting", "contes/khm-040-longue")
    assert lib.classify({"compte": "contes", "id": "x"}, "contes/KHM-1") == ("waiting", "contes/x")


def _video(drive, fid, folder, name, infos=None):
    drive.files[fid] = {"name": name, "mimeType": "video/mp4", "parent": folder, "content": drive.video,
                        "durationMillis": "30000", "modifiedTime": "2026-11-22T10:00:00Z"}
    if infos is not None:
        drive.files[f"{fid}-infos"] = {"name": "infos.json", "mimeType": "application/json", "parent": folder,
                                       "content": json.dumps(infos).encode(), "modifiedTime": "2026-11-22T10:00:00Z"}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_archives_reserves_and_api_posts_are_never_proposed(pg_session, cmenv, drive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    soon = (utcnow() + timedelta(days=2)).strftime("%Y-%m-%d")
    for fid, name, infos in (
        ("pub", f"{soon} 18h30 — Publiée", {"compte": "ghost-hands", "id": "g1", "statut": "publiee",
                                            "plateformes": {"instagram": {"lien": "https://www.instagram.com/reel/AAA/"},
                                                            "youtube": {"video_id": "yt123"}}}),
        ("api", f"{soon} 19h10 — Programmée", {"compte": "ghost-hands", "id": "g2", "statut": "prete", "heure": f"{soon}T19:10:00+01:00"}),
        ("new", f"{soon} 20h00 — Nouvelle", None),
    ):
        drive.folders[f"d-{fid}"] = {"name": name, "parent": SUB}
        _video(drive, fid, f"d-{fid}", f"{fid}.mp4", infos)
    drive.folders["res"] = {"name": "réserves", "parent": FOLDER}
    drive.folders["res1"] = {"name": "r9 — Réserve", "parent": "res"}
    _video(drive, "rsv", "res1", "rsv.mp4")
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        kinds = {a.file_id: a.kind for a in (await pg_session.execute(select(CmAsset))).scalars()}
        assert kinds["pub"] == "published" and kinds["api"] == "routine" and kinds["rsv"] == "reserve" and kinds["new"] is None
        pub = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == "pub.mp4")
        assert pub["links"] == {"instagram": "https://www.instagram.com/reel/AAA/", "youtube": "https://youtube.com/shorts/yt123"}
        assert "pub.mp4" not in [a["name"] for a in (await h.get("/api/cm/assets?state=new")).json()]
        assert "rsv.mp4" in [a["name"] for a in (await h.get("/api/cm/assets?state=new")).json()]
        # Brouillons (avec l'arriéré) : seulement la vidéo ordinaire.
        recipe = {**cm_recipe.default_recipe(), "account": {"from": "source", "level": 1, "map": {"*": [f"instagram:{ig.id}"]}},
                  "when": {"pattern": "ymd_hm", "default_time": "18:00", "timezone": "Europe/Paris"}}
        r = await h.put(f"/api/cm/sources/{src['id']}/recipe", json={"recipe": recipe, "auto_drafts": True, "backlog": True})
        names = [p["asset"]["name"] for p in (await h.get("/api/cm/proposals")).json()]
        assert names.count("new.mp4") == 1 and not {"pub.mp4", "api.mp4", "rsv.mp4"} & set(names)
        # La publication arrive par l'API avec sa référence : rattachée à la vidéo du Drive ; doublon refusé.
        body = {"title": "Programmée", "video_size": 1000, "file_name": "api.mp4", "ref": "ghost-hands/g2",
                "targets": [{"platform": "instagram", "account": f"instagram:@{ig.username}", "options": {},
                             "scheduled_at": (utcnow() + timedelta(days=2)).isoformat() + "Z"}]}
        r = await h.post("/api/cm/posts", json=body)
        assert r.status_code == 200, r.text
        post = await pg_session.get(CmPost, r.json()["post_id"])
        asset_api = (await pg_session.execute(select(CmAsset).where(CmAsset.file_id == "api"))).scalar_one()
        assert post.ref == "ghost-hands/g2" and post.asset_id == asset_api.id
        dup = await h.post("/api/cm/posts", json=body)
        assert dup.status_code == 409 and dup.json()["detail"]["code"] == "duplicate_ref" and dup.json()["detail"]["post_id"] == post.id
        # infos.json ajouté plus tard sur une vidéo déjà proposée : le brouillon passe en archive.
        _video(drive, "new", "d-new", "new.mp4", {"compte": "ghost-hands", "id": "g3", "statut": "publiee"})
        source = await pg_session.get(CmSource, src["id"])
        await lib.scan_source(pg_session, source)
        assert "new.mp4" not in [p["asset"]["name"] for p in (await h.get("/api/cm/proposals")).json()]
        st = {p.status for p in (await pg_session.execute(select(CmProposal))).scalars()}
        assert "archived" in st


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_bulk_archive_publishes_nothing(pg_session, cmenv, drive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        assets = (await pg_session.execute(select(CmAsset))).scalars().all()
        pg_session.add_all([CmProposal(owner_user_id=u.id, source_id=src["id"], asset_id=a.id, accounts=[]) for a in assets])
        await pg_session.commit()
        assert (await h.get("/api/cm/proposals/count")).json()["open"] == len(assets)
        r = await h.post("/api/cm/proposals/archive", json={"source_id": src["id"]})
        assert r.json() == {"archived": len(assets)}
        assert (await h.get("/api/cm/proposals/count")).json()["open"] == 0
        assert (await pg_session.execute(select(CmPost))).scalars().all() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_platform_fields_and_fallbacks(pg_session, cmenv, tiktok):
    from src.models.cm import CmTarget
    u = await _user(pg_session, "a@t.dev")
    tk = await _account(pg_session, owner=u, open_id="pf1")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    at = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        t = _tt_target(tk.id, scheduled_at=at)
        t["options"].update({"caption": "Clair de lune #piano", "hashtags": ["piano", "#debussy"]})
        body = {"title": "Clair", "caption": "Légende commune", "video_size": 1000, "file_name": "a.mp4", "targets": [
            t, {"platform": "instagram", "account_id": ig.id, "scheduled_at": at,
                "options": {"collaborators": ["@ami.music"], "hashtags": ["shorts"]}}]}
        r = await h.post("/api/cm/posts", json=body)
        assert r.status_code == 200, r.text
        rows = {x.platform: x.options for x in (await pg_session.execute(select(CmTarget))).scalars()}
        assert rows["tiktok"]["title"] == "Clair de lune #piano\n\n#debussy"
        assert rows["instagram"]["caption"] == "Légende commune\n\n#shorts" and rows["instagram"]["collaborators"] == ["ami.music"]
        bad = {**body, "targets": [{"platform": "instagram", "account_id": ig.id, "scheduled_at": at,
                                    "options": {"collaborators": ["a", "b", "c", "d"]}}]}
        assert (await h.post("/api/cm/posts", json=bad)).status_code == 400


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_conte_parts_are_never_to_validate(pg_session, cmenv, drive, tiktok):
    u = await _user(pg_session, "a@t.dev")
    ig = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    drive.folders["khm"] = {"name": "KHM-040 — Le Voleur", "parent": SUB}
    names = {"p1": "Le Voleur — partie 1.mp4", "p2": "Le Voleur — partie 2.mp4",
             "p3": "Le Voleur — partie 3.mp4", "lg": "Le Voleur — version longue.mp4"}
    for fid, name in names.items():
        _video(drive, fid, "khm", name)
    async with Client(pg_session) as c:
        h = c.as_(u)
        src = (await h.post("/api/cm/sources", json={"url": _link()})).json()
        # Avant l'infos.json : vidéos ordinaires, proposées en brouillons (l'arriéré).
        recipe = {**cm_recipe.default_recipe(), "account": {"from": "source", "level": 1, "map": {"*": [f"instagram:{ig.id}"]}}}
        await h.put(f"/api/cm/sources/{src['id']}/recipe", json={"recipe": recipe, "auto_drafts": True, "backlog": True})
        async def conte_drafts():
            return {p["asset"]["name"] for p in (await h.get("/api/cm/proposals")).json()} & set(names.values())
        assert await conte_drafts() == set(names.values())
        # L'outil ajoute l'infos.json du conte : tout est reclassé, plus rien « à valider », rien publié.
        drive.files["khm-infos"] = {"name": "infos.json", "mimeType": "application/json", "parent": "khm",
                                    "modifiedTime": "2026-11-23T10:00:00Z", "content": json.dumps({
                                        "compte": "contes", "id": "khm-040", "parties": {
                                            "1": {"statut": "publiee", "id": "khm-040-p1", "plateformes": {"instagram": {"lien": "https://www.instagram.com/reel/B/"}}},
                                            "2": {"statut": "prete", "heure": None, "id": "khm-040-p2"},
                                            "3": {"statut": None, "id": "khm-040-p3"},
                                            "longue": {"statut": None, "id": "khm-040-longue"}}}).encode()}
        await lib.scan_source(pg_session, await pg_session.get(CmSource, src["id"]))
        kinds = {a.file_id: (a.kind, a.origin_ref) for a in (await pg_session.execute(select(CmAsset))).scalars()}
        assert kinds["p1"] == ("published", "contes/khm-040-p1") and kinds["p2"] == ("routine", "contes/khm-040-p2")
        assert kinds["p3"] == ("waiting", "contes/khm-040-p3") and kinds["lg"] == ("waiting", "contes/khm-040-longue")
        assert await conte_drafts() == set()
        assert (await pg_session.execute(select(CmPost))).scalars().all() == []
        new = [a["name"] for a in (await h.get("/api/cm/assets?state=new")).json()]
        assert not set(names.values()) & set(new)
        lg = next(a for a in (await h.get("/api/cm/assets")).json() if a["name"] == names["lg"])
        assert lg["kind"] == "waiting"
        # Une nouvelle relecture ne recrée aucun brouillon.
        await lib.scan_source(pg_session, await pg_session.get(CmSource, src["id"]))
        assert await conte_drafts() == set()
        # La partie 2 arrive par l'API avec sa ref : rattachée, doublon refusé.
        body = {"title": "Le Voleur 2", "video_size": 1000, "file_name": "p2.mp4", "ref": "contes/khm-040-p2",
                "targets": [{"platform": "instagram", "account": f"instagram:@{ig.username}", "options": {},
                             "scheduled_at": (utcnow() + timedelta(days=1)).isoformat() + "Z"}]}
        r = await h.post("/api/cm/posts", json=body)
        assert r.status_code == 200, r.text
        assert (await pg_session.get(CmPost, r.json()["post_id"])).asset_id is not None
        assert (await h.post("/api/cm/posts", json=body)).status_code == 409
