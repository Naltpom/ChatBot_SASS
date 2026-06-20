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

def test_signature_valide():
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
    from src.routers import billing as billing_router

    captured = {}

    async def _capture(db, event):
        captured["event"] = event

    async def _noop_apply(db, event):
        return None

    monkeypatch.setattr(billing_router, "_sync_subscription_mirror", _capture)
    monkeypatch.setattr(billing_router, "apply_subscription_event", _noop_apply)

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
