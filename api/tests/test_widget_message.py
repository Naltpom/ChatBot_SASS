"""PR-14 — surface HTTP `/api/widget/message` + runtime du handshake (DB réelle).

Cluster audit NON couvert au niveau ENDPOINT : le chemin IA du widget (pré-check
quota AVANT génération, bascule block↔meter du dépassement, BYOK jamais métré,
gating de statut suspended) et les gardes anti-abus du handshake (origine,
captcha, rate-limit) n'étaient exercés par aucun test HTTP. test_billing_metering.py
(PR v2) couvre la MÉCANIQUE d'entitlement (overage_active / ai_overage_* en
FakeSession) ; ce module COMPLÈTE en exerçant l'endpoint réel sur Postgres.

DB RÉELLE (PR-10, real_db.py) : le compteur de quota (pré-check) lit la source
DURABLE `Message` (COUNT SQL par mois UTC) quand la clé Redis du mois est absente —
on seed donc de vraies réponses IA et on prouve le verdict sur DB réelle, ce que
FakeSession (pas d'agrégation SQL) ne peut pas faire. Le provider IA (generate_reply)
et le report Stripe (report_meter_event) sont monkeypatchés + COMPTÉS : on prouve
0/1 appel selon le cas, sans réseau.

NB session partagée (revue PR-10/PR-11) : `pg_session` sert au seed ET à l'endpoint
(get_db override) ; le commit de l'endpoint est visible côté test.
"""
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import METER_EVENT_NAME, MODULE_AI
from src.core.database import get_db
from src.core.security import create_widget_token
from src.main import app
from src.models.billing import BotEntitlement, BotUsageCounter
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.user import User
from src.routers import widget
from src.routers import widget_helpers
from src.services import quota_service as qs

_ORIGIN = "https://shop.example.com"
_DOMAIN = "shop.example.com"


# --------------------------------------------------------------------------
# Harness : override get_db -> pg_session, client httpx ASGI. Le widget
# s'authentifie par un VRAI JWT de session (get_widget_session décode le Bearer,
# aucune DB), donc seul get_db est surchargé.
# --------------------------------------------------------------------------

class _RealApp:
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


# --- Helpers de seed -------------------------------------------------------

async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Owner", is_active=True)
    session.add(u)
    await session.flush()
    return u


async def _mk_bot(session: AsyncSession, owner: User, *, mode="ai",
                  api_key_mode="managed", allowed=None, captcha="turnstile") -> Bot:
    bot = Bot(
        name="W", owner_user_id=owner.id, organization_id=None,
        mode=mode, api_key_mode=api_key_mode,
        allowed_domains=allowed if allowed is not None else [_DOMAIN],
        captcha_provider=captcha,
    )
    session.add(bot)
    await session.flush()
    return bot


async def _mk_conv(session: AsyncSession, bot: Bot, status="ai") -> Conversation:
    conv = Conversation(bot_id=bot.id, visitor_id="visitor-12345",
                        domain=_DOMAIN, status=status)
    session.add(conv)
    await session.flush()
    return conv


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Origin": _ORIGIN}


class _AIReply:
    content = "AI reply"
    tokens_in = 3
    tokens_out = 4


def _aret(value):
    async def _inner(*a, **k):
        return value
    return _inner


def _enable_billing(monkeypatch):
    """billing_enabled() + metering_enabled() True (sans réseau Stripe)."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "rk_test_x", raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_x", raising=False)
    monkeypatch.setattr(settings, "BILLING_METERING_ENABLED", True, raising=False)


def _allow_limiters(monkeypatch):
    """Neutralise les rate-limiters (anti-flakiness) pour exercer le chemin métier."""
    monkeypatch.setattr(widget_helpers.ip_limiter, "check", _aret(True))
    monkeypatch.setattr(widget.session_limiter, "check", _aret(True))


def _patch_generate(monkeypatch) -> list:
    """Remplace generate_reply par un faux COMPTÉ ; renvoie la liste d'appels."""
    calls: list = []

    async def _fake(*a, **k):
        calls.append(1)
        return _AIReply()

    monkeypatch.setattr(widget, "generate_reply", _fake)
    return calls


