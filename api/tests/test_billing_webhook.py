"""Webhook Stripe (spec §3.6 / §7.3) :

- signature valide -> applique (200) ; invalide -> 400 ; expirée -> 400 ;
- corps brut lu AVANT parse JSON (la signature porte sur les octets exacts) ;
- idempotence par event.id (billing_webhook_events) ;
- subscription.deleted révoque ; subscription.updated resync ;
- D1 : un `deleted` pendant un regrouping ne révoque PAS (état NET = union des
  subs actives couvrant le bot).

verify_webhook_signature est testée en VRAI HMAC (jamais mockée).
"""
import pytest

from conftest import (
    FakeSession,
    Obj,
    sign_stripe,
    stripe_event,
    to_bytes,
)
from src.core.constants import MODULE_RAG
from src.services import entitlement_service as es
from src.services import stripe_service


# --- Signature : valide / invalide / expirée (VRAI HMAC) ------------------

def test_signature_valide(monkeypatch):
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET", "whsec_abc")
    body = b'{"hello":"world"}'
    sig = sign_stripe(body, "whsec_abc")
    out = stripe_service.verify_webhook_signature(body, sig)
    assert out == {"hello": "world"}


def test_signature_invalide(monkeypatch):
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET", "whsec_abc")
    body = b'{"a":1}'
    # Signature calculée avec un AUTRE secret -> rejet.
    sig = sign_stripe(body, "whsec_WRONG")
    with pytest.raises(stripe_service.StripeError):
        stripe_service.verify_webhook_signature(body, sig)


def test_signature_absente(monkeypatch):
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET", "whsec_abc")
    with pytest.raises(stripe_service.StripeError):
        stripe_service.verify_webhook_signature(b"{}", None)


def test_signature_expiree(monkeypatch):
    """t hors tolérance (300 s) -> rejet anti-rejeu."""
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET", "whsec_abc")
    body = b'{"a":1}'
    sig = sign_stripe(body, "whsec_abc", ts=1)  # epoch=1 -> très ancien
    with pytest.raises(stripe_service.StripeError):
        stripe_service.verify_webhook_signature(body, sig, tolerance=300)


def test_signature_malformee(monkeypatch):
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET", "whsec_abc")
    with pytest.raises(stripe_service.StripeError):
        stripe_service.verify_webhook_signature(b"{}", "garbage_header")


# --- Endpoint : corps brut, billing OFF no-op, signature -----------------

@pytest.mark.asyncio
async def test_webhook_corps_brut_signe(client, overrides, db, billing_on, monkeypatch):
    """La signature porte sur les BYTES exacts envoyés (request.body() avant JSON)."""
    # PR-20 : l'orchestration (miroir + projection) vit dans stripe_webhook_service ;
    # le handler HTTP délègue. On patche donc les fonctions sur le SERVICE.
    from src.services import stripe_webhook_service

    captured = {}

    async def _capture(db, event):
        captured["event"] = event

    async def _noop_apply(db, event):
        return None

    monkeypatch.setattr(stripe_webhook_service, "_sync_subscription_mirror", _capture)
    monkeypatch.setattr(stripe_webhook_service, "apply_subscription_event", _noop_apply)

    ev = stripe_event("customer.subscription.updated", event_id="evt_42")
    body = to_bytes(ev)
    sig = sign_stripe(body, "whsec_test_xxx")
    async with client as c:
        resp = await c.post("/api/billing/webhook", content=body,
                            headers={"Stripe-Signature": sig})
    assert resp.status_code == 200
    assert captured["event"]["id"] == "evt_42"


@pytest.mark.asyncio
async def test_webhook_billing_off_noop(client, overrides, monkeypatch):
    """E1 : billing OFF -> no-op APRÈS vérif signature (réversibilité R2 propre).

    Webhook secret présent (la signature reste vérifiée) mais SECRET_KEY absente
    => billing_enabled()==False => le webhook accuse réception sans appliquer."""
    monkeypatch.setattr(stripe_service.settings, "STRIPE_SECRET_KEY", None, raising=False)
    monkeypatch.setattr(stripe_service.settings, "STRIPE_WEBHOOK_SECRET",
                        "whsec_off", raising=False)
    body = to_bytes(stripe_event("customer.subscription.updated"))
    sig = sign_stripe(body, "whsec_off")
    async with client as c:
        resp = await c.post("/api/billing/webhook", content=body,
                            headers={"Stripe-Signature": sig})
    assert resp.status_code == 200
    assert resp.json().get("billing") == "disabled"


