"""cm.chapote.fr — groupes de comptes, calendrier (rétrospective + planning) et statistiques.

Vraie base jetable (`real_db`), authentification réelle par le cookie de session.
Couvre : création / modification / suppression d'un groupe, un compte dans
plusieurs groupes, filtre ?group_id= (comptes, vidéos, tableau de bord, planning,
calendrier, statistiques), isolation entre tenants, calendrier qui mêle vidéos
relevées chez les plateformes et publications programmées (sans doublon), et
agrégats des statistiques (par plateforme, par compte, taux d'engagement).
"""
from datetime import timedelta

import pytest

from src.core.time import utcnow
from src.models.cm import CmAccountStat, CmGroupAccount, CmVideo, CmMemberRole
from src.services import cm_service as cm

from test_cm import SERVICE, _ig_routine, _publish, _tt_target, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _org, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)
from test_tiktok import _account as _tt_account
from test_youtube import _account as _yt_account


async def _setup(db):
    a = await _user(db, "a@t.dev")
    tt1 = await _tt_account(db, owner=a, open_id="oid-1")
    tt2 = await _tt_account(db, owner=a, open_id="oid-2", display_name="second.compte")
    yt1 = await _yt_account(db, owner=a)
    ig1 = await _ig_routine(db, owner=a)
    await db.commit()
    return a, tt1, tt2, yt1, ig1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_group_crud_and_account_in_several_groups(pg_session, cmenv):
    a, tt1, tt2, yt1, ig1 = await _setup(pg_session)
    async with Client(pg_session) as c:
        h = c.as_(a)
        r = await h.post("/api/cm/groups", json={"name": "  Ghost   Hands ", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}, {"platform": "youtube", "account_id": yt1.id},
            {"platform": "tiktok", "account_id": tt1.id}]})
        assert r.status_code == 200, r.text
        g1 = r.json()
        assert g1["name"] == "Ghost Hands" and g1["color"]
        assert g1["accounts"] == [{"platform": "tiktok", "id": tt1.id}, {"platform": "youtube", "id": yt1.id}]

        # Le même compte TikTok dans un second groupe.
        r = await h.post("/api/cm/groups", json={"name": "Musique", "color": "green", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}, {"platform": "instagram", "account_id": ig1.id}]})
        g2 = r.json()
        assert r.status_code == 200 and g2["color"] == "green"

        groups = (await h.get("/api/cm/groups")).json()
        assert [g["name"] for g in groups] == ["Ghost Hands", "Musique"]

        # Modification : nom et membres remplacés.
        r = await h.patch(f"/api/cm/groups/{g1['id']}", json={"name": "GH", "accounts": [
            {"platform": "tiktok", "account_id": tt2.id}]})
        assert r.status_code == 200 and r.json()["accounts"] == [{"platform": "tiktok", "id": tt2.id}]
        assert r.json()["name"] == "GH"

        # Compte inconnu, nom vide, couleur inconnue : refusés.
        r = await h.patch(f"/api/cm/groups/{g1['id']}", json={"accounts": [{"platform": "youtube", "account_id": 99999}]})
        assert r.status_code == 404
        assert (await h.post("/api/cm/groups", json={"name": "   "})).status_code == 400
        assert (await h.post("/api/cm/groups", json={"name": "x", "color": "red"})).status_code == 422

        # Filtre des comptes par groupe.
        accs = (await h.get(f"/api/cm/accounts?group_id={g2['id']}")).json()
        assert sorted((x["platform"], x["id"]) for x in accs) == [("instagram", ig1.id), ("tiktok", tt1.id)]

        # Suppression : le groupe seulement.
        assert (await h.delete(f"/api/cm/groups/{g1['id']}")).json() == {"ok": True}
        assert [g["id"] for g in (await h.get("/api/cm/groups")).json()] == [g2["id"]]
        assert len((await h.get("/api/cm/accounts")).json()) == 4
        assert (await h.get(f"/api/cm/accounts?group_id={g1['id']}")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_groups_are_isolated_between_tenants(pg_session, cmenv):
    a, tt1, *_ = await _setup(pg_session)
    b = await _user(pg_session, "b@t.dev")
    member = await _user(pg_session, "m@t.dev")
    org = await _org(pg_session, a, (member, "member"))
    org_acc = await _tt_account(pg_session, org=org, by=a, open_id="oid-org")
    await pg_session.commit()
    async with Client(pg_session) as c:
        g = (await c.as_(a).post("/api/cm/groups", json={"name": "Perso", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}]})).json()
        hb = c.as_(b)
        assert (await hb.get("/api/cm/groups")).json() == []
        assert (await hb.patch(f"/api/cm/groups/{g['id']}", json={"name": "x"})).status_code == 404
        assert (await hb.delete(f"/api/cm/groups/{g['id']}")).status_code == 404
        assert (await hb.get(f"/api/cm/overview?group_id={g['id']}")).status_code == 404
        # Un compte d'un autre tenant ne peut pas entrer dans un groupe.
        r = await hb.post("/api/cm/groups", json={"name": "x", "accounts": [{"platform": "tiktok", "account_id": tt1.id}]})
        assert r.status_code == 404
        # Groupe d'équipe : comptes de l'équipe seulement ; invisible depuis l'espace perso.
        # Gérer les groupes d'une équipe demande le rôle admin dans cm.
        pg_session.add(CmMemberRole(organization_id=org.id, email=member.email, role="admin"))
        await pg_session.commit()
        hm = c.as_(member)
        r = await hm.post("/api/cm/groups", json={"org_id": org.id, "name": "Équipe", "accounts": [
            {"platform": "tiktok", "account_id": org_acc.id}]})
        assert r.status_code == 200, r.text
        r2 = await hm.post("/api/cm/groups", json={"org_id": org.id, "name": "x", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}]})
        assert r2.status_code == 404
        assert (await hm.get("/api/cm/groups")).json() == []
        assert [x["name"] for x in (await hm.get(f"/api/cm/groups?org_id={org.id}")).json()] == ["Équipe"]
        # Le groupe perso de « a » n'est pas utilisable dans l'équipe.
        assert (await c.as_(a).get(f"/api/cm/accounts?org_id={org.id}&group_id={g['id']}")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_group_filter_on_videos_overview_and_planning(pg_session, cmenv, tiktok):
    a, tt1, tt2, yt1, _ = await _setup(pg_session)
    now = utcnow()
    for acc, views in ((tt1, 1000), (tt2, 50)):
        pg_session.add(CmVideo(platform="tiktok", account_id=acc.id, external_id=f"v{acc.id}", title=f"v{acc.id}",
                               published_at=now - timedelta(days=2), views=views, likes=10))
        pg_session.add(CmAccountStat(platform="tiktok", account_id=acc.id, day=now.date(), followers=views, views=views))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        g = (await h.post("/api/cm/groups", json={"name": "G", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}]})).json()
        vids = (await h.get(f"/api/cm/videos?group_id={g['id']}")).json()
        assert [v["account_id"] for v in vids] == [tt1.id]
        assert len((await h.get("/api/cm/videos?sort=likes")).json()) == 2

        ov = (await h.get(f"/api/cm/overview?group_id={g['id']}")).json()
        assert ov["totals"]["accounts"] == 1 and ov["totals"]["followers"] == 1000
        assert (await h.get("/api/cm/overview")).json()["totals"]["followers"] == 1050

        # Planning : seule la cible du compte du groupe est renvoyée.
        when = (now + timedelta(days=1)).isoformat() + "Z"
        _, r = await _publish(h, [_tt_target(tt1.id, scheduled_at=when), _tt_target(tt2.id, scheduled_at=when)],
                              mp4_bytes(5_000))
        assert r.status_code == 200, r.text
        posts = (await h.get(f"/api/cm/posts?group_id={g['id']}")).json()
        assert [[t["account_id"] for t in p["targets"]] for p in posts] == [[tt1.id]]
        assert len((await h.get("/api/cm/posts")).json()[0]["targets"]) == 2
        assert ov["totals"]["upcoming"] == 0
        assert (await h.get(f"/api/cm/overview?group_id={g['id']}")).json()["totals"]["upcoming"] == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_calendar_mixes_platform_videos_and_scheduled_posts(pg_session, cmenv, tiktok):
    a, tt1, tt2, yt1, _ = await _setup(pg_session)
    now = utcnow()
    pg_session.add(CmVideo(platform="youtube", account_id=yt1.id, external_id="yt9", title="Short d'hier",
                           published_at=now - timedelta(days=1), views=420, likes=20, comments=3))
    pg_session.add(CmVideo(platform="tiktok", account_id=tt1.id, external_id="old", title="Trop vieux",
                           published_at=now - timedelta(days=60), views=1))
    for d, f in ((3, 100), (2, 110), (1, 125), (0, 130)):
        pg_session.add(CmAccountStat(platform="youtube", account_id=yt1.id, day=(now - timedelta(days=d)).date(),
                                     followers=f, views=f * 10))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        when = (now + timedelta(days=2)).isoformat() + "Z"
        _, r = await _publish(h, [_tt_target(tt1.id, scheduled_at=when)], mp4_bytes(5_000))
        assert r.status_code == 200, r.text
        start = (now - timedelta(days=7)).isoformat() + "Z"
        end = (now + timedelta(days=7)).isoformat() + "Z"
        cal = (await h.get("/api/cm/calendar", params={"start": start, "end": end})).json()
        kinds = [(i["kind"], i["platform"], i.get("views")) for i in cal["items"]]
        assert kinds == [("video", "youtube", 420), ("target", "tiktok", None)]
        assert cal["items"][1]["title"] == "Clair de lune" and cal["items"][1]["status"] == "SCHEDULED"
        by_day = {d["day"]: d for d in cal["days"]}
        assert by_day[(now - timedelta(days=1)).date().isoformat()]["followers_delta"] == 15
        assert by_day[now.date().isoformat()]["followers"] == 130

        # Groupe sans YouTube : la vidéo YouTube disparaît.
        g = (await h.post("/api/cm/groups", json={"name": "TT", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}]})).json()
        cal = (await h.get("/api/cm/calendar", params={"start": start, "end": end, "group_id": g["id"]})).json()
        assert [i["kind"] for i in cal["items"]] == ["target"]

        # Période trop longue ou inversée.
        r = await h.get("/api/cm/calendar", params={"start": start, "end": (now + timedelta(days=200)).isoformat() + "Z"})
        assert r.status_code == 400
        assert (await h.get("/api/cm/calendar", params={"start": end, "end": start})).status_code == 400

        # Une publication Chapote déjà relevée chez la plateforme n'apparaît qu'une fois.
        cal = (await h.get("/api/cm/calendar", params={"start": start, "end": end})).json()
        target = next(i for i in cal["items"] if i["kind"] == "target")
        from src.models.cm import CmTarget
        t = await pg_session.get(CmTarget, target["id"])
        t.status, t.external_id, t.published_at, t.scheduled_at = "PUBLISHED", "tt77", now, now
        await cm.upsert_video(pg_session, "tiktok", tt1.id, "tt77", title="Clair de lune",
                              published_at=now, views=99)
        await pg_session.commit()
        cal = (await h.get("/api/cm/calendar", params={"start": start, "end": end})).json()
        tiktok_items = [i for i in cal["items"] if i["platform"] == "tiktok"]
        assert [(i["kind"], i["views"], i["via_chapote"]) for i in tiktok_items] == [("video", 99, True)]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_detailed_stats_per_platform_and_account(pg_session, cmenv):
    a, tt1, tt2, yt1, ig1 = await _setup(pg_session)
    now = utcnow()
    rows = [("tiktok", tt1.id, 1000, 100, 10, 5, None), ("tiktok", tt1.id, 3000, 200, 20, 15, None),
            ("youtube", yt1.id, 500, 50, 5, None, None), ("instagram", ig1.id, 2000, 100, 10, 30, 60)]
    for i, (p, aid, views, likes, comments, shares, saves) in enumerate(rows):
        pg_session.add(CmVideo(platform=p, account_id=aid, external_id=f"x{i}", published_at=now - timedelta(days=i + 1),
                               views=views, likes=likes, comments=comments, shares=shares, saves=saves))
    pg_session.add(CmVideo(platform="tiktok", account_id=tt2.id, external_id="vieux",
                           published_at=now - timedelta(days=90), views=10 ** 6))
    pg_session.add(CmAccountStat(platform="tiktok", account_id=tt1.id, day=(now - timedelta(days=30)).date(), followers=800))
    pg_session.add(CmAccountStat(platform="tiktok", account_id=tt1.id, day=now.date(), followers=1000))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        st = (await h.get("/api/cm/stats?days=30")).json()
        assert st["totals"]["posts"] == 4 and st["totals"]["views"] == 6500 and st["totals"]["accounts"] == 4
        tt = next(p for p in st["platforms"] if p["platform"] == "tiktok")
        assert tt["posts"] == 2 and tt["views"] == 4000 and tt["avg_views"] == 2000
        assert tt["interactions"] == 350 and tt["engagement_rate"] == round(350 / 4000, 4)
        assert tt["followers"] == 1000 and tt["followers_delta"] == 200
        assert "saves" not in tt["metrics"] and "shares" in tt["metrics"]
        acc = next(r for r in st["accounts"] if r["platform"] == "tiktok" and r["id"] == tt1.id)
        assert acc["posts"] == 2 and acc["followers_delta"] == 200
        assert st["accounts"][0]["id"] == tt1.id          # tri par vues
        assert len(st["posts"]) == 4 and {"published_at", "views", "interactions"} <= set(st["posts"][0])

        g = (await h.post("/api/cm/groups", json={"name": "IG", "accounts": [
            {"platform": "instagram", "account_id": ig1.id}]})).json()
        st = (await h.get(f"/api/cm/stats?days=30&group_id={g['id']}")).json()
        assert [p["platform"] for p in st["platforms"]] == ["instagram"]
        assert st["totals"]["saves"] == 60 and st["totals"]["shares"] == 30


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disconnected_account_leaves_groups_silently(pg_session, cmenv):
    a, tt1, tt2, *_ = await _setup(pg_session)
    async with Client(pg_session) as c:
        h = c.as_(a)
        g = (await h.post("/api/cm/groups", json={"name": "G", "accounts": [
            {"platform": "tiktok", "account_id": tt1.id}, {"platform": "tiktok", "account_id": tt2.id}]})).json()
        tt2.revoked_at = utcnow()
        await pg_session.commit()
        assert (await h.get("/api/cm/groups")).json()[0]["accounts"] == [{"platform": "tiktok", "id": tt1.id}]
        assert len((await h.get(f"/api/cm/accounts?group_id={g['id']}")).json()) == 1
        # Le lien reste en base (retrouvé si le compte revient) mais n'est jamais exposé.
        from sqlalchemy import select
        assert len((await pg_session.execute(select(CmGroupAccount))).scalars().all()) == 2


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_videos_and_posts_are_paginated(pg_session, cmenv, tiktok):
    a, tt1, *_ = await _setup(pg_session)
    now = utcnow()
    for i in range(7):
        pg_session.add(CmVideo(platform="tiktok", account_id=tt1.id, external_id=f"p{i}", title=f"v{i}",
                               published_at=now - timedelta(hours=i), views=i))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        seen, cursor, pages = [], None, 0
        while True:
            r = await h.get("/api/cm/videos", params={"limit": 3, **({"cursor": cursor} if cursor else {})})
            assert r.status_code == 200, r.text
            seen += [v["title"] for v in r.json()]
            pages += 1
            cursor = r.headers.get("x-next-cursor")
            if not cursor:
                break
        assert pages == 3 and seen == [f"v{i}" for i in range(7)]
        # Sans limite explicite : comportement inchangé (une liste, pas d'en-tête s'il n'y a pas de suite).
        r = await h.get("/api/cm/videos")
        assert len(r.json()) == 7 and "x-next-cursor" not in r.headers
        assert (await h.get("/api/cm/videos", params={"cursor": "n'importe quoi"})).status_code == 400

        when = (now + timedelta(days=1)).isoformat() + "Z"
        for _ in range(3):
            _, r = await _publish(h, [_tt_target(tt1.id, scheduled_at=when)], mp4_bytes(3_000))
            assert r.status_code == 200, r.text
        r = await h.get("/api/cm/posts", params={"limit": 2})
        assert len(r.json()) == 2 and r.headers.get("x-next-cursor")
        r2 = await h.get("/api/cm/posts", params={"limit": 2, "cursor": r.headers["x-next-cursor"]})
        assert len(r2.json()) == 1 and "x-next-cursor" not in r2.headers
        assert {p["id"] for p in r.json()}.isdisjoint({p["id"] for p in r2.json()})
