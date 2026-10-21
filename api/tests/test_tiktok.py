"""Module TikTok « Chapote Publisher » (Espace client, multi-tenant).

TikTok est simulé par un httpx.MockTransport branché sur
tiktok_service._transport : AUCUN appel réel. Les tests d'endpoints tournent
sur la vraie base jetable (`real_db`) : l'isolation entre tenants ne se prouve
pas avec FakeSession (cf. conftest). Authentification réelle par le cookie de
session dashboard (get_current_user exercé).

Couvre : découpage FILE_UPLOAD, lecture de format/durée, OAuth (state signé à
usage unique, expiré, rejoué, d'un autre utilisateur), isolation entre tenants
(lister / utiliser / déconnecter / publier), refresh (à la volée, planifié,
rotation, échec => à reconnecter), révocation, publication directe et
brouillon (init, chunks, statut, suppression du fichier temporaire),
validations serveur, back-office en lecture seule.
"""
import json
import os
import struct
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import AUTH_COOKIE_NAME, _encode, create_dashboard_token
from src.core.time import utcnow
from src.main import app
from src.models.tiktok import TikTokAccount, TikTokPost
from src.models.user import Membership, Organization, User
from src.routers import tiktok as tiktok_router
from src.services import tiktok_jobs
from src.services import tiktok_service as tt
from src.services.crypto import decrypt_secret, encrypt_secret
from src.services.video_probe import ProbeError, probe

MB = 1000 * 1000
UPLOAD_URL = "https://upload.tiktok.test/video/?token=xyz"
SCOPES = "user.info.basic,video.upload,video.publish"


# --------------------------------------------------------------------------
# Faux TikTok
# --------------------------------------------------------------------------

