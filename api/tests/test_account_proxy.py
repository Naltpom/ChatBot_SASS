"""PR-14 — proxy chiffré `/api/account/*` du plugin WordPress (DB réelle).

Cluster audit NON couvert au niveau ENDPOINT : `require_oauth_token` (scope plugin
+ révocation stateful par jti, PR-05), l'isolation MULTI-TENANT du proxy (un token
plugin de l'org A ne doit JAMAIS lire/modifier un bot de l'org B) et l'anti
open-redirect des URLs de retour (wordpress_site_url / checkout). test_oauth_flow.py
(PR-11) couvre le CYCLE OAuth (PKCE/rotation) ; ici on exerce la surface /api/account
qui CONSOMME les tokens émis.

DB RÉELLE (PR-10) : l'autorisation cross-tenant repose sur de vraies FK
(bot.owner_user_id -> users.id) et la révocation lit la ligne OAuthToken — FakeSession
ne pose aucune contrainte et neutralise les filtres non triviaux. Les tokens sont
émis par le vrai service (oauth_service._issue_token_pair, persiste l'access_jti).

Déchiffrement : la couche crypto du repo est **Fernet** (services/crypto.py), PAS
AES-256-GCM (l'intitulé « AES-GCM » de la spec PR-14 ne correspond pas à
l'implémentation réelle). On teste le round-trip réel chiffré-en-base -> déchiffré,
et la robustesse d'un blob corrompu (None, pas de crash).
"""
import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import create_dashboard_token
from src.main import app
from src.models.billing import BillingWordPressLink
from src.models.bot import Bot
from src.models.oauth import OAuthToken
from src.models.user import Membership, Organization, User
from src.routers.external import account
from src.services import oauth_service as oauth
from src.services.crypto import decrypt_secret, encrypt_secret


class _RealApp:
    """Override get_db -> pg_session. require_oauth_token (Bearer plugin) n'est PAS
    surchargé : on l'EXERCE (lookup OAuthToken + User sur la session réelle)."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)


async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Plug", is_active=True)
    session.add(u)
    await session.flush()
    return u


async def _mk_bot(session: AsyncSession, owner: User) -> Bot:
    bot = Bot(name="B", owner_user_id=owner.id, organization_id=None)
    session.add(bot)
    await session.flush()
    return bot


async def _mk_team_bot(session: AsyncSession, owner: User) -> tuple[Organization, Bot]:
    """Org (owner=admin) + un bot d'ÉQUIPE rattaché (organization_id)."""
    org = Organization(name="Org", owner_user_id=owner.id)
    session.add(org)
    await session.flush()
    bot = Bot(name="B", owner_user_id=None, organization_id=org.id)
    session.add(bot)
    await session.flush()
    return org, bot


async def _mk_membership(session: AsyncSession, user: User, org: Organization,
                         bot: Bot, perms: list[str]) -> Membership:
    """Membership 'member' (pas admin) avec permissions par bot restreintes."""
    m = Membership(user_id=user.id, organization_id=org.id, role="member",
                   permissions={str(bot.id): perms})
    session.add(m)
    await session.flush()
    return m


