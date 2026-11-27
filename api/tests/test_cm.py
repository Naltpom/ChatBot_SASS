"""cm.chapote.fr — gestion des réseaux sociaux (planning multi-comptes, Instagram, statistiques).

TikTok, Google et Meta sont simulés (httpx.MockTransport) : AUCUN appel réel.
Endpoints testés sur la vraie base jetable (`real_db`), authentification réelle
par le cookie de session (ou le jeton de service de la routine).

Couvre : publication immédiate sur TikTok + YouTube + Instagram (routine) et
suivi jusqu'à « publié », programmation (rien ne part avant l'heure), modification
et annulation, nouvel essai après échec, validations, isolation entre tenants,
Instagram officiel (OAuth, conteneur avec lien signé, publication, statistiques,
rappels Meta signés), statistiques YouTube, chiffres envoyés par la routine,
retour OAuth TikTok/YouTube vers cm.chapote.fr, nettoyage des vidéos.
"""
import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from jose import jwt
from sqlalchemy import select

from src.core.config import settings
from src.core.security import _encode
from src.core.time import utcnow
from src.models.cm import CmAccountStat, CmPost, CmTarget, CmVideo, InstagramAccount
from src.models.tiktok import TikTokPost
from src.models.youtube import YouTubePost
from src.services import cm_jobs
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import tiktok_jobs
from src.services import tiktok_service as tt
from src.services import youtube_jobs
from src.services import youtube_service as yt
from src.services.crypto import decrypt_secret, encrypt_secret

from test_tiktok import Client, _org, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)
from test_tiktok import _account as _tt_account
from test_youtube import _account as _yt_account
from test_youtube import google  # noqa: F401  (fixture)

SERVICE = "svc-cm-token"
IG_ID = "17841400000000001"


# --------------------------------------------------------------------------
# Faux Meta
# --------------------------------------------------------------------------

class FakeMeta:
    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.container_states = ["IN_PROGRESS", "FINISHED"]
        self.created: list[dict] = []
        self.account_type = "MEDIA_CREATOR"

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        host, path = req.url.host, req.url.path
        if host == "api.instagram.com" and path == "/oauth/access_token":
            form = parse_qs(req.content.decode())
            if form["code"] == ["bad"]:
                return httpx.Response(400, json={"error_type": "OAuthException", "code": 400,
                                                 "error_message": "Invalid authorization code"})
            assert form["code"] == ["AQ123"], form["code"]       # « #_ » retiré
            return httpx.Response(200, json={"access_token": "IGshort", "user_id": int(IG_ID),
                                             "permissions": [ig.SCOPE_BASIC, ig.SCOPE_PUBLISH, ig.SCOPE_INSIGHTS]})
        if path == "/access_token":
            return httpx.Response(200, json={"access_token": "IGlong", "token_type": "bearer", "expires_in": 5183944})
        if path == "/refresh_access_token":
            return httpx.Response(200, json={"access_token": "IGlong2", "token_type": "bearer", "expires_in": 5183944})
        auth = req.headers.get("authorization")
        if auth not in ("Bearer IGlong", "Bearer IGlong2"):
            return httpx.Response(401, json={"error": {"message": "Invalid OAuth access token", "type": "OAuthException", "code": 190}})
        v = f"/{settings.INSTAGRAM_API_VERSION}"
        if path == f"{v}/me":
            return httpx.Response(200, json={"user_id": IG_ID, "username": "ghosthands.music", "name": "Ghost Hands",
                                             "account_type": self.account_type, "profile_picture_url": "https://cdn.ig/p.jpg",
                                             "followers_count": 5400, "media_count": 120})
        if path == f"{v}/{IG_ID}/media" and req.method == "POST":
            self.created.append(parse_qs(req.content.decode()))
            return httpx.Response(200, json={"id": "cont1"})
        if path == f"{v}/cont1":
            return httpx.Response(200, json={"status_code": self.container_states.pop(0) if self.container_states else "FINISHED"})
        if path == f"{v}/{IG_ID}/media_publish":
            return httpx.Response(200, json={"id": "media9"})
        if path == f"{v}/media9":
            return httpx.Response(200, json={"id": "media9", "permalink": "https://www.instagram.com/reel/ABC/"})
        if path == f"{v}/{IG_ID}/media":
            return httpx.Response(200, json={"data": [
                {"id": "media9", "caption": "Clair de lune", "media_type": "VIDEO", "media_product_type": "REELS",
                 "permalink": "https://www.instagram.com/reel/ABC/", "timestamp": "2026-11-20T10:00:00+0000",
                 "like_count": 300, "comments_count": 12},
                {"id": "img1", "media_type": "IMAGE", "like_count": 5, "timestamp": "2026-11-01T10:00:00+0000"},
            ]})
        if path == f"{v}/{IG_ID}/insights":            # chiffres du compte jour par jour (historique)
            q = parse_qs(req.url.query.decode())
            if q["metric"] == ["views"]:
                return httpx.Response(200, json={"data": [{"name": "views", "period": "day", "total_value": {"value": 100}}]})
            since, until = int(q["since"][0]), int(q["until"][0])
            ends = range(since + 86400, until + 1, 86400)
            return httpx.Response(200, json={"data": [{"name": "follower_count", "period": "day", "values": [
                {"value": 2, "end_time": datetime.utcfromtimestamp(e).strftime("%Y-%m-%dT07:00:00+0000")} for e in ends]}]})
        if path == f"{v}/media9/insights":
            return httpx.Response(200, json={"data": [{"name": "views", "values": [{"value": 15000}]},
                                                      {"name": "shares", "values": [{"value": 40}]},
                                                      {"name": "saved", "values": [{"value": 90}]}]})
        return httpx.Response(404, json={"error": {"message": path, "code": 100}})


@pytest.fixture
def cmenv(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "CM_MEDIA_DIR", str(tmp_path / "cm"))
    monkeypatch.setattr(settings, "CM_URL", "https://cm.chapote.test")
    monkeypatch.setattr(settings, "CM_SERVICE_TOKEN", SERVICE)
    monkeypatch.setattr(settings, "CM_SERVICE_USER_EMAIL", "a@t.dev")
    monkeypatch.setattr(settings, "CM_STORAGE_REQUIRED", False)    # testé à part (test_cm_storage)
    monkeypatch.setattr(cm, "PART_SIZE", 1024)
    launched: list[int] = []
    monkeypatch.setattr(cm_jobs, "launch", lambda target_id: launched.append(target_id))
    return launched


@pytest.fixture
def meta(monkeypatch):
    monkeypatch.setattr(settings, "INSTAGRAM_CLIENT_ID", "990001")
    monkeypatch.setattr(settings, "INSTAGRAM_CLIENT_SECRET", "ig-secret")
    fake = FakeMeta()
    monkeypatch.setattr(ig, "_transport", httpx.MockTransport(fake.handler))
    return fake


