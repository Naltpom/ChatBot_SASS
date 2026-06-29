"""Aperçu LIVE du widget (onboarding plugin WP) — surface /api/widget/* + /api/embed
+ scopes de jetons (DB réelle).

Couvre : le bypass origine+captcha+servabilité du bootstrap/session via
`?preview_token=` (sur un bot non whitelisté/non payé), le comportement public
INCHANGÉ sans token, l'absence de side-effects d'une session d'aperçu (génération
IA SANS comptage/persistance), et le cloisonnement des scopes (les jetons
'embed'/'widget_preview' sont refusés sur /api/account ; le token 'embed' ouvre
/api/embed, pas le 'dashboard').

Harness identique à test_widget_message.py : override get_db -> pg_session, vrais
JWT de session/preview/embed.
"""
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    create_dashboard_token,
    create_embed_token,
    create_widget_preview_token,
    create_widget_token,
)
from src.main import app
from src.models.billing import BotEntitlement
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.user import User
from src.routers import widget, widget_helpers

_API_ORIGIN = settings.API_URL  # origine de l'iframe widget-frame (servie par l'API)


class _RealApp:
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
    u = User(email=email, hashed_password="x", name="Owner", is_active=True)
    session.add(u)
    await session.flush()
    return u


async def _mk_bot(session: AsyncSession, owner: User, *, mode="ai", allowed=None,
                  captcha="turnstile") -> Bot:
    bot = Bot(name="W", owner_user_id=owner.id, organization_id=None, mode=mode,
              allowed_domains=allowed if allowed is not None else [], captcha_provider=captcha)
    session.add(bot)
    await session.flush()
    return bot


def _aret(value):
    async def _inner(*a, **k):
        return value
    return _inner


def _allow_limiters(monkeypatch):
    monkeypatch.setattr(widget_helpers.ip_limiter, "check", _aret(True))
    monkeypatch.setattr(widget.session_limiter, "check", _aret(True))


class _AIReply:
    content = "AI reply"
    tokens_in = 3
    tokens_out = 4