class FakeTikTok:
    """Faux serveur TikTok : enregistre les requêtes, réponses configurables."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.open_id = "oid-1"
        self.creator = {
            "creator_nickname": "Studio Démo", "creator_username": "studio.demo",
            "creator_avatar_url": "https://p16.tiktok/a.jpg",
            "privacy_level_options": ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
            "comment_disabled": False, "duet_disabled": True, "stitch_disabled": False,
            "max_video_post_duration_sec": 600,
        }
        self.creator_error = None
        self.refresh_error = None
        self.init_error = None
        self.status = {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [123]}
        self.refresh_count = 0
        self.upload_failures = []      # codes HTTP renvoyés (un par PUT) avant succès

    @staticmethod
    def ok(data):
        return httpx.Response(200, json={"data": data, "error": {"code": "ok", "message": "", "log_id": "L"}})

    @staticmethod
    def err(http, code):
        return httpx.Response(http, json={"data": {}, "error": {"code": code, "message": "nope", "log_id": "LOG42"}})

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        path = req.url.path
        if path == "/v2/oauth/token/":
            form = parse_qs(req.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                if self.refresh_error:
                    return httpx.Response(400, json={"error": self.refresh_error, "error_description": "bad", "log_id": "R"})
                self.refresh_count += 1
                n = self.refresh_count
                return httpx.Response(200, json={"access_token": f"act.new{n}", "refresh_token": f"rft.new{n}",
                                                 "expires_in": 86400, "refresh_expires_in": 31536000,
                                                 "open_id": self.open_id, "scope": SCOPES})
            if form["code"] == ["bad"]:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Code expired", "log_id": "X1"})
            return httpx.Response(200, json={"access_token": "act.1", "refresh_token": "rft.1", "expires_in": 86400,
                                             "refresh_expires_in": 31536000, "open_id": self.open_id,
                                             "scope": SCOPES, "token_type": "Bearer"})
        if path == "/v2/oauth/revoke/":
            return httpx.Response(200, content=b"")  # corps vide, comme TikTok
        if path == "/v2/user/info/":
            return self.ok({"user": {"open_id": self.open_id, "display_name": "studio.demo",
                                     "avatar_url": "https://p16.tiktok/a.jpg"}})
        if path == "/v2/post/publish/creator_info/query/":
            if self.creator_error:
                return self.err(403, self.creator_error)
            return self.ok(self.creator)
        if path in ("/v2/post/publish/video/init/", "/v2/post/publish/inbox/video/init/"):
            if self.init_error:
                return self.err(403, self.init_error)
            return self.ok({"publish_id": "v_pub_file~1", "upload_url": UPLOAD_URL})
        if req.url.host == "upload.tiktok.test":
            if self.upload_failures:
                code = self.upload_failures.pop(0)
                if code == 0:
                    raise httpx.ConnectError("coupure", request=req)
                return httpx.Response(code, text="<html>Service Temporarily Unavailable</html>")
            rng = req.headers["Content-Range"].split("/")
            end = int(rng[0].split("-")[1])
            return httpx.Response(201 if end + 1 == int(rng[1]) else 206)
        if path == "/v2/post/publish/status/fetch/":
            return self.ok(self.status)
        return httpx.Response(404, json={"error": {"code": "not_found", "message": path}})

    def paths(self):
        return [c.url.path for c in self.calls]

    def last(self, path):
        return [c for c in self.calls if c.url.path == path][-1]


@pytest.fixture
def tiktok(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_KEY", "ck_test")
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_SECRET", "cs_test")
    monkeypatch.setattr(settings, "TIKTOK_TMP_DIR", str(tmp_path / "tt"))
    fake = FakeTikTok()
    monkeypatch.setattr(tt, "_transport", httpx.MockTransport(fake.handler))
    # Envoi TikTok : capturé (exécuté explicitement par le test, sur pg_session).
    fake.launched = []
    monkeypatch.setattr(tiktok_jobs, "launch", lambda post_id: fake.launched.append(post_id))
    # Morceaux de 1 Ko vers Chapote : vidéos de test légères.
    monkeypatch.setattr(tiktok_router, "PART_SIZE", 1024)
    monkeypatch.setattr(tt, "CHUNK_RETRY_DELAYS", (0, 0, 0))
    return fake


# --------------------------------------------------------------------------
# Vidéos synthétiques
# --------------------------------------------------------------------------

def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def mp4_bytes(duration_ms: int = 42_000, *, brand: bytes = b"isom", v1: bool = False,
              moov_last: bool = False, mdat: int = 3000) -> bytes:
    if v1:
        mvhd = bytes([1, 0, 0, 0]) + struct.pack(">QQIQ", 0, 0, 1000, duration_ms) + bytes(80)
    else:
        mvhd = bytes(4) + struct.pack(">IIII", 0, 0, 1000, duration_ms) + bytes(80)
    ftyp = _box(b"ftyp", brand + bytes(4) + brand)
    moov = _box(b"moov", _box(b"mvhd", mvhd))
    data = _box(b"mdat", b"\x00" * mdat)
    return ftyp + (data + moov if moov_last else moov + data)


def _ebml(eid: int, payload: bytes) -> bytes:
    assert len(payload) < 127
    return eid.to_bytes((eid.bit_length() + 7) // 8, "big") + bytes([0x80 | len(payload)]) + payload


def webm_bytes(duration_ms: float = 42_000.0) -> bytes:
    header = _ebml(0x1A45DFA3, _ebml(0x4282, b"webm"))
    info = _ebml(0x1549A966, _ebml(0x2AD7B1, (1_000_000).to_bytes(3, "big"))
                 + _ebml(0x4489, struct.pack(">d", duration_ms)))
    segment = (0x18538067).to_bytes(4, "big") + b"\x01\xff\xff\xff\xff\xff\xff\xff" + info + b"\x00" * 500
    return header + segment


def _write(tmp_path: Path, data: bytes) -> str:
    p = tmp_path / "v.bin"
    p.write_bytes(data)
    return str(p)


# --------------------------------------------------------------------------
# Unitaires : découpage + lecture vidéo
# --------------------------------------------------------------------------

@pytest.mark.parametrize("size, chunk, count", [
    (3 * MB, 3 * MB, 1),        # < 5 MB : un seul chunk = taille du fichier
    (5 * MB, 5 * MB, 1),
    (12 * MB, 12 * MB, 1),      # <= 64 MB : un seul chunk
    (64 * MB, 64 * MB, 1),
    (64 * MB + 1, 10 * MB, 6),  # > 64 MB : chunks de 10 MB, floor()
    (70 * MB, 10 * MB, 7),
    (133 * MB, 10 * MB, 13),
])
def test_chunk_plan_rules(size, chunk, count):
    assert tt.chunk_plan(size) == (chunk, count)


@pytest.mark.parametrize("size", [3 * MB + 7, 12 * MB + 1, 64 * MB, 70 * MB + 123, 133 * MB + 999_999, 4000 * MB])
def test_chunk_ranges_follow_tiktok_rules(size):
    cs, n = tt.chunk_plan(size)
    assert 1 <= n <= tt.MAX_CHUNK_COUNT
    ranges = [tt.chunk_range(i, cs, n, size) for i in range(n)]
    assert ranges[0][0] == 0 and ranges[-1][1] == size - 1
    assert all(ranges[i][1] + 1 == ranges[i + 1][0] for i in range(n - 1))   # contigus
    sizes = [e - s + 1 for s, e in ranges]
    assert all(x == cs for x in sizes[:-1])
    if n == 1:
        assert cs == size and size <= tt.MAX_CHUNK
    else:
        assert tt.MIN_CHUNK <= cs <= tt.MAX_CHUNK
        assert cs <= sizes[-1] <= tt.MAX_LAST_CHUNK


def test_chunk_plan_rejects_oversize():
    with pytest.raises(ValueError):
        tt.chunk_plan(tt.MAX_VIDEO_SIZE + 1)


@pytest.mark.parametrize("data, mime, dur", [
    (mp4_bytes(42_000), "video/mp4", 42.0),
    (mp4_bytes(61_500, v1=True), "video/mp4", 61.5),
    (mp4_bytes(30_000, moov_last=True), "video/mp4", 30.0),
    (mp4_bytes(12_000, brand=b"qt  "), "video/quicktime", 12.0),
    (webm_bytes(42_000.0), "video/webm", 42.0),
])
def test_probe_reads_format_and_duration(tmp_path, data, mime, dur):
    info = probe(_write(tmp_path, data))
    assert info.mime_type == mime and info.duration_sec == pytest.approx(dur)


@pytest.mark.parametrize("data", [
    b"GIF89a" + b"\0" * 100,                                         # pas une vidéo
    _box(b"ftyp", b"isom\0\0\0\0isom") + _box(b"mdat", b"\0" * 50),  # pas de moov
    b"",
])
def test_probe_rejects_unreadable(tmp_path, data):
    with pytest.raises(ProbeError):
        probe(_write(tmp_path, data))


def test_error_messages_are_french_and_carry_log_id():
    e = tt.TikTokError("spam_risk_too_many_posts", "x", "LOG1", 403)
    assert "nombre maximal" in e.describe() and "LOG1" in e.describe()
    assert "inconnu_xyz" in tt.TikTokError("inconnu_xyz", "msg").describe()


# --------------------------------------------------------------------------
# Harness DB réelle
# --------------------------------------------------------------------------

class Client:
    """Client HTTP authentifié par le vrai cookie de session dashboard."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def __aenter__(self):
        async def _get_db():
            yield self._session
        app.dependency_overrides[get_db] = _get_db
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        return self

    async def __aexit__(self, *exc):
        await self.http.aclose()
        app.dependency_overrides.pop(get_db, None)

    def as_(self, user: User):
        self.http.cookies.set(AUTH_COOKIE_NAME, create_dashboard_token(user.id))
        return self.http