async def _send(h, post_id: int, data: bytes, part: int = 1024):
    for i in range(0, len(data), part):
        r = await h.put(f"/api/cm/posts/{post_id}/parts/{i // part}", content=data[i:i + part])
        assert r.status_code == 200, r.text


def _tt_target(acc_id, **kw):
    t = {"platform": "tiktok", "account_id": acc_id,
         "options": {"mode": "direct", "privacy_level": "PUBLIC_TO_EVERYONE", "allow_comment": True}}
    t.update(kw)
    return t


def _yt_target(acc_id, **kw):
    t = {"platform": "youtube", "account_id": acc_id,
         "options": {"privacy_status": "public", "made_for_kids": False, "tags": ["piano"]}}
    t.update(kw)
    return t


def _ig_target(acc_id, **kw):
    t = {"platform": "instagram", "account_id": acc_id, "options": {"caption": "Clair de lune #piano"}}
    t.update(kw)
    return t


async def _publish(h, targets, data, **kw):
    body = {"title": "Clair de lune", "caption": "Debussy au piano #piano", "file_name": "clip.mp4",
            "video_size": len(data), "targets": targets}
    body.update(kw)
    r = await h.post("/api/cm/posts", json=body)
    assert r.status_code == 200, r.text
    plan = r.json()
    await _send(h, plan["post_id"], data)
    r = await h.post(f"/api/cm/posts/{plan['post_id']}/submit")
    return plan["post_id"], r


async def _ig_routine(db, owner=None, org=None, username="ghosthands.music") -> InstagramAccount:
    acc = InstagramAccount(owner_user_id=owner.id if owner else None, organization_id=org.id if org else None,
                           mode="routine", username=username)
    db.add(acc)
    await db.flush()
    return acc


async def _ig_api(db, owner) -> InstagramAccount:
    acc = InstagramAccount(owner_user_id=owner.id, mode="api", ig_user_id=IG_ID, username="ghosthands.music",
                           scopes=ig.SCOPES, access_token_enc=encrypt_secret("IGlong"),
                           access_token_expires_at=utcnow() + timedelta(days=50))
    db.add(acc)
    await db.flush()
    return acc


def _service(h):
    h.headers["Authorization"] = f"Bearer {SERVICE}"
    return h


