"""Onboarding guidé du plugin WordPress — surface /api/account/* (DB réelle).

Couvre la surface ajoutée (routers/external/onboarding.py) : découverte d'URLs
(ranking/cap/host/sitemap), génération d'arbre (job_id / 429 / 404 cross-tenant /
exclude threadé), generate-status (404 cross-bot et cross-user), arbre GET/PUT
(422 / perm 'context' / pas de gating billing), prune (diff sans sauvegarde) et
les jetons aperçu/embed. La recommandation déterministe est aussi testée comme
fonction PURE (bornes de palier pilotées catalogue).

Harness identique à test_account_proxy.py : override get_db -> pg_session, tokens
plugin émis par le vrai oauth_service (require_oauth_token EXERCÉ), ownership réelle
via FK.
"""
import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import verify_embed_token, verify_widget_preview_token
from src.main import app
from src.models.bot import Bot
from src.models.user import Membership, Organization, User
from src.routers.external import onboarding as ext_onboarding
from src.services import oauth_service as oauth
from src.services import onboarding_service, tree_jobs


class _RealApp:
    """Override get_db -> pg_session. require_oauth_token (Bearer plugin) EXERCÉ."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test")
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)


async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Plug", is_active=True)
    session.add(u)
    await session.flush()
    return u


async def _mk_bot(session: AsyncSession, owner: User, *, tree=None) -> Bot:
    bot = Bot(name="B", owner_user_id=owner.id, organization_id=None, mode="hybrid")
    if tree is not None:
        bot.tree_json = tree
    session.add(bot)
    await session.flush()
    return bot


async def _mk_team_bot(session: AsyncSession, owner: User) -> tuple[Organization, Bot]:
    org = Organization(name="Org", owner_user_id=owner.id)
    session.add(org)
    await session.flush()
    bot = Bot(name="B", owner_user_id=None, organization_id=org.id, mode="hybrid")
    session.add(bot)
    await session.flush()
    return org, bot


async def _mk_membership(session, user, org, bot, perms) -> Membership:
    m = Membership(user_id=user.id, organization_id=org.id, role="member",
                   permissions={str(bot.id): perms})
    session.add(m)
    await session.flush()
    return m


async def _plugin_token(session: AsyncSession, user: User) -> str:
    access, _refresh, _exp = await oauth._issue_token_pair(session, user.id)
    return access


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _aret(value):
    async def _inner(*a, **k):
        return value
    return _inner


_VALID_TREE = {"start": "root", "nodes": {
    "root": {"message": "Salut", "options": [{"label": "IA", "next": "__ai__"}]}}}


# ==========================================================================
# Recommandation (fonction PURE, pilotée catalogue) — bornes 1000/3000/None
# ==========================================================================

_CATALOG = {"ai_tiers": [
    {"id": "ai_starter", "included_replies": 1000},
    {"id": "ai_growth", "included_replies": 3000},
    {"id": "ai_scale", "included_replies": 10000},
]}


def _tier(visitors):
    return onboarding_service.recommend(_CATALOG, _VALID_TREE, None, visitors, "hybrid")["recommended_ai_tier"]


def test_recommend_tier_thresholds():
    assert _tier(None) == "ai_starter"     # None -> plus petit palier
    assert _tier(1000) == "ai_starter"     # <=1000
    assert _tier(1001) == "ai_growth"      # >1000
    assert _tier(3000) == "ai_growth"      # <=3000
    assert _tier(3001) == "ai_scale"       # >3000
    assert _tier(999999) == "ai_scale"     # plafonne au plus grand palier


def test_recommend_modules_and_byok():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Conseiller", "next": "h"}]},
        "h": {"message": "Relation", "type": "handoff", "options": []}}}
    out = onboarding_service.recommend(_CATALOG, tree, None, None, "hybrid")
    assert "inbox" in out["required_modules"]
    assert set(out["recommended_modules"]) == {"ai", "inbox"}
    assert out["recommended_byok"] is False
    assert out["expected_replies"] == 1000


def test_recommend_empty_catalog_defaults_to_starter():
    out = onboarding_service.recommend({}, _VALID_TREE, None, 5000, "ai")
    assert out["recommended_ai_tier"] == "ai_starter"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_recommendation_endpoint_billing_off(pg_session: AsyncSession, monkeypatch):
    """Endpoint POST /recommendation (billing OFF -> catalogue DISABLED) : 200, le
    palier retombe sur 'ai_starter' et le module 'ai' est toujours recommandé."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None, raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", None, raising=False)
    user = await _mk_user(pg_session, "rec@test.dev")
    bot = await _mk_bot(pg_session, user, tree=_VALID_TREE)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/recommendation",
                         json={"visitors_per_month": 2000}, headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["recommended_ai_tier"] == "ai_starter"
    assert "ai" in r.json()["recommended_modules"]