# --- apply_subscription_event : idempotence / deleted / updated ----------

def _products():
    """Index price->product comme _product_index (Obj avec .kind/.included_replies)."""
    return {
        "price_rag": Obj(stripe_price_id="price_rag", code="mod_rag", kind="module",
                         included_replies=None),
        "price_growth": Obj(stripe_price_id="price_growth", code="ai_growth",
                            kind="ai_tier", included_replies=3000),
    }


def _seed_products(db: FakeSession):
    from src.models.billing import BillingProduct
    db.seed(
        BillingProduct(stripe_price_id="price_rag", code="mod_rag", kind="module",
                       included_replies=None, label="RAG", unit_amount=900),
        BillingProduct(stripe_price_id="price_growth", code="ai_growth",
                       kind="ai_tier", included_replies=3000, label="Growth",
                       unit_amount=3900),
    )


def _sub(db: FakeSession, *, user_id=1, sub_id="sub_1", status="active", items):
    from src.models.billing import BillingSubscription
    s = BillingSubscription(user_id=user_id, stripe_subscription_id=sub_id,
                            grouping="total", scope_kind="user_all",
                            status=status, raw_items=items)
    db.seed(s)
    return s


@pytest.mark.asyncio
async def test_updated_resync_projette_module(db: FakeSession, monkeypatch):
    """subscription.updated : la sub miroir porte mod_rag -> entitlement gagne RAG."""
    _seed_products(db)
    _sub(db, items=[{"si_id": "si_1", "price_id": "price_rag",
                     "code": "mod_rag", "bot_id": 7, "qty": 1}])
    ev = stripe_event("customer.subscription.updated", sub_id="sub_1",
                      event_id="evt_u1")
    await es.apply_subscription_event(db, ev)

    from src.models.billing import BotEntitlement
    ents = db.rows(BotEntitlement)
    assert len(ents) == 1
    assert ents[0].bot_id == 7
    assert MODULE_RAG in ents[0].modules
    assert ents[0].status == "active"


@pytest.mark.asyncio
async def test_trialing_projette_status_trialing_et_trial_end(db: FakeSession):
    """Essai AVEC carte : un abonnement Stripe `trialing` (carte posée au Checkout)
    -> entitlement status='trialing' + trial_end = subscription.trial_end (epoch s
    Stripe -> datetime naïf UTC). Les modules de l'abonnement sont débloqués."""
    import calendar

    _seed_products(db)
    _sub(db, sub_id="sub_tr", status="trialing",
         items=[{"si_id": "si_1", "price_id": "price_rag",
                 "code": "mod_rag", "bot_id": 7, "qty": 1}])
    # trial_end ~ J+7 (epoch s) ; on le retrouve sur l'entitlement.
    trial_end_epoch = calendar.timegm((2026, 6, 27, 12, 0, 0, 0, 0, 0))
    ev = stripe_event("customer.subscription.updated", sub_id="sub_tr",
                      status_="trialing", event_id="evt_tr")
    ev["data"]["object"]["trial_end"] = trial_end_epoch
    await es.apply_subscription_event(db, ev)

    from src.models.billing import BotEntitlement
    ent = [e for e in db.rows(BotEntitlement) if e.bot_id == 7][0]
    assert ent.status == "trialing"
    assert MODULE_RAG in ent.modules
    assert ent.trial_end is not None
    assert calendar.timegm(ent.trial_end.utctimetuple()) == trial_end_epoch


@pytest.mark.asyncio
async def test_active_apres_debit_ignore_trial_end(db: FakeSession):
    """Statut Stripe 'active' (1er débit passé à J+7) -> status='active', trial_end
    effacé (point 9 : trial_end ignoré hors essai)."""
    _seed_products(db)
    _sub(db, sub_id="sub_ac", status="active",
         items=[{"si_id": "si_1", "price_id": "price_rag",
                 "code": "mod_rag", "bot_id": 7, "qty": 1}])
    ev = stripe_event("customer.subscription.updated", sub_id="sub_ac",
                      status_="active", event_id="evt_ac")
    # Même si Stripe renvoie encore un trial_end, il est ignoré une fois actif.
    ev["data"]["object"]["trial_end"] = 1_900_000_000
    await es.apply_subscription_event(db, ev)

    from src.models.billing import BotEntitlement
    ent = [e for e in db.rows(BotEntitlement) if e.bot_id == 7][0]
    assert ent.status == "active"
    assert ent.trial_end is None


