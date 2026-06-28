"""PR-11 — cycle de vie OAuth « plugin » (PKCE, anti-rejeu code, rotation refresh).

Cluster audit NON couvert jusqu'ici : le cœur cryptographique du flux OAuth
(Authorization Code + PKCE S256) et ses verrous anti-rejeu n'étaient exercés par
aucun test. test_oauth_redirect.py (PR-02) couvre la FORME du redirect_uri +
l'allowlist /authorize ; test_oauth_revocation.py (PR-05) couvre la révocation
stateful de l'access via access_jti. Ce module COMPLÈTE les trous : échange réel
du code, usage unique, rotation/rejeu du refresh, liaison redirect_uri à
l'échange, format des erreurs de rate-limit.

DB RÉELLE (PR-10, real_db.py) : les axes qui exercent un VERROU (`with_for_update`,
neutralisé par FakeSession) ou une vraie persistance transactionnelle (used_at,
is_revoked/replaced_by_id) tournent sur `pg_session`/`pg_engine` (marqueur
`real_db`). Les FK (user_id -> users.id) imposent d'ailleurs un vrai Postgres :
FakeSession ne pose aucune contrainte. Seuls les tests de FORMAT de rate-limit
(qui bloquent AVANT tout accès DB) restent sur FakeSession + monkeypatch.

NB shared session (revue PR-10) : `pg_session` est UNIQUE et partagée entre le
seed du test et l'endpoint ; le `db.commit()` de l'endpoint est visible côté test.
On relit donc la ligne APRÈS l'appel pour asserter l'état persistant.
"""
import asyncio
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.database import get_db
from src.core.security import OAUTH_PLUGIN_CLIENT_ID, get_current_user
from src.main import app
from src.models.oauth import OAuthAuthorizationCode, OAuthToken
from src.models.user import User
from src.services import oauth_service as svc
from src.services.rate_limit import oauth_authorize_limiter, oauth_token_limiter

# Paire PKCE canonique de la RFC 7636 (annexe B) : challenge = base64url-no-pad(
# sha256(verifier)). Identique au constant utilisé par test_oauth_redirect.py.
RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

_VALID = "https://shop.example.com/wp-admin/admin.php?page=chapote-chatbot"
_OTHER = "https://other.example.com/wp-admin/admin.php?page=chapote-chatbot"


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Test")
    session.add(u)
    await session.flush()
    return u


def _authorize_body(redirect_uri: str = _VALID, challenge: str = RFC_CHALLENGE) -> dict:
    return {
        "client_id": OAUTH_PLUGIN_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "state": "st-123",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": "plugin",
    }


def _code_from_redirect(redirect_url: str) -> str:
    return parse_qs(urlparse(redirect_url).query)["code"][0]


class _RealApp:
    """Branche get_db -> `session` réelle et get_current_user -> `user` réel, et
    fournit un client httpx ASGI. Restaure les overrides en sortie."""

    def __init__(self, session: AsyncSession, user: User):
        self._session = session
        self._user = user

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        async def _get_user():
            return self._user

        app.dependency_overrides[get_db] = _get_db
        app.dependency_overrides[get_current_user] = _get_user
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


# ==========================================================================
# Axe 1 — PKCE S256
# ==========================================================================

