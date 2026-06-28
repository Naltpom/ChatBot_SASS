"""Pipeline de DÉPASSEMENT IA MÉTRÉ (Stripe Billing Meters) — spec §D1/§6.3.

Couvre l'axe v2 « au-delà du quota : SERVIR + FACTURER avec PLAFOND » :

- `overage_active(ent)` : armé seulement si metering_enabled() ET mode 'meter' ET
  plan IA managé (quota non None) ET non BYOK ET status='active' ;
- `ai_overage_precheck` / `ai_overage_consume` : compteur durable BotUsageCounter,
  INCR + report meter event (best-effort, identifier idempotent), refus au plafond ;
- invariants : billing-OFF inert, BYOK jamais métré, métrage gating ;
- endpoint POST /api/bots/{id}/overage : owner-only + 409 metering_unavailable /
  overage_not_applicable ;
- `_project_bot` (reprojet webhook) PRÉSERVE overage_mode/overage_cap (choix owner).

Aucune DB réelle (FakeSession, cf. conftest). Stripe mocké (report_meter_event /
create_meter monkeypatchés — aucun appel réseau).
"""
import pytest
from sqlalchemy import select

from conftest import FakeSession, Obj
from src.core.constants import MODULE_AI, MODULE_RAG, OVERAGE_CAP_DEFAULT
from src.models.billing import BotUsageCounter
from src.services import entitlement_service as es
from src.services import quota_service as qs


def _bot(bot_id=1, api_key_mode="managed", organization_id=None, owner_user_id=5):
    return Obj(id=bot_id, api_key_mode=api_key_mode,
               organization_id=organization_id, owner_user_id=owner_user_id,
               name="B")


def _aretval(value):
    async def _inner(*a, **k):
        return value
    return _inner


# --- overage_active : conditions cumulatives -----------------------------

@pytest.mark.asyncio
async def test_overage_active_meter_managed(monkeypatch):
    """meter + plan IA managé + non BYOK + status active + metering ON => armé."""
    monkeypatch.setattr(es, "metering_enabled", lambda: True)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=1000,
        overage_mode="meter", overage_cap=500, status="active", byok=False)
    assert es.overage_active(ent) is True


@pytest.mark.asyncio
async def test_overage_inactive_mode_block(monkeypatch):
    """Mode 'block' (défaut) => JAMAIS de dépassement facturé (argent)."""
    monkeypatch.setattr(es, "metering_enabled", lambda: True)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=1000,
        overage_mode="block", status="active", byok=False)
    assert es.overage_active(ent) is False


@pytest.mark.asyncio
async def test_overage_inactive_byok(monkeypatch):
    """BYOK jamais métré (illimité, clé du client) — même en mode meter."""
    monkeypatch.setattr(es, "metering_enabled", lambda: True)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=1000,
        overage_mode="meter", status="active", byok=True)
    assert es.overage_active(ent) is False


@pytest.mark.asyncio
async def test_overage_inactive_metering_off(monkeypatch):
    """metering_enabled() faux (billing OFF / flag off) => métrage INERTE (D0)."""
    monkeypatch.setattr(es, "metering_enabled", lambda: False)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=1000,
        overage_mode="meter", status="active", byok=False)
    assert es.overage_active(ent) is False


@pytest.mark.asyncio
async def test_overage_inactive_no_managed_quota(monkeypatch):
    """Pas de quota managé (None = illimité/BYOK) => rien à dépasser."""
    monkeypatch.setattr(es, "metering_enabled", lambda: True)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=None,
        overage_mode="meter", status="active", byok=False)
    assert es.overage_active(ent) is False


@pytest.mark.asyncio
async def test_overage_inactive_status_trialing(monkeypatch):
    """status != active (essai/past_due) => pas de facturation de dépassement."""
    monkeypatch.setattr(es, "metering_enabled", lambda: True)
    ent = es.Entitlement(
        bot_id=1, modules={MODULE_AI}, ai_monthly_quota=1000,
        overage_mode="meter", status="trialing", byok=False)
    assert es.overage_active(ent) is False


# --- ai_overage_precheck : lecture seule sous/au plafond -----------------

@pytest.mark.asyncio
async def test_overage_precheck_sous_plafond(db: FakeSession, monkeypatch):
    """reported_overage < cap => True (une réponse de dépassement de plus passe)."""
    db.seed(BotUsageCounter(id=1, bot_id=7, period=qs.quota_period(),
                            reported_overage=4, period_start=qs._month_start_utc()))
    assert await qs.ai_overage_precheck(db, bot_id=7, cap=5) is True


