"""Format de facture / regrouping (spec §4 / §7.3) :

- calcul de B(U) (bots facturables = perso ∪ bots des orgs OWNED) ;
- _scope_for_bot par format ; _config_to_codes (config -> codes catalogue) ;
- transitions PUT /api/billing/grouping (per_org 409 sans bot, MOCK no-op,
  idempotence target==courant) ;
- regrouping réel (MOCK_BILLING=False) : créer-puis-résilier, idempotence du
  re-appel (stripe_service monkeypatché, aucun appel réseau).
"""
import pytest

from conftest import FakeSession, FakeUser
from src.core.constants import MODULE_AI, MODULE_RAG
from src.routers import billing as bil
from src.routers.billing import (
    BotConfigPayload,
    _billable_bots,
    _config_to_codes,
    _scope_for_bot,
)


def _bot(id, owner_user_id=None, organization_id=None):
    from src.models.bot import Bot
    return Bot(id=id, owner_user_id=owner_user_id, organization_id=organization_id,
               name=f"bot{id}")


def _org(id, owner_user_id):
    from src.models.user import Organization
    return Organization(id=id, name=f"org{id}", owner_user_id=owner_user_id)


# --- B(U) : bots facturables du payeur -----------------------------------

@pytest.mark.asyncio
async def test_billable_bots_perso_et_org_owned(db: FakeSession):
    """B(U) = bots perso (owner_user_id==U) ∪ bots des orgs OWNED par U."""
    user = FakeUser(id=1)
    db.seed(_org(10, owner_user_id=1))      # owned par U
    db.seed(_org(20, owner_user_id=99))     # NON owned (un autre)
    db.seed(_bot(1, owner_user_id=1))                # perso de U -> inclus
    db.seed(_bot(2, organization_id=10))             # org owned -> inclus
    db.seed(_bot(3, organization_id=20))             # org d'un autre -> EXCLU
    db.seed(_bot(4, owner_user_id=2))                # perso d'un autre -> EXCLU

    bots = await _billable_bots(db, user)
    ids = sorted(b.id for b in bots)
    assert ids == [1, 2]


@pytest.mark.asyncio
async def test_billable_bots_admin_non_owner_ne_paie_pas(db: FakeSession):
    """Un admin non-owner d'une org ne facture PAS ses bots (c'est l'owner)."""
    user = FakeUser(id=2)  # membre/admin de l'org 10 mais owner = user 1
    db.seed(_org(10, owner_user_id=1))
    db.seed(_bot(2, organization_id=10))
    bots = await _billable_bots(db, user)
    assert bots == []


# --- _scope_for_bot -------------------------------------------------------

def test_scope_for_bot_total():
    assert _scope_for_bot("total", _bot(1, owner_user_id=1)) == ("user_all", None, None)


def test_scope_for_bot_per_bot():
    assert _scope_for_bot("per_bot", _bot(7, owner_user_id=1)) == ("bot", 7, None)


def test_scope_for_bot_per_org_equipe():
    assert _scope_for_bot("per_org", _bot(3, organization_id=10)) == ("org", None, 10)


def test_scope_for_bot_per_org_perso():
    assert _scope_for_bot("per_org", _bot(3, owner_user_id=1)) == ("user_personal", None, None)


# --- _config_to_codes : config -> codes catalogue ------------------------

def test_config_to_codes_managed_avec_addons():
    cfg = BotConfigPayload(modules=[MODULE_RAG], ai_tier_id="ai_growth", ai_byok=False)
    codes, modules = _config_to_codes(cfg)
    assert "base" in codes
    assert "ai_growth" in codes
    assert "mod_rag" in codes
    assert MODULE_AI in modules and MODULE_RAG in modules


def test_config_to_codes_byok():
    cfg = BotConfigPayload(modules=[], ai_tier_id=None, ai_byok=True)
    codes, modules = _config_to_codes(cfg)
    assert "mod_ai_byok" in codes
    assert "ai_growth" not in codes
    assert MODULE_AI in modules


def test_config_to_codes_arbre_seul():
    """Bot ARBRE seul (aucun plan IA) : seul `base` est dans les codes, sans IA.
    (Fin du gratuit à vie : `ai_free` supprimé du catalogue — point 7.)"""
    cfg = BotConfigPayload(modules=[], ai_tier_id=None, ai_byok=False)
    codes, modules = _config_to_codes(cfg)
    assert codes == ["base"]
    assert MODULE_AI not in modules


