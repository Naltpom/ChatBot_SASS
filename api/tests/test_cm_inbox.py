"""cm.chapote.fr : boîte de réception (commentaires, réponses, réponses privées, mot-clé SHEET,
messages Instagram). APIs simulées ; vraie base jetable."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmComment, CmVideo
from src.services import cm_inbox as inbox
from src.services import instagram_service as ig
from src.services import youtube_service as yt

from test_cm import _ig_api, _ig_routine, _service, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _user


def _ts(minutes_ago=5):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S+0000")


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_account_comments_actions_and_sheet(pg_session, cmenv):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    pg_session.add(CmVideo(platform="instagram", account_id=acc.id, external_id="m1", title="Clair de lune", url="https://ig/r/1"))
    await pg_session.commit()
    async with Client(pg_session) as c:
        s = _service(c.http)
        items = [{"id": "c1", "media_id": "m1", "username": "lea.piano", "user_id": "u1", "text": "SHEET please 🙏", "like_count": 3, "timestamp": _ts(10)},
                 {"id": "c2", "media_id": "m1", "username": "tom", "text": "Magnifique", "like_count": 9, "timestamp": _ts(5)},
                 {"id": "c3", "media_id": "m1", "username": "lea.piano", "user_id": "u1", "text": "sheet!!", "timestamp": _ts(2)},
                 {"id": "r1", "media_id": "m1", "parent_id": "c2", "username": "ghosthands.music", "text": "Merci !", "timestamp": _ts(1)}]
        r = await s.post("/api/cm/routine/comments", json={"username": "@GhostHands.music", "items": items})
        assert r.status_code == 200 and r.json() == {"saved": 4}
        await s.post("/api/cm/routine/comments", json={"username": "ghosthands.music", "items": items[:1]})   # pas de doublon
        h = c.as_(u)
        rows = (await h.get("/api/cm/inbox/comments?sort=likes")).json()
        assert [x["external_id"] for x in rows][:2] == ["c2", "c1"] and rows[0]["video_title"] == "Clair de lune"
        assert len(rows) == 4
        acc_caps = (await h.get("/api/cm/inbox/accounts")).json()[0]
        assert acc_caps["source"] == "routine" and acc_caps["reply"] and acc_caps["new"] == 4
        # Réponse tapée dans cm : en file pour la routine, faite par elle.
        cid = next(x["id"] for x in rows if x["external_id"] == "c2")
        r = await h.post(f"/api/cm/comments/{cid}/reply", json={"text": "Merci Tom !"})
        assert r.status_code == 200 and r.json()["pending"] == "reply"
        s = _service(c.http)
        todo = (await s.get("/api/cm/routine/actions")).json()
        assert todo == [{"id": cid, "username": "ghosthands.music", "comment_id": "c2", "media_id": "m1", "author": "tom",
                         "type": "reply", "text": "Merci Tom !"}]
        assert (await s.post(f"/api/cm/routine/actions/{cid}/done", json={"ok": True})).status_code == 200
        h = c.as_(u)
        got = (await h.get("/api/cm/inbox/comments?status=replied")).json()
        assert [x["external_id"] for x in got] == ["c2"] and got[0]["reply_text"] == "Merci Tom !"
        # Mot-clé SHEET : une ligne par personne, lien de profil et message privé.
        people = (await h.get("/api/cm/inbox/keyword?word=sheet")).json()
        assert len(people) == 1 and people[0]["author"] == "lea.piano" and people[0]["count"] == 2
        assert people[0]["profile_url"] == "https://www.instagram.com/lea.piano/" and people[0]["dm_url"] == "https://ig.me/m/lea.piano"
        assert people[0]["can_private_reply"] is True
        assert (await h.post(f"/api/cm/comments/{people[0]['id']}/contacted")).status_code == 200
        assert (await h.get("/api/cm/inbox/keyword?word=sheet")).json() == [
            p for p in (await h.get("/api/cm/inbox/keyword?word=sheet")).json() if p["author"] != "lea.piano"]
        # Recherche.
        assert [x["external_id"] for x in (await h.get("/api/cm/inbox/comments?status=all&q=magni")).json()] == ["c2"]
        # Messages privés d'un compte routine : dans Instagram.
        r = await h.get(f"/api/cm/inbox/conversations?account_id={acc.id}")
        assert r.status_code == 403 and r.json()["detail"]["code"] == "permission_pending"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_official_instagram_waits_for_permission_then_works(pg_session, cmenv, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    pg_session.add(CmVideo(platform="instagram", account_id=acc.id, external_id="m9", title="Nocturne", published_at=utcnow()))
    await pg_session.commit()
    pg_session.add(CmComment(owner_user_id=u.id, platform="instagram", account_id=acc.id, external_id="x1",
                             text="Bravo", author="ana", status="new", published_at=utcnow()))
    await pg_session.commit()
    sent = []

    async def comments(token, media_id, limit=50):
        return [{"id": "x2", "text": "SHEET", "username": "bob", "from": {"id": "77", "username": "bob"},
                 "timestamp": _ts(3), "like_count": 1, "replies": {"data": [{"id": "x3", "text": "merci", "username": "ghosthands.music", "timestamp": _ts(1)}]}}]

    async def reply(token, cid, text):
        sent.append(("reply", cid, text))
        return "rep1"

    async def private(token, uid, cid, text):
        sent.append(("private", cid, text))
        return "dm1"
    monkeypatch.setattr(ig, "media_comments", comments)
    monkeypatch.setattr(ig, "reply_comment", reply)
    monkeypatch.setattr(ig, "private_reply", private)
    async with Client(pg_session) as c:
        h = c.as_(u)
        caps = (await h.get("/api/cm/inbox/accounts")).json()[0]
        assert caps["read"] is False and "Meta" in caps["notice"]
        cid = (await h.get("/api/cm/inbox/comments")).json()[0]["id"]
        r = await h.post(f"/api/cm/comments/{cid}/reply", json={"text": "Merci"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "permission_pending" and "Meta" in r.json()["detail"]["message"]
        assert sent == []
        # Permissions accordées (compte reconnecté avec les nouvelles autorisations).
        acc.scopes = ",".join([ig.SCOPES, ig.SCOPE_COMMENTS, ig.SCOPE_MESSAGES])
        await pg_session.commit()
        assert (await h.post("/api/cm/inbox/sync")).json()["comments"] == 2
        r = await h.post(f"/api/cm/comments/{cid}/reply", json={"text": "Merci"})
        assert r.status_code == 200 and r.json()["status"] == "replied" and sent == [("reply", "x1", "Merci")]
        x2 = next(x for x in (await h.get("/api/cm/inbox/comments")).json() if x["external_id"] == "x2")
        r = await h.post(f"/api/cm/comments/{x2['id']}/private-reply", json={"text": "Voici le lien"})
        assert r.status_code == 200 and r.json()["private_replied_at"] and r.json()["status"] == "contacted"
        assert (await h.post(f"/api/cm/comments/{x2['id']}/private-reply", json={"text": "encore"})).status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_youtube_reads_comments_but_reply_waits_for_google(pg_session, cmenv, monkeypatch):
    from test_youtube import _account as _yt_account
    u = await _user(pg_session, "a@t.dev")
    acc = await _yt_account(pg_session, owner=u)
    assert inbox.capabilities("youtube", acc)["read"] is False          # désactivé par défaut (audit Google)
    pg_session.add(CmVideo(platform="youtube", account_id=acc.id, external_id="vid1", title="Short", published_at=utcnow()))
    await pg_session.commit()

    from src.core.config import settings
    monkeypatch.setattr(settings, "YOUTUBE_COMMENTS_ENABLED", True)

    async def threads(token, video_id, limit=50):
        return [{"snippet": {"topLevelComment": {"id": "yc1", "snippet": {"textDisplay": "Super", "authorDisplayName": "@ana",
                                                                          "likeCount": 2, "publishedAt": "2026-11-23T10:00:00Z"}}}}]
    monkeypatch.setattr(yt, "comment_threads", threads)
    async with Client(pg_session) as c:
        h = c.as_(u)
        assert (await h.post("/api/cm/inbox/sync")).json()["comments"] == 1
        cid = (await h.get("/api/cm/inbox/comments")).json()[0]["id"]
        r = await h.post(f"/api/cm/comments/{cid}/reply", json={"text": "Merci"})
        assert r.status_code == 403 and "Google" in r.json()["detail"]["message"]
        assert (await h.post(f"/api/cm/comments/{cid}/ignore")).json()["status"] == "ignored"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_messages_respect_24h_window(pg_session, cmenv, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    acc.scopes = ",".join([ig.SCOPES, ig.SCOPE_MESSAGES])
    await pg_session.commit()
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%S+0000")
    msgs = [{"id": "m1", "message": "salut", "from": {"id": "55", "username": "lea"}, "created_time": old}]
    sent = []

    async def conv(token, cid, limit=30):
        return msgs

    async def send(token, me, to, text):
        sent.append((to, text))
        return "mm"
    monkeypatch.setattr(ig, "conversation_messages", conv)
    monkeypatch.setattr(ig, "send_message", send)
    async with Client(pg_session) as c:
        h = c.as_(u)
        d = (await h.get(f"/api/cm/inbox/conversations/cv1?account_id={acc.id}")).json()
        assert d["can_write"] is False and d["messages"][0]["from"] == "lea"
        r = await h.post(f"/api/cm/inbox/conversations/cv1/send?account_id={acc.id}", json={"text": "hey", "recipient_id": "55"})
        assert r.status_code == 409 and sent == []
        msgs[0]["created_time"] = _ts(30)
        r = await h.post(f"/api/cm/inbox/conversations/cv1/send?account_id={acc.id}", json={"text": "hey", "recipient_id": "55"})
        assert r.status_code == 200 and sent == [("55", "hey")]
