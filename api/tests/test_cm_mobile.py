"""cm.chapote.fr — application mobile : connexion (navigateur + PKCE, formulaire), sessions,
appareils, notifications (réglages et envoi). Vraie base jetable (`real_db`)."""
import base64
import html
import re
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import select

from src.core.config import settings
from src.core.security import AUTH_COOKIE_NAME
from src.core.time import utcnow
from src.models.cm import CmComment, CmMemberRole, CmPost, CmTarget
from src.models.cm_mobile import CmMobileDevice, CmPushEvent
from src.services import cm_push

from test_cm import cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _org, _user  # noqa: F401
from test_tiktok import _account as _tt_account

PUSH = "ExponentPushToken[abcdefghijklmnop]"


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


async def _login_by_browser(h, verifier, challenge, redirect="chapotecm://auth"):
    r = await h.post("/api/cm/mobile/connect", data={"redirect_uri": redirect, "challenge": challenge, "state": "s1"})
    assert r.status_code == 200, r.text
    # Pas de redirection (la CSP form-action du nginx de cm la bloquerait) : un lien et un rafraîchissement.
    assert "location" not in r.headers
    m = re.search(r'http-equiv="refresh" content="0;url=([^"]+)"', r.text)
    loc = html.unescape(m.group(1))
    assert f'href="{m.group(1)}"' in r.text
    assert loc.startswith(redirect + ("&" if "?" in redirect else "?"))
    q = parse_qs(urlparse(loc).query)
    assert q["state"] == ["s1"]
    return q["code"][0]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_connect_page_and_pkce_exchange(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    verifier, challenge = _pkce()
    async with Client(pg_session) as c:
        anon = c.http
        # Lien invalide : schéma de retour inconnu, challenge mal formé.
        r = await anon.get("/api/cm/mobile/connect", params={"redirect_uri": "https://evil.test/x", "challenge": challenge})
        assert r.status_code == 400
        r = await anon.get("/api/cm/mobile/connect", params={"redirect_uri": "chapotecm://auth", "challenge": "court"})
        assert r.status_code == 400
        # Pas connecté sur le site : page qui renvoie vers cm.chapote.fr.
        r = await anon.get("/api/cm/mobile/connect", params={"redirect_uri": "chapotecm://auth", "challenge": challenge})
        assert r.status_code == 200 and "Connexion" in r.text and "https://cm.chapote.test/" in r.text
        assert "form-action 'self'" in r.headers["content-security-policy"]
        old_gid = settings.GOOGLE_CLIENT_ID
        settings.GOOGLE_CLIENT_ID = "gid-123.apps.googleusercontent.com"
        try:
            r = await anon.get("/api/cm/mobile/connect", params={"redirect_uri": "chapotecm://auth", "challenge": challenge})
            assert 'data-client="gid-123.apps.googleusercontent.com"' in r.text and "connect.js" in r.text
            assert "https://accounts.google.com/gsi/client" in r.headers["content-security-policy"]
        finally:
            settings.GOOGLE_CLIENT_ID = old_gid
        js = await anon.get("/api/cm/mobile/connect.js")
        assert js.status_code == 200 and "javascript" in js.headers["content-type"] and "/api/auth/google" in js.text
        # Autoriser sans être connecté : refusé.
        r = await anon.post("/api/cm/mobile/connect", data={"redirect_uri": "chapotecm://auth", "challenge": challenge})
        assert r.status_code == 401

        h = c.as_(a)
        r = await h.get("/api/cm/mobile/connect", params={"redirect_uri": "chapotecm://auth", "challenge": challenge, "state": "s1"})
        assert r.status_code == 200 and "a@t.dev" in r.text and "Autoriser" in r.text
        code = await _login_by_browser(h, verifier, challenge)
        c.http.cookies.clear()

        # Mauvais verifier : refusé (et le code n'est pas brûlé).
        r = await anon.post("/api/cm/mobile/token", json={"code": code, "verifier": _pkce()[0]})
        assert r.status_code == 400
        r = await anon.post("/api/cm/mobile/token", json={"code": code, "verifier": verifier, "name": "iPhone", "platform": "ios"})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["user"]["email"] == "a@t.dev" and out["expires_in"] == 3600 and out["refresh_token"]
        # Usage unique.
        assert (await anon.post("/api/cm/mobile/token", json={"code": code, "verifier": verifier})).status_code == 400

        dev = (await pg_session.execute(select(CmMobileDevice))).scalar_one()
        assert dev.name == "iPhone" and dev.platform == "ios"
        assert dev.token_hash == hashlib.sha256(out["refresh_token"].encode()).hexdigest()

        # La session d'une heure ouvre les routes existantes (cookie envoyé par l'app).
        r = await anon.get("/api/cm/spaces", headers={"Cookie": f"{AUTH_COOKIE_NAME}={out['session']}"})
        assert r.status_code == 200, r.text
        # Expo Go (développement) accepté aussi.
        v2, ch2 = _pkce()
        h = c.as_(a)
        await _login_by_browser(h, v2, ch2, redirect="exp://192.168.1.2:8081/--/auth")


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_refresh_logout_and_devices(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        r = await h.post("/api/cm/mobile/devices", json={"name": "Pixel", "platform": "android"})
        assert r.status_code == 200
        token = r.json()["refresh_token"]
        r2 = await h.post("/api/cm/mobile/devices", json={"name": "Tablette", "platform": "weird"})
        assert r2.json()["refresh_token"] != token
        c.http.cookies.clear()

        r = await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})
        assert r.status_code == 200 and r.json()["session"] and r.json()["user"]["id"] == a.id
        assert (await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": "inconnu"})).status_code == 401
        assert (await c.http.post("/api/cm/mobile/devices", json={})).status_code == 401

        h = c.as_(a)
        devices = (await h.get("/api/cm/mobile/devices")).json()
        assert [d["name"] for d in devices] == ["Tablette", "Pixel"] or {d["name"] for d in devices} == {"Pixel", "Tablette"}
        tab = next(d for d in devices if d["name"] == "Tablette")
        assert tab["platform"] is None
        # Un autre utilisateur ne peut pas révoquer mes appareils.
        hb = c.as_(b)
        assert (await hb.delete(f"/api/cm/mobile/devices/{tab['id']}")).status_code == 404
        h = c.as_(a)
        assert (await h.delete(f"/api/cm/mobile/devices/{tab['id']}")).status_code == 200
        assert [d["name"] for d in (await h.get("/api/cm/mobile/devices")).json()] == ["Pixel"]
        assert (await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": r2.json()["refresh_token"]})).status_code == 401

        # Déconnexion depuis l'app : le jeton ne sert plus.
        assert (await c.http.post("/api/cm/mobile/logout", json={"refresh_token": token})).json() == {"ok": True}
        assert (await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})).status_code == 401
        assert (await c.http.post("/api/cm/mobile/logout", json={"refresh_token": token})).json() == {"ok": True}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_push_settings(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        t1 = (await h.post("/api/cm/mobile/devices", json={})).json()["refresh_token"]
        t2 = (await h.post("/api/cm/mobile/devices", json={})).json()["refresh_token"]
        r = await h.get("/api/cm/mobile/push", params={"refresh_token": t1})
        assert r.json() == {"enabled": False, "prefs": {"published": True, "failed": True, "draft": True, "comments": True, "storage": True}}
        assert (await h.put("/api/cm/mobile/push", json={"refresh_token": t1, "push_token": "nimporte"})).status_code == 400
        r = await h.put("/api/cm/mobile/push", json={"refresh_token": t1, "push_token": PUSH, "prefs": {"comments": False}})
        assert r.status_code == 200 and r.json()["enabled"] and r.json()["prefs"]["comments"] is False
        r = await h.put("/api/cm/mobile/push", json={"refresh_token": t1, "prefs": {"published": False}})
        assert r.json()["prefs"] == {"published": False, "failed": True, "draft": True, "comments": False, "storage": True}
        # Même téléphone reconnecté : le jeton passe au nouvel appareil.
        await h.put("/api/cm/mobile/push", json={"refresh_token": t2, "push_token": PUSH})
        assert (await h.get("/api/cm/mobile/push", params={"refresh_token": t1})).json()["enabled"] is False
        # Couper les notifications.
        r = await h.put("/api/cm/mobile/push", json={"refresh_token": t2, "push_token": ""})
        assert r.json()["enabled"] is False


async def _device(db, user, token, prefs=None):
    d = CmMobileDevice(user_id=user.id, token_hash=secrets.token_hex(32), push_token=token, push_prefs=prefs)
    db.add(d)
    await db.flush()
    return d


async def _target(db, post, acc, status, **kw):
    t = CmTarget(post_id=post.id, platform="tiktok", account_id=acc.id, scheduled_at=utcnow(), options={},
                 status=status, **kw)
    db.add(t)
    await db.flush()
    return t


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_push_collect_and_send(pg_session, cmenv):
    db = pg_session
    a = await _user(db, "a@t.dev")
    b = await _user(db, "b@t.dev")
    viewer = await _user(db, "v@t.dev")
    outsider = await _user(db, "o@t.dev")
    org = await _org(db, a, (b, "member"), (viewer, "member"))
    acc = await _tt_account(db, org=org, by=a, open_id="oid-1")
    # Le lecteur est limité à un groupe vide : il ne voit pas ce compte.
    db.add(CmMemberRole(organization_id=org.id, email="v@t.dev", role="viewer", group_ids=[]))
    da = await _device(db, a, "ExponentPushToken[aaaaaaaaaaaa]")
    db_ = await _device(db, b, "ExponentPushToken[bbbbbbbbbbbb]", prefs={"published": False, "failed": True, "draft": True, "comments": True})
    await _device(db, viewer, "ExponentPushToken[vvvvvvvvvvvv]")
    await _device(db, outsider, "ExponentPushToken[oooooooooooo]")
    post = CmPost(organization_id=org.id, user_id=a.id, title="Clair de lune", video_size=1, status="READY")
    db.add(post)
    await db.flush()
    pub = await _target(db, post, acc, "PUBLISHED", url="https://www.tiktok.com/@x/video/1")
    fail = await _target(db, post, acc, "FAILED", error_message="Ce niveau de confidentialité n'est plus proposé.")
    old = await _target(db, post, acc, "PUBLISHED")
    old.updated_at = utcnow() - timedelta(hours=2)
    await _target(db, post, acc, "SCHEDULED")
    for i in range(3):
        db.add(CmComment(organization_id=org.id, platform="tiktok", account_id=acc.id, external_id=f"c{i}",
                         author=f"fan{i}", text=f"Bravo {i}", status="new"))
    await db.commit()

    msgs = await cm_push.collect(db)
    by_to: dict[str, list[dict]] = {}
    for m in msgs:
        by_to.setdefault(m["to"], []).append(m)
    assert set(by_to) == {da.push_token, db_.push_token}       # ni le lecteur limité, ni l'inconnu
    titles_a = sorted(m["title"] for m in by_to[da.push_token])
    assert titles_a == ["3 nouveaux commentaires", "Vidéo publiée", "Échec sur TikTok"]
    assert sorted(m["title"] for m in by_to[db_.push_token]) == ["3 nouveaux commentaires", "Échec sur TikTok"]
    published = next(m for m in by_to[da.push_token] if m["title"] == "Vidéo publiée")
    assert published["data"] == {"type": "published", "post_id": post.id, "target_id": pub.id, "url": pub.url}
    failed = next(m for m in by_to[da.push_token] if m["data"]["type"] == "failed")
    assert "Clair de lune" in failed["body"] and "confidentialité" in failed["body"]
    kinds = {(e.kind, e.ref_id) for e in (await db.execute(select(CmPushEvent))).scalars()}
    assert ("published", pub.id) in kinds and ("failed", fail.id) in kinds and ("published", old.id) not in kinds

    # Jamais deux fois.
    assert await cm_push.collect(db) == []

    # Envoi : un téléphone désinstallé perd son jeton.
    sent_bodies = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        sent_bodies.append(body)
        return httpx.Response(200, json={"data": [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}} if m["to"] == db_.push_token
            else {"status": "ok", "id": "x"} for m in body]})

    cm_push._transport = httpx.MockTransport(handler)
    try:
        sent = await cm_push.send(db, msgs)
    finally:
        cm_push._transport = None
    assert sent == 3 and all("_device" not in m for m in sent_bodies[0])
    await db.refresh(db_)
    await db.refresh(da)
    assert db_.push_token is None and da.push_token is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_push_nothing_without_devices(pg_session, cmenv):
    db = pg_session
    a = await _user(db, "a@t.dev")
    acc = await _tt_account(db, owner=a, open_id="oid-1")
    post = CmPost(owner_user_id=a.id, user_id=a.id, title="x", video_size=1, status="READY")
    db.add(post)
    await db.flush()
    await _target(db, post, acc, "INBOX")
    await db.commit()
    assert await cm_push.collect(db) == []
    # Un téléphone arrive ensuite : l'événement récent part (brouillon TikTok).
    await _device(db, a, PUSH)
    await db.commit()
    msgs = await cm_push.collect(db)
    assert [m["title"] for m in msgs] == ["Brouillon TikTok à publier"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_pending_pickup_when_return_link_fails(pg_session, cmenv):
    """Retour automatique dans l'app raté (Expo Go…) : l'app reprend le code avec son verifier."""
    a = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    verifier, challenge = _pkce()
    async with Client(pg_session) as c:
        anon = c.http
        assert (await anon.post("/api/cm/mobile/token/pending", json={"verifier": verifier})).status_code == 404
        h = c.as_(a)
        await _login_by_browser(h, verifier, challenge, redirect="exp://u.expo.dev/abc/--/auth?channel-name=preview")
        c.http.cookies.clear()
        # Un autre verifier ne reprend rien.
        assert (await anon.post("/api/cm/mobile/token/pending", json={"verifier": _pkce()[0]})).status_code == 404
        r = await anon.post("/api/cm/mobile/token/pending", json={"verifier": verifier, "name": "Pixel", "platform": "android"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == "a@t.dev" and r.json()["refresh_token"]
        # Une seule fois.
        assert (await anon.post("/api/cm/mobile/token/pending", json={"verifier": verifier})).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_idle_device_warned_then_logged_out(pg_session, cmenv):
    """7 jours sans ouvrir l'app : prévenu la veille (une fois), puis déconnecté (refresh 401, plus de notifications)."""
    db = pg_session
    a = await _user(db, "a@t.dev")
    await db.commit()
    async with Client(db) as c:
        token = (await c.as_(a).post("/api/cm/mobile/devices", json={})).json()["refresh_token"]
        c.http.cookies.clear()
        dev = (await db.execute(select(CmMobileDevice))).scalar_one()
        dev.push_token = PUSH
        dev.last_used_at = utcnow() - timedelta(days=6, hours=1)
        await db.commit()

        msgs = await cm_push.collect(db)
        assert [m["data"]["type"] for m in msgs] == ["idle_warning"]
        assert await cm_push.collect(db) == []                       # une seule fois

        # Ouverte entre-temps : l'avertissement pourra repartir plus tard.
        assert (await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})).status_code == 200
        assert (await db.execute(select(CmPushEvent).where(CmPushEvent.kind == "idle"))).scalars().first() is None

        await db.refresh(dev)
        dev.last_used_at = utcnow() - timedelta(days=7, hours=1)
        await db.commit()
        msgs = await cm_push.collect(db)
        assert [m["data"]["type"] for m in msgs] == ["idle_logout"] and msgs[0]["to"] == PUSH
        await db.refresh(dev)
        assert dev.revoked_at is not None and dev.push_token is None
        r = await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})
        assert r.status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_idle_device_refused_on_refresh_without_push(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        token = (await c.as_(a).post("/api/cm/mobile/devices", json={})).json()["refresh_token"]
        c.http.cookies.clear()
        dev = (await pg_session.execute(select(CmMobileDevice))).scalar_one()
        dev.last_used_at = utcnow() - timedelta(days=8)
        await pg_session.commit()
        r = await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})
        assert r.status_code == 401 and "7 jours" in r.json()["detail"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_web_link_logs_browser_into_app_account(pg_session, cmenv):
    """Connexion d'un compte TikTok/YouTube depuis l'app : le navigateur, connecté à un autre compte,
    passe sur le compte de l'app avant d'aller chez la plateforme (lien à usage unique)."""
    a = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    google = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc"
    async with Client(pg_session) as c:
        anon = c.http
        assert (await anon.post("/api/cm/mobile/web-link", json={"next": google})).status_code == 401
        h = c.as_(a)
        for bad in ("https://evil.test/x", "http://accounts.google.com/x", "chapotecm://auth",
                    "https://accounts.google.com.evil.test/x", "https://u@accounts.google.com/x"):
            assert (await h.post("/api/cm/mobile/web-link", json={"next": bad})).status_code == 400, bad
        r = await h.post("/api/cm/mobile/web-link", json={"next": google})
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        assert path.startswith("/api/cm/mobile/web-session?t=")
        c.http.cookies.clear()
        r = await anon.get(path, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == google
        cookie = r.cookies.get(AUTH_COOKIE_NAME)
        assert cookie
        c.http.cookies.clear()
        me = await anon.get("/api/auth/me", headers={"Cookie": f"{AUTH_COOKIE_NAME}={cookie}"})
        assert me.status_code == 200 and me.json()["email"] == "a@t.dev"
        # Une seule fois ; jeton trafiqué refusé.
        r = await anon.get(path, follow_redirects=False)
        assert r.status_code == 400 and AUTH_COOKIE_NAME not in r.cookies
        assert (await anon.get("/api/cm/mobile/web-session?t=abc", follow_redirects=False)).status_code == 400