def _patch_generate(monkeypatch) -> list:
    calls: list = []

    async def _fake(*a, **k):
        calls.append(1)
        return _AIReply()

    monkeypatch.setattr(widget, "generate_reply", _fake)
    return calls


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ==========================================================================
# Bootstrap : aperçu bypasse l'origine ; sans token le public est INCHANGÉ
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_preview_bootstrap_bypasses_origin(pg_session: AsyncSession, monkeypatch):
    """Bot SANS domaine autorisé (non payé/non whitelisté) : bootstrap depuis une
    origine quelconque -> 200 grâce au preview_token (bypass origine)."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "pvb@test.dev")
    bot = await _mk_bot(pg_session, owner, allowed=[])
    await pg_session.commit()

    tok = create_widget_preview_token(bot.id, owner.id)
    async with _RealApp(pg_session) as c:
        r = await c.get(f"/api/widget/bootstrap?key={bot.public_key}&preview_token={tok}",
                        headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 200, r.text
    assert "design" in r.json()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_public_bootstrap_without_token_unchanged(pg_session: AsyncSession, monkeypatch):
    """Sans preview_token, l'origine non autorisée est toujours refusée (403) :
    comportement public strictement inchangé."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "pub@test.dev")
    bot = await _mk_bot(pg_session, owner, allowed=[])
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.get(f"/api/widget/bootstrap?key={bot.public_key}",
                        headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403


# ==========================================================================
# Session : aperçu bypasse origine + captcha ; public refusé sans token
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_preview_session_bypasses_origin_and_captcha(pg_session: AsyncSession, monkeypatch):
    """Session d'aperçu : captcha turnstile + origine non autorisée NORMALEMENT
    bloquants, bypassés par le preview_token -> 200, session marquée preview."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "pvs@test.dev")
    bot = await _mk_bot(pg_session, owner, mode="hybrid", allowed=[], captcha="turnstile")
    await pg_session.commit()

    tok = create_widget_preview_token(bot.id, owner.id)
    async with _RealApp(pg_session) as c:
        r = await c.post(f"/api/widget/session?preview_token={tok}",
                         json={"public_key": bot.public_key, "visitor_id": "visitor-12345"},
                         headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 200, r.text
    assert "first" in r.json()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_public_session_without_token_rejected(pg_session: AsyncSession, monkeypatch):
    """Sans token, l'origine non autorisée est refusée (403) : public inchangé."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "pubs@test.dev")
    bot = await _mk_bot(pg_session, owner, allowed=[], captcha="turnstile")
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/session",
                         json={"public_key": bot.public_key, "visitor_id": "visitor-12345"},
                         headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403


# ==========================================================================
# Session d'aperçu : AUCUN side-effect (génère sans gating ni comptage/persistance)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_preview_message_generates_without_side_effects(pg_session: AsyncSession, monkeypatch):
    """Aperçu : un message IA est généré (1 appel provider) MÊME si l'entitlement
    bloquerait un visiteur réel (status inactive + quota 0) — l'aperçu bypasse le
    gating — et AUCUN Message 'ai' n'est persisté (zero comptage/metering)."""
    # billing ON pour prouver que le gating S'APPLIQUERAIT à un vrai visiteur.
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "rk_test_x", raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_x", raising=False)
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)

    owner = await _mk_user(pg_session, "pvm@test.dev")
    bot = await _mk_bot(pg_session, owner, mode="ai", allowed=[])
    conv = Conversation(bot_id=bot.id, visitor_id="visitor-12345",
                        domain=widget.PREVIEW_DOMAIN, status="ai")
    pg_session.add(conv)
    await pg_session.flush()
    pg_session.add(BotEntitlement(bot_id=bot.id, modules=[], ai_monthly_quota=0,
                                  status="inactive", overage_mode="block", source="stripe"))
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, widget.PREVIEW_DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "bonjour"},
                         headers={"Authorization": f"Bearer {token}", "Origin": _API_ORIGIN})
    assert r.status_code == 200, r.text
    assert r.json()["message"] == "AI reply"   # généré malgré inactive/quota 0
    assert len(calls) == 1
    # AUCUN message assistant 'ai' persisté -> aucune conso durable du quota.
    persisted = (await pg_session.execute(
        select(Message).where(Message.bot_id == bot.id,
                              Message.role == "assistant", Message.source == "ai")
    )).scalars().all()
    assert persisted == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_preview_tree_node_no_persistence(pg_session: AsyncSession, monkeypatch):
    """Aperçu : un clic d'option d'arbre renvoie la réponse calculée mais NE
    persiste AUCUN message (ni funnel) — zero compteur."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "pvt@test.dev")
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Services", "next": "svc"}]},
        "svc": {"message": "Nos services", "options": [{"label": "Retour", "next": "root"}]}}}
    bot = await _mk_bot(pg_session, owner, mode="hybrid", allowed=[])
    bot.tree_json = tree
    conv = Conversation(bot_id=bot.id, visitor_id="visitor-12345",
                        domain=widget.PREVIEW_DOMAIN, status="ai")
    pg_session.add(conv)
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, widget.PREVIEW_DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"node": "svc"},
                         headers={"Authorization": f"Bearer {token}", "Origin": _API_ORIGIN})
    assert r.status_code == 200, r.text
    assert "Nos services" in r.json()["message"]
    persisted = (await pg_session.execute(
        select(Message).where(Message.bot_id == bot.id)
    )).scalars().all()
    assert persisted == []  # aucune persistance en aperçu


# ==========================================================================
# Cloisonnement des scopes
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_embed_and_preview_scopes_rejected_on_account(pg_session: AsyncSession):
    """Les jetons 'embed' et 'widget_preview' ne sont JAMAIS acceptés par la
    surface /api/account (qui exige scope='plugin')."""
    owner = await _mk_user(pg_session, "scope@test.dev")
    await pg_session.commit()
    embed_tok = create_embed_token(123, owner.id)
    preview_tok = create_widget_preview_token(123, owner.id)
    async with _RealApp(pg_session) as c:
        r_e = await c.get("/api/account/me", headers=_bearer(embed_tok))
        r_p = await c.get("/api/account/me", headers=_bearer(preview_tok))
    assert r_e.status_code == 401
    assert r_p.status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_embed_surface_requires_embed_scope(pg_session: AsyncSession):
    """/api/embed/bot : ouvert par un token 'embed' (bot porté par le token),
    refusé pour un token 'dashboard' (scope incorrect)."""
    owner = await _mk_user(pg_session, "emb@test.dev")
    bot = await _mk_bot(pg_session, owner, allowed=[])
    await pg_session.commit()

    embed_tok = create_embed_token(bot.id, owner.id)
    dash_tok = create_dashboard_token(owner.id)
    async with _RealApp(pg_session) as c:
        r_ok = await c.get("/api/embed/bot", headers=_bearer(embed_tok))
        r_dash = await c.get("/api/embed/bot", headers=_bearer(dash_tok))
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json()["id"] == bot.id
    assert r_dash.status_code == 401


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_embed_cross_tenant_404(pg_session: AsyncSession):
    """Un token 'embed' émis pour le bot de B ne donne accès qu'à CE bot ; il ne
    permet pas de lire le bot d'un autre (require_bot_access, 404)."""
    user_a = await _mk_user(pg_session, "ea@test.dev")
    user_b = await _mk_user(pg_session, "eb@test.dev")
    bot_a = await _mk_bot(pg_session, user_a, allowed=[])
    await pg_session.commit()

    # Token embed forgé pour le bot de A mais avec l'user B (require_bot_access -> 404).
    tok = create_embed_token(bot_a.id, user_b.id)
    async with _RealApp(pg_session) as c:
        r = await c.get("/api/embed/bot", headers=_bearer(tok))
    assert r.status_code == 404