def test_pkce_challenge_derivation_matches_rfc():
    """Pur unitaire : la transformation S256 du service == challenge RFC 7636.
    Ancre la dérivation (base64url-sans-padding de sha256(verifier))."""
    assert svc._pkce_s256(RFC_VERIFIER) == RFC_CHALLENGE


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_pkce_full_exchange_success_then_single_use(pg_session: AsyncSession):
    """Bout-en-bout HTTP : /authorize crée le code ; /token (bon verifier) ->
    paire access+refresh. Puis 2e /token avec le MÊME code -> invalid_grant
    (used_at posé et committé : usage unique séquentiel sur DB réelle). Couvre
    axe 1 (succès PKCE) + axe 2 (anti-rejeu séquentiel)."""
    user = await _mk_user(pg_session, "pkce-ok@test.dev")
    await pg_session.commit()

    async with _RealApp(pg_session, user) as c:
        r_auth = await c.post("/api/oauth/authorize", json=_authorize_body())
        assert r_auth.status_code == 200, r_auth.text
        code = _code_from_redirect(r_auth.json()["redirect_url"])

        r_tok = await c.post("/api/oauth/token", json={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _VALID,
            "code_verifier": RFC_VERIFIER,
            "client_id": OAUTH_PLUGIN_CLIENT_ID,
        })
        assert r_tok.status_code == 200, r_tok.text
        payload = r_tok.json()
        assert payload["access_token"] and payload["refresh_token"]
        assert payload["token_type"] == "Bearer" and payload["scope"] == "plugin"

        # used_at posé en base (lecture après commit de l'endpoint, session partagée).
        row = (await pg_session.execute(
            select(OAuthAuthorizationCode).where(
                OAuthAuthorizationCode.code_hash == svc._hash(code))
        )).scalar_one()
        assert row.used_at is not None

        # Rejeu du même code -> invalid_grant.
        r_replay = await c.post("/api/oauth/token", json={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _VALID,
            "code_verifier": RFC_VERIFIER,
            "client_id": OAUTH_PLUGIN_CLIENT_ID,
        })
        assert r_replay.status_code == 400
        assert r_replay.json() == {"error": "invalid_grant"}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_pkce_wrong_verifier_rejected(pg_session: AsyncSession):
    """/token avec un MAUVAIS code_verifier -> invalid_grant (preuve PKCE
    invalide). Le code reste non consommé (used_at NULL)."""
    user = await _mk_user(pg_session, "pkce-bad@test.dev")
    await pg_session.commit()

    async with _RealApp(pg_session, user) as c:
        r_auth = await c.post("/api/oauth/authorize", json=_authorize_body())
        code = _code_from_redirect(r_auth.json()["redirect_url"])

        r_tok = await c.post("/api/oauth/token", json={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _VALID,
            "code_verifier": "wrong-verifier-zzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            "client_id": OAUTH_PLUGIN_CLIENT_ID,
        })
        assert r_tok.status_code == 400
        assert r_tok.json() == {"error": "invalid_grant"}

    row = (await pg_session.execute(
        select(OAuthAuthorizationCode).where(
            OAuthAuthorizationCode.code_hash == svc._hash(code))
    )).scalar_one()
    assert row.used_at is None  # échange refusé : code toujours utilisable


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_non_s256_challenge_rejected(pg_session: AsyncSession):
    """Un code dont le code_challenge_method n'est PAS 'S256' est refusé à
    l'échange (seul S256 accepté). /authorize impose déjà S256 ; on fabrique donc
    le code directement via le service pour exercer la garde côté exchange."""
    user = await _mk_user(pg_session, "plain@test.dev")
    code = await svc.create_authorization_code(
        pg_session, user_id=user.id, client_id=OAUTH_PLUGIN_CLIENT_ID,
        redirect_uri=_VALID, code_challenge="plain-challenge",
        code_challenge_method="plain", scope="plugin",
    )
    await pg_session.commit()

    with pytest.raises(svc.OAuthError) as exc:
        await svc.exchange_authorization_code(pg_session, code, _VALID, "plain-challenge")
    assert exc.value.code == "invalid_grant"


# ==========================================================================
# Axe 2 — anti-rejeu du code d'autorisation (verrou with_for_update)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_auth_code_concurrent_exchange_single_winner(pg_engine):
    """Deux échanges CONCURRENTS du même code (connexions distinctes) : le verrou
    `with_for_update` les sérialise -> exactement UN succès, l'autre voit used_at
    et obtient invalid_grant. Impossible à prouver sous FakeSession (with_for_update
    = no-op). C'est l'axe central du cluster audit."""
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as s:
        u = await _mk_user(s, "concurrent@test.dev")
        code = await svc.create_authorization_code(
            s, user_id=u.id, client_id=OAUTH_PLUGIN_CLIENT_ID,
            redirect_uri=_VALID, code_challenge=RFC_CHALLENGE,
            code_challenge_method="S256", scope="plugin",
        )
        await s.commit()

    async def _flow() -> str:
        async with Session() as sess:
            try:
                await svc.exchange_authorization_code(sess, code, _VALID, RFC_VERIFIER)
                await sess.commit()
                return "ok"
            except svc.OAuthError as e:
                await sess.commit()
                return e.code

    r1, r2 = await asyncio.gather(_flow(), _flow())
    assert sorted([r1, r2]) == ["invalid_grant", "ok"], (r1, r2)

    # Une seule paire de tokens émise (usage strictement unique).
    async with Session() as s:
        n = len((await s.execute(select(OAuthToken))).scalars().all())
    assert n == 1