@pytest.mark.asyncio
async def test_line_items_socle_facture_seul_pour_bot_arbre(db: FakeSession):
    """Socle (9 €) facturé seul pour un bot arbre seul (aucun plan IA, point 6)."""
    from src.models.billing import BillingProduct
    db.seed(BillingProduct(code="base", label="Socle", kind="base",
                           unit_amount=900, is_active=True, stripe_price_id="price_base"))
    items = await bil._line_items_for_codes(db, ["base"])
    assert [it["code"] for it in items] == ["base"]


@pytest.mark.asyncio
async def test_line_items_socle_inclus_si_plan_ia(db: FakeSession):
    """Socle INCLUS (retiré des line_items) dès qu'un plan IA est pris : les prix
    IA ne changent pas, seul le plan IA est facturé (point 6)."""
    from src.models.billing import BillingProduct
    db.seed(BillingProduct(code="base", label="Socle", kind="base",
                           unit_amount=900, is_active=True, stripe_price_id="price_base"))
    db.seed(BillingProduct(code="ai_growth", label="IA Growth", kind="ai_tier",
                           unit_amount=3900, included_replies=3000, is_active=True,
                           stripe_price_id="price_growth"))
    items = await bil._line_items_for_codes(db, ["base", "ai_growth"])
    codes = [it["code"] for it in items]
    assert "base" not in codes          # socle inclus, pas de ligne séparée
    assert codes == ["ai_growth"]


# --- Intro 1er mois remisé : Checkout sans essai, carte if_required -------

@pytest.mark.asyncio
async def test_checkout_session_intro_remise_et_carte_if_required(monkeypatch):
    """create_checkout_session : plus d'essai gratuit -> intro 1er mois remisée
    (coupon `duration:once` via discounts) + carte if_required (demandée car
    montant dû, sautée si 100 %). PAS de allow_promotion_codes (Stripe l'interdit
    avec discounts)."""
    from src.services import stripe_service as svc

    monkeypatch.setattr(svc.settings, "MOCK_BILLING", False, raising=False)
    monkeypatch.setattr(svc.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)

    captured = {}

    async def _fake_request(method, path, data=None, params=None):
        captured["method"] = method
        captured["path"] = path
        captured["data"] = data
        return {"url": "https://checkout.stripe.test/cs_123"}

    monkeypatch.setattr(svc, "_stripe_request", _fake_request)

    url = await svc.create_checkout_session(
        customer_id="cus_1",
        line_items=[{"price": "price_growth", "quantity": 1}],
        bots_map={"7": ["ai_growth"]},
        group_key="total:1",
        user_id=1,
        intro_coupon="intro_growth_65",
    )
    assert url == "https://checkout.stripe.test/cs_123"
    data = captured["data"]
    # Plus d'essai gratuit ; carte seulement si montant dû ; intro via discounts.
    assert "subscription_data[trial_period_days]" not in data
    assert data["payment_method_collection"] == "if_required"
    assert data["discounts[0][coupon]"] == "intro_growth_65"
    assert "allow_promotion_codes" not in data
    assert data["mode"] == "subscription"


# --- PUT /api/billing/grouping : transitions -----------------------------

@pytest.mark.asyncio
async def test_grouping_billing_off_disabled(client, overrides, billing_off):
    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "per_bot"})
    assert resp.status_code == 200
    assert resp.json() == {"billing": "disabled"}


@pytest.mark.asyncio
async def test_grouping_per_org_409_sans_bot(client, overrides, db, current_user,
                                             billing_on):
    """per_org refusé (409) si 0 org owned ET 0 bot perso (spec §4.2)."""
    current_user.id = 1  # aucun bot, aucune org owned
    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "per_org"})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_grouping_mock_bascule_sans_stripe(client, overrides, db, current_user,
                                                 billing_on):
    """MOCK_BILLING : le format bascule sans toucher Stripe, entitlements intacts."""
    current_user.id = 1
    current_user.billing_grouping = "total"
    db.seed(_bot(1, owner_user_id=1))  # un bot perso facturable
    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "per_bot"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["billing_grouping"] == "per_bot"
    assert body["changed"] is True
    assert current_user.billing_grouping == "per_bot"