async def _user(db, email, **kw) -> User:
    u = User(email=email, hashed_password="x", name=email.split("@")[0], is_active=True, **kw)
    db.add(u)
    await db.flush()
    return u


async def _org(db, owner: User, *members: tuple[User, str]) -> Organization:
    org = Organization(name=f"Org {owner.name}", owner_user_id=owner.id)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=owner.id, organization_id=org.id, role="admin", permissions={}))
    for u, role in members:
        db.add(Membership(user_id=u.id, organization_id=org.id, role=role, permissions={}))
    await db.flush()
    return org


async def _account(db, *, org=None, owner=None, by=None, open_id="oid-1", **kw) -> TikTokAccount:
    now = utcnow()
    acc = TikTokAccount(
        organization_id=org.id if org else None, owner_user_id=owner.id if owner else None,
        connected_by_user_id=(by or owner).id if (by or owner) else None,
        open_id=open_id, display_name="studio.demo", scopes=SCOPES,
        access_token_enc=encrypt_secret("act.1"), refresh_token_enc=encrypt_secret("rft.1"),
        access_token_expires_at=now + timedelta(hours=10), refresh_token_expires_at=now + timedelta(days=300),
    )
    for k, v in kw.items():
        setattr(acc, k, v)
    db.add(acc)
    await db.flush()
    return acc


def _state(user_id, org_id=None, **over) -> str:
    claims = {"sub": str(user_id), "scope": "tiktok_oauth", "org": org_id, "jti": os.urandom(8).hex()}
    claims.update(over)
    return _encode(claims, timedelta(minutes=10))


# --------------------------------------------------------------------------
# OAuth
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disabled_without_keys(pg_session, monkeypatch):
    monkeypatch.setattr(settings, "TIKTOK_CLIENT_KEY", None)
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/tiktok/oauth/start", json={})
        assert r.status_code == 503
        assert (await c.as_(u).get("/api/tiktok/config")).json()["enabled"] is False


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_requires_dashboard_session(pg_session, tiktok):
    async with Client(pg_session) as c:
        assert (await c.http.get("/api/tiktok/accounts")).status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_oauth_start_and_exchange_into_org(pg_session, tiktok):
    owner = await _user(pg_session, "owner@t.dev")
    member = await _user(pg_session, "member@t.dev")
    org = await _org(pg_session, owner, (member, "member"))
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(member).post("/api/tiktok/oauth/start", json={"org_id": org.id})
        assert r.status_code == 200
        url = urlparse(r.json()["authorize_url"])
        q = parse_qs(url.query)
        assert url.netloc == "www.tiktok.com" and url.path == "/v2/auth/authorize/"
        assert q["client_key"] == ["ck_test"] and q["scope"] == [SCOPES]
        assert q["redirect_uri"] == ["https://chapote.fr/tiktok/callback"]
        assert "cs_test" not in r.text
        state = q["state"][0]
        claims = jwt.decode(state, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        assert claims["sub"] == str(member.id) and claims["org"] == org.id
        assert claims["exp"] - claims["iat"] <= 600

        r = await c.as_(member).post("/api/tiktok/oauth/exchange", json={"code": "c0de", "state": state})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["org_id"] == org.id
        assert body["account"]["display_name"] == "studio.demo" and body["account"]["can_publish"]
        assert "act." not in r.text and "rft." not in r.text and "oid-1" not in r.text

        form = parse_qs(tiktok.last("/v2/oauth/token/").content.decode())
        assert form["client_secret"] == ["cs_test"]
        assert form["redirect_uri"] == ["https://chapote.fr/tiktok/callback"]

        [acc] = (await pg_session.execute(select(TikTokAccount))).scalars().all()
        assert acc.organization_id == org.id and acc.owner_user_id is None
        assert acc.connected_by_user_id == member.id
        assert acc.access_token_enc != "act.1" and decrypt_secret(acc.access_token_enc) == "act.1"
        assert decrypt_secret(acc.refresh_token_enc) == "rft.1"

        # Rejeu du même state : refusé, TikTok non rappelé.
        n = len(tiktok.calls)
        r = await c.as_(member).post("/api/tiktok/oauth/exchange", json={"code": "c0de", "state": state})
        assert r.status_code == 400 and len(tiktok.calls) == n


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_oauth_start_refused_for_foreign_org(pg_session, tiktok):
    owner = await _user(pg_session, "o@t.dev")
    stranger = await _user(pg_session, "s@t.dev", is_superadmin=True)  # pas de passe-droit staff
    org = await _org(pg_session, owner)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(stranger).post("/api/tiktok/oauth/start", json={"org_id": org.id})
        assert r.status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["garbage", "expired", "other_user", "wrong_scope", "no_longer_member"])
