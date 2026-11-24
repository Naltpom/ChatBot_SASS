"""emails.chapote.fr : serveur MCP distant (outils, IMAP/SMTP simulés), OAuth 2.1 complet
(inscription dynamique, PKCE, consentement, rotation, rejeu, révocation), contrôle d'accès
(superadmin, 2FA), droits d'envoi et de corbeille, absence de secrets dans les journaux.

Vraie base jetable (real_db) ; IMAP / SMTP simulés par tests/emails_fakes.py.
"""
import asyncio
import base64
import hashlib
import json
import logging
import secrets
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.config import Settings, settings
from src.core.database import get_db
from src.core.security import AUTH_COOKIE_NAME, create_dashboard_token
from src.main import app
from src.models.emails import Mailbox, McpAuditLog, McpOAuthClient, McpOAuthToken
from src.models.user import User
from src.services import emails_access, emails_mcp, mail_client
from src.services import rate_limit
from src.services.mailbox_crypto import encrypt_password

import emails_fakes as fk

CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback"
OVH_PASSWORD = "Mdp-OVH-tres-secret-42"
GMAIL_PASSWORD = "abcdabcdabcdabcd"


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

@pytest_asyncio.fixture
async def env(pg_engine, pg_session, monkeypatch):
    monkeypatch.setattr(settings, "EMAILS_ENABLED", True)
    monkeypatch.setattr(settings, "EMAILS_URL", "https://emails.chapote.fr")
    monkeypatch.setattr(settings, "EMAILS_IMAP_TIMEOUT", 5)
    monkeypatch.setattr(emails_mcp, "SessionFactory",
                        async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False))
    # Limiteurs en mémoire partagés par toute la suite : neutralisés (un test dédié les vérifie).
    for name in ("emails_register_limiter", "emails_authorize_limiter", "emails_token_limiter",
                 "emails_mcp_limiter", "emails_mcp_anon_limiter"):
        lim = getattr(rate_limit, name)

        async def ok(key, _lim=lim):
            return True
        monkeypatch.setattr(lim, "check", ok)
    fk.install(monkeypatch)

    async def _get_db():
        yield pg_session
    app.dependency_overrides[get_db] = _get_db
    # Le gestionnaire MCP ouvre un groupe de tâches anyio : il doit naître et finir dans la
    # même tâche (pytest-asyncio installe et démonte la fixture dans deux tâches distinctes).
    started, stop = asyncio.Event(), asyncio.Event()

    async def serve():
        async with emails_mcp.running():
            started.set()
            await stop.wait()
    task = asyncio.create_task(serve())
    await started.wait()
    try:
        yield pg_session
    finally:
        stop.set()
        await task
        app.dependency_overrides.pop(get_db, None)


def http() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://emails.chapote.fr")


async def _user(db, email, superadmin=False, totp=False) -> User:
    u = User(email=email, hashed_password="x", name=email.split("@")[0], is_active=True,
             is_superadmin=superadmin, totp_enabled=totp)
    db.add(u)
    await db.commit()
    return u


def as_(c: httpx.AsyncClient, user: User, mfa: bool = True) -> httpx.AsyncClient:
    c.cookies.set(AUTH_COOKIE_NAME, create_dashboard_token(user.id, mfa=mfa))
    c.headers["X-Chapote-App"] = "emails"
    return c


async def _boxes(db) -> None:
    fk.ovh_account(password=OVH_PASSWORD)
    fk.gmail_account(password=GMAIL_PASSWORD)
    db.add_all([
        Mailbox(slug="contact", address="contact@chapote.fr", label="Chapote", preset="ovh-email-pro",
                imap_host="pro2.mail.ovh.net", imap_port=993, imap_tls="ssl", smtp_host="pro2.mail.ovh.net",
                smtp_port=587, smtp_tls="starttls", username="contact@chapote.fr",
                password_encrypted=encrypt_password(OVH_PASSWORD), allow_send=True, allow_delete=True, save_sent=True),
        Mailbox(slug="perso", address="moi@gmail.com", label=None, preset="gmail",
                imap_host="imap.gmail.com", imap_port=993, imap_tls="ssl", smtp_host="smtp.gmail.com",
                smtp_port=465, smtp_tls="ssl", username="moi@gmail.com",
                password_encrypted=encrypt_password(GMAIL_PASSWORD), save_sent=False),
    ])
    await db.commit()


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