@pytest.mark.asyncio
async def test_grouping_idempotent_meme_format(client, overrides, db, current_user,
                                               billing_on):
    """target == format courant -> changed=False, aucune mutation."""
    current_user.id = 1
    current_user.billing_grouping = "total"
    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "total"})
    assert resp.status_code == 200
    assert resp.json() == {"billing_grouping": "total", "changed": False}


# --- Regrouping réel (MOCK_BILLING=False) : créer-puis-résilier ----------

@pytest.mark.asyncio
async def test_grouping_reel_cree_puis_resilie(client, overrides, db, current_user,
                                               monkeypatch):
    """Stripe « réel » mocké : passage total -> per_bot crée 1 sub/bot et résilie
    l'ancienne sub user_all (créer-puis-résilier, préserve les entitlements)."""
    from src.models.billing import BillingProduct, BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)

    # Catalogue : base (0 €, pas de ligne) + mod_rag (facturable, price seedé).
    db.seed(BillingProduct(code="base", label="Base", kind="base", unit_amount=0,
                           stripe_price_id=None))
    db.seed(BillingProduct(code="mod_rag", label="RAG", kind="module",
                           unit_amount=900, stripe_price_id="price_rag"))

    current_user.id = 1
    current_user.billing_grouping = "total"
    current_user.stripe_customer_id = "cus_1"
    db.seed(_bot(1, owner_user_id=1))
    # Sub existante (total) couvrant le bot 1 avec mod_rag.
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_old", grouping="total",
        scope_kind="user_all", status="active",
        raw_items=[{"si_id": "si_1", "price_id": "price_rag", "code": "mod_rag",
                    "bot_id": 1, "qty": 1}]))

    created, canceled, expired = [], [], []

    async def _create_sub(customer_id, items, metadata=None):
        created.append((items, metadata))
        return {"id": f"sub_new_{len(created)}", "status": "active"}

    async def _cancel(subscription_id, prorate=False):
        canceled.append((subscription_id, prorate))

    async def _expire(customer_id):
        expired.append(customer_id)

    monkeypatch.setattr(bil.stripe_service, "create_subscription", _create_sub)
    monkeypatch.setattr(bil.stripe_service, "cancel_subscription", _cancel)
    monkeypatch.setattr(bil.stripe_service, "expire_open_checkout_sessions", _expire)

    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "per_bot"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["billing_grouping"] == "per_bot"
    # 1 nouvelle sub créée (per_bot -> 1 par bot), l'ancienne résiliée avec proration.
    assert len(created) == 1
    assert ("sub_old", True) in canceled
    # Ancienne sub marquée canceled localement.
    old = [s for s in db.rows(BillingSubscription)
           if s.stripe_subscription_id == "sub_old"][0]
    assert old.status == "canceled"


@pytest.mark.asyncio
async def test_grouping_reel_resiliation_proration(client, overrides, db, current_user,
                                                   monkeypatch):
    """L'ancienne sub est résiliée AVEC proration (prorate=True), jamais sèche."""
    from src.models.billing import BillingProduct, BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)
    db.seed(BillingProduct(code="base", label="Base", kind="base", unit_amount=0))
    db.seed(BillingProduct(code="mod_rag", label="RAG", kind="module",
                           unit_amount=900, stripe_price_id="price_rag"))

    current_user.id = 1
    current_user.billing_grouping = "per_bot"
    current_user.stripe_customer_id = "cus_1"
    db.seed(_bot(1, owner_user_id=1))
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_a", grouping="per_bot",
        scope_kind="bot", scope_bot_id=1, status="active",
        raw_items=[{"si_id": "si_1", "price_id": "price_rag", "code": "mod_rag",
                    "bot_id": 1, "qty": 1}]))

    prorations = []

    async def _cancel(subscription_id, prorate=False):
        prorations.append(prorate)

    async def _create_sub(customer_id, items, metadata=None):
        return {"id": "sub_total", "status": "active"}

    async def _expire(customer_id):
        return None

    monkeypatch.setattr(bil.stripe_service, "cancel_subscription", _cancel)
    monkeypatch.setattr(bil.stripe_service, "create_subscription", _create_sub)
    monkeypatch.setattr(bil.stripe_service, "expire_open_checkout_sessions", _expire)

    async with client as c:
        resp = await c.put("/api/billing/grouping", json={"grouping": "total"})
    assert resp.status_code == 200, resp.text
    assert prorations == [True]  # résiliation AVEC proration


