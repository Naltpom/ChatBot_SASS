"""cm.chapote.fr : listes à grande échelle (recherche, tri dans les deux sens, pages keyset).

Vraie base jetable.
"""
import base64
from datetime import timedelta

import pytest

from src.core.time import utcnow
from src.models.cm import CmAccountStat, CmVideo

from test_cm import _ig_routine, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, tiktok  # noqa: F401  (fixture)


async def _all_pages(h, url, limit=7):
    seen, cursor, pages = [], None, 0
    while True:
        r = await h.get(url + f"&limit={limit}" + (f"&cursor={cursor}" if cursor else ""))
        assert r.status_code == 200, r.text
        seen += r.json()
        cursor = r.headers.get("X-Next-Cursor")
        pages += 1
        if not cursor:
            return seen, pages


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_videos_search_sort_and_keyset(pg_session, cmenv, tiktok):
    me = await _user(pg_session, "listes@t.dev")
    other = await _user(pg_session, "autre@t.dev")
    acc = await _account(pg_session, owner=me, open_id="l1")
    foreign = await _account(pg_session, owner=other, open_id="l2")
    now = utcnow()
    for i in range(30):
        pg_session.add(CmVideo(platform="tiktok", account_id=acc.id, external_id=f"v{i}",
                               title=f"Clair de lune {i}" if i % 3 == 0 else f"Piano {i}",
                               views=None if i % 10 == 0 else (i * 7) % 11,   # NULL et égalités
                               published_at=now - timedelta(hours=i)))
    pg_session.add(CmVideo(platform="tiktok", account_id=foreign.id, external_id="x", title="Clair de lune secret", views=999))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(me)
        for order in ("desc", "asc"):
            rows, pages = await _all_pages(h, f"/api/cm/videos?sort=views&order={order}")
            assert len(rows) == 30 and len({r["id"] for r in rows}) == 30 and pages == 5   # ni doublon ni trou
            vals = [r["views"] for r in rows]
            known = [v for v in vals if v is not None]
            assert vals[-len([v for v in vals if v is None]):] == [None] * 3              # NULL en fin
            assert known == sorted(known, reverse=order == "desc")
        rows, _ = await _all_pages(h, "/api/cm/videos?sort=recent&order=asc")
        assert [r["external_id"] for r in rows][:2] == ["v29", "v28"]
        rows, _ = await _all_pages(h, "/api/cm/videos?sort=title")
        assert [r["title"] for r in rows] == sorted(r["title"] for r in rows)
        # Recherche : insensible à la casse, jamais les vidéos d'un autre espace ; % pris à la lettre.
        rows, _ = await _all_pages(h, "/api/cm/videos?q=CLAIR%20de")
        assert len(rows) == 10 and all("Clair" in r["title"] for r in rows)
        assert (await h.get("/api/cm/videos?q=%25")).json() == []
        # Ancien curseur (offset) encore lu ; curseur invalide refusé.
        old = base64.urlsafe_b64encode(b"o:25").decode().rstrip("=")
        assert len((await h.get(f"/api/cm/videos?cursor={old}")).json()) == 5
        assert (await h.get("/api/cm/videos?cursor=zzz")).status_code == 400


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_accounts_and_stats_search_and_sort(pg_session, cmenv, tiktok):
    me = await _user(pg_session, "stats@t.dev")
    a = await _account(pg_session, owner=me, open_id="s1", display_name="alpha.music")
    b = await _account(pg_session, owner=me, open_id="s2", display_name="beta.contes")
    ig = await _ig_routine(pg_session, owner=me, username="gamma.piano")
    today = utcnow().date()
    for acc, plat, f in ((a, "tiktok", 100), (b, "tiktok", 300), (ig, "instagram", 200)):
        for d, delta in ((0, 0), (10, -50)):
            pg_session.add(CmAccountStat(platform=plat, account_id=acc.id, day=today - timedelta(days=d),
                                         followers=f + delta, views=f * 10 + delta))
        pg_session.add(CmVideo(platform=plat, account_id=acc.id, external_id=f"e{acc.id}", views=f,
                               published_at=utcnow() - timedelta(days=1)))
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(me)
        names = lambda r: [x["name"] for x in r.json()]  # noqa: E731
        assert names(await h.get("/api/cm/accounts?sort=followers&order=desc")) == ["beta.contes", "@gamma.piano", "alpha.music"]
        assert names(await h.get("/api/cm/accounts?sort=name")) == ["alpha.music", "beta.contes", "@gamma.piano"]
        assert names(await h.get("/api/cm/accounts?q=PIANO")) == ["@gamma.piano"]
        acc = (await h.get("/api/cm/accounts?days=7&q=beta")).json()[0]
        assert acc["stats"]["followers"] == 300 and acc["stats"]["delta_followers"] == 50
        st = (await h.get("/api/cm/stats?days=7&sort=views&order=asc")).json()
        assert [r["name"] for r in st["accounts"]] == ["alpha.music", "@gamma.piano", "beta.contes"]
        assert st["totals"]["views"] == 600 and st["totals"]["posts"] == 3 and len(st["posts"]) == 3
        st = (await h.get("/api/cm/stats?days=7&q=alpha")).json()
        assert [r["name"] for r in st["accounts"]] == ["alpha.music"] and st["totals"]["views"] == 600


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_posts_search_status_order_pages(pg_session, cmenv, tiktok):
    from test_cm import _tt_target
    from test_cm_team import _plan
    me = await _user(pg_session, "plan@t.dev")
    acc = await _account(pg_session, owner=me, open_id="p1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(me)
        for i in range(5):
            at = (utcnow() + timedelta(days=i + 1)).isoformat() + "Z"
            await _plan(h, [_tt_target(acc.id, scheduled_at=at)], title=f"{'Nocturne' if i % 2 else 'Prélude'} {i}")
        rows, pages = await _all_pages(h, "/api/cm/posts?status=upcoming", limit=2)
        assert [r["title"] for r in rows] == [f"{'Nocturne' if i % 2 else 'Prélude'} {i}" for i in range(5)] and pages == 3
        rows, _ = await _all_pages(h, "/api/cm/posts?order=desc", limit=2)
        assert rows[0]["title"] == "Prélude 4"
        rows, _ = await _all_pages(h, "/api/cm/posts?q=nocturne")
        assert [r["title"] for r in rows] == ["Nocturne 1", "Nocturne 3"]
        assert (await h.get("/api/cm/posts?status=published")).json() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_video_sheet_groups_platforms_and_filters_comments(pg_session, cmenv, tiktok):
    from sqlalchemy import select as _select
    from src.models.cm import CmComment, CmTarget
    from test_cm import _ig_routine, _tt_target
    from test_cm_team import _plan
    me = await _user(pg_session, "fiche@t.dev")
    acc = await _account(pg_session, owner=me, open_id="f1")
    ig_acc = await _ig_routine(pg_session, owner=me)
    other = await _user(pg_session, "autre2@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(me)
        at = (utcnow() + timedelta(days=1)).isoformat() + "Z"
        plan = await _plan(h, [_tt_target(acc.id, scheduled_at=at),
                               {"platform": "instagram", "account_id": ig_acc.id, "scheduled_at": at, "options": {}}],
                           title="Clair de lune")
        tids = {t.platform: t.id for t in (await pg_session.execute(_select(CmTarget))).scalars()}
        tt = CmVideo(platform="tiktok", account_id=acc.id, external_id="7300", title="Clair de lune", views=100, likes=10, target_id=tids["tiktok"])
        ig_v = CmVideo(platform="instagram", account_id=ig_acc.id, external_id="m55", url="https://www.instagram.com/reel/ABC_1/",
                       views=50, likes=None, target_id=tids["instagram"])
        pg_session.add_all([tt, ig_v])
        await pg_session.flush()
        pg_session.add_all([CmComment(owner_user_id=me.id, platform="instagram", account_id=ig_acc.id, media_id="m55", external_id="k9", text="Bravo"),
                            CmComment(owner_user_id=me.id, platform="instagram", account_id=ig_acc.id, media_id="autre", external_id="k10", text="Autre")])
        await pg_session.commit()
        d = (await h.get(f"/api/cm/videos/{tt.id}/sheet")).json()
        assert d["title"] == "Clair de lune" and d["post_id"] == plan.get("id", d["post_id"])
        assert {v["platform"] for v in d["videos"]} == {"tiktok", "instagram"}
        assert d["totals"]["views"] == 150 and d["totals"]["likes"] == 10
        emb = {v["platform"]: v["embed"] for v in d["videos"]}
        assert emb == {"tiktok": "https://www.tiktok.com/embed/v2/7300", "instagram": "https://www.instagram.com/reel/ABC_1/embed"}
        got = (await h.get(f"/api/cm/inbox/comments?status=all&videos={tt.id},{ig_v.id}")).json()
        assert [x["external_id"] for x in got] == ["k9"]
        assert (await c.as_(other).get(f"/api/cm/videos/{tt.id}/sheet")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_accounts_have_readable_slugs_usable_as_targets(pg_session, cmenv, tiktok):
    from test_cm import _ig_routine
    me = await _user(pg_session, "slug@t.dev")
    tk = await _account(pg_session, owner=me, open_id="s9", display_name="Ghost Hands Music", username="ghosthands.music")
    ig_acc = await _ig_routine(pg_session, owner=me, username="GhostHands.Music")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(me)
        slugs = {a["slug"] for a in (await h.get("/api/cm/accounts")).json()}
        assert slugs == {"tiktok:@ghosthands.music", "instagram:@ghosthands.music"}
        at = (utcnow() + timedelta(days=1)).isoformat() + "Z"
        r = await h.post("/api/cm/posts", json={"title": "x", "video_size": 1000, "file_name": "a.mp4", "targets": [
            {"platform": "instagram", "account": "@ghosthands.music", "scheduled_at": at, "options": {}},
            {"platform": "tiktok", "account": "tiktok:@GhostHands.Music", "scheduled_at": at,
             "options": {"mode": "direct", "privacy_level": "PUBLIC_TO_EVERYONE", "fallback_draft": True}}]})
        assert r.status_code == 200, r.text
        from sqlalchemy import select as _select
        from src.models.cm import CmTarget
        rows = (await pg_session.execute(_select(CmTarget).where(CmTarget.post_id == r.json()["post_id"]))).scalars().all()
        assert {(t.platform, t.account_id) for t in rows} == {("instagram", ig_acc.id), ("tiktok", tk.id)}
        assert next(t for t in rows if t.platform == "tiktok").options["fallback_draft"] is True
        bad = await h.post("/api/cm/posts", json={"title": "x", "video_size": 1000, "file_name": "a.mp4", "targets": [
            {"platform": "tiktok", "account": "tiktok:@inconnu", "options": {}}]})
        assert bad.status_code == 404 and "slug" in bad.json()["detail"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_falls_back_to_draft_when_visibility_refused(pg_session, cmenv, tiktok):
    from sqlalchemy import select as _select
    from src.models.cm import CmTarget
    from src.models.tiktok import TikTokPost
    from src.services import cm_jobs
    from test_cm import _tt_target
    from test_cm_team import _plan
    me = await _user(pg_session, "repli@t.dev")
    acc = await _account(pg_session, owner=me, open_id="r9")
    await pg_session.commit()
    tiktok.creator["privacy_level_options"] = ["SELF_ONLY"]          # app pas encore auditée
    async with Client(pg_session) as c:
        h = c.as_(me)
        at = (utcnow() + timedelta(days=1)).isoformat() + "Z"
        t = _tt_target(acc.id, scheduled_at=at)
        t["options"]["fallback_draft"] = True
        await _plan(h, [t])
    target = (await pg_session.execute(_select(CmTarget))).scalar_one()
    target.scheduled_at = utcnow() - timedelta(minutes=1)
    await pg_session.commit()
    await cm_jobs.dispatch_target(pg_session, target.id)
    await pg_session.refresh(target)
    tp = await pg_session.get(TikTokPost, target.tiktok_post_id)
    assert target.status == "PUBLISHING" and tp.mode == "draft" and "brouillon" in target.notice


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_all_reels_get_views_in_rounds(pg_session, cmenv, monkeypatch):
    from sqlalchemy import func as _func, select as _select
    from src.services import cm_service as cm
    from src.services import instagram_service as ig
    from test_cm import _ig_api
    me = await _user(pg_session, "reels@t.dev")
    acc = await _ig_api(pg_session, me)
    await pg_session.commit()
    reels = [{"id": f"r{i}", "media_type": "VIDEO", "media_product_type": "REELS", "caption": f"Reel {i}",
              "timestamp": "2026-10-01T10:00:00+0000", "like_count": i} for i in range(80)]
    asked = []

    async def profile(token):
        return {"username": "ghosthands.music", "followers_count": 10, "media_count": 80}

    async def all_media(token, uid, max_items=500):
        return reels

    async def insights(token, mid):
        asked.append(mid)
        return {"views": 1000 + int(mid[1:])}
    monkeypatch.setattr(ig, "profile", profile)
    monkeypatch.setattr(ig, "all_media", all_media)
    monkeypatch.setattr(ig, "media_insights", insights)
    await cm.sync_account(pg_session, "instagram", acc)
    assert len(asked) == cm.INSIGHTS_PER_SYNC
    asked.clear()
    await cm.sync_account(pg_session, "instagram", acc)
    assert {f"r{i}" for i in range(80)} - set(asked) <= {f"r{i}" for i in range(cm.INSIGHTS_PER_SYNC)}   # les 20 restants d'abord
    missing = (await pg_session.execute(_select(_func.count()).select_from(CmVideo).where(
        CmVideo.account_id == acc.id, CmVideo.views.is_(None)))).scalar()
    assert missing == 0