@pytest.mark.asyncio
async def test_idempotence_event_id(db: FakeSession):
    """Le même event.id rejoué ne réapplique rien (billing_webhook_events)."""
    _seed_products(db)
    _sub(db, items=[{"si_id": "si_1", "price_id": "price_rag",
                     "code": "mod_rag", "bot_id": 7, "qty": 1}])
    ev = stripe_event("customer.subscription.updated", sub_id="sub_1",
                      event_id="evt_same")
    await es.apply_subscription_event(db, ev)
    from src.models.billing import BotEntitlement, BillingWebhookEvent
    n_after_first = len(db.rows(BotEntitlement))
    assert len(db.rows(BillingWebhookEvent)) == 1

    # Rejoue le même event : aucune nouvelle projection, pas de doublon d'event.
    await es.apply_subscription_event(db, ev)
    assert len(db.rows(BotEntitlement)) == n_after_first
    assert len(db.rows(BillingWebhookEvent)) == 1


@pytest.mark.asyncio
async def test_deleted_revoque_quand_plus_aucune_sub_active(db: FakeSession):
    """subscription.deleted, plus aucune sub active couvrant le bot -> dégradé.

    La ligne est conservée (source=stripe) mais vidée + status inactive."""
    _seed_products(db)
    # La sub portant le bot 7 est passée canceled (le miroir l'a déjà marquée).
    _sub(db, sub_id="sub_1", status="canceled",
         items=[{"si_id": "si_1", "price_id": "price_rag",
                 "code": "mod_rag", "bot_id": 7, "qty": 1}])
    # Entitlement actif préexistant à révoquer.
    from src.models.billing import BotEntitlement
    db.seed(BotEntitlement(bot_id=7, modules=[MODULE_RAG], ai_monthly_quota=0,
                           status="active", source="stripe"))
    ev = stripe_event("customer.subscription.deleted", sub_id="sub_1",
                      status_="canceled", event_id="evt_del")
    await es.apply_subscription_event(db, ev)

    ent = [e for e in db.rows(BotEntitlement) if e.bot_id == 7][0]
    assert ent.status == "inactive"
    assert ent.modules == []


@pytest.mark.asyncio
async def test_deleted_pendant_regrouping_ne_revoque_pas_etat_net(db: FakeSession):
    """D1 : un `deleted` sur sub_1 alors qu'une AUTRE sub active (sub_2) couvre
    encore le bot 7 -> état NET conserve le module (pas de révocation aveugle)."""
    _seed_products(db)
    # sub_1 supprimée mais sub_2 (active) couvre toujours le bot 7 avec mod_rag.
    _sub(db, sub_id="sub_1", status="canceled",
         items=[{"si_id": "si_1", "price_id": "price_rag",
                 "code": "mod_rag", "bot_id": 7, "qty": 1}])
    _sub(db, sub_id="sub_2", status="active",
         items=[{"si_id": "si_2", "price_id": "price_rag",
                 "code": "mod_rag", "bot_id": 7, "qty": 1}])
    ev = stripe_event("customer.subscription.deleted", sub_id="sub_1",
                      status_="canceled", event_id="evt_del2")
    await es.apply_subscription_event(db, ev)

    from src.models.billing import BotEntitlement
    ent = [e for e in db.rows(BotEntitlement) if e.bot_id == 7][0]
    assert ent.status == "active"
    assert MODULE_RAG in ent.modules


@pytest.mark.asyncio
async def test_event_sans_id_ignore(db: FakeSession):
    ev = {"type": "customer.subscription.updated", "data": {"object": {"id": "sub_x"}}}
    await es.apply_subscription_event(db, ev)  # ne lève pas
    from src.models.billing import BotEntitlement
    assert db.rows(BotEntitlement) == []


# --- Orchestration webhook (DB RÉELLE) : idempotence + garde d'ordre ------
#
# Ces deux axes exercent le COEUR revenue-critical du webhook (PR-20) sur un VRAI
# Postgres (pg_session) : la garde d'idempotence (event.id) et la garde d'ORDRE
# (champ Stripe `created`), cette dernière passant par la requête BORNÉE
# `_last_event_created_for_sub` (accès JSON SQL + ORDER BY created DESC LIMIT 1)
# que FakeSession ne sait pas exécuter (JSON/LIKE/ORDER BY neutralisés).