@pytest.mark.asyncio
async def test_overage_precheck_au_plafond(db: FakeSession):
    """reported_overage == cap => False (plafond atteint, on ne génère plus)."""
    db.seed(BotUsageCounter(id=1, bot_id=7, period=qs.quota_period(),
                            reported_overage=5, period_start=qs._month_start_utc()))
    assert await qs.ai_overage_precheck(db, bot_id=7, cap=5) is False


@pytest.mark.asyncio
async def test_overage_precheck_cap_none_defaut(db: FakeSession):
    """cap None => défaut OVERAGE_CAP_DEFAULT (1000) ; vide => True."""
    assert await qs.ai_overage_precheck(db, bot_id=7, cap=None) is True
    db.seed(BotUsageCounter(id=1, bot_id=7, period=qs.quota_period(),
                            reported_overage=OVERAGE_CAP_DEFAULT,
                            period_start=qs._month_start_utc()))
    assert await qs.ai_overage_precheck(db, bot_id=7, cap=None) is False


# --- ai_overage_consume : INCR ATOMIQUE + report + identifier + refus plafond -
#
# DB RÉELLE (PR-07, real_db.py) : l'incrément de dépassement est un upsert + UPDATE
# atomique (ON CONFLICT + RETURNING, verrou ligne) — FakeSession ne sait PAS exécuter
# ce SQL (insert pg, returning) ni prouver l'atomicité. Ces tests tournent donc sur un
# vrai Postgres jetable (skip gracieux si la base de test est injoignable).