# --- POST /billing/subscription/update : changement de plan AU PRORATA ----

@pytest.mark.asyncio
async def test_subscription_update_billing_off_disabled(client, overrides, billing_off):
    """Billing OFF (invariant D0) : aucune route billing active."""
    async with client as c:
        resp = await c.post("/api/billing/subscription/update",
                            json={"bot_id": 1, "config": {"modules": []}})
    assert resp.status_code == 200
    assert resp.json() == {"billing": "disabled"}


@pytest.mark.asyncio
async def test_subscription_update_prorata_via_items(client, overrides, db,
                                                     current_user, monkeypatch):
    """Vrai Stripe : modifier le plan d'un bot souscrit aligne les items AU PRORATA
    (update_subscription_items proration_behavior='always_invoice' hors essai :
    prorata facturé tout de suite), PAS de portail. Renvoie {status:'updated'}
    (point 1, règle 1)."""
    from src.models.billing import BillingProduct, BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)

    # Catalogue : base 9 € + mod_rag (déjà souscrit) + mod_inbox (ajouté).
    db.seed(BillingProduct(code="base", label="Socle", kind="base",
                           unit_amount=900, stripe_price_id="price_base"))
    db.seed(BillingProduct(code="mod_rag", label="RAG", kind="module",
                           unit_amount=900, stripe_price_id="price_rag"))
    db.seed(BillingProduct(code="mod_inbox", label="Inbox", kind="module",
                           unit_amount=1900, stripe_price_id="price_inbox"))

    current_user.id = 1
    current_user.stripe_customer_id = "cus_1"
    db.seed(_bot(1, owner_user_id=1))
    # Sub active couvrant le bot 1 avec base + mod_rag.
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_1", grouping="per_bot",
        scope_kind="bot", scope_bot_id=1, status="active",
        raw_items=[
            {"si_id": "si_base", "price_id": "price_base", "code": "base",
             "bot_id": 1, "qty": 1},
            {"si_id": "si_rag", "price_id": "price_rag", "code": "mod_rag",
             "bot_id": 1, "qty": 1}]))

    captured = {}

    async def _update_items(subscription_id, target_items, proration_behavior="x"):
        captured["sub"] = subscription_id
        captured["items"] = target_items
        captured["proration"] = proration_behavior
        return {"id": subscription_id}

    monkeypatch.setattr(bil.stripe_service, "update_subscription_items", _update_items)

    # Nouvelle config : on garde RAG, on ajoute INBOX (upgrade).
    async with client as c:
        resp = await c.post("/api/billing/subscription/update",
                            json={"bot_id": 1,
                                  "config": {"modules": ["rag", "inbox"]}})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "updated"}
    assert captured["sub"] == "sub_1"
    assert captured["proration"] == "always_invoice"  # PRORATA facturé maintenant (hors essai)
    # L'item RAG existant est réutilisé (si_id porté), INBOX est ajouté.
    by_price = {it.get("price"): it for it in captured["items"] if it.get("price")}
    assert by_price["price_rag"].get("id") == "si_rag"
    assert "price_inbox" in by_price
    # Bot arbre seul (sans IA) -> base reste facturé et porté.
    assert "price_base" in by_price