# ==========================================================================
# Axe 3 — rotation refresh + détection de rejeu (révocation de la lignée)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_refresh_rotation_then_replay_revokes_lineage(pg_session: AsyncSession):
    """rotate_refresh : nouvelle paire, ancien refresh révoqué + replaced_by_id.
    Réutiliser l'ANCIEN refresh (rejeu) -> invalid_grant ET révocation de toute la
    lignée (le NOUVEAU refresh devient révoqué aussi)."""
    user = await _mk_user(pg_session, "rotate@test.dev")
    _access0, refresh0, _ = await svc._issue_token_pair(pg_session, user.id)
    await pg_session.commit()

    # Rotation : émet une nouvelle paire.
    _access1, refresh1, _ = await svc.rotate_refresh(pg_session, refresh0)
    await pg_session.commit()
    assert refresh1 != refresh0

    old = (await pg_session.execute(select(OAuthToken).where(
        OAuthToken.refresh_token_hash == svc._hash(refresh0)))).scalar_one()
    new = (await pg_session.execute(select(OAuthToken).where(
        OAuthToken.refresh_token_hash == svc._hash(refresh1)))).scalar_one()
    assert old.is_revoked is True and old.replaced_by_id == new.id
    assert new.is_revoked is False

    # Rejeu de l'ancien refresh (déjà révoqué/remplacé) -> invalid_grant.
    with pytest.raises(svc.OAuthError) as exc:
        await svc.rotate_refresh(pg_session, refresh0)
    assert exc.value.code == "invalid_grant"
    await pg_session.commit()

    # La lignée entière est révoquée : le NOUVEAU refresh ne vaut plus rien.
    new_after = (await pg_session.execute(select(OAuthToken).where(
        OAuthToken.refresh_token_hash == svc._hash(refresh1)))).scalar_one()
    assert new_after.is_revoked is True
    with pytest.raises(svc.OAuthError):
        await svc.rotate_refresh(pg_session, refresh1)


# ==========================================================================
# Axe 4 — liaison redirect_uri à l'échange
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_token_redirect_uri_must_match_code(pg_session: AsyncSession):
    """Le redirect_uri fourni à /token doit être IDENTIQUE à celui lié au code ;
    sinon invalid_grant (même verifier valide). Complète test_oauth_redirect.py
    qui ne couvrait que la FORME / l'allowlist côté /authorize."""
    user = await _mk_user(pg_session, "redir@test.dev")
    code = await svc.create_authorization_code(
        pg_session, user_id=user.id, client_id=OAUTH_PLUGIN_CLIENT_ID,
        redirect_uri=_VALID, code_challenge=RFC_CHALLENGE,
        code_challenge_method="S256", scope="plugin",
    )
    await pg_session.commit()

    with pytest.raises(svc.OAuthError) as exc:
        await svc.exchange_authorization_code(pg_session, code, _OTHER, RFC_VERIFIER)
    assert exc.value.code == "invalid_grant"

    # Le bon redirect_uri (avec le bon verifier) réussit ensuite.
    access, refresh, _ = await svc.exchange_authorization_code(
        pg_session, code, _VALID, RFC_VERIFIER)
    assert access and refresh


# ==========================================================================
# Axe 6 — FORMAT des erreurs de rate-limit (contrat ACTUEL ; fige avant PR-09)
# ==========================================================================

@pytest.mark.asyncio
async def test_authorize_rate_limited_returns_429_text(client, overrides, monkeypatch):
    """/authorize au-delà du quota -> HTTP 429 + détail TEXTE (« Trop de requêtes »).
    Documente le contrat ACTUEL (à uniformiser en PR-09). Limiter monkeypatché."""
    async def _blocked(key):
        return False
    monkeypatch.setattr(oauth_authorize_limiter, "check", _blocked)

    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_authorize_body())
    assert resp.status_code == 429
    assert "Trop de requêtes" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_token_rate_limited_returns_slow_down(client, overrides, monkeypatch):
    """/token au-delà du quota -> HTTP 400 + {"error": "slow_down"} (forme OAuth,
    PAS 429+texte comme /authorize). Fige l'asymétrie ACTUELLE (cf. PR-09)."""
    async def _blocked(key):
        return False
    monkeypatch.setattr(oauth_token_limiter, "check", _blocked)

    async with client as c:
        resp = await c.post("/api/oauth/token", json={
            "grant_type": "authorization_code",
            "code": "x", "redirect_uri": _VALID, "code_verifier": "y",
        })
    assert resp.status_code == 400
    assert resp.json() == {"error": "slow_down"}