def _patch_report(monkeypatch) -> list:
    """Compte les meter events Stripe rapportés (au plus bas niveau, dans qs)."""
    reports: list = []

    async def _fake(**k):
        reports.append(k)

    monkeypatch.setattr(qs.stripe_service, "report_meter_event", _fake)
    return reports


async def _seed_ai_replies(session: AsyncSession, conv: Conversation, n: int) -> None:
    """n réponses IA déjà consommées ce mois (source durable du quota)."""
    for _ in range(n):
        session.add(Message(conversation_id=conv.id, bot_id=conv.bot_id,
                            role="assistant", source="ai", content="prev"))


# ==========================================================================
# A1 — pré-check quota AVANT génération (mode block) : 0 appel provider
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_quota_exhausted_block_no_generation(pg_session: AsyncSession, monkeypatch):
    """Quota épuisé (conso durable == quota) en mode block : l'endpoint renvoie le
    message DÉDIÉ et generate_reply n'est JAMAIS appelé (pré-check lecture seule sur
    COUNT SQL réel). Preuve que le crédit n'est pas brûlé avant l'effet coûteux."""
    _enable_billing(monkeypatch)
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)

    owner = await _mk_user(pg_session, "a1@test.dev")
    bot = await _mk_bot(pg_session, owner)
    conv = await _mk_conv(pg_session, bot)
    pg_session.add(BotEntitlement(
        bot_id=bot.id, modules=[MODULE_AI], ai_monthly_quota=2,
        status="active", overage_mode="block", source="stripe"))
    await _seed_ai_replies(pg_session, conv, 2)   # quota plein
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, _DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "bonjour"},
                         headers=_hdr(token))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "ai"
    assert body["message"] == widget.QUOTA_EXHAUSTED_MESSAGE
    assert calls == []  # génération NON déclenchée


# ==========================================================================
# A2 — bascule block↔meter : dépassement SERVI + meter event rapporté
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_overage_meter_serves_and_reports(pg_session: AsyncSession, monkeypatch):
    """Quota épuisé MAIS overage armé (mode meter, sous plafond) : la génération a
    lieu (1 appel) ET un meter event est rapporté (1 appel) ; le compteur durable
    reported_overage passe à 1 (DB réelle)."""
    _enable_billing(monkeypatch)
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)
    reports = _patch_report(monkeypatch)
    monkeypatch.setattr(widget, "billing_customer_for_bot", _aret("cus_test"))

    owner = await _mk_user(pg_session, "a2@test.dev")
    bot = await _mk_bot(pg_session, owner)
    conv = await _mk_conv(pg_session, bot)
    pg_session.add(BotEntitlement(
        bot_id=bot.id, modules=[MODULE_AI], ai_monthly_quota=2,
        status="active", overage_mode="meter", overage_cap=500, source="stripe"))
    await _seed_ai_replies(pg_session, conv, 2)   # quota plein -> dépassement
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, _DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "encore"},
                         headers=_hdr(token))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "ai" and body["message"] == "AI reply"
    assert len(calls) == 1                 # génération SERVIE au-delà du quota
    assert len(reports) == 1               # meter event rapporté
    assert reports[0]["event_name"] == METER_EVENT_NAME
    assert reports[0]["customer_id"] == "cus_test"
    row = (await pg_session.execute(
        select(BotUsageCounter).where(BotUsageCounter.bot_id == bot.id)
    )).scalar_one()
    assert row.reported_overage == 1       # compteur durable incrémenté