@pytest.mark.asyncio
async def test_subscription_update_downgrade_supprime_item(client, overrides, db,
                                                          current_user, monkeypatch):
    """Downgrade : un module retiré de la config est PROGRAMMÉ en fin de période
    (schedule_subscription_downgrade, phase 2 SANS le module retiré, sans crédit),
    PAS supprimé immédiatement — et aucune modification immédiate de la sub."""
    from src.models.billing import BillingProduct, BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)
    db.seed(BillingProduct(code="base", label="Socle", kind="base",
                           unit_amount=900, stripe_price_id="price_base"))
    db.seed(BillingProduct(code="mod_rag", label="RAG", kind="module",
                           unit_amount=900, stripe_price_id="price_rag"))
    db.seed(BillingProduct(code="mod_inbox", label="Inbox", kind="module",
                           unit_amount=1900, stripe_price_id="price_inbox"))

    current_user.id = 1
    current_user.stripe_customer_id = "cus_1"
    db.seed(_bot(1, owner_user_id=1))
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_1", grouping="per_bot",
        scope_kind="bot", scope_bot_id=1, status="active",
        raw_items=[
            {"si_id": "si_base", "price_id": "price_base", "code": "base",
             "bot_id": 1, "qty": 1},
            {"si_id": "si_rag", "price_id": "price_rag", "code": "mod_rag",
             "bot_id": 1, "qty": 1},
            {"si_id": "si_inbox", "price_id": "price_inbox", "code": "mod_inbox",
             "bot_id": 1, "qty": 1}]))

    captured = {}
    updated_now = []

    async def _update_items(subscription_id, target_items, proration_behavior="x"):
        updated_now.append(target_items)
        return {"id": subscription_id}

    async def _schedule_downgrade(subscription_id, phase_items):
        captured["sub"] = subscription_id
        captured["phase_items"] = phase_items
        return {"id": "sub_sched_1"}

    monkeypatch.setattr(bil.stripe_service, "update_subscription_items", _update_items)
    monkeypatch.setattr(bil.stripe_service, "schedule_subscription_downgrade",
                        _schedule_downgrade)

    # On retire INBOX (downgrade) : garde rag.
    async with client as c:
        resp = await c.post("/api/billing/subscription/update",
                            json={"bot_id": 1, "config": {"modules": ["rag"]}})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "updated"}
    # Aucun ajout/swap -> pas de modification IMMÉDIATE de la sub (pas de facture).
    assert updated_now == []
    # Retrait DIFFÉRÉ : phase 2 programmée SANS inbox (base + rag conservés).
    assert captured["sub"] == "sub_1"
    phase_prices = {it["price"]: it.get("quantity") for it in captured["phase_items"]}
    assert phase_prices == {"price_base": 1, "price_rag": 1}
    assert "price_inbox" not in phase_prices


@pytest.mark.asyncio
async def test_subscription_update_sans_sub_needs_checkout(client, overrides, db,
                                                          current_user, monkeypatch):
    """Bot SANS sub active (Checkout annulé/abandonné, point 3) : update relance le
    Checkout -> {status:'needs_checkout', checkout_url}."""
    from src.models.billing import BillingProduct
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)
    db.seed(BillingProduct(code="base", label="Socle", kind="base",
                           unit_amount=900, stripe_price_id="price_base"))
    db.seed(BillingProduct(code="mod_rag", label="RAG", kind="module",
                           unit_amount=900, stripe_price_id="price_rag"))

    current_user.id = 1
    current_user.stripe_customer_id = "cus_1"
    db.seed(_bot(1, owner_user_id=1))  # aucune BillingSubscription

    async def _expire(customer_id):
        return None

    async def _checkout(**kw):
        return "https://checkout.stripe.test/relance"

    monkeypatch.setattr(bil.stripe_service, "expire_open_checkout_sessions", _expire)
    monkeypatch.setattr(bil.stripe_service, "create_checkout_session", _checkout)

    async with client as c:
        resp = await c.post("/api/billing/subscription/update",
                            json={"bot_id": 1, "config": {"modules": ["rag"]}})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "needs_checkout"
    assert body["checkout_url"] == "https://checkout.stripe.test/relance"


@pytest.mark.asyncio
async def test_subscription_update_mock_inactive_needs_checkout(client, overrides, db,
                                                               current_user, billing_on):
    """MOCK : un bot jamais souscrit (entitlement 'inactive') -> needs_checkout
    (point 3), il ne bascule pas 'updated' aveuglément."""
    from src.models.billing import BotEntitlement
    current_user.id = 1
    db.seed(_bot(1, owner_user_id=1))
    db.seed(BotEntitlement(bot_id=1, modules=[], ai_monthly_quota=0,
                           status="inactive", source="stripe"))
    async with client as c:
        resp = await c.post("/api/billing/subscription/update",
                            json={"bot_id": 1, "config": {"modules": ["rag"]}})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "needs_checkout"