def _sub_event(event_id: str, sub_id: str, created: int, *, items: list,
               user_id: int, status_: str = "active",
               etype: str = "customer.subscription.updated") -> dict:
    return {
        "id": event_id, "type": etype, "created": created,
        "data": {"object": {
            "id": sub_id, "status": status_,
            "metadata": {"user_id": str(user_id)},
            "items": {"data": items},
        }},
    }


async def _seed_payer_bot_product(pg_session):
    """User payeur + 1 bot + le palier IA growth (price_growth). Renvoie (user, bot)."""
    from src.models.bot import Bot
    from src.models.billing import BillingProduct
    from src.models.user import User

    user = User(email="payer@test.dev", hashed_password="x", name="Payer")
    pg_session.add(user)
    await pg_session.flush()
    bot = Bot(name="B", owner_user_id=user.id)
    pg_session.add(bot)
    pg_session.add(BillingProduct(
        stripe_price_id="price_growth", code="ai_growth", kind="ai_tier",
        included_replies=3000, label="Growth", unit_amount=3900))
    await pg_session.commit()
    return user, bot


def _ai_item(bot_id: int) -> dict:
    return {"id": "si_1", "price": {"id": "price_growth"},
            "metadata": {"bot_id": str(bot_id)}, "quantity": 1}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_webhook_idempotence_real_db(pg_session):
    """Le MÊME event rejoué 2× n'est appliqué qu'UNE fois (idempotence event.id) :
    2e passage -> court-circuit {duplicate}, aucun doublon d'event, état stable."""
    from sqlalchemy import select
    from src.models.billing import BillingWebhookEvent, BotEntitlement
    from src.services import stripe_webhook_service as wh
    from src.core.constants import MODULE_AI

    user, bot = await _seed_payer_bot_product(pg_session)
    ev = _sub_event("evt_idem", "sub_1", 1000, items=[_ai_item(bot.id)],
                    user_id=user.id)

    r1 = await wh.process_webhook_event(pg_session, ev)
    assert r1 == {"received": True}
    events = (await pg_session.execute(select(BillingWebhookEvent))).scalars().all()
    assert len(events) == 1
    ent = (await pg_session.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
    )).scalar_one()
    assert ent.status == "active"
    assert MODULE_AI in ent.modules

    # Rejoue le MÊME event : court-circuit total (duplicate), aucune ré-application.
    r2 = await wh.process_webhook_event(pg_session, ev)
    assert r2 == {"received": True, "duplicate": True}
    events2 = (await pg_session.execute(select(BillingWebhookEvent))).scalars().all()
    assert len(events2) == 1


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_webhook_garde_ordre_real_db(pg_session):
    """Garde d'ordre : un event PLUS ANCIEN (created<) arrivant APRÈS un plus
    récent est IGNORÉ (stale) — l'état projeté par le récent est préservé.

    Exerce la requête bornée `_last_event_created_for_sub` sur Postgres."""
    from sqlalchemy import select
    from src.models.billing import BillingWebhookEvent, BotEntitlement
    from src.services import stripe_webhook_service as wh
    from src.core.constants import MODULE_AI

    user, bot = await _seed_payer_bot_product(pg_session)

    # (1) Event RÉCENT (created=2000) : active le plan IA sur le bot.
    ev_new = _sub_event("evt_new", "sub_1", 2000, items=[_ai_item(bot.id)],
                        user_id=user.id)
    assert await wh.process_webhook_event(pg_session, ev_new) == {"received": True}
    ent = (await pg_session.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
    )).scalar_one()
    assert MODULE_AI in ent.modules

    # (2) Event PLUS ANCIEN (created=1000, autre event_id, MÊME sub) qui — s'il
    #     était appliqué — viderait les items (perte de l'IA). Il doit être IGNORÉ.
    ev_old = _sub_event("evt_old", "sub_1", 1000, items=[], user_id=user.id)
    r = await wh.process_webhook_event(pg_session, ev_old)
    assert r == {"received": True, "stale": True}

    # État INCHANGÉ (IA conservée) + l'event ancien n'est PAS enregistré.
    await pg_session.refresh(ent)
    assert MODULE_AI in ent.modules
    events = (await pg_session.execute(select(BillingWebhookEvent))).scalars().all()
    assert {e.stripe_event_id for e in events} == {"evt_new"}