async def test_exchange_rejects_bad_state(pg_session, tiktok, case):
    owner = await _user(pg_session, "o@t.dev")
    other = await _user(pg_session, "x@t.dev")
    member = await _user(pg_session, "m@t.dev")
    org = await _org(pg_session, owner, (member, "member"))
    await pg_session.commit()
    state = {
        "garbage": "web_abc",
        "expired": _encode({"sub": str(owner.id), "scope": "tiktok_oauth", "org": None, "jti": "j1"},
                           timedelta(seconds=-5)),
        "other_user": _state(other.id),
        "wrong_scope": _state(owner.id, scope="dashboard"),
        "no_longer_member": _state(member.id, org.id),
    }[case]
    if case == "no_longer_member":
        m = (await pg_session.execute(select(Membership).where(Membership.user_id == member.id))).scalar_one()
        await pg_session.delete(m)
        await pg_session.commit()
    who = member if case == "no_longer_member" else owner
    async with Client(pg_session) as c:
        r = await c.as_(who).post("/api/tiktok/oauth/exchange", json={"code": "c", "state": state})
    assert r.status_code in (400, 404)
    assert r.status_code != 401          # jamais pris pour une session Chapote expirée
    assert not tiktok.calls
    assert not (await pg_session.execute(select(TikTokAccount))).scalars().all()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_exchange_shows_tiktok_error(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/tiktok/oauth/exchange", json={"code": "bad", "state": _state(u.id)})
    assert r.status_code == 400 and "invalid_grant" in r.json()["detail"] and "X1" in r.json()["detail"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_reconnect_upserts_same_account_and_multiple_accounts(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        assert (await h.post("/api/tiktok/oauth/exchange", json={"code": "c", "state": _state(u.id)})).status_code == 200
        assert (await h.post("/api/tiktok/oauth/exchange", json={"code": "c", "state": _state(u.id)})).status_code == 200
        tiktok.open_id = "oid-2"
        assert (await h.post("/api/tiktok/oauth/exchange", json={"code": "c", "state": _state(u.id)})).status_code == 200
        accounts = (await h.get("/api/tiktok/accounts")).json()
    assert len(accounts) == 2
    rows = (await pg_session.execute(select(TikTokAccount))).scalars().all()
    assert {r.open_id for r in rows} == {"oid-1", "oid-2"} and all(r.owner_user_id == u.id for r in rows)


# --------------------------------------------------------------------------
# Isolation entre tenants
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tenant_isolation(pg_session, tiktok):
    alice = await _user(pg_session, "alice@t.dev")
    bob = await _user(pg_session, "bob@t.dev")
    org_a = await _org(pg_session, alice)
    org_b = await _org(pg_session, bob)
    acc_a = await _account(pg_session, org=org_a, by=alice)
    perso_a = await _account(pg_session, owner=alice, open_id="oid-perso")
    post_a = TikTokPost(organization_id=org_a.id, tiktok_account_id=acc_a.id, user_id=alice.id, mode="direct",
                        title="secret", privacy_level="SELF_ONLY", disable_comment=True, disable_duet=True,
                        disable_stitch=True, brand_organic=False, brand_content=False, video_size=10,
                        received_bytes=0, status="RECEIVING")
    pg_session.add(post_a)
    await pg_session.commit()

    async with Client(pg_session) as c:
        b = c.as_(bob)
        # Lister
        assert (await b.get("/api/tiktok/accounts", params={"org_id": org_b.id})).json() == []
        assert (await b.get("/api/tiktok/accounts")).json() == []
        assert (await b.get("/api/tiktok/accounts", params={"org_id": org_a.id})).status_code == 404
        assert (await b.get("/api/tiktok/posts", params={"org_id": org_a.id})).status_code == 404
        assert (await b.get("/api/tiktok/posts")).json() == []
        # Utiliser
        for acc in (acc_a, perso_a):
            assert (await b.get(f"/api/tiktok/accounts/{acc.id}/creator-info")).status_code == 404
            r = await b.post("/api/tiktok/posts", json={"account_id": acc.id, "mode": "draft", "video_size": 10})
            assert r.status_code == 404
        assert (await b.get(f"/api/tiktok/posts/{post_a.id}")).status_code == 404
        assert (await b.put(f"/api/tiktok/posts/{post_a.id}/parts/0", content=b"\0" * 10)).status_code == 404
        assert (await b.post(f"/api/tiktok/posts/{post_a.id}/submit")).status_code == 404
        assert (await b.delete(f"/api/tiktok/posts/{post_a.id}")).status_code == 404
        # Déconnecter
        assert (await b.delete(f"/api/tiktok/accounts/{acc_a.id}")).status_code == 404
        assert not tiktok.calls

        # Espace perso et équipe d'un même utilisateur restent séparés.
        a = c.as_(alice)
        org_list = (await a.get("/api/tiktok/accounts", params={"org_id": org_a.id})).json()
        perso_list = (await a.get("/api/tiktok/accounts")).json()
        assert [x["id"] for x in org_list] == [acc_a.id]
        assert [x["id"] for x in perso_list] == [perso_a.id]
        assert all("token" not in k and "open_id" not in k for x in org_list for k in x)
    await pg_session.refresh(acc_a)
    assert acc_a.revoked_at is None and decrypt_secret(acc_a.access_token_enc) == "act.1"


# --------------------------------------------------------------------------
# Jetons : refresh + révocation
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_expired_access_token_refreshed_on_the_fly(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u, access_token_expires_at=utcnow() - timedelta(minutes=1))
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).get(f"/api/tiktok/accounts/{acc.id}/creator-info")
    assert r.status_code == 200 and r.json()["creator"]["nickname"] == "Studio Démo"
    await pg_session.refresh(acc)
    assert decrypt_secret(acc.access_token_enc) == "act.new1"
    assert decrypt_secret(acc.refresh_token_enc) == "rft.new1"      # rotation conservée
    assert tiktok.last("/v2/post/publish/creator_info/query/").headers["Authorization"] == "Bearer act.new1"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_failed_refresh_marks_account_to_reconnect(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u, access_token_expires_at=utcnow() - timedelta(minutes=1))
    await pg_session.commit()
    tiktok.refresh_error = "invalid_grant"
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.get(f"/api/tiktok/accounts/{acc.id}/creator-info")
        assert r.status_code == 409 and "reconnectez" in r.json()["detail"]
        [out] = (await h.get("/api/tiktok/accounts")).json()
    assert out["needs_reconnect"] is True


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_scheduled_refresh(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    soon = await _account(pg_session, owner=u, access_token_expires_at=utcnow() + timedelta(minutes=30))
    later = await _account(pg_session, owner=u, open_id="oid-2", access_token_expires_at=utcnow() + timedelta(hours=20))
    dead = await _account(pg_session, owner=u, open_id="oid-3", access_token_expires_at=utcnow() + timedelta(minutes=10),
                          refresh_token_expires_at=utcnow() - timedelta(days=1))
    await pg_session.commit()
    await tiktok_jobs.refresh_due_tokens(pg_session)
    for a in (soon, later, dead):
        await pg_session.refresh(a)
    assert decrypt_secret(soon.access_token_enc).startswith("act.new")
    assert soon.access_token_expires_at > utcnow() + timedelta(hours=23)
    assert decrypt_secret(later.access_token_enc) == "act.1"         # pas encore dû
    assert dead.needs_reconnect is True                              # refresh expiré => à reconnecter
    assert tiktok.refresh_count == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disconnect_revokes_then_deletes_tokens(pg_session, tiktok):
    owner = await _user(pg_session, "o@t.dev")
    member = await _user(pg_session, "m@t.dev")
    other = await _user(pg_session, "x@t.dev")
    org = await _org(pg_session, owner, (member, "member"), (other, "member"))
    acc = await _account(pg_session, org=org, by=member)
    await pg_session.commit()
    async with Client(pg_session) as c:
        # Un autre membre (non admin, pas l'auteur de la connexion) : refusé.
        assert (await c.as_(other).delete(f"/api/tiktok/accounts/{acc.id}")).status_code == 403
        assert not tiktok.calls
        r = await c.as_(member).delete(f"/api/tiktok/accounts/{acc.id}")
        assert r.status_code == 200 and r.json()["warning"] is None
        assert (await c.as_(member).get("/api/tiktok/accounts", params={"org_id": org.id})).json() == []
        assert (await c.as_(member).get(f"/api/tiktok/accounts/{acc.id}/creator-info")).status_code == 404
    form = parse_qs(tiktok.last("/v2/oauth/revoke/").content.decode())
    assert form["token"] == ["act.1"] and form["client_secret"] == ["cs_test"]
    await pg_session.refresh(acc)
    assert acc.revoked_at is not None
    assert acc.access_token_enc is None and acc.refresh_token_enc is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_org_admin_can_disconnect_any_team_account(pg_session, tiktok):
    owner = await _user(pg_session, "o@t.dev")
    member = await _user(pg_session, "m@t.dev")
    org = await _org(pg_session, owner, (member, "member"))
    acc = await _account(pg_session, org=org, by=member)
    await pg_session.commit()
    async with Client(pg_session) as c:
        assert (await c.as_(owner).delete(f"/api/tiktok/accounts/{acc.id}")).status_code == 200


# --------------------------------------------------------------------------
# Publication
# --------------------------------------------------------------------------

async def _send(h, post_id: int, data: bytes, part: int = 1024):
    for i in range(0, len(data), part):
        r = await h.put(f"/api/tiktok/posts/{post_id}/parts/{i // part}", content=data[i:i + part])
        assert r.status_code == 200, r.text


def _direct(acc_id, size, **kw):
    body = {"account_id": acc_id, "mode": "direct", "title": "Ma vidéo #test", "privacy_level": "PUBLIC_TO_EVERYONE",
            "allow_comment": True, "allow_duet": True, "allow_stitch": False, "file_name": "clip.mp4",
            "video_size": size}
    body.update(kw)
    return body


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_direct_post_full_flow(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/tiktok/posts", json=_direct(acc.id, len(data)))
        assert r.status_code == 200, r.text
        plan = r.json()
        assert plan["part_size"] == 1024 and plan["part_count"] == -(-len(data) // 1024)
        assert not any("init" in p for p in tiktok.paths())          # rien n'est parti chez TikTok
        await _send(h, plan["post_id"], data)
        r = await h.post(f"/api/tiktok/posts/{plan['post_id']}/submit")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "QUEUED" and tiktok.launched == [plan["post_id"]]

        post = await pg_session.get(TikTokPost, plan["post_id"])
        tmp = post.tmp_path
        assert os.path.exists(tmp)
        assert post.mime_type == "video/mp4" and post.duration_sec == 42.0
        await tiktok_jobs.process_post(pg_session, post)

        init = json.loads(tiktok.last("/v2/post/publish/video/init/").content)
        assert init["source_info"] == {"source": "FILE_UPLOAD", "video_size": len(data),
                                       "chunk_size": len(data), "total_chunk_count": 1}
        pi = init["post_info"]
        assert pi["privacy_level"] == "PUBLIC_TO_EVERYONE" and pi["title"] == "Ma vidéo #test"
        assert pi["disable_comment"] is False
        assert pi["disable_duet"] is True        # coupé chez le créateur malgré allow_duet
        assert pi["disable_stitch"] is True      # non coché
        assert pi["brand_content_toggle"] is False and pi["brand_organic_toggle"] is False
        put = tiktok.calls[-1]
        assert str(put.url) == UPLOAD_URL and put.content == data
        assert put.headers["Content-Range"] == f"bytes 0-{len(data) - 1}/{len(data)}"
        assert put.headers["Content-Type"] == "video/mp4"
        assert post.status == "PROCESSING_UPLOAD" and post.publish_id == "v_pub_file~1"
        assert not os.path.exists(tmp) and post.tmp_path is None   # fichier supprimé

        await tiktok_jobs.poll_post(pg_session, post)
        r = await h.get(f"/api/tiktok/posts/{post.id}")
        assert r.json()["status"] == "PUBLISH_COMPLETE" and r.json()["post_ids"] == ["123"]
        hist = (await h.get("/api/tiktok/posts")).json()
        assert [p["id"] for p in hist] == [post.id] and hist[0]["account_name"] == "studio.demo"
        assert "upload" not in json.dumps(hist).lower().replace("processing_upload", "")


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_background_job_sends_then_follows_status(pg_engine, pg_session, tiktok, monkeypatch):
    """run_post (vraie tâche de fond, sa propre session) : envoi puis suivi du statut."""
    from sqlalchemy.ext.asyncio import async_sessionmaker
    monkeypatch.setattr(tiktok_jobs, "FOLLOW_INTERVAL", 0)
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    path = tiktok_jobs.tmp_dir() / "job.part"
    data = mp4_bytes(10_000)
    path.write_bytes(data)
    post = TikTokPost(owner_user_id=u.id, tiktok_account_id=acc.id, mode="direct", privacy_level="SELF_ONLY",
                      disable_comment=True, disable_duet=True, disable_stitch=True, brand_organic=False,
                      brand_content=False, video_size=len(data), received_bytes=len(data), mime_type="video/mp4",
                      tmp_path=str(path), status="QUEUED")
    pg_session.add(post)
    await pg_session.commit()
    calls = iter([{"status": "PROCESSING_UPLOAD"}, {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [9]}])
    orig = tt.publish_status

    async def _status(token, pid):
        tiktok.status = next(calls)
        return await orig(token, pid)
    monkeypatch.setattr(tt, "publish_status", _status)
    await tiktok_jobs.run_post(post.id, async_sessionmaker(pg_engine, expire_on_commit=False))
    await pg_session.refresh(post)
    assert post.status == "PUBLISH_COMPLETE" and post.post_ids == ["9"] and not path.exists()
    # Un tick planifié complet ne casse rien.
    await tiktok_jobs.tick(pg_session)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_large_video_uploaded_in_tiktok_chunks(pg_session, tiktok, tmp_path):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    size = 70 * MB + 5
    path = tiktok_jobs.tmp_dir() / "big.part"
    head = mp4_bytes(20_000, mdat=0)
    with open(path, "wb") as f:
        f.write(head[:-8] + struct.pack(">I4s", 0, b"mdat"))   # mdat jusqu'à la fin du fichier
        f.truncate(size)
    post = TikTokPost(owner_user_id=u.id, tiktok_account_id=acc.id, user_id=u.id, mode="direct",
                      privacy_level="SELF_ONLY", disable_comment=True, disable_duet=True, disable_stitch=True,
                      brand_organic=False, brand_content=False, video_size=size, received_bytes=size,
                      mime_type="video/mp4", tmp_path=str(path), status="QUEUED")
    pg_session.add(post)
    await pg_session.commit()
    assert probe(str(path)).duration_sec == 20.0
    await tiktok_jobs.process_post(pg_session, post)
    init = json.loads(tiktok.last("/v2/post/publish/video/init/").content)
    assert init["source_info"]["chunk_size"] == 10 * MB and init["source_info"]["total_chunk_count"] == 7
    puts = [c for c in tiktok.calls if c.url.host == "upload.tiktok.test"]
    assert len(puts) == 7
    for i, p in enumerate(puts):
        start = i * 10 * MB
        end = size - 1 if i == 6 else start + 10 * MB - 1
        assert p.headers["Content-Range"] == f"bytes {start}-{end}/{size}"
        assert p.headers["Content-Length"] == str(end - start + 1)
    assert post.status == "PROCESSING_UPLOAD" and not path.exists()


@pytest.mark.asyncio
async def test_put_chunk_retries_transient_errors(tiktok):
    tiktok.upload_failures = [503, 0, 502]
    assert await tt.put_chunk(UPLOAD_URL, b"x" * 10, 0, 9, 10, "video/mp4") == 201
    assert len([c for c in tiktok.calls if c.url.host == "upload.tiktok.test"]) == 4


@pytest.mark.asyncio
async def test_put_chunk_gives_up_with_french_message(tiktok):
    tiktok.upload_failures = [503] * 4
    with pytest.raises(tt.TikTokError) as e:
        await tt.put_chunk(UPLOAD_URL, b"x" * 10, 0, 9, 10, "video/mp4")
    assert e.value.code == "upload_unavailable"
    assert "momentanément indisponible" in e.value.describe()
    tiktok.upload_failures = [400]
    with pytest.raises(tt.TikTokError) as e:
        await tt.put_chunk(UPLOAD_URL, b"x" * 10, 0, 9, 10, "video/mp4")
    assert e.value.code == "upload_http_400"
    assert len([c for c in tiktok.calls if c.url.host == "upload.tiktok.test"]) == 5


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_draft_post_goes_to_inbox(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = webm_bytes(15_000)
    tiktok.status = {"status": "SEND_TO_USER_INBOX"}
    async with Client(pg_session) as c:
        h = c.as_(u)
        r = await h.post("/api/tiktok/posts", json={"account_id": acc.id, "mode": "draft", "title": "ignoré",
                                                    "privacy_level": "SELF_ONLY", "brand_content": True,
                                                    "video_size": len(data)})
        assert r.status_code == 200, r.text
        pid = r.json()["post_id"]
        await _send(h, pid, data)
        assert (await h.post(f"/api/tiktok/posts/{pid}/submit")).status_code == 200
        post = await pg_session.get(TikTokPost, pid)
        assert post.title is None and post.privacy_level is None and post.brand_content is False
        await tiktok_jobs.process_post(pg_session, post)
        body = json.loads(tiktok.last("/v2/post/publish/inbox/video/init/").content)
        assert set(body) == {"source_info"}                           # pas de post_info en brouillon
        assert "/v2/post/publish/video/init/" not in tiktok.paths()
        assert tiktok.calls[-1].headers["Content-Type"] == "video/webm"
        await tiktok_jobs.poll_post(pg_session, post)
        assert (await h.get(f"/api/tiktok/posts/{pid}")).json()["status"] == "SEND_TO_USER_INBOX"


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("override, code, fragment", [
    ({"privacy_level": None}, 400, "qui peut voir"),
    ({"privacy_level": "SELF_ONLY", "brand_content": True}, 400, "ne peut pas être privée"),
    ({"video_size": 2 * 1024 * 1024 * 1024}, 413, "trop volumineuse"),
    ({"title": "é" * 2201}, 400, "Titre trop long"),
])
async def test_create_post_validation(pg_session, tiktok, override, code, fragment):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(u).post("/api/tiktok/posts", json=_direct(acc.id, 100, **override))
    assert r.status_code == code and fragment in r.json()["detail"]
    assert not (await pg_session.execute(select(TikTokPost))).scalars().all()


@pytest.mark.real_db
@pytest.mark.asyncio
@pytest.mark.parametrize("setup, data, fragment, http", [
    ("garbage", b"GIF89a" + b"\0" * 1500, "Format non reconnu", 400),
    ("too_long", None, "trop longue", 400),
    ("privacy", None, "confidentialité", 400),
    ("cannot_post", None, "nombre maximal", 409),
])
async def test_submit_validation_fails_post_and_deletes_file(pg_session, tiktok, setup, data, fragment, http):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = data or mp4_bytes(42_000)
    if setup == "too_long":
        tiktok.creator["max_video_post_duration_sec"] = 30
    if setup == "privacy":
        tiktok.creator["privacy_level_options"] = ["SELF_ONLY"]
    if setup == "cannot_post":
        tiktok.creator_error = "spam_risk_too_many_posts"
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = (await h.post("/api/tiktok/posts", json=_direct(acc.id, len(data)))).json()["post_id"]
        await _send(h, pid, data)
        post = await pg_session.get(TikTokPost, pid)
        tmp = post.tmp_path
        r = await h.post(f"/api/tiktok/posts/{pid}/submit")
        assert r.status_code == http and fragment in r.json()["detail"], r.text
        out = (await h.get(f"/api/tiktok/posts/{pid}")).json()
    assert out["status"] == "FAILED" and fragment in out["error_message"]
    assert not os.path.exists(tmp) and not tiktok.launched
    assert not any("init" in p for p in tiktok.paths())


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_parts_must_be_sequential_and_complete(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = (await h.post("/api/tiktok/posts", json=_direct(acc.id, len(data)))).json()["post_id"]
        assert (await h.put(f"/api/tiktok/posts/{pid}/parts/1", content=data[1024:2048])).status_code == 409
        assert (await h.put(f"/api/tiktok/posts/{pid}/parts/0", content=b"\0" * 10)).status_code == 400
        assert (await h.post(f"/api/tiktok/posts/{pid}/submit")).status_code == 409   # incomplète
        assert (await h.put(f"/api/tiktok/posts/{pid}/parts/0", content=data[:1024])).status_code == 200
        assert (await h.put(f"/api/tiktok/posts/{pid}/parts/0", content=data[:1024])).status_code == 200  # renvoi idempotent
        # Annulation : fichier supprimé
        tmp = (await pg_session.get(TikTokPost, pid)).tmp_path
        assert (await h.delete(f"/api/tiktok/posts/{pid}")).status_code == 200
        assert not os.path.exists(tmp)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tiktok_init_error_is_reported_in_french(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    data = mp4_bytes(42_000)
    async with Client(pg_session) as c:
        h = c.as_(u)
        pid = (await h.post("/api/tiktok/posts", json=_direct(acc.id, len(data)))).json()["post_id"]
        await _send(h, pid, data)
        await h.post(f"/api/tiktok/posts/{pid}/submit")
        post = await pg_session.get(TikTokPost, pid)
        tmp = post.tmp_path
        tiktok.init_error = "unaudited_client_can_only_post_to_private_accounts"
        await tiktok_jobs.process_post(pg_session, post)
        out = (await h.get(f"/api/tiktok/posts/{pid}")).json()
    assert out["status"] == "FAILED" and "compte privé" in out["error_message"] and "LOG42" in out["error_message"]
    assert not os.path.exists(tmp)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_status_failure_reason_translated(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    post = TikTokPost(owner_user_id=u.id, tiktok_account_id=acc.id, mode="direct", privacy_level="SELF_ONLY",
                      disable_comment=True, disable_duet=True, disable_stitch=True, brand_organic=False,
                      brand_content=False, video_size=10, received_bytes=10, publish_id="p1",
                      status="PROCESSING_UPLOAD")
    pg_session.add(post)
    await pg_session.commit()
    tiktok.status = {"status": "FAILED", "fail_reason": "spam_risk_text"}
    await tiktok_jobs.poll_pending(pg_session)
    assert post.status == "FAILED" and "légende" in post.error_message


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_rate_limit_active_posts_per_tenant(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(u)
        for _ in range(tiktok_router.MAX_ACTIVE_POSTS):
            assert (await h.post("/api/tiktok/posts", json=_direct(acc.id, 100))).status_code == 200
        r = await h.post("/api/tiktok/posts", json=_direct(acc.id, 100))
    assert r.status_code == 429


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cleanup_abandons_stale_uploads(pg_session, tiktok):
    u = await _user(pg_session, "a@t.dev")
    acc = await _account(pg_session, owner=u)
    path = tiktok_jobs.tmp_dir() / "stale.part"
    path.write_bytes(b"\0" * 10)
    orphan = tiktok_jobs.tmp_dir() / "orphan.part"
    orphan.write_bytes(b"\0")
    os.utime(orphan, (0, 0))
    post = TikTokPost(owner_user_id=u.id, tiktok_account_id=acc.id, mode="draft", disable_comment=True,
                      disable_duet=True, disable_stitch=True, brand_organic=False, brand_content=False,
                      video_size=100, received_bytes=10, tmp_path=str(path), status="RECEIVING")
    pg_session.add(post)
    await pg_session.commit()
    post.updated_at = utcnow() - timedelta(hours=3)
    await pg_session.commit()
    await tiktok_jobs.cleanup_stale(pg_session)
    assert post.status == "FAILED" and not path.exists() and not orphan.exists()


# --------------------------------------------------------------------------
# Back-office (lecture seule)
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_admin_overview_read_only_without_tokens(pg_session, tiktok):
    admin = await _user(pg_session, "admin@t.dev", is_superadmin=True)
    u = await _user(pg_session, "a@t.dev")
    org = await _org(pg_session, u)
    await _account(pg_session, org=org, by=u)
    await _account(pg_session, owner=u, open_id="oid-9")
    await pg_session.commit()
    async with Client(pg_session) as c:
        assert (await c.as_(u).get("/api/admin/tiktok/overview")).status_code == 403
        r = await c.as_(admin).get("/api/admin/tiktok/overview")
        assert r.status_code == 200
        body = r.json()
        assert body["total_accounts"] == 2 and len(body["tenants"]) == 2
        assert "oid-" not in r.text and "token" not in r.text
        # Aucune route d'usage côté opérateur.
        assert (await c.as_(admin).post("/api/admin/tiktok/oauth/start")).status_code in (404, 405)


def test_httpx_urls_not_logged():
    # L'URL d'upload TikTok porte un upload_token : httpx ne doit pas la journaliser.
    import logging
    import src.main  # noqa: F401
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