# --- POST /billing/subscription/cancel : annulation fin de période --------

@pytest.mark.asyncio
async def test_subscription_cancel_billing_off_disabled(client, overrides, billing_off):
    async with client as c:
        resp = await c.post("/api/billing/subscription/cancel", json={"bot_id": 1})
    assert resp.status_code == 200
    assert resp.json() == {"billing": "disabled"}


@pytest.mark.asyncio
async def test_subscription_cancel_pose_cancel_at_period_end(client, overrides, db,
                                                            current_user, monkeypatch):
    """Annuler = fin de période (cancel_at_period_end=true), AUCUN remboursement.
    Renvoie {status:'cancel_scheduled', current_period_end} (point 2, règle 2)."""
    from src.models.billing import BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)

    current_user.id = 1
    db.seed(_bot(1, owner_user_id=1))
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_1", grouping="per_bot",
        scope_kind="bot", scope_bot_id=1, status="active",
        raw_items=[{"si_id": "si_1", "price_id": "price_rag", "code": "mod_rag",
                    "bot_id": 1, "qty": 1}]))

    captured = {}

    async def _cape(subscription_id):
        captured["sub"] = subscription_id
        return {"id": subscription_id, "current_period_end": 1893456000}

    monkeypatch.setattr(bil.stripe_service, "cancel_at_period_end", _cape)

    async with client as c:
        resp = await c.post("/api/billing/subscription/cancel", json={"bot_id": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"status": "cancel_scheduled", "current_period_end": 1893456000}
    assert captured["sub"] == "sub_1"
    # Miroir local marqué.
    sub = [s for s in db.rows(BillingSubscription)
           if s.stripe_subscription_id == "sub_1"][0]
    assert sub.cancel_at_period_end is True


@pytest.mark.asyncio
async def test_subscription_cancel_par_subscription_id(client, overrides, db,
                                                      current_user, monkeypatch):
    """On peut cibler la sub par subscription_id (doit appartenir au payeur)."""
    from src.models.billing import BillingSubscription
    monkeypatch.setattr(bil.settings, "STRIPE_SECRET_KEY", "rk_test", raising=False)
    monkeypatch.setattr(bil.settings, "STRIPE_WEBHOOK_SECRET", "whsec", raising=False)
    monkeypatch.setattr(bil.settings, "MOCK_BILLING", False, raising=False)
    current_user.id = 1
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_1", grouping="total",
        scope_kind="user_all", status="active", raw_items=[]))

    async def _cape(subscription_id):
        return {"id": subscription_id, "current_period_end": 1893456000}

    monkeypatch.setattr(bil.stripe_service, "cancel_at_period_end", _cape)

    async with client as c:
        resp = await c.post("/api/billing/subscription/cancel",
                            json={"subscription_id": "sub_1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "cancel_scheduled"


@pytest.mark.asyncio
async def test_subscription_cancel_sans_sub_404(client, overrides, db,
                                               current_user, billing_on):
    """Aucun abonnement actif à annuler -> 404."""
    current_user.id = 1
    db.seed(_bot(1, owner_user_id=1))
    async with client as c:
        resp = await c.post("/api/billing/subscription/cancel", json={"bot_id": 1})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_subscription_cancel_mock_marque_sub(client, overrides, db,
                                                  current_user, billing_on):
    """MOCK_BILLING : cancel_at_period_end ne fait aucun appel sortant, marque la
    sub locale et renvoie current_period_end depuis le miroir."""
    import calendar as _cal
    from datetime import datetime

    from src.models.billing import BillingSubscription
    current_user.id = 1
    db.seed(_bot(1, owner_user_id=1))
    cpe = datetime(2030, 1, 1)
    db.seed(BillingSubscription(
        user_id=1, stripe_subscription_id="sub_mock_1", grouping="per_bot",
        scope_kind="bot", scope_bot_id=1, status="active",
        current_period_end=cpe,
        raw_items=[{"si_id": "si_1", "price_id": "price_rag", "code": "mod_rag",
                    "bot_id": 1, "qty": 1}]))

    async with client as c:
        resp = await c.post("/api/billing/subscription/cancel", json={"bot_id": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancel_scheduled"
    assert body["current_period_end"] == _cal.timegm(cpe.utctimetuple())