async def _oauth_tokens(c: httpx.AsyncClient, admin: User) -> tuple[dict, dict, str]:
    """Flux complet de Claude : DCR, autorisation, consentement, échange. -> (client, jetons, verifier)."""
    r = await c.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [CLAUDE_REDIRECT],
                                              "token_endpoint_auth_method": "none"})
    assert r.status_code == 201, r.text
    client = r.json()
    verifier, challenge = _pkce()
    as_(c, admin)
    r = await c.get("/oauth/authorize", params={
        "response_type": "code", "client_id": client["client_id"], "redirect_uri": CLAUDE_REDIRECT,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": "etat-123", "scope": "emails",
        "resource": "https://emails.chapote.fr/mcp"})
    assert r.status_code == 302 and r.headers["location"].startswith("/consentement?req="), r.headers.get("location")
    req = parse_qs(urlparse(r.headers["location"]).query)["req"][0]
    info = (await c.get("/api/emails/oauth/request", params={"req": req})).json()
    assert info["client_name"] == "Claude" and info["redirect_host"] == "claude.ai"
    r = await c.post("/api/emails/oauth/consent", json={"req": req, "approve": True})
    assert r.status_code == 200, r.text
    back = urlparse(r.json()["redirect"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == CLAUDE_REDIRECT
    q = parse_qs(back.query)
    assert q["state"] == ["etat-123"]
    c.cookies.clear()
    r = await c.post("/oauth/token", data={"grant_type": "authorization_code", "code": q["code"][0],
                                           "redirect_uri": CLAUDE_REDIRECT, "client_id": client["client_id"],
                                           "code_verifier": verifier, "resource": "https://emails.chapote.fr/mcp"})
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    tokens = r.json()
    assert tokens["token_type"] == "Bearer" and tokens["expires_in"] == 3600
    return client, tokens, q["code"][0]


async def rpc(c: httpx.AsyncClient, token: str, method: str, params: dict | None = None) -> httpx.Response:
    return await c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream",
                                 "Content-Type": "application/json"})


async def tool(c: httpx.AsyncClient, token: str, name: str, **args) -> tuple[bool, dict | str]:
    r = await rpc(c, token, "tools/call", {"name": name, "arguments": args})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        return False, text
    return True, json.loads(text)


async def _admin_token(env, c) -> tuple[User, str]:
    admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
    _client, tokens, _code = await _oauth_tokens(c, admin)
    return admin, tokens["access_token"]