async def _seed_bot(session, bot_id_email: str):
    """Crée un user + un bot (FK requis par BotUsageCounter.bot_id) et renvoie l'id."""
    from src.models.bot import Bot
    from src.models.user import User
    u = User(email=bot_id_email, hashed_password="x", name="T")
    session.add(u)
    await session.flush()
    bot = Bot(name="ov", owner_user_id=u.id)
    session.add(bot)
    await session.flush()
    return bot.id


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_overage_consume_incr_et_report(pg_session, monkeypatch):
    """Incrémente reported_overage ET rapporte le meter event (identifier atomique)."""
    calls = []

    async def _report(event_name, customer_id, value=1, identifier=None):
        calls.append((event_name, customer_id, value, identifier))

    monkeypatch.setattr(qs.stripe_service, "report_meter_event", _report)
    bot_id = await _seed_bot(pg_session, "ov-incr@test.dev")
    await pg_session.commit()

    ok = await qs.ai_overage_consume(
        pg_session, bot_id=bot_id, customer_id="cus_x",
        event_name="ai_reply_overage", cap=5)
    await pg_session.commit()
    assert ok is True
    period = qs.quota_period()
    row = (await pg_session.execute(
        select(BotUsageCounter).where(BotUsageCounter.bot_id == bot_id)
    )).scalar_one()
    assert row.reported_overage == 1
    assert row.period == period
    # identifier = f"{bot_id}:{period}:{new_count}" (dérivé du compteur ATOMIQUE).
    assert calls == [("ai_reply_overage", "cus_x", 1, f"{bot_id}:{period}:1")]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_overage_consume_refus_au_plafond(pg_session, monkeypatch):
    """reported_overage == cap => l'UPDATE ne touche aucune ligne, refus, NO report."""
    calls = []

    async def _report(**k):
        calls.append(k)

    monkeypatch.setattr(qs.stripe_service, "report_meter_event", _report)
    bot_id = await _seed_bot(pg_session, "ov-cap@test.dev")
    pg_session.add(BotUsageCounter(bot_id=bot_id, period=qs.quota_period(),
                                   reported_overage=5,
                                   period_start=qs._month_start_utc()))
    await pg_session.commit()

    ok = await qs.ai_overage_consume(
        pg_session, bot_id=bot_id, customer_id="cus_x",
        event_name="ai_reply_overage", cap=5)
    await pg_session.commit()
    assert ok is False
    row = (await pg_session.execute(
        select(BotUsageCounter).where(BotUsageCounter.bot_id == bot_id)
    )).scalar_one()
    assert row.reported_overage == 5  # inchangé
    assert calls == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_overage_consume_stripe_error_avalee(pg_session, monkeypatch):
    """Un hoquet Stripe (StripeError) est AVALÉ : le compteur local fait foi."""
    async def _boom(**k):
        raise qs.stripe_service.StripeError("boom")

    monkeypatch.setattr(qs.stripe_service, "report_meter_event", _boom)
    bot_id = await _seed_bot(pg_session, "ov-err@test.dev")
    await pg_session.commit()

    ok = await qs.ai_overage_consume(
        pg_session, bot_id=bot_id, customer_id="cus_x",
        event_name="ai_reply_overage", cap=5)
    await pg_session.commit()
    # Réponse servie malgré l'échec Stripe ; compteur local incrémenté.
    assert ok is True
    row = (await pg_session.execute(
        select(BotUsageCounter).where(BotUsageCounter.bot_id == bot_id)
    )).scalar_one()
    assert row.reported_overage == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_overage_consume_concurrent_no_lost_update(pg_engine, monkeypatch):
    """ATOMICITÉ : deux consume concurrents du MÊME bot au bord du plafond (4/5)
    -> exactement UN succès, compteur final == 5 (plafond enforce, pas de
    lost-update ni de double meter event). Sous l'ancien read-modify-write les
    deux liraient 4 et écriraient 5 => 2 succès + sous-facturation. Impossible à
    prouver sous FakeSession (with_for_update no-op, pas de SQL atomique)."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    reports = []

    async def _report(event_name, customer_id, value=1, identifier=None):
        reports.append(identifier)

    monkeypatch.setattr(qs.stripe_service, "report_meter_event", _report)

    Session = async_sessionmaker(pg_engine, class_=AsyncSession,
                                 expire_on_commit=False)
    async with Session() as seed:
        bot_id = await _seed_bot(seed, "ov-race@test.dev")
        seed.add(BotUsageCounter(bot_id=bot_id, period=qs.quota_period(),
                                 reported_overage=4,
                                 period_start=qs._month_start_utc()))
        await seed.commit()

    async def _worker():
        async with Session() as s:
            ok = await qs.ai_overage_consume(
                s, bot_id=bot_id, customer_id="cus_x",
                event_name="ai_reply_overage", cap=5)
            await s.commit()
            return ok

    import asyncio
    results = await asyncio.gather(_worker(), _worker())

    assert sorted(results) == [False, True]      # un seul crédit accordé
    assert len(reports) == 1                       # un seul meter event
    async with Session() as check:
        row = (await check.execute(
            select(BotUsageCounter).where(BotUsageCounter.bot_id == bot_id)
        )).scalar_one()
        assert row.reported_overage == 5           # plafond exact, pas de dérive


# --- _project_bot PRÉSERVE overage_mode/overage_cap (choix owner) --------

@pytest.mark.asyncio
async def test_project_bot_preserve_overage(monkeypatch):
    """Le reprojet webhook ne réinitialise PAS le dépassement armé par l'owner."""
    db = FakeSession()
    # Entitlement existant : owner a armé le dépassement (meter, cap 300).
    row = Obj(bot_id=3, modules=[MODULE_AI], ai_monthly_quota=1000,
              overage_mode="meter", overage_cap=300, status="active",
              source="stripe", trial_end=None, synced_at=None)
    monkeypatch.setattr(es, "_load", _aretval(row))

    # Sub active couvrant le bot (plan IA managé) : reprojette modules/quota/status.
    sub = Obj(status="active", raw_items=[
        {"bot_id": 3, "code": "ai_starter", "price_id": "price_ai", "qty": 1}])
    products = {"price_ai": Obj(kind="ai_tier", included_replies=1000)}

    await es._project_bot(db, 3, [sub], products, trial_end=None)
    # overage_mode/overage_cap INCHANGÉS (jamais touchés par _project_bot).
    assert row.overage_mode == "meter"
    assert row.overage_cap == 300


# --- Endpoint POST /api/bots/{id}/overage --------------------------------

@pytest.mark.asyncio
async def test_endpoint_overage_billing_off(client, overrides, db, current_user,
                                            billing_off):
    """Billing OFF => {billing: disabled} (200, aucune mutation)."""
    from src.models.bot import Bot
    current_user.id = 5
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B"))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": True, "cap": 100})
    assert resp.status_code == 200
    assert resp.json() == {"billing": "disabled"}


@pytest.mark.asyncio
async def test_endpoint_overage_metering_unavailable(client, overrides, db,
                                                     current_user, billing_on,
                                                     monkeypatch):
    """metering_enabled() faux => 409 metering_unavailable."""
    from src.models.bot import Bot
    from src.routers import billing as billing_router
    monkeypatch.setattr(billing_router.stripe_service, "metering_enabled",
                        lambda: False)
    current_user.id = 5
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B"))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": True, "cap": None})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "metering_unavailable"