async def _plugin_token(session: AsyncSession, user: User) -> str:
    """Émet une paire OAuth valide (scope plugin) et persiste la ligne OAuthToken
    (access_jti). Renvoie l'access JWT."""
    access, _refresh, _exp = await oauth._issue_token_pair(session, user.id)
    return access


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ==========================================================================
# B1 — require_oauth_token : scope plugin + révocation stateful (jti)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_account_no_token_401(pg_session: AsyncSession):
    """Aucun Authorization -> 401 (require_oauth_token : credentials None)."""
    async with _RealApp(pg_session) as c:
        r = await c.get("/api/account/me")
    assert r.status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_account_dashboard_scope_rejected(pg_session: AsyncSession):
    """Un token de scope 'dashboard' (pas 'plugin') -> 401 (scope invalide). La
    surface plugin n'accepte JAMAIS le JWT dashboard."""
    user = await _mk_user(pg_session, "b1d@test.dev")
    await pg_session.commit()
    tok = create_dashboard_token(user.id)
    async with _RealApp(pg_session) as c:
        r = await c.get("/api/account/me", headers=_bearer(tok))
    assert r.status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_account_plugin_token_ok(pg_session: AsyncSession):
    """Token plugin valide (jti présent en base, non révoqué) -> 200 {email,name}."""
    user = await _mk_user(pg_session, "b1ok@test.dev")
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()
    async with _RealApp(pg_session) as c:
        r = await c.get("/api/account/me", headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json() == {"email": user.email, "name": user.name}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_account_revoked_token_401(pg_session: AsyncSession):
    """Token dont la ligne OAuthToken est révoquée -> 401 (révocation stateful PR-05,
    sans attendre l'expiration du JWT)."""
    user = await _mk_user(pg_session, "b1rev@test.dev")
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()
    # Révoque la ligne du pair (déconnexion / rotation).
    row = (await pg_session.execute(
        select(OAuthToken).where(OAuthToken.user_id == user.id)
    )).scalar_one()
    row.is_revoked = True
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.get("/api/account/me", headers=_bearer(token))
    assert r.status_code == 401


# ==========================================================================
# B2 — autorisation cross-tenant (cœur sécurité : pas de fuite)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cross_tenant_get_bot_404(pg_session: AsyncSession):
    """Token plugin de l'user A lisant le bot perso de l'user B -> 404
    (require_bot_access, anti-énumération). Aucune fuite de la ressource d'autrui."""
    user_a = await _mk_user(pg_session, "b2a@test.dev")
    user_b = await _mk_user(pg_session, "b2b@test.dev")
    bot_b = await _mk_bot(pg_session, user_b)
    token_a = await _plugin_token(pg_session, user_a)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.get(f"/api/account/bots/{bot_b.id}", headers=_bearer(token_a))
    assert r.status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_cross_tenant_patch_appearance_404(pg_session: AsyncSession):
    """Token plugin de A modifiant l'apparence du bot de B -> 404 (pas de mutation
    cross-tenant)."""
    user_a = await _mk_user(pg_session, "b2pa@test.dev")
    user_b = await _mk_user(pg_session, "b2pb@test.dev")
    bot_b = await _mk_bot(pg_session, user_b)
    token_a = await _plugin_token(pg_session, user_a)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.patch(f"/api/account/bots/{bot_b.id}/appearance",
                          json={"design_json": {"primaryColor": "#123456"}},
                          headers=_bearer(token_a))
    assert r.status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_owner_get_own_bot_ok(pg_session: AsyncSession):
    """Contrôle positif : l'owner lit SON bot -> 200 (les 404 ci-dessus sont bien
    de l'autorisation, pas un déni global)."""
    user_a = await _mk_user(pg_session, "b2own@test.dev")
    bot_a = await _mk_bot(pg_session, user_a)
    token_a = await _plugin_token(pg_session, user_a)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.get(f"/api/account/bots/{bot_a.id}", headers=_bearer(token_a))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == bot_a.id


# ==========================================================================
# B2bis — permission de champ `appearance` sur un bot d'ÉQUIPE (anti-escalade)
# Le PATCH apparence plugin doit appliquer la MÊME garde field-perm que le
# dashboard : un membre SANS la perm `appearance` ne peut pas éditer design_json.
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_team_member_without_appearance_perm_403(pg_session: AsyncSession):
    """Bot d'ÉQUIPE, membre (role member) SANS la perm `appearance` -> 403 au
    PATCH apparence (require_bot_access l'autorise comme membre de l'org, mais
    _check_bot_perm refuse le champ design_json)."""
    owner = await _mk_user(pg_session, "b2bisown@test.dev")
    member = await _mk_user(pg_session, "b2bismem@test.dev")
    org, bot = await _mk_team_bot(pg_session, owner)
    # Membre avec une AUTRE perm (context) mais PAS `appearance`.
    await _mk_membership(pg_session, member, org, bot, ["context"])
    token = await _plugin_token(pg_session, member)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.patch(f"/api/account/bots/{bot.id}/appearance",
                          json={"design_json": {"primaryColor": "#123456"}},
                          headers=_bearer(token))
    assert r.status_code == 403, r.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_team_member_with_appearance_perm_200(pg_session: AsyncSession):
    """Contrôle positif : le MÊME bot d'équipe, un membre AVEC la perm `appearance`
    -> 200 (la garde n'est pas un déni global)."""
    owner = await _mk_user(pg_session, "b2bisown2@test.dev")
    member = await _mk_user(pg_session, "b2bismem2@test.dev")
    org, bot = await _mk_team_bot(pg_session, owner)
    await _mk_membership(pg_session, member, org, bot, ["appearance"])
    token = await _plugin_token(pg_session, member)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.patch(f"/api/account/bots/{bot.id}/appearance",
                          json={"design_json": {"primaryColor": "#123456"}},
                          headers=_bearer(token))
    assert r.status_code == 200, r.text


# ==========================================================================
# B3 — anti open-redirect (wordpress_site_url / URLs de retour checkout)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_link_rejects_non_http_url(pg_session: AsyncSession):
    """POST /link avec un wordpress_site_url NON http(s) absolu -> 400."""
    user = await _mk_user(pg_session, "b3l@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/link",
                         json={"wordpress_site_url": "ftp://evil.example.com"},
                         headers=_bearer(token))
    assert r.status_code == 400


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_link_valid_url_normalized(pg_session: AsyncSession):
    """POST /link valide -> 200, URL normalisée en origine (scheme://host)."""
    user = await _mk_user(pg_session, "b3lv@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/link",
                         json={"wordpress_site_url": "https://shop.example.com/wp-admin/x"},
                         headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["wordpress_site_url"] == "https://shop.example.com"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_checkout_urls_anti_open_redirect(pg_session: AsyncSession):
    """_assert_checkout_urls (cœur anti open-redirect, lecture du lien WP sur DB) :
    - hôte EXTERNE au site WP lié -> 400 ;
    - hôtes success/cancel DIFFÉRENTS -> 400 ;
    - même hôte que le site lié -> accepté (aucune exception)."""
    user = await _mk_user(pg_session, "b3co@test.dev")
    bot = await _mk_bot(pg_session, user)
    pg_session.add(BillingWordPressLink(
        bot_id=bot.id, wordpress_site_url="https://shop.example.com"))
    await pg_session.commit()

    # Externe au site lié -> rejet.
    with pytest.raises(HTTPException) as e1:
        await account._assert_checkout_urls(
            pg_session, bot, "https://evil.com/s", "https://evil.com/c")
    assert e1.value.status_code == 400

    # success/cancel d'hôtes différents -> rejet.
    with pytest.raises(HTTPException) as e2:
        await account._assert_checkout_urls(
            pg_session, bot, "https://shop.example.com/s", "https://other.com/c")
    assert e2.value.status_code == 400

    # Même hôte que le site lié -> accepté (pas d'exception).
    await account._assert_checkout_urls(
        pg_session, bot, "https://shop.example.com/s", "https://shop.example.com/c")


# ==========================================================================
# B4 — déchiffrement (Fernet) : round-trip via la base + blob corrompu
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_secret_roundtrip_via_db_and_corrupt(pg_session: AsyncSession):
    """Un secret chiffré et PERSISTÉ (bot.captcha_secret_encrypted) se relit puis se
    déchiffre à l'identique ; un blob corrompu -> None (géré, pas de crash)."""
    user = await _mk_user(pg_session, "b4@test.dev")
    bot = Bot(name="B", owner_user_id=user.id, organization_id=None,
              captcha_secret_encrypted=encrypt_secret("super-secret-123"))
    pg_session.add(bot)
    await pg_session.commit()

    fresh = await pg_session.get(Bot, bot.id)
    assert decrypt_secret(fresh.captcha_secret_encrypted) == "super-secret-123"
    # Blob illisible (clé changée / corruption) : None, jamais d'exception.
    assert decrypt_secret("not-a-valid-fernet-token") is None