# --------------------------------------------------------------------------
# OAuth 2.1
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_discovery_and_401(env):
    async with http() as c:
        r = await c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert r.status_code == 401
        assert r.headers["www-authenticate"].startswith(
            'Bearer resource_metadata="https://emails.chapote.fr/.well-known/oauth-protected-resource"')
        r = await c.post("/mcp", json={}, headers={"Authorization": "Bearer cem_at_faux"})
        assert r.status_code == 401 and 'error="invalid_token"' in r.headers["www-authenticate"]
        prm = (await c.get("/.well-known/oauth-protected-resource")).json()
        assert prm["resource"] == "https://emails.chapote.fr/mcp"
        assert prm["authorization_servers"] == ["https://emails.chapote.fr"]
        asm = (await c.get("/.well-known/oauth-authorization-server")).json()
        assert asm["code_challenge_methods_supported"] == ["S256"]
        assert asm["registration_endpoint"] == "https://emails.chapote.fr/oauth/register"
        assert asm["token_endpoint"] == "https://emails.chapote.fr/oauth/token"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_disabled_module_is_404(env, monkeypatch):
    monkeypatch.setattr(settings, "EMAILS_ENABLED", False)
    async with http() as c:
        assert (await c.post("/mcp", json={})).status_code == 404
        assert (await c.get("/.well-known/oauth-authorization-server")).status_code == 404
        assert (await c.post("/oauth/register", json={})).status_code == 404
        assert (await c.get("/api/emails/public-config")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_full_oauth_flow_refresh_rotation_and_revocation(env):
    await _boxes(env)
    async with http() as c:
        admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
        client, tokens, code = await _oauth_tokens(c, admin)
        ok, data = await tool(c, tokens["access_token"], "list_accounts")
        assert ok and [a["account"] for a in data["accounts"]] == ["contact", "perso"]

        # Code à usage unique : rejouer le code échoue ET révoque les jetons qu'il a donnés.
        r = await c.post("/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                               "client_id": client["client_id"], "code_verifier": "x" * 50})
        assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401

        # Nouvelle autorisation, puis rotation du jeton de rafraîchissement.
        client, tokens, _ = await _oauth_tokens(c, admin)
        r = await c.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                               "client_id": client["client_id"]})
        assert r.status_code == 200, r.text
        fresh = r.json()
        assert fresh["refresh_token"] != tokens["refresh_token"]
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401   # ancien accès coupé
        assert (await rpc(c, fresh["access_token"], "tools/list")).status_code == 200
        # Rejeu de l'ancien jeton de rafraîchissement : toute la famille tombe.
        r = await c.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                               "client_id": client["client_id"]})
        assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
        assert (await rpc(c, fresh["access_token"], "tools/list")).status_code == 401
        replay = (await env.execute(select(McpAuditLog).where(McpAuditLog.tool == "oauth.refresh_replay"))).scalars().all()
        assert len(replay) == 1 and replay[0].status == "denied"

        # Révocation RFC 7009.
        client, tokens, _ = await _oauth_tokens(c, admin)
        r = await c.post("/oauth/revoke", data={"token": tokens["refresh_token"], "client_id": client["client_id"]})
        assert r.status_code == 200
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401

        # Révocation depuis l'interface : un jeton, puis le client entier.
        client, tokens, _ = await _oauth_tokens(c, admin)
        as_(c, admin)
        listed = (await c.get("/api/emails/tokens")).json()
        assert len(listed) == 1 and listed[0]["client_name"] == "Claude" and listed[0]["user_email"] == "boss@chapote.fr"
        assert (await c.post(f"/api/emails/tokens/{listed[0]['id']}/revoke")).json()["ok"] is True
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401
        client, tokens, _ = await _oauth_tokens(c, admin)
        as_(c, admin)
        pk = next(x["id"] for x in (await c.get("/api/emails/clients")).json() if x["client_id"] == client["client_id"])
        assert (await c.post(f"/api/emails/clients/{pk}/revoke")).json()["ok"] is True
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401
        r = await c.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
                                               "client_id": client["client_id"]})
        assert r.status_code == 401 and r.json()["error"] == "invalid_client"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_pkce_and_registration_rules(env):
    admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
    async with http() as c:
        # redirect_uri hors liste (pas Claude) : inscription refusée.
        r = await c.post("/oauth/register", json={"redirect_uris": ["https://pirate.example/cb"]})
        assert r.status_code == 400 and r.json()["error"] == "invalid_redirect_uri"
        r = await c.post("/oauth/register", json={"redirect_uris": ["http://claude.ai/cb"]})
        assert r.status_code == 400
        r = await c.post("/oauth/register", json={"redirect_uris": [CLAUDE_REDIRECT],
                                                  "token_endpoint_auth_method": "client_secret_post"})
        assert r.status_code == 201
        conf = r.json()
        assert conf["client_secret"]
        stored = (await env.execute(select(McpOAuthClient).where(McpOAuthClient.client_id == conf["client_id"]))).scalar_one()
        assert stored.client_secret_hash != conf["client_secret"]          # haché

        as_(c, admin)
        base = {"response_type": "code", "client_id": conf["client_id"], "redirect_uri": CLAUDE_REDIRECT, "state": "s"}
        # Sans PKCE, ou en « plain » : erreur renvoyée au client (redirect_uri validé).
        for extra in ({}, {"code_challenge": "a" * 43, "code_challenge_method": "plain"}):
            r = await c.get("/oauth/authorize", params={**base, **extra})
            assert r.status_code == 302 and r.headers["location"].startswith(CLAUDE_REDIRECT)
            assert parse_qs(urlparse(r.headers["location"]).query)["error"] == ["invalid_request"]
        # redirect_uri non inscrit : jamais de redirection vers lui.
        r = await c.get("/oauth/authorize", params={**base, "redirect_uri": "https://claude.ai/autre",
                                                    "code_challenge": "a" * 43, "code_challenge_method": "S256"})
        assert r.headers["location"] == "/consentement?erreur=invalid_redirect_uri"
        r = await c.get("/oauth/authorize", params={**base, "client_id": "inconnu"})
        assert r.headers["location"] == "/consentement?erreur=invalid_client"

        # Mauvais code_verifier.
        verifier, challenge = _pkce()
        r = await c.get("/oauth/authorize", params={**base, "code_challenge": challenge, "code_challenge_method": "S256"})
        req = parse_qs(urlparse(r.headers["location"]).query)["req"][0]
        code = parse_qs(urlparse((await c.post("/api/emails/oauth/consent", json={"req": req, "approve": True}))
                                 .json()["redirect"]).query)["code"][0]
        c.cookies.clear()
        r = await c.post("/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                               "client_id": conf["client_id"], "client_secret": conf["client_secret"],
                                               "code_verifier": verifier + "x", "redirect_uri": CLAUDE_REDIRECT})
        assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
        # Client confidentiel sans secret : refusé.
        r = await c.post("/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                               "client_id": conf["client_id"], "code_verifier": verifier})
        assert r.status_code == 401 and r.json()["error"] == "invalid_client"

        # Refus de l'utilisateur : access_denied renvoyé au client.
        as_(c, admin)
        r = await c.get("/oauth/authorize", params={**base, "code_challenge": challenge, "code_challenge_method": "S256"})
        req = parse_qs(urlparse(r.headers["location"]).query)["req"][0]
        r = await c.post("/api/emails/oauth/consent", json={"req": req, "approve": False})
        assert parse_qs(urlparse(r.json()["redirect"]).query)["error"] == ["access_denied"]
        # Consentement sans l'en-tête de l'interface (CSRF) : refusé.
        del c.headers["X-Chapote-App"]
        r = await c.post("/api/emails/oauth/consent", json={"req": req, "approve": True})
        assert r.status_code == 403


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_rate_limit_on_registration(env, monkeypatch):
    lim = rate_limit.RateLimiter("rl:test-emreg:", 2, 3600)
    monkeypatch.setattr("src.routers.emails_oauth.emails_register_limiter", lim)
    async with http() as c:
        codes = [(await c.post("/oauth/register", json={"redirect_uris": [CLAUDE_REDIRECT]})).status_code for _ in range(3)]
    assert codes == [201, 201, 429]


# --------------------------------------------------------------------------
# Contrôle d'accès : superadmin, 2FA
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_access_requires_superadmin_and_2fa(env, monkeypatch):
    monkeypatch.setattr(emails_access, "twofa_enforced", lambda: True)
    user = await _user(env, "client@exemple.fr")
    no2fa = await _user(env, "admin-sans-2fa@chapote.fr", superadmin=True)
    admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
    async with http() as c:
        assert (await c.get("/api/emails/mailboxes")).status_code == 401
        as_(c, user)
        r = await c.get("/api/emails/mailboxes")
        assert r.status_code == 403 and r.json()["detail"] == "superadmin_required"
        assert (await c.get("/api/emails/access")).json()["reason"] == "superadmin_required"
        as_(c, no2fa)
        assert (await c.get("/api/emails/mailboxes")).json()["detail"] == "twofa_setup_required"
        as_(c, admin, mfa=False)                  # 2FA configurée, mais session sans 2nd facteur
        assert (await c.get("/api/emails/mailboxes")).json()["detail"] == "twofa_session_required"
        as_(c, admin, mfa=True)
        assert (await c.get("/api/emails/mailboxes")).status_code == 200
        assert (await c.get("/api/emails/access")).json()["allowed"] is True

        # /oauth/authorize : connexion, puis refus pour un non-superadmin ou une session sans 2FA.
        r = await c.post("/oauth/register", json={"redirect_uris": [CLAUDE_REDIRECT]})
        cid = r.json()["client_id"]
        params = {"response_type": "code", "client_id": cid, "redirect_uri": CLAUDE_REDIRECT,
                  "code_challenge": "a" * 43, "code_challenge_method": "S256"}
        c.cookies.clear()
        r = await c.get("/oauth/authorize", params=params)
        assert r.headers["location"].startswith("/connexion?suite=%2Foauth%2Fauthorize%3F")
        as_(c, user)
        assert (await c.get("/oauth/authorize", params=params)).headers["location"] == "/consentement?erreur=superadmin_required"
        as_(c, admin, mfa=False)
        assert (await c.get("/oauth/authorize", params=params)).headers["location"] == "/consentement?erreur=twofa_session_required"
        as_(c, admin, mfa=False)
        r = await c.post("/api/emails/oauth/consent", json={"req": "x", "approve": True})
        assert r.status_code == 403

        # Jeton déjà émis : un compte qui perd le rôle superadmin perd l'accès MCP.
        _client, tokens, _ = await _oauth_tokens(c, admin)
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 200
        admin.is_superadmin = False
        await env.commit()
        assert (await rpc(c, tokens["access_token"], "tools/list")).status_code == 401


def test_validate_production_requires_dedicated_mailbox_key():
    from cryptography.fernet import Fernet
    base = dict(ENV="production", JWT_SECRET_KEY="x" * 40, ENCRYPTION_KEY=Fernet.generate_key().decode(),
                EMAILS_ENABLED=True, EMAILS_URL="https://emails.chapote.fr", MOCK_BILLING=False,
                STRIPE_SECRET_KEY=None, STRIPE_WEBHOOK_SECRET=None)
    with pytest.raises(RuntimeError, match="MAILBOX_ENCRYPTION_KEY obligatoire"):
        Settings(**base).validate_production()
    with pytest.raises(RuntimeError, match="distincte"):
        Settings(**base, MAILBOX_ENCRYPTION_KEY=base["ENCRYPTION_KEY"]).validate_production()
    with pytest.raises(RuntimeError, match="Fernet"):
        Settings(**base, MAILBOX_ENCRYPTION_KEY="pas-une-cle").validate_production()
    Settings(**base, MAILBOX_ENCRYPTION_KEY=Fernet.generate_key().decode()).validate_production()
    Settings(**{**base, "EMAILS_ENABLED": False}).validate_production()   # module coupé : pas exigée


def test_webauthn_origins_include_emails_subdomain(monkeypatch):
    monkeypatch.setattr(settings, "APP_URL", "https://chapote.fr")
    monkeypatch.setattr(settings, "WEBAUTHN_RP_ID", None)
    monkeypatch.setattr(settings, "EMAILS_URL", "https://emails.chapote.fr")
    monkeypatch.setattr(settings, "EMAILS_ENABLED", True)
    assert settings.webauthn_rp_id == "chapote.fr"
    assert settings.webauthn_origins == ["https://chapote.fr", "https://emails.chapote.fr"]
    monkeypatch.setattr(settings, "EMAILS_ENABLED", False)
    assert settings.webauthn_origins == ["https://chapote.fr"]


# --------------------------------------------------------------------------
# Administration des boîtes
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_mailbox_crud_presets_and_connection_test(env):
    admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
    fk.gmail_account(password=GMAIL_PASSWORD)
    async with http() as c:
        as_(c, admin)
        presets = {p["id"]: p for p in (await c.get("/api/emails/presets")).json()}
        assert presets["ovh-email-pro"]["imap_host"] == "pro2.mail.ovh.net"
        assert (presets["ovh-email-pro"]["smtp_port"], presets["ovh-email-pro"]["smtp_tls"]) == (587, "starttls")
        assert (presets["gmail"]["smtp_host"], presets["gmail"]["smtp_port"], presets["gmail"]["smtp_tls"]) == ("smtp.gmail.com", 465, "ssl")
        r = await c.post("/api/emails/mailboxes", json={"slug": "perso", "address": "moi@gmail.com", "preset": "gmail",
                                                        "password": "abcd abcd abcd abcd"})
        assert r.status_code == 200, r.text
        mb = r.json()
        assert mb["imap_host"] == "imap.gmail.com" and mb["username"] == "moi@gmail.com"
        assert mb["allow_send"] is False and mb["allow_delete"] is False and mb["save_sent"] is False
        assert "password" not in mb and "password_encrypted" not in mb and mb["has_password"] is True
        row = await env.get(Mailbox, mb["id"])
        await env.refresh(row)
        assert "abcd" not in row.password_encrypted
        # Mot de passe d'application collé avec ses espaces : espaces retirés, la connexion passe.
        r = await c.patch(f"/api/emails/mailboxes/{mb['id']}", json={"allow_send": True})
        assert r.json()["allow_send"] is True and r.json()["has_password"] is True
        good = (await c.post(f"/api/emails/mailboxes/{mb['id']}/test")).json()
        assert good["ok"] is True and good["gmail"] is True and good["special"]["drafts"] == "[Gmail]/Brouillons"
        listed = (await c.get("/api/emails/mailboxes")).json()
        assert listed[0]["last_check_ok"] is True
        # Mauvais mot de passe : échec lisible, sans écho du secret.
        await c.patch(f"/api/emails/mailboxes/{mb['id']}", json={"password": "faux-mot-de-passe"})
        bad = (await c.post(f"/api/emails/mailboxes/{mb['id']}/test")).json()
        assert bad["ok"] is False and bad["code"] == "auth_imap" and "faux" not in json.dumps(bad)
        assert (await c.get("/api/emails/mailboxes")).json()[0]["last_check_ok"] is False
        assert (await c.post("/api/emails/mailboxes", json={"slug": "perso", "address": "a@b.fr", "imap_host": "h",
                                                            "smtp_host": "h", "password": "p"})).status_code == 409
        assert (await c.post("/api/emails/mailboxes", json={"slug": "Pas Bon", "address": "a@b.fr", "preset": "gmail",
                                                            "password": "p"})).status_code == 422
        r = await c.post("/api/emails/mailboxes/test", json={"address": "x@y.fr", "imap_host": "down.example",
                                                             "smtp_host": "down.example", "password": "p"})
        assert r.json()["ok"] is False and r.json()["code"] == "network"
        assert (await c.delete(f"/api/emails/mailboxes/{mb['id']}")).json()["ok"] is True


# --------------------------------------------------------------------------
# Outils MCP
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_read_tools(env):
    await _boxes(env)
    ovh = fk.ACCOUNTS["contact@chapote.fr"]
    u1 = fk.add(ovh, "INBOX", fk.make_raw("Devis piano", sender="Bob <bob@client.fr>", body="Prix pour 3 cours ?",
                                          msgid="<a1@client.fr>",
                                          attachments=[("notes.txt", "text/plain", "Do ré mi".encode()),
                                                       ("logo.png", "image/png", b"\x89PNG....")]))
    fk.add(ovh, "INBOX", fk.make_raw("Newsletter", sender="news@spam.fr"), flags={"\\Seen"})
    sent = fk.add(ovh, "&AMk-l&AOk-ments envoy&AOk-s",
                  fk.make_raw("Re: Devis piano", sender="contact@chapote.fr", to="bob@client.fr",
                              msgid="<r1@chapote.fr>", refs="<a1@client.fr>"))
    async with http() as c:
        _admin, token = await _admin_token(env, c)
        ok, folders = await tool(c, token, "list_folders", account="contact")
        assert ok
        special = {f["special"]: f["name"] for f in folders["folders"] if f["special"]}
        assert special == {"inbox": "INBOX", "sent": "Éléments envoyés", "drafts": "Brouillons",
                           "trash": "Éléments supprimés", "archive": "Archives"}

        ok, res = await tool(c, token, "search_messages", account="contact", **{"from": "bob"})
        assert ok, res
        assert res["total"] == 1 and res["messages"][0]["subject"] == "Devis piano"
        assert res["messages"][0]["unread"] is True
        ok, res = await tool(c, token, "search_messages", account="contact", unseen=True, limit=5)
        assert ok and [m["uid"] for m in res["messages"]] == [u1]
        ok, res = await tool(c, token, "search_messages", account="contact", subject="Ré")    # littéral UTF-8
        assert ok
        ok, err = await tool(c, token, "search_messages", account="contact", since="24/11/2026")
        assert not ok and "AAAA-MM-JJ" in err
        ok, err = await tool(c, token, "search_messages", account="inconnue")
        assert not ok and "contact, perso" in err
        ok, err = await tool(c, token, "search_messages", account="contact", folder="Nope")
        assert not ok and "introuvable" in err and "Brouillons" in err

        ok, msg = await tool(c, token, "get_message", account="contact", uid=u1)
        assert ok and msg["body"].startswith("Prix pour 3 cours") and msg["from"] == ["Bob <bob@client.fr>"]
        assert [a["filename"] for a in msg["attachments"]] == ["notes.txt", "logo.png"]
        assert not any(cmd[:2] == ("UID", "STORE") for cmd in fk.IMAP_LOG)              # pas marqué lu
        assert all(not (c_[0] == "SELECT" and not c_[2]) for c_ in fk.IMAP_LOG if c_[0] == "SELECT")  # lecture seule
        ok, att = await tool(c, token, "get_attachment", account="contact", uid=u1, index=0)
        assert ok and att["text"] == "Do ré mi"
        ok, att = await tool(c, token, "get_attachment", account="contact", uid=u1, index=1)
        assert ok and base64.b64decode(att["base64"]).startswith(b"\x89PNG")
        ok, err = await tool(c, token, "get_attachment", account="contact", uid=u1, index=7)
        assert not ok and "introuvable" in err
        ok, err = await tool(c, token, "get_message", account="contact", uid=999999)
        assert not ok and "introuvable" in err

        ok, thread = await tool(c, token, "get_thread", account="contact", uid=u1)
        assert ok and [m["subject"] for m in thread["messages"]] == ["Devis piano", "Re: Devis piano"]
        assert thread["messages"][1]["uid"] == sent

        gm = fk.ACCOUNTS["moi@gmail.com"]
        fk.add(gm, "[Gmail]/Tous les messages", fk.make_raw("Facture piano Gmail", sender="shop@x.fr"), thrid=7)
        ok, res = await tool(c, token, "search_all", query="piano")
        assert ok and {m["account"] for m in res["messages"]} == {"contact", "perso"}
        assert res["accounts_searched"] == 2 and res["errors"] == []
        assert ("UID", "SEARCH", "X-GM-RAW", '"piano"') in fk.IMAP_LOG                   # syntaxe Gmail
        # Une boîte injoignable n'empêche pas les autres.
        fk.ACCOUNTS["moi@gmail.com"].password = "change"
        ok, res = await tool(c, token, "search_all", query="piano")
        assert ok and [e["account"] for e in res["errors"]] == ["perso"] and res["messages"]

    rows = (await env.execute(select(McpAuditLog).where(McpAuditLog.tool == "get_message"))).scalars().all()
    assert {r.status for r in rows} == {"ok", "error"} and all(r.mailbox_slug == "contact" for r in rows)
    assert all(r.client_pk is not None and r.duration_ms is not None for r in rows)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_draft_send_mark_move_trash_and_rights(env):
    await _boxes(env)
    ovh = fk.ACCOUNTS["contact@chapote.fr"]
    gm = fk.ACCOUNTS["moi@gmail.com"]
    orig = fk.add(ovh, "INBOX", fk.make_raw("Question", sender="Bob <bob@client.fr>", msgid="<q1@client.fr>"))
    g1 = fk.add(gm, "INBOX", fk.make_raw("Promo", sender="promo@x.fr"))
    async with http() as c:
        _admin, token = await _admin_token(env, c)
        # Brouillon de réponse : en-têtes de réponse, destinataire déduit, rien n'est envoyé.
        ok, d = await tool(c, token, "create_draft", account="contact", body="Oui, avec plaisir.", reply_to_uid=orig)
        assert ok and d["folder"] == "Brouillons" and d["subject"] == "Re: Question" and d["to"] == ["Bob <bob@client.fr>"]
        draft = fk.email.message_from_bytes(ovh.folders["Brouillons"][-1].raw)
        assert draft["In-Reply-To"] == "<q1@client.fr>" and "<q1@client.fr>" in draft["References"]
        assert draft["From"] == "Chapote <contact@chapote.fr>"
        assert "\\Draft" in ovh.folders["Brouillons"][-1].flags and fk.SMTP_SENT == []
        ok, err = await tool(c, token, "create_draft", account="contact", to=["pas-une-adresse"], body="x")
        assert not ok and "invalide" in err
        ok, err = await tool(c, token, "create_draft", account="contact", to=["a@b.fr"], subject="x\r\nBcc: pirate@x.fr")
        assert ok                                    # CR/LF neutralisés dans l'objet
        assert "pirate" not in (fk.email.message_from_bytes(ovh.folders["Brouillons"][-1].raw).get("Bcc") or "")

        # Envoi autorisé (OVH) : SMTP + copie APPEND dans Éléments envoyés, Bcc hors en-têtes transmis.
        ok, s = await tool(c, token, "send_message", account="contact", to=["bob@client.fr"], bcc=["archive@chapote.fr"],
                           subject="Infos", body="Voici.")
        assert ok and s["sent"] is True and s["sent_folder"] == "Éléments envoyés"
        assert fk.SMTP_SENT[-1]["to"] == ["bob@client.fr", "archive@chapote.fr"]
        assert len(ovh.folders["&AMk-l&AOk-ments envoy&AOk-s"]) == 1

        # Gmail : envoi interdit (allow_send=false) -> erreur explicite, rien d'envoyé ; corbeille interdite.
        n = len(fk.SMTP_SENT)
        ok, err = await tool(c, token, "send_message", account="perso", to=["a@b.fr"], body="x")
        assert not ok and "create_draft" in err and len(fk.SMTP_SENT) == n
        ok, err = await tool(c, token, "trash", account="perso", uids=[g1])
        assert not ok and "désactivée" in err and len(gm.folders["INBOX"]) == 1
        ok, err = await tool(c, token, "move", account="perso", uids=[g1], destination="[Gmail]/Corbeille")
        assert not ok and "corbeille" in err.lower()
        denied = (await env.execute(select(McpAuditLog).where(McpAuditLog.status == "denied"))).scalars().all()
        assert {d.tool for d in denied} == {"send_message", "trash", "move"}

        # Indicateurs, déplacement, corbeille (OVH : droits accordés).
        ok, r = await tool(c, token, "mark", account="contact", uids=[orig], read=True, flagged=True)
        assert ok and ovh.folders["INBOX"][0].flags >= {"\\Seen", "\\Flagged"}
        ok, r = await tool(c, token, "move", account="contact", uids=[orig], destination="Archives")
        assert ok and r["to_folder"] == "Archives" and not ovh.folders["INBOX"] and len(ovh.folders["Archives"]) == 1
        moved = ovh.folders["Archives"][0].uid
        ok, r = await tool(c, token, "trash", account="contact", uids=[moved], folder="Archives")
        assert ok and r["to_folder"] == "Éléments supprimés" and len(ovh.folders["&AMk-l&AOk-ments supprim&AOk-s"]) == 1
        in_trash = ovh.folders["&AMk-l&AOk-ments supprim&AOk-s"][0].uid
        ok, err = await tool(c, token, "trash", account="contact", uids=[in_trash], folder="Éléments supprimés")
        assert not ok and "définitive" in err
        ok, err = await tool(c, token, "mark", account="contact", uids=list(range(1, 200)), read=True)
        assert not ok                                  # 100 UID au plus (validation du schéma)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_no_secret_in_logs_or_audit(env, caplog):
    caplog.set_level(logging.DEBUG)
    await _boxes(env)
    fk.add(fk.ACCOUNTS["contact@chapote.fr"], "INBOX", fk.make_raw("Sujet confidentiel XYZ", body="Corps secret 987"))
    async with http() as c:
        admin = await _user(env, "boss@chapote.fr", superadmin=True, totp=True)
        client, tokens, code = await _oauth_tokens(c, admin)
        token = tokens["access_token"]
        await tool(c, token, "search_messages", account="contact", query="confidentiel")
        await tool(c, token, "get_message", account="contact", uid=fk.ACCOUNTS["contact@chapote.fr"].folders["INBOX"][0].uid)
        fk.ACCOUNTS["contact@chapote.fr"].password = "autre"                 # échec d'authentification IMAP
        ok, err = await tool(c, token, "list_folders", account="contact")
        assert not ok and "refusée" in err and OVH_PASSWORD not in err
        as_(c, admin)
        await c.post("/api/emails/mailboxes", json={"slug": "x", "address": "x@gmail.com", "preset": "gmail",
                                                    "password": "Ultra-Secret-999"})
        await c.post("/api/emails/mailboxes/test", json={"address": "x@y.fr", "imap_host": "h.example",
                                                         "smtp_host": "h.example", "password": "Ultra-Secret-999"})
        # Erreur inattendue dans un outil : message générique, type seul dans le journal.
        async def boom(*a, **k):
            raise RuntimeError(f"fuite {OVH_PASSWORD}")
        orig_run = mail_client.run_blocking
        mail_client.run_blocking = boom
        try:
            ok, err = await tool(c, token, "list_folders", account="perso")
        finally:
            mail_client.run_blocking = orig_run
        assert not ok and "Erreur interne" in err and OVH_PASSWORD not in err
    logs = caplog.text
    for secret in (OVH_PASSWORD, GMAIL_PASSWORD, "Ultra-Secret-999", token, tokens["refresh_token"], code):
        assert secret not in logs
    assert "RuntimeError" in logs
    rows = (await env.execute(select(McpAuditLog))).scalars().all()
    dump = json.dumps([{k: str(getattr(r, k)) for k in ("tool", "mailbox_slug", "status", "error_code")} for r in rows])
    assert "confidentiel" not in dump and "XYZ" not in dump and "987" not in dump
    assert {"auth_imap", "internal"} <= {r.error_code for r in rows}
    stored = (await env.execute(select(McpOAuthToken))).scalars().all()
    assert all(t.access_hash != token and len(t.access_hash) == 64 for t in stored)


def test_folder_name_utf7_roundtrip():
    for name in ("INBOX", "Éléments envoyés", "[Gmail]/Messages envoyés", "R&D", "日本語"):
        assert mail_client.decode_folder(mail_client.encode_folder(name)) == name
    assert mail_client.encode_folder("Éléments envoyés") == "&AMk-l&AOk-ments envoy&AOk-s"
    assert mail_client.encode_folder("R&D") == "R&-D"