# --------------------------------------------------------------------------
# Bases
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_health_and_session_required(pg_session, cmenv):
    async with Client(pg_session) as c:
        r = await c.http.get("/api/cm/health")
        assert r.status_code == 200 and r.json()["ok"] is True
        assert (await c.http.get("/api/cm/accounts")).status_code == 401
        assert (await c.http.get("/api/cm/routine/due")).status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_oauth_from_cm_uses_declared_redirects(pg_session, tiktok, google, monkeypatch):
    """Depuis cm.chapote.fr : par défaut, l'URI déjà déclarée chez TikTok / Google (chapote.fr),
    dont la page renvoie vers cm ; l'URI directe de cm seulement si elle est configurée."""
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        q = parse_qs(urlparse((await h.post("/api/tiktok/oauth/start", json={"app": "cm"})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == [settings.TIKTOK_REDIRECT_URI]
        assert q["scope"] == [tt.SCOPES]        # rien de plus tant que TikTok n'a pas validé les statistiques
        claims = jwt.get_unverified_claims(q["state"][0])
        assert claims["app"] == "cm"             # lu par la page de chapote.fr pour renvoyer vers cm
        r = await h.post("/api/tiktok/oauth/exchange", json={"code": "ok", "state": q["state"][0]})
        assert r.status_code == 200, r.text
        form = parse_qs(tiktok.last("/v2/oauth/token/").content.decode())
        assert form["redirect_uri"] == [settings.TIKTOK_REDIRECT_URI]
        q = parse_qs(urlparse((await h.post("/api/youtube/oauth/start", json={"app": "cm"})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == [settings.YOUTUBE_REDIRECT_URI]

        # URI de cm déclarée chez la plateforme : retour direct, et le même à l'échange.
        monkeypatch.setattr(settings, "TIKTOK_CM_REDIRECT_URI", "https://cm.chapote.test/tiktok/callback")
        monkeypatch.setattr(settings, "YOUTUBE_CM_REDIRECT_URI", "https://cm.chapote.test/youtube/callback")
        q = parse_qs(urlparse((await h.post("/api/tiktok/oauth/start", json={"app": "cm"})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == ["https://cm.chapote.test/tiktok/callback"]
        r = await h.post("/api/tiktok/oauth/exchange", json={"code": "ok", "state": q["state"][0]})
        assert r.status_code == 200, r.text
        form = parse_qs(tiktok.last("/v2/oauth/token/").content.decode())
        assert form["redirect_uri"] == ["https://cm.chapote.test/tiktok/callback"]
        q = parse_qs(urlparse((await h.post("/api/youtube/oauth/start", json={"app": "cm"})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == ["https://cm.chapote.test/youtube/callback"]
        # Depuis l'Espace client : inchangé.
        q = parse_qs(urlparse((await h.post("/api/tiktok/oauth/start", json={})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == [settings.TIKTOK_REDIRECT_URI] and "app" in jwt.get_unverified_claims(q["state"][0])
    monkeypatch.setattr(settings, "TIKTOK_EXTRA_SCOPES", "user.info.stats, video.list")
    assert tt.scopes() == f"{tt.SCOPES},user.info.stats,video.list"


# --------------------------------------------------------------------------
# Publication immédiate sur trois plateformes
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_publish_now_everywhere_then_followed_to_published(pg_session, cmenv, tiktok, google):
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/cm/instagram/routine-accounts", json={"username": "@ghosthands.music"})
        assert r.status_code == 200 and r.json()["mode"] == "routine" and r.json()["can_publish"]
        iacc_id = r.json()["id"]
        accounts = (await h.get("/api/cm/accounts")).json()
        assert {(a["platform"], a["id"]) for a in accounts} == {("tiktok", tacc.id), ("youtube", yacc.id), ("instagram", iacc_id)}

        tt_target = _tt_target(tacc.id)
        tt_target["options"]["cover_timestamp_ms"] = 99_000            # après la fin : ramené dans la vidéo
        tt_target["options"]["is_aigc"] = True
        ig_target = _ig_target(iacc_id)
        ig_target["options"]["thumb_offset_ms"] = "41500"
        post_id, r = await _publish(h, [tt_target, _yt_target(yacc.id), ig_target], data)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["status"] == "READY" and out["duration_sec"] == 42.0
        assert {t["status"] for t in out["targets"]} == {"SCHEDULED"}
        targets = {t["platform"]: t for t in out["targets"]}
        assert sorted(cmenv) == sorted(t["id"] for t in out["targets"])       # « maintenant » : lancées tout de suite
        # Les options par défaut reprennent le titre et la légende de la publication.
        assert targets["youtube"]["options"]["title"] == "Clair de lune"
        assert targets["youtube"]["options"]["description"] == "Debussy au piano #piano"
        assert targets["tiktok"]["options"]["title"] == "Debussy au piano #piano"
        assert targets["tiktok"]["options"]["cover_timestamp_ms"] == 99_000
        assert targets["instagram"]["options"]["thumb_offset_ms"] == 41_500
        assert not any("init" in p for p in tiktok.paths())                  # rien n'est parti avant l'envoi

        post = await pg_session.get(CmPost, post_id)
        media = post.media_path
        assert os.path.exists(media) and media.endswith(".mp4")
        for t in out["targets"]:
            await cm_jobs.dispatch_target(pg_session, t["id"])

        tt_t = await pg_session.get(CmTarget, targets["tiktok"]["id"])
        tp = await pg_session.get(TikTokPost, tt_t.tiktok_post_id)
        assert tt_t.status == "PUBLISHING" and tp.status == "QUEUED" and tiktok.launched == [tp.id]
        assert tp.privacy_level == "PUBLIC_TO_EVERYONE" and tp.title == "Debussy au piano #piano"
        assert tp.disable_comment is False and tp.disable_duet is True    # duo coupé : non coché
        assert tp.tmp_path != media and open(tp.tmp_path, "rb").read() == data
        yt_t = await pg_session.get(CmTarget, targets["youtube"]["id"])
        yp = await pg_session.get(YouTubePost, yt_t.youtube_post_id)
        assert yt_t.status == "PUBLISHING" and yp.status == "QUEUED" and google.launched == [yp.id]
        assert yp.tags == ["piano"] and yp.privacy_status == "public"
        ig_t = await pg_session.get(CmTarget, targets["instagram"]["id"])
        assert ig_t.status == "AWAITING_ROUTINE"

        # Les modules TikTok et YouTube font l'envoi ; cm suit jusqu'à « publié ».
        assert tp.cover_timestamp_ms == 41_950
        await tiktok_jobs.process_post(pg_session, tp)
        init = json.loads(tiktok.last("/v2/post/publish/video/init/").content)
        assert init["post_info"]["video_cover_timestamp_ms"] == 41_950
        assert init["post_info"]["is_aigc"] is True
        await tiktok_jobs.poll_post(pg_session, tp)
        await youtube_jobs.process_post(pg_session, yp)
        await youtube_jobs.poll_post(pg_session, yp)
        await cm_jobs.follow_pending(pg_session)
        await pg_session.refresh(tt_t)
        await pg_session.refresh(yt_t)
        assert tt_t.status == "PUBLISHED" and tt_t.url == "https://www.tiktok.com/@studio.demo/video/123"
        assert yt_t.status == "PUBLISHED" and yt_t.url == "https://youtube.com/shorts/vid42"

        # Instagram géré par la routine.
        r = _service(c.http)
        due = (await r.get("/api/cm/routine/due")).json()
        assert [d["id"] for d in due] == [ig_t.id] and due[0]["caption"] == "Clair de lune #piano"
        assert due[0]["username"] == "ghosthands.music"
        assert (await r.post(f"/api/cm/routine/targets/{ig_t.id}/claim")).json()["status"] == "ROUTINE_CLAIMED"
        assert (await r.post(f"/api/cm/routine/targets/{ig_t.id}/claim")).status_code == 409
        video = await r.get(f"/api/cm/routine/targets/{ig_t.id}/video")
        assert video.status_code == 200 and video.content == data
        done = await r.post(f"/api/cm/routine/targets/{ig_t.id}/done", json={"url": "https://www.instagram.com/reel/XYZ/"})
        assert done.status_code == 200 and done.json()["status"] == "PUBLISHED"
        assert (await r.get("/api/cm/routine/due")).json() == []
        del c.http.headers["Authorization"]

        vids = (await h.get("/api/cm/videos")).json()
        assert {(v["platform"], v["external_id"]) for v in vids} == {("tiktok", "123"), ("youtube", "vid42"), ("instagram", "XYZ")}
        assert all(v["via_chapote"] for v in vids)
        overview = (await h.get("/api/cm/overview")).json()
        assert overview["totals"]["published"] == 3 and overview["totals"]["upcoming"] == 0

    # Toutes les publications sont terminées : la vidéo est supprimée.
    await cm_jobs.cleanup(pg_session)
    await pg_session.refresh(post)
    assert post.media_path is None and not os.path.exists(media)


# --------------------------------------------------------------------------
# Programmation, modification, annulation, nouvel essai
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_scheduled_target_waits_for_its_time(pg_session, cmenv, tiktok, google):
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    when = (utcnow() + timedelta(hours=2)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        post_id, r = await _publish(h, [_tt_target(tacc.id, scheduled_at=when), _yt_target(yacc.id, scheduled_at=when)],
                                    mp4_bytes(20_000))
        assert r.status_code == 200, r.text
        assert cmenv == []                                   # rien de lancé
        t_tt, t_yt = sorted(r.json()["targets"], key=lambda t: t["platform"])
        await cm_jobs.dispatch_due(pg_session)
        assert tiktok.launched == [] and google.launched == []

        plan = (await h.get("/api/cm/posts")).json()
        assert [p["id"] for p in plan] == [post_id]
        later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
        r = await h.patch(f"/api/cm/targets/{t_yt['id']}", json={"scheduled_at": later, "options": {"title": "Nouveau titre"}})
        assert r.status_code == 200 and r.json()["options"]["title"] == "Nouveau titre"
        r = await h.patch(f"/api/cm/targets/{t_yt['id']}", json={"scheduled_at": "2020-01-01T00:00:00Z"})
        assert r.status_code == 400
        r = await h.post(f"/api/cm/targets/{t_yt['id']}/cancel")
        assert r.status_code == 200 and r.json()["status"] == "CANCELLED"

        # L'heure arrive : seule la cible TikTok part.
        t = await pg_session.get(CmTarget, t_tt["id"])
        t.scheduled_at = utcnow() - timedelta(minutes=1)
        await pg_session.commit()
        await cm_jobs.dispatch_due(pg_session)
        await pg_session.refresh(t)
        assert t.status == "PUBLISHING" and len(tiktok.launched) == 1 and google.launched == []
        assert (await h.post(f"/api/cm/targets/{t.id}/cancel")).status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_publish_now_and_retry_after_failure(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    await pg_session.commit()
    when = (utcnow() + timedelta(hours=3)).isoformat() + "Z"
    tiktok.creator["privacy_level_options"] = ["SELF_ONLY"]       # le créateur ne peut plus publier en public
    async with Client(pg_session) as c:
        h = c.as_(u)
        _, r = await _publish(h, [_tt_target(tacc.id, scheduled_at=when)], mp4_bytes(10_000))
        target = r.json()["targets"][0]
        r = await h.post(f"/api/cm/targets/{target['id']}/publish-now")
        assert r.status_code == 200 and cmenv == [target["id"]]
        await cm_jobs.dispatch_target(pg_session, target["id"])
        t = await pg_session.get(CmTarget, target["id"])
        await pg_session.refresh(t)
        assert t.status == "FAILED" and t.fail_reason == "privacy_level_option_mismatch"
        assert "confidentialité" in t.error_message and tiktok.launched == []

        tiktok.creator["privacy_level_options"] = ["PUBLIC_TO_EVERYONE", "SELF_ONLY"]
        r = await h.post(f"/api/cm/targets/{t.id}/retry", json={})
        assert r.status_code == 200 and r.json()["status"] == "SCHEDULED" and r.json()["error_message"] is None
        await cm_jobs.dispatch_target(pg_session, t.id)
        await pg_session.refresh(t)
        assert t.status == "PUBLISHING" and len(tiktok.launched) == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_active_post_limit_postpones_instead_of_failing(pg_session, cmenv, tiktok, monkeypatch):
    monkeypatch.setattr(cm_jobs, "MAX_ACTIVE_POSTS", 0)
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        _, r = await _publish(c.as_(u), [_tt_target(tacc.id)], mp4_bytes(10_000))
        tid = r.json()["targets"][0]["id"]
    await cm_jobs.dispatch_target(pg_session, tid)
    t = await pg_session.get(CmTarget, tid)
    await pg_session.refresh(t)
    assert t.status == "SCHEDULED" and t.attempts == 0 and tiktok.launched == []


# --------------------------------------------------------------------------
# Validations et isolation
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("targets, fragment", [
    (lambda tt_id, yt_id: [_tt_target(tt_id), _tt_target(tt_id)], "deux fois"),
    (lambda tt_id, yt_id: [_tt_target(tt_id, options={"mode": "direct"})], "qui peut voir"),
    (lambda tt_id, yt_id: [_tt_target(tt_id, scheduled_at="2020-01-01T10:00:00Z")], "déjà passée"),
    (lambda tt_id, yt_id: [_yt_target(yt_id, options={"privacy_status": "public"})], "enfants"),
    (lambda tt_id, yt_id: [_yt_target(yt_id, options={"title": "<b>", "made_for_kids": False})], "Titre"),
])
async def test_create_validation(pg_session, cmenv, tiktok, google, targets, fragment):
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/cm/posts", json={"title": "x", "video_size": 1000,
                                                       "targets": targets(tacc.id, yacc.id)})
        assert r.status_code == 400 and fragment in r.json()["detail"], r.text
    assert (await pg_session.execute(select(CmPost))).scalars().all() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_video_too_long_for_a_short_is_refused_and_deleted(pg_session, cmenv, google):
    u = await _user(pg_session, "a@t.dev")
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        post_id, r = await _publish(c.as_(u), [_yt_target(yacc.id)], mp4_bytes(200_000))
        assert r.status_code == 400 and "trop longue pour un Short" in r.json()["detail"]
    post = await pg_session.get(CmPost, post_id)
    await pg_session.refresh(post)
    assert post.status == "CANCELLED" and post.media_path is None
    assert os.listdir(settings.CM_MEDIA_DIR) == [] and cmenv == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tenant_isolation(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    member = await _user(pg_session, "m@t.dev")
    org = await _org(pg_session, a, (member, "member"))
    a_acc = await _tt_account(pg_session, owner=a)
    org_acc = await _tt_account(pg_session, org=org, by=a, open_id="oid-org")
    await pg_session.commit()
    async with Client(pg_session) as c:
        post_id, r = await _publish(c.as_(a), [_tt_target(a_acc.id)], mp4_bytes(5_000))
        target_id = r.json()["targets"][0]["id"]
        hb = c.as_(b)
        r = await hb.post("/api/cm/posts", json={"title": "x", "video_size": 10, "targets": [_tt_target(a_acc.id)]})
        assert r.status_code == 404
        assert (await hb.get(f"/api/cm/posts/{post_id}")).status_code == 404
        assert (await hb.patch(f"/api/cm/targets/{target_id}", json={"options": {}})).status_code == 404
        assert (await hb.post(f"/api/cm/targets/{target_id}/cancel")).status_code == 404
        assert (await hb.get("/api/cm/posts")).json() == []
        assert (await hb.get("/api/cm/accounts")).json() == []
        assert (await hb.get(f"/api/cm/accounts?org_id={org.id}")).status_code == 404
        # Membre de l'équipe : comptes de l'équipe seulement, pas ceux de l'espace perso du propriétaire.
        hm = c.as_(member)
        accs = (await hm.get(f"/api/cm/accounts?org_id={org.id}")).json()
        assert [x["id"] for x in accs] == [org_acc.id]
        r = await hm.post("/api/cm/posts", json={"org_id": org.id, "title": "x", "video_size": 10,
                                                 "targets": [_tt_target(a_acc.id)]})
        assert r.status_code == 404
        spaces = (await hm.get("/api/cm/spaces")).json()
        assert [s["org_id"] for s in spaces] == [None, org.id]


# --------------------------------------------------------------------------
# Instagram officiel
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_oauth_publish_reel_and_stats(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    data = mp4_bytes(30_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        # Un compte géré par la routine existe déjà : il passe en connexion officielle (même ligne).
        routine = (await h.post("/api/cm/instagram/routine-accounts", json={"username": "ghosthands.music"})).json()
        q = parse_qs(urlparse((await h.post("/api/cm/instagram/oauth/start", json={})).json()["authorize_url"]).query)
        assert q["redirect_uri"] == [settings.INSTAGRAM_REDIRECT_URI] and q["client_id"] == ["990001"]
        assert set(q["scope"][0].split(",")) == {ig.SCOPE_BASIC, ig.SCOPE_PUBLISH, ig.SCOPE_INSIGHTS}
        state = q["state"][0]
        r = await h.post("/api/cm/instagram/oauth/exchange", json={"code": "AQ123#_", "state": state})
        assert r.status_code == 200, r.text
        acc_out = r.json()["account"]
        assert acc_out["id"] == routine["id"] and acc_out["mode"] == "api" and acc_out["name"] == "@ghosthands.music"
        # State à usage unique.
        assert (await h.post("/api/cm/instagram/oauth/exchange", json={"code": "AQ123", "state": state})).status_code == 400
        acc = await pg_session.get(InstagramAccount, acc_out["id"])
        assert acc.ig_user_id == IG_ID and decrypt_secret(acc.access_token_enc) == "IGlong"
        assert "IGlong" not in json.dumps(acc_out)

        post_id, r = await _publish(h, [_ig_target(acc.id)], data)
        assert r.status_code == 200, r.text
        tid = r.json()["targets"][0]["id"]
        await cm_jobs.dispatch_target(pg_session, tid)
        t = await pg_session.get(CmTarget, tid)
        await pg_session.refresh(t)
        assert t.status == "PUBLISHING" and t.ig_container_id == "cont1"
        sent = meta.created[0]
        assert sent["media_type"] == ["REELS"] and sent["caption"] == ["Clair de lune #piano"]
        video_url = sent["video_url"][0]
        assert video_url.startswith("https://cm.chapote.test/api/cm/media/")
        # Meta télécharge la vidéo par le lien signé (sans session) ; un lien modifié est refusé.
        c.http.cookies.clear()
        path = urlparse(video_url).path
        got = await c.http.get(path)
        assert got.status_code == 200 and got.content == data
        assert (await c.http.get(path.replace(path.rsplit("/", 1)[1][:4], "0000"))).status_code == 404
        h = c.as_(u)

        await cm_jobs.follow_pending(pg_session)                 # IN_PROGRESS
        await pg_session.refresh(t)
        assert t.status == "PUBLISHING"
        await cm_jobs.follow_pending(pg_session)                 # FINISHED -> publication
        await pg_session.refresh(t)
        assert t.status == "PUBLISHED" and t.external_id == "media9" and t.url == "https://www.instagram.com/reel/ABC/"
        # Publiée : le lien ne sert plus.
        assert (await c.http.get(path)).status_code == 404

        stat = await cm.sync_account(pg_session, "instagram", acc)
        assert stat.error is None and stat.followers == 5400 and stat.views == 15000 and stat.videos == 120
        v = (await pg_session.execute(select(CmVideo).where(CmVideo.external_id == "media9"))).scalar_one()
        assert v.views == 15000 and v.likes == 300 and v.saves == 90 and v.target_id == t.id
        assert (await pg_session.execute(select(CmVideo).where(CmVideo.external_id == "img1"))).first() is None
        overview = (await h.get("/api/cm/overview")).json()
        assert overview["totals"]["followers"] == 5400 and overview["totals"]["views"] == 15000
        assert overview["series"][-1]["views"] == 15000 and overview["top_videos"][0]["external_id"] == "media9"
        # Historique d'avant le 1er relevé, reconstitué depuis les chiffres jour par jour d'Instagram
        # (1re publication le 1er novembre : rien avant le 31 octobre), puis plus jamais redemandé.
        hist = {s.day: s for s in (await pg_session.execute(select(CmAccountStat).where(
            CmAccountStat.platform == "instagram", CmAccountStat.account_id == acc.id))).scalars()}
        today = utcnow().date()
        assert min(hist) == datetime(2026, 10, 31).date() and len(hist) == (today - min(hist)).days + 1
        y = hist[today - timedelta(days=1)]
        assert (y.views, y.followers) == (15000 - 100, 5400 - 2)
        await pg_session.refresh(acc)
        assert acc.history_done is True
        before = len(meta.calls)
        await cm.sync_account(pg_session, "instagram", acc)
        assert not [r for r in meta.calls[before:] if r.url.path.endswith(f"/{IG_ID}/insights")]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_rejects_personal_accounts_and_bad_codes(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)

        def state():
            return _encode({"sub": str(u.id), "scope": "instagram_oauth", "org": None, "jti": os.urandom(8).hex()},
                           timedelta(minutes=10))
        r = await h.post("/api/cm/instagram/oauth/exchange", json={"code": "bad", "state": state()})
        assert r.status_code == 400 and "Instagram" in r.json()["detail"]
        meta.account_type = "PERSONAL"
        r = await h.post("/api/cm/instagram/oauth/exchange", json={"code": "AQ123", "state": state()})
        assert r.status_code == 400 and "professionnel" in r.json()["detail"]
    assert (await pg_session.execute(select(InstagramAccount))).scalars().all() == []


def _signed(payload: dict, secret: str) -> str:
    def b64(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).decode().rstrip("=")
    body = b64(json.dumps(payload).encode())
    sig = b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{sig}.{body}"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_meta_deauthorize_and_data_deletion_callbacks(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.http.post("/api/cm/instagram/deauthorize",
                              data={"signed_request": _signed({"user_id": IG_ID}, "faux-secret")})
        assert r.status_code == 400
        await pg_session.refresh(acc)
        assert acc.revoked_at is None
        r = await c.http.post("/api/cm/instagram/data-deletion",
                              data={"signed_request": _signed({"user_id": IG_ID, "algorithm": "HMAC-SHA256"}, "ig-secret")})
        assert r.status_code == 200 and r.json()["confirmation_code"]
        assert r.json()["url"].endswith("/legal/instagram-confidentialite#suppression")
    await pg_session.refresh(acc)
    assert acc.revoked_at is not None and acc.access_token_enc is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_token_refreshed_before_expiry(pg_session, cmenv, meta):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_api(pg_session, u)
    acc.access_token_expires_at = utcnow() + timedelta(days=3)
    await pg_session.commit()
    await cm_jobs.refresh_instagram_tokens(pg_session)
    await pg_session.refresh(acc)
    assert decrypt_secret(acc.access_token_enc) == "IGlong2"
    assert acc.access_token_expires_at > utcnow() + timedelta(days=50)


# --------------------------------------------------------------------------
# Statistiques YouTube, chiffres de la routine
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_youtube_stats_sync(pg_session, cmenv, google, monkeypatch):
    orig = google.handler

    def handler(req):
        if req.url.path == "/youtube/v3/channels" and "statistics" in req.url.params.get("part", ""):
            return httpx.Response(200, json={"items": [{"id": "UC123", "statistics": {
                "viewCount": "250000", "subscriberCount": "1800", "videoCount": "64"},
                "snippet": {"title": "Nouveau nom", "customUrl": "@nouveau",
                            "thumbnails": {"default": {"url": "https://yt3.ggpht/nouvelle.jpg"}}},
                "contentDetails": {"relatedPlaylists": {"uploads": "UU123"}}}]})
        if req.url.path == "/youtube/v3/playlistItems":
            return httpx.Response(200, json={"items": [{"contentDetails": {"videoId": "v1"}},
                                                       {"contentDetails": {"videoId": "v2"}}]})
        if req.url.path == "/youtube/v3/videos" and "statistics" in req.url.params.get("part", ""):
            return httpx.Response(200, json={"items": [
                {"id": "v1", "snippet": {"title": "Short", "publishedAt": "2026-11-20T10:00:00Z"},
                 "statistics": {"viewCount": "9000", "likeCount": "400"}, "contentDetails": {"duration": "PT45S"}},
                {"id": "v2", "snippet": {"title": "Long", "publishedAt": "2026-11-10T10:00:00Z"},
                 "statistics": {"viewCount": "100", "likeCount": "3"}, "contentDetails": {"duration": "PT12M3S"}},
            ]})
        return orig(req)
    monkeypatch.setattr(yt, "_transport", httpx.MockTransport(handler))
    u = await _user(pg_session, "a@t.dev")
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    await cm_jobs.sync_due(pg_session)
    stat = (await pg_session.execute(select(CmAccountStat))).scalar_one()
    assert (stat.views, stat.followers, stat.videos, stat.likes) == (250000, 1800, 64, 403)
    vids = {v.external_id: v for v in (await pg_session.execute(select(CmVideo))).scalars()}
    assert vids["v1"].url == "https://youtube.com/shorts/v1" and vids["v2"].url.endswith("watch?v=v2")
    assert vids["v2"].duration_sec == 723
    # Relevé récent : pas de nouvel appel avant CM_STATS_EVERY_HOURS.
    calls = len(google.calls)
    await cm_jobs.sync_due(pg_session)
    assert len(google.calls) == calls
    async with Client(pg_session) as c:
        accs = (await c.as_(u).get("/api/cm/accounts")).json()
        assert accs[0]["stats"]["followers"] == 1800 and accs[0]["stats"]["views"] == 250000
        # Nom et photo de la chaîne relus au relevé.
        assert accs[0]["name"] == "Nouveau nom" and accs[0]["avatar_url"] == "https://yt3.ggpht/nouvelle.jpg"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_refresh_button_reports_failures_instead_of_500(pg_session, cmenv, google, monkeypatch):
    """Bouton Actualiser : une plateforme en erreur, injoignable ou un jeton refusé donnent un relevé en
    erreur (et « à reconnecter »), jamais un 500 (le rollback expirait le compte relu ensuite)."""
    from src.routers import cm as cm_router
    monkeypatch.setattr(cm_router.sync_limiter, "check", lambda *_a, **_k: _true())
    monkeypatch.setattr(cm_router.full_sync_limiter, "check", lambda *_a, **_k: _true())
    orig = google.handler
    mode = {"v": "quota"}

    def handler(req):
        if req.url.path.startswith("/youtube/v3/"):
            if mode["v"] == "network":
                raise httpx.ConnectTimeout("délai dépassé", request=req)
            return httpx.Response(403, json={"error": {"code": 403, "message": "quota",
                                                       "errors": [{"reason": "quotaExceeded"}]}})
        if req.url.path.endswith("/token") and mode["v"] == "revoked":
            return httpx.Response(400, json={"error": "invalid_grant"})
        return orig(req)
    monkeypatch.setattr(yt, "_transport", httpx.MockTransport(handler))
    u = await _user(pg_session, "a@t.dev")
    yacc = await _yt_account(pg_session, owner=u)
    await pg_session.commit()
    url = f"/api/cm/accounts/youtube/{yacc.id}/sync"
    async with Client(pg_session) as c:
        http = c.as_(u)     # la session est partagée avec l'app : son rollback expire aussi u et yacc
        for m in ("quota", "network"):
            mode["v"] = m
            r = await http.post(url)
            assert r.status_code == 200, (m, r.text)
            assert r.json()["stats"]["error"] and r.json()["needs_reconnect"] is False
        mode["v"] = "revoked"
        await pg_session.refresh(yacc)
        yacc.access_token_expires_at = utcnow() - timedelta(minutes=1)
        await pg_session.commit()
        r = await http.post(url)
        assert r.status_code == 200, r.text
        assert r.json()["needs_reconnect"] is True and r.json()["stats"]["error"] == "Compte à reconnecter."


async def _true():
    return True


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_instagram_token_invalidated_by_meta(pg_session, cmenv, meta, monkeypatch):
    """Jeton invalidé par Meta (mot de passe changé…) : « à reconnecter », jeton effacé, et les tâches
    planifiées continuent avec les autres comptes (le rollback d'un compte expirait les suivants)."""
    from src.routers import cm as cm_router
    from src.services import cm_inbox
    monkeypatch.setattr(cm_router.sync_limiter, "check", lambda *_a, **_k: _true())
    monkeypatch.setattr(cm_router.full_sync_limiter, "check", lambda *_a, **_k: _true())
    u = await _user(pg_session, "a@t.dev")
    dead = []
    for i in (1, 2):
        d = InstagramAccount(owner_user_id=u.id, mode="api", ig_user_id=f"99{i}", username=f"mort{i}",
                             scopes=ig.SCOPES, access_token_enc=encrypt_secret("IGrevoque"),
                             access_token_expires_at=utcnow() + timedelta(days=50))
        pg_session.add(d)
        dead.append(d)
    await pg_session.flush()
    good = await _ig_api(pg_session, u)
    ids, good_id = [d.id for d in dead], good.id
    await pg_session.commit()
    # Tâches planifiées : ni l'une ni l'autre ne plante, le bon compte est relevé.
    await cm_inbox.sync_due(pg_session)
    await cm_jobs.sync_due(pg_session)
    stats = {s.account_id: s for s in (await pg_session.execute(select(CmAccountStat).where(
        CmAccountStat.day == utcnow().date()))).scalars()}
    assert stats[good_id].error is None and stats[good_id].followers == 5400
    for i in ids:
        acc = await pg_session.get(InstagramAccount, i)
        await pg_session.refresh(acc)
        assert acc.needs_reconnect is True and acc.access_token_enc is None
        assert stats[i].error == "Compte à reconnecter."
    # Bouton Actualiser sur un compte dont Meta vient d'invalider le jeton : 200, « à reconnecter ».
    acc = await pg_session.get(InstagramAccount, ids[0])
    acc.needs_reconnect, acc.access_token_enc = False, encrypt_secret("IGrevoque")
    await pg_session.commit()
    await pg_session.refresh(u)
    async with Client(pg_session) as c:
        r = await c.as_(u).post(f"/api/cm/accounts/instagram/{ids[0]}/sync")
        assert r.status_code == 200, r.text
        assert r.json()["needs_reconnect"] is True and r.json()["stats"]["error"] == "Compte à reconnecter."


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_stats_wait_for_tiktok_approval(pg_session, cmenv, tiktok):
    """Sans les autorisations de statistiques (pas encore validées par TikTok), aucun appel."""
    u = await _user(pg_session, "a@t.dev")
    await _tt_account(pg_session, owner=u)
    await pg_session.commit()
    await cm_jobs.sync_due(pg_session)
    assert tiktok.calls == []
    async with Client(pg_session) as c:
        accs = (await c.as_(u).get("/api/cm/accounts")).json()
        assert accs[0]["stats_available"] is False and accs[0]["stats"] is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_refresh_updates_name_and_photo(pg_session, cmenv, tiktok, monkeypatch):
    """Actualiser relit le nom et la photo TikTok, même sans les autorisations de statistiques."""
    from src.routers import cm as cm_router
    monkeypatch.setattr(cm_router.sync_limiter, "check", lambda *_a, **_k: _true())
    u = await _user(pg_session, "a@t.dev")
    acc = await _tt_account(pg_session, owner=u)
    acc.display_name, acc.avatar_url = "ancien.nom", "https://p16.tiktok/expiree.jpg"
    await pg_session.commit()
    url = f"/api/cm/accounts/tiktok/{acc.id}/sync"
    async with Client(pg_session) as c:
        r = await c.as_(u).post(url)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "studio.demo" and r.json()["avatar_url"] == "https://p16.tiktok/a.jpg"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_stats_and_service_token(pg_session, cmenv, monkeypatch):
    u = await _user(pg_session, "a@t.dev")
    other = await _user(pg_session, "b@t.dev")
    await pg_session.commit()
    monkeypatch.setattr(settings, "CM_SERVICE_USER_EMAIL", "A@t.dev")
    body = {"username": "@ghosthands.music", "followers": 5400, "media_count": 120,
            "videos": [{"external_id": "r1", "url": "https://www.instagram.com/reel/r1/", "views": 1000, "likes": 50},
                       {"external_id": "r2", "views": 2500, "likes": 70}]}
    async with Client(pg_session) as c:
        c.http.headers["Authorization"] = "Bearer faux"
        assert (await c.http.post("/api/cm/routine/stats", json=body)).status_code == 401
        _service(c.http)
        r = await c.http.post("/api/cm/routine/stats", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["mode"] == "routine" and r.json()["stats"]["views"] == 3500
        r = await c.http.post("/api/cm/routine/stats", json={**body, "followers": 5450})
        assert r.json()["stats"]["followers"] == 5450                 # même jour : relevé mis à jour
        del c.http.headers["Authorization"]
        accs = (await c.as_(u).get("/api/cm/accounts")).json()
        assert [(a["platform"], a["username"]) for a in accs] == [("instagram", "ghosthands.music")]
        assert (await c.as_(other).get("/api/cm/accounts")).json() == []
    assert (await pg_session.execute(select(InstagramAccount))).scalar_one().owner_user_id == u.id
    assert len((await pg_session.execute(select(CmAccountStat))).scalars().all()) == 1


# --------------------------------------------------------------------------
# Comptes retirés, nettoyage
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_removing_instagram_cancels_upcoming_and_deletes_data(pg_session, cmenv):
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    pg_session.add(CmVideo(platform="instagram", account_id=acc.id, external_id="r1", views=10))
    pg_session.add(CmAccountStat(platform="instagram", account_id=acc.id, day=utcnow().date(), followers=1))
    await pg_session.commit()
    when = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        _, r = await _publish(h, [_ig_target(acc.id, scheduled_at=when)], mp4_bytes(10_000))
        tid = r.json()["targets"][0]["id"]
        r = await h.delete(f"/api/cm/instagram/accounts/{acc.id}")
        assert r.status_code == 200
    t = await pg_session.get(CmTarget, tid)
    await pg_session.refresh(t)
    assert t.status == "CANCELLED"
    await cm_jobs.cleanup(pg_session)
    assert (await pg_session.execute(select(CmVideo))).scalars().all() == []
    assert (await pg_session.execute(select(CmAccountStat))).scalars().all() == []
    assert os.listdir(settings.CM_MEDIA_DIR) == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_abandoned_upload_is_cleaned(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    tacc = await _tt_account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/cm/posts", json={"title": "x", "video_size": 5000, "targets": [_tt_target(tacc.id)]})
        post_id = r.json()["post_id"]
    post = await pg_session.get(CmPost, post_id)
    post.updated_at = utcnow() - timedelta(hours=3)
    await pg_session.commit()
    await cm_jobs.cleanup(pg_session)
    await pg_session.refresh(post)
    assert post.status == "CANCELLED" and post.media_path is None and os.listdir(settings.CM_MEDIA_DIR) == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cover_sent_the_day_before_survives_cleanup(pg_session, cmenv):
    """Couverture envoyée la veille (routines) : le nettoyage des fichiers orphelins ne l'efface pas."""
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    when = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        data = mp4_bytes(10_000)
        r = await h.post("/api/cm/posts", json={"title": "x", "file_name": "clip.mp4", "video_size": len(data),
                                                "targets": [_ig_target(acc.id, scheduled_at=when)]})
        post_id = r.json()["post_id"]
        await _send(h, post_id, data)
        r = await h.put(f"/api/cm/posts/{post_id}/cover", content=b"\xff\xd8\xff\xe0" + b"0" * 2000)
        assert r.status_code == 200, r.text
        r = await h.post(f"/api/cm/posts/{post_id}/submit")
        assert r.status_code == 200, r.text
        assert (await h.get(f"/api/cm/posts/{post_id}")).json()["has_cover"] is True
    post = await pg_session.get(CmPost, post_id)
    await pg_session.refresh(post)
    old = utcnow().timestamp() - 5 * 3600
    for f in (post.cover_path, post.media_path):
        os.utime(f, (old, old))
    await cm_jobs.cleanup(pg_session)
    assert os.path.exists(post.cover_path) and os.path.exists(post.media_path)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_thumbnail_and_download_links(pg_session, cmenv, tmp_path):
    """Miniature : la couverture envoyée, sinon l'image de la vidéo à l'instant choisi ; liens de téléchargement signés."""
    import shutil, subprocess
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    when = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        data = mp4_bytes(10_000)
        target = _ig_target(acc.id, scheduled_at=when)
        target["options"]["thumb_offset_ms"] = 500
        post_id, r = await _publish(h, [target], data)
        assert r.status_code == 200, r.text
        # Sans couverture ni image extractible (fausse vidéo) : choisie par la plateforme.
        if not shutil.which("ffmpeg"):
            assert (await h.get(f"/api/cm/posts/{post_id}/thumbnail")).status_code == 404
        assert (await h.put(f"/api/cm/posts/{post_id}/cover", content=b"\xff\xd8\xff\xe0" + b"1" * 500)).status_code == 200
        r = await h.get(f"/api/cm/posts/{post_id}/thumbnail")
        assert r.status_code == 200 and r.content.startswith(b"\xff\xd8") and "miniature" in r.headers["content-disposition"]
        # Liens signés (app) : sans session, valables 10 minutes, liés à la publication et au type.
        link = (await h.post(f"/api/cm/posts/{post_id}/download-link?kind=video")).json()["url"]
        path = urlparse(link).path
        anon = httpx.AsyncClient(transport=c.http._transport, base_url="http://test")
        r = await anon.get(path)
        assert r.status_code == 200 and r.content == data and "attachment" in r.headers["content-disposition"]
        assert (await anon.get(path.replace("/video/", "/thumbnail/"))).status_code == 404
        thumb = (await h.post(f"/api/cm/posts/{post_id}/download-link?kind=thumbnail")).json()["url"]
        assert (await anon.get(urlparse(thumb).path)).content.startswith(b"\xff\xd8")
        await anon.aclose()
    if shutil.which("ffmpeg"):
        # Vraie vidéo, pas de couverture : l'image à l'instant choisi est extraite.
        src = tmp_path / "v.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=red:size=64x112:rate=10", "-t", "2", "-pix_fmt", "yuv420p", str(src)], check=True)
        post = await pg_session.get(CmPost, post_id)
        cm.remove_cover(post)
        shutil.copy(src, post.media_path)
        await pg_session.commit()
        async with Client(pg_session) as c:
            r = await c.as_(u).get(f"/api/cm/posts/{post_id}/thumbnail")
            assert r.status_code == 200 and r.content.startswith(b"\xff\xd8")


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_history_backfills_days_before_first_reading(pg_session, cmenv, monkeypatch):
    """Historique Instagram envoyé par la routine : jours d'avant le 1er relevé reconstitués à rebours, jamais écrasés."""
    from datetime import date
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    pg_session.add(CmAccountStat(platform="instagram", account_id=acc.id, day=date(2026, 11, 23), followers=1000, views=50_000))
    pg_session.add(CmAccountStat(platform="instagram", account_id=acc.id, day=date(2026, 11, 24), followers=1010, views=52_000))
    await pg_session.commit()
    monkeypatch.setattr(settings, "CM_SERVICE_USER_EMAIL", "a@t.dev")
    async with Client(pg_session) as c:
        h = c.http
        _service(h)
        days = [{"day": "2026-11-23", "views": 3000, "followers_gained": 20},
                {"day": "2026-11-22", "views": 2000, "followers_gained": 10},
                {"day": "2026-11-21", "views": 1000, "followers_gained": 5},
                {"day": "2026-11-24", "views": 999, "followers_gained": 999}]     # après le 1er relevé : ignoré
        r = await h.post("/api/cm/routine/stats/history", json={"username": "ghosthands.music", "days": days})
        assert r.status_code == 200, r.text
        assert r.json()["added"] == 3
        # Rejouer n'ajoute rien et ne modifie rien.
        assert (await h.post("/api/cm/routine/stats/history", json={"username": "ghosthands.music", "days": days})).json()["added"] == 0
    rows = {s.day: (s.followers, s.views) for s in (await pg_session.execute(
        select(CmAccountStat).where(CmAccountStat.account_id == acc.id))).scalars()}
    assert rows[date(2026, 11, 22)] == (980, 47_000)
    assert rows[date(2026, 11, 21)] == (970, 45_000)
    assert rows[date(2026, 11, 20)] == (965, 44_000)
    assert rows[date(2026, 11, 24)] == (1010, 52_000)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_thumbnail_after_publication(pg_session, cmenv, monkeypatch):
    """Publiée : couverture reprise dans le Drive (archive) ; sans couverture ni instant choisi : celle de la plateforme."""
    from src.services import gdrive_service as gd
    u = await _user(pg_session, "a@t.dev")
    acc = await _ig_routine(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        post_id, r = await _publish(h, [_ig_target(acc.id, scheduled_at=(utcnow() + timedelta(days=1)).isoformat() + "Z")], mp4_bytes(10_000))
        tid = r.json()["targets"][0]["id"]
    post = await pg_session.get(CmPost, post_id)
    cm.remove_media(post)                               # publiée et rangée : plus rien sur le serveur
    post.archive = {"cover_id": "drive-cover-1"}
    await pg_session.commit()
    monkeypatch.setattr(gd, "is_enabled", lambda: True)
    async def fake_download(file_id, dest, max_bytes):
        assert file_id == "drive-cover-1"
        open(dest, "wb").write(b"\xff\xd8\xff\xe0drive")
        return 9
    monkeypatch.setattr(gd, "download", fake_download)
    async with Client(pg_session) as c:
        r = await c.as_(u).get(f"/api/cm/posts/{post_id}/thumbnail")
        assert r.status_code == 200 and r.content == b"\xff\xd8\xff\xe0drive"
    # Sans couverture archivée ni instant choisi : redirigé vers la miniature de la plateforme.
    post.archive = {}
    await pg_session.commit()
    for f in os.listdir(settings.CM_MEDIA_DIR):
        if f.startswith(f"thumb-{post_id}-"):
            os.unlink(os.path.join(settings.CM_MEDIA_DIR, f))
    pg_session.add(CmVideo(platform="instagram", account_id=acc.id, external_id="r1", target_id=tid, thumbnail_url="https://cdn.ig/t.jpg"))
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).get(f"/api/cm/posts/{post_id}/thumbnail")
        assert r.status_code == 302 and r.headers["location"] == "https://cdn.ig/t.jpg"


def test_media_links_expire_and_are_bound_to_the_target(monkeypatch):
    t = CmTarget(id=7)
    url = cm.media_url(t, "video/mp4")
    _, _, _, _, tid, exp, sig = urlparse(url).path.split("/")
    assert cm.check_media_link(7, int(exp), sig[:-4])
    assert not cm.check_media_link(8, int(exp), sig[:-4])
    assert not cm.check_media_link(7, int(exp) - 10_000_000, sig[:-4])


def test_cm_proxy_forwards_real_ip_only_with_key(monkeypatch):
    from starlette.requests import Request
    from src.services.user_apps import client_ip
    monkeypatch.setattr(settings, "CM_PROXY_KEY", "cle-cm")

    def req(headers):
        return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                        "client": ("10.0.0.5", 1234)})
    assert client_ip(req({"X-Cm-Client-IP": "1.2.3.4", "X-Cm-Proxy-Key": "cle-cm"})) == "1.2.3.4"
    assert client_ip(req({"X-Cm-Client-IP": "1.2.3.4", "X-Cm-Proxy-Key": "fausse"})) == "10.0.0.5"
    assert client_ip(req({"X-Cm-Client-IP": "1.2.3.4"})) == "10.0.0.5"