# ==========================================================================
# discover-urls : ranking / cap 15 / host / repli sitemap / none
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_discover_urls_ranking_cap_and_host(pg_session: AsyncSession):
    user = await _mk_user(pg_session, "du1@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    urls = [f"https://shop.example.com/p{i}" for i in range(20)]
    urls += ["https://shop.example.com/", "https://shop.example.com/contact",
             "https://autre.com/etranger"]
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/discover-urls",
                         json={"site_url": "https://shop.example.com", "urls": urls},
                         headers=_bearer(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "plugin_list"
    sug = body["suggested"]
    assert len(sug) <= 15                                   # cap
    assert all(u["url"].startswith("https://shop.example.com") for u in sug)  # host filtré
    top = [u["url"] for u in sug[:2]]
    assert "https://shop.example.com/" in top               # home en tête
    assert "https://shop.example.com/contact" in top        # page clé en tête
    assert sum(1 for u in sug if u["selected"]) <= 8         # pré-cochés bornés


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_discover_urls_sitemap_fallback(pg_session: AsyncSession, monkeypatch):
    user = await _mk_user(pg_session, "du2@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    monkeypatch.setattr(onboarding_service, "sitemap_fallback",
                        _aret(["https://shop.example.com/", "https://shop.example.com/a-propos"]))
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/discover-urls",
                         json={"site_url": "https://shop.example.com", "urls": []},
                         headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "sitemap"
    assert len(r.json()["suggested"]) == 2


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_discover_urls_none(pg_session: AsyncSession, monkeypatch):
    user = await _mk_user(pg_session, "du3@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    monkeypatch.setattr(onboarding_service, "sitemap_fallback", _aret([]))
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/discover-urls",
                         json={"site_url": "https://shop.example.com", "urls": []},
                         headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "none"
    assert r.json()["suggested"] == []


# ==========================================================================
# generate-from-urls : 404 cross-tenant / job_id + exclude threadé / 429
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_generate_from_urls_cross_tenant_404(pg_session: AsyncSession):
    user_a = await _mk_user(pg_session, "gfa@test.dev")
    user_b = await _mk_user(pg_session, "gfb@test.dev")
    bot_b = await _mk_bot(pg_session, user_b)
    token_a = await _plugin_token(pg_session, user_a)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot_b.id}/generate-from-urls",
                         json={"urls": ["https://shop.example.com/"]}, headers=_bearer(token_a))
    assert r.status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_generate_from_urls_starts_job_with_exclude(pg_session: AsyncSession, monkeypatch):
    user = await _mk_user(pg_session, "gfj@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    monkeypatch.setattr(ext_onboarding.treegen_limiter, "check", _aret(True))
    captured: dict = {}

    def _fake_run(job_id, urls, context, exclude_modules=None):
        captured.update(job_id=job_id, urls=urls, exclude=exclude_modules)

        async def _noop():
            return None

        return _noop()

    monkeypatch.setattr(onboarding_service, "run_bot_generation", _fake_run)
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/generate-from-urls",
                         json={"urls": ["https://shop.example.com/", "https://shop.example.com/faq"],
                               "exclude_modules": ["ai"]},
                         headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["job_id"]
    assert captured["exclude"] == ["ai"]       # exclude_modules bien threadé
    assert captured["urls"] == ["https://shop.example.com/", "https://shop.example.com/faq"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_generate_from_urls_rate_limited_429(pg_session: AsyncSession, monkeypatch):
    user = await _mk_user(pg_session, "gf429@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    monkeypatch.setattr(ext_onboarding.treegen_limiter, "check", _aret(False))
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/generate-from-urls",
                         json={"urls": ["https://shop.example.com/"]}, headers=_bearer(token))
    assert r.status_code == 429


# ==========================================================================
# generate-status : autorisation stricte (couple user+bot)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_generate_status_cross_bot_and_user_404(pg_session: AsyncSession):
    user_a = await _mk_user(pg_session, "gsa@test.dev")
    bot_a1 = await _mk_bot(pg_session, user_a)
    bot_a2 = await _mk_bot(pg_session, user_a)
    user_b = await _mk_user(pg_session, "gsb@test.dev")
    bot_b = await _mk_bot(pg_session, user_b)
    token_a = await _plugin_token(pg_session, user_a)
    token_b = await _plugin_token(pg_session, user_b)
    await pg_session.commit()

    job_id = await tree_jobs.create(user_a.id, bot_id=bot_a1.id)
    async with _RealApp(pg_session) as c:
        r_ok = await c.get(f"/api/account/bots/{bot_a1.id}/generate-status?job_id={job_id}",
                           headers=_bearer(token_a))
        r_bot = await c.get(f"/api/account/bots/{bot_a2.id}/generate-status?job_id={job_id}",
                            headers=_bearer(token_a))
        r_usr = await c.get(f"/api/account/bots/{bot_b.id}/generate-status?job_id={job_id}",
                            headers=_bearer(token_b))
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json()["status"] == "running"
    assert r_bot.status_code == 404   # bon user, AUTRE bot
    assert r_usr.status_code == 404   # autre user (job d'autrui)


# ==========================================================================
# Arbre : GET / PUT (422, perm 'context', pas de gating billing) / prune
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tree_get_put_validate_and_persist(pg_session: AsyncSession):
    user = await _mk_user(pg_session, "tr1@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        rget = await c.get(f"/api/account/bots/{bot.id}/tree", headers=_bearer(token))
        rput = await c.put(f"/api/account/bots/{bot.id}/tree",
                           json={"tree_json": _VALID_TREE}, headers=_bearer(token))
        rbad = await c.put(f"/api/account/bots/{bot.id}/tree",
                           json={"tree_json": {"nodes": {}}}, headers=_bearer(token))
    assert rget.status_code == 200 and "tree_json" in rget.json()
    assert rput.status_code == 200, rput.text
    assert rput.json()["tree_json"] == _VALID_TREE
    assert "updated_at" in rput.json()
    assert rbad.status_code == 422                       # validate_tree -> 422
    fresh = await pg_session.get(Bot, bot.id)
    assert fresh.tree_json == _VALID_TREE                # persisté (pas de gating billing)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tree_put_team_member_perm_context(pg_session: AsyncSession):
    owner = await _mk_user(pg_session, "trown@test.dev")
    m_no = await _mk_user(pg_session, "trno@test.dev")
    m_ok = await _mk_user(pg_session, "trok@test.dev")
    org, bot = await _mk_team_bot(pg_session, owner)
    await _mk_membership(pg_session, m_no, org, bot, ["appearance"])  # PAS 'context'
    await _mk_membership(pg_session, m_ok, org, bot, ["context"])
    tok_no = await _plugin_token(pg_session, m_no)
    tok_ok = await _plugin_token(pg_session, m_ok)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r_no = await c.put(f"/api/account/bots/{bot.id}/tree",
                           json={"tree_json": _VALID_TREE}, headers=_bearer(tok_no))
        r_ok = await c.put(f"/api/account/bots/{bot.id}/tree",
                           json={"tree_json": _VALID_TREE}, headers=_bearer(tok_ok))
    assert r_no.status_code == 403, r_no.text   # sans la perm 'context'
    assert r_ok.status_code == 200, r_ok.text   # avec la perm 'context'


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_tree_prune_diff_without_save(pg_session: AsyncSession):
    user = await _mk_user(pg_session, "prn@test.dev")
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [
            {"label": "Conseiller", "next": "h"}, {"label": "Infos", "next": "i"}]},
        "h": {"message": "Relation", "type": "handoff", "options": []},
        "i": {"message": "Infos", "options": [{"label": "Retour", "next": "root"}]}}}
    bot = await _mk_bot(pg_session, user, tree=tree)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/account/bots/{bot.id}/tree/prune",
                         json={"kept_modules": ["ai"]}, headers=_bearer(token))  # inbox EXCLU
    assert r.status_code == 200, r.text
    body = r.json()
    assert "h" in body["removed_node_ids"]
    assert "h" not in body["tree_json"]["nodes"]
    fresh = await pg_session.get(Bot, bot.id)
    assert "h" in fresh.tree_json["nodes"]      # NON sauvegardé (diff seul)


# ==========================================================================
# Jetons aperçu / embed
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_preview_and_embed_tokens(pg_session: AsyncSession):
    user = await _mk_user(pg_session, "tok@test.dev")
    bot = await _mk_bot(pg_session, user)
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        rp = await c.post(f"/api/account/bots/{bot.id}/preview-token", headers=_bearer(token))
        re_ = await c.post(f"/api/account/bots/{bot.id}/embed-token", headers=_bearer(token))
    assert rp.status_code == 200, rp.text
    assert rp.json()["expires_in"] == 900
    assert verify_widget_preview_token(rp.json()["preview_token"])["bot_id"] == bot.id
    assert re_.status_code == 200, re_.text
    assert re_.json()["expires_in"] == 1200
    assert verify_embed_token(re_.json()["embed_token"])["bot_id"] == bot.id