# ==========================================================================
# A3 — BYOK jamais métré (même quota épuisé / mode meter)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_byok_never_metered(pg_session: AsyncSession, monkeypatch):
    """Bot BYOK : quota illimité (ai_quota_for None) => ni pré-check ni overage. La
    génération a lieu mais AUCUN meter event n'est rapporté, même si l'entitlement
    porte un plan IA managé en mode meter (la clé BYOK prime)."""
    _enable_billing(monkeypatch)
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)
    reports = _patch_report(monkeypatch)
    monkeypatch.setattr(widget, "billing_customer_for_bot", _aret("cus_test"))

    owner = await _mk_user(pg_session, "a3@test.dev")
    bot = await _mk_bot(pg_session, owner, api_key_mode="byok")
    conv = await _mk_conv(pg_session, bot)
    pg_session.add(BotEntitlement(
        bot_id=bot.id, modules=[MODULE_AI], ai_monthly_quota=2,
        status="active", overage_mode="meter", overage_cap=500, source="stripe"))
    await _seed_ai_replies(pg_session, conv, 2)
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, _DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "byok"},
                         headers=_hdr(token))

    assert r.status_code == 200, r.text
    assert r.json()["message"] == "AI reply"
    assert len(calls) == 1
    assert reports == []  # BYOK jamais métré


# ==========================================================================
# A4 — gating statut : suspended coupe le widget, actif passe
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_suspended_bot_blocks_message(pg_session: AsyncSession, monkeypatch):
    """Bot suspended (blocage admin) : /message coupé en 404 (anti-énumération)
    AVANT toute génération — la garde _assert_bot_servable lit le statut sur DB."""
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)

    owner = await _mk_user(pg_session, "a4s@test.dev")
    bot = await _mk_bot(pg_session, owner)
    conv = await _mk_conv(pg_session, bot)
    pg_session.add(BotEntitlement(bot_id=bot.id, status="suspended", source="staff"))
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, _DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "hi"},
                         headers=_hdr(token))

    assert r.status_code == 404
    assert calls == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_active_bot_serves_message(pg_session: AsyncSession, monkeypatch):
    """Bot servable (aucune ligne d'entitlement => socle gratuit ALL_UNLOCKED) :
    /message génère normalement (200, source 'ai')."""
    _allow_limiters(monkeypatch)
    calls = _patch_generate(monkeypatch)

    owner = await _mk_user(pg_session, "a4a@test.dev")
    bot = await _mk_bot(pg_session, owner)
    conv = await _mk_conv(pg_session, bot)
    await pg_session.commit()

    token = create_widget_token(bot.id, conv.id, _DOMAIN)
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/message", json={"text": "salut"},
                         headers=_hdr(token))

    assert r.status_code == 200, r.text
    assert r.json()["source"] == "ai"
    assert len(calls) == 1


# ==========================================================================
# A5 — runtime du handshake : origine / captcha / rate-limit
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_session_origin_not_allowed_rejected(pg_session: AsyncSession, monkeypatch):
    """Origine hors whitelist du bot -> 403 (embed sauvage refusé au handshake)."""
    _allow_limiters(monkeypatch)
    owner = await _mk_user(pg_session, "a5o@test.dev")
    bot = await _mk_bot(pg_session, owner)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/session",
                         json={"public_key": bot.public_key, "visitor_id": "visitor-12345"},
                         headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_session_captcha_failed_rejected(pg_session: AsyncSession, monkeypatch):
    """Captcha requis échoué (verify_captcha mocké False) -> 403, après une origine
    valide (le captcha est la 2e barrière du handshake)."""
    _allow_limiters(monkeypatch)
    monkeypatch.setattr(widget, "verify_captcha", _aret(False))
    owner = await _mk_user(pg_session, "a5c@test.dev")
    bot = await _mk_bot(pg_session, owner)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/session",
                         json={"public_key": bot.public_key,
                               "visitor_id": "visitor-12345", "captcha_token": "tok"},
                         headers={"Origin": _ORIGIN})
    assert r.status_code == 403
    assert "anti-bot" in r.json()["detail"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_session_ip_rate_limited(pg_session: AsyncSession, monkeypatch):
    """Budget IP épuisé (ip_limiter mocké) -> 429 dès l'entrée du handshake."""
    monkeypatch.setattr(widget_helpers.ip_limiter, "check", _aret(False))
    async with _RealApp(pg_session) as c:
        r = await c.post("/api/widget/session",
                         json={"public_key": "pk_whatever", "visitor_id": "visitor-12345"},
                         headers={"Origin": _ORIGIN})
    assert r.status_code == 429