@pytest.mark.asyncio
async def test_endpoint_overage_not_applicable_byok(client, overrides, db,
                                                    current_user, billing_on,
                                                    monkeypatch):
    """Bot BYOK => 409 overage_not_applicable (jamais métré)."""
    from src.models.bot import Bot
    from src.routers import billing as billing_router
    monkeypatch.setattr(billing_router.stripe_service, "metering_enabled",
                        lambda: True)
    current_user.id = 5
    # api_key_mode=byok => resolve() pose byok=True.
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B",
                api_key_mode="byok"))
    db.seed(_ent_row(bot_id=1, quota=1000))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": True, "cap": 50})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "overage_not_applicable"


@pytest.mark.asyncio
async def test_endpoint_overage_not_applicable_no_ai(client, overrides, db,
                                                     current_user, billing_on,
                                                     monkeypatch):
    """Pas de plan IA managé (quota 0/None) => 409 overage_not_applicable."""
    from src.models.bot import Bot
    from src.routers import billing as billing_router
    monkeypatch.setattr(billing_router.stripe_service, "metering_enabled",
                        lambda: True)
    current_user.id = 5
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B"))
    db.seed(_ent_row(bot_id=1, quota=0, modules=[MODULE_RAG]))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": True, "cap": 50})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "overage_not_applicable"


@pytest.mark.asyncio
async def test_endpoint_overage_owner_only(client, overrides, db, current_user,
                                           billing_on):
    """Un user non-owner du bot perso => 404 (require_billing_owner)."""
    from src.models.bot import Bot
    current_user.id = 5
    db.seed(Bot(id=2, owner_user_id=6, organization_id=None, name="X"))
    async with client as c:
        resp = await c.post("/api/bots/2/overage", json={"enabled": True, "cap": 100})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_endpoint_overage_enable_upsert(client, overrides, db, current_user,
                                              billing_on, monkeypatch):
    """MOCK : enabled=True => overage_mode='meter', overage_cap posé ; réponse a la
    forme entitlement (overage_mode/overage_enabled/overage_cap/metering_available)."""
    from src.models.bot import Bot
    from src.models.billing import BotEntitlement
    from src.routers import billing as billing_router
    monkeypatch.setattr(billing_router.stripe_service, "metering_enabled",
                        lambda: True)
    current_user.id = 5
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B"))
    db.seed(_ent_row(bot_id=1, quota=1000))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": True, "cap": 250})
    assert resp.status_code == 200
    data = resp.json()
    assert data["overage_mode"] == "meter"
    assert data["overage_enabled"] is True
    assert data["overage_cap"] == 250
    assert data["metering_available"] is True
    # La colonne a bien été écrite sur la ligne entitlement.
    row = [r for r in db.rows(BotEntitlement) if r.bot_id == 1][0]
    assert row.overage_mode == "meter"
    assert row.overage_cap == 250


@pytest.mark.asyncio
async def test_endpoint_overage_disable_cap_default(client, overrides, db,
                                                    current_user, billing_on,
                                                    monkeypatch):
    """enabled=False + cap null => overage_mode='block', cap = OVERAGE_CAP_DEFAULT."""
    from src.models.bot import Bot
    from src.models.billing import BotEntitlement
    from src.routers import billing as billing_router
    monkeypatch.setattr(billing_router.stripe_service, "metering_enabled",
                        lambda: True)
    current_user.id = 5
    db.seed(Bot(id=1, owner_user_id=5, organization_id=None, name="B"))
    db.seed(_ent_row(bot_id=1, quota=1000, overage_mode="meter", overage_cap=99))
    async with client as c:
        resp = await c.post("/api/bots/1/overage", json={"enabled": False, "cap": None})
    assert resp.status_code == 200
    data = resp.json()
    assert data["overage_mode"] == "block"
    assert data["overage_enabled"] is False
    assert data["overage_cap"] == OVERAGE_CAP_DEFAULT
    row = [r for r in db.rows(BotEntitlement) if r.bot_id == 1][0]
    assert row.overage_mode == "block"


# --- Helpers -------------------------------------------------------------

def _ent_row(bot_id=1, quota=1000, modules=None, overage_mode="block",
             overage_cap=None):
    """Ligne BotEntitlement seedable (plan IA managé actif par défaut)."""
    from src.models.billing import BotEntitlement
    return BotEntitlement(
        id=bot_id, bot_id=bot_id, modules=modules or [MODULE_AI],
        ai_monthly_quota=quota, overage_mode=overage_mode, overage_cap=overage_cap,
        status="active", source="stripe")
