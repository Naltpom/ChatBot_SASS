"""Stripe via l'API REST (httpx exclusivement, pas de SDK).

Facturation MODULAIRE (spec §2.4). Le billing est actif dès que les DEUX clés
sont posées (`billing_enabled()` = secret + webhook ; sortie du « tout-ou-rien
5 vars » — les price IDs vivent désormais dans `billing_products`, plus en .env).

Catalogue piloté en base : `price_id_for_code(code, db)` / `code_for_price(...)`
remplacent l'ancien mapping figé starter/pro/agence. Le Customer Stripe est
attaché au User (plus à l'Organization).

MOCK_BILLING (spec §2.3) : quand `settings.MOCK_BILLING` est vrai, ce service
N'ÉMET AUCUN appel sortant. Les fonctions retournent des URLs locales / des
identifiants `*_mock_*` pour que les e2e vérifient l'activation sans Stripe.
`verify_webhook_signature` reste INCHANGÉ (testé en vrai HMAC).

Aucune TVA (franchise en base, art. 293 B du CGI) : `automatic_tax`,
`tax_id_collection`, `billing_address_collection` NE SONT JAMAIS passés.
`payment_method_types` n'est JAMAIS passé (dynamic payment methods).

La verification de signature webhook (Stripe-Signature) est faite a la main :
HMAC-SHA256 sur "{timestamp}.{corps brut}" avec STRIPE_WEBHOOK_SECRET.
"""
import hashlib
import hmac
import json
import logging
import time
import uuid
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.billing import BillingProduct
from src.models.user import User

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"


class StripeError(Exception):
    pass


def billing_enabled() -> bool:
    """Billing actif dès que secret + webhook sont posés (spec §6.1).

    Sortie du « tout-ou-rien 5 vars » : les price IDs vivent dans
    `billing_products` (catalogue seedé), plus en config. Clés absentes
    ⇒ False ⇒ resolver ALL_UNLOCKED (invariant D0 : app 100 % gratuite)."""
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_WEBHOOK_SECRET)


def metering_enabled() -> bool:
    """Axe IA métré actif (Phase 2). v1 = blocage au quota (toujours False)."""
    return billing_enabled() and settings.BILLING_METERING_ENABLED


async def price_id_for_code(code: str, db: AsyncSession) -> Optional[str]:
    """Price ID Stripe d'un code catalogue (lookup `billing_products`).

    Remplace l'ancien `price_id_for(plan)` figé. None si code inconnu, produit
    inactif ou price non seedé (`seed_billing_catalog.py` pose stripe_price_id)."""
    row = (await db.execute(
        select(BillingProduct).where(
            BillingProduct.code == code,
            BillingProduct.is_active.is_(True),
        )
    )).scalar_one_or_none()
    return row.stripe_price_id if row else None


async def code_for_price(price_id: str, db: AsyncSession) -> Optional[str]:
    """Inverse de price_id_for_code (sync webhook subscription.updated).

    Remplace l'ancien `plan_for_price`. None si le price n'est dans aucun
    `billing_products`."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.stripe_price_id == price_id)
    )).scalar_one_or_none()
    return row.code if row else None


async def _stripe_request(method: str, path: str,
                          data: Optional[dict] = None,
                          params: Optional[dict] = None) -> dict:
    """Appel REST Stripe (corps form-encode, cles imbriquees style metadata[x])."""
    headers = {"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.request(method, f"{STRIPE_API_BASE}{path}",
                                        headers=headers, data=data, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("Stripe %s : %s", e.response.status_code, e.response.text[:500])
        raise StripeError("Le service de paiement a renvoyé une erreur")
    except httpx.HTTPError as e:
        logger.error("Stripe injoignable : %s", e)
        raise StripeError("Service de paiement injoignable")


async def create_customer(user: User, email: Optional[str]) -> str:
    """Cree le Customer Stripe du USER -> cus_... (l'appelant stocke et commit).

    Le Customer est attaché au User (spec §1.1, plus à l'Organization).
    `metadata[user_id]` permet au webhook de remonter au payeur.
    MOCK_BILLING ⇒ identifiant local `cus_mock_<uuid>` (aucun appel sortant)."""
    if settings.MOCK_BILLING:
        return f"cus_mock_{uuid.uuid4().hex[:16]}"
    data = await _stripe_request("POST", "/customers", data={
        "name": user.name,
        "email": email or user.email or "",
        "metadata[user_id]": str(user.id),
    })
    return data["id"]


async def create_checkout_session(
    customer_id: str,
    line_items: list[dict],
    bots_map: dict[str, list[str]],
    group_key: str,
    user_id: int,
    trial_period_days: Optional[int] = None,
) -> str:
    """Session de checkout abonnement -> URL de paiement hebergee par Stripe.

    Réécrit (spec §2.4, corrige A1) : plusieurs `line_items` (1 par produit :
    base + plan IA + add-ons), chacun `[{"price": "price_...", "quantity": 1}]`.

    Checkout ne propage AUCUN metadata par line_item ⇒ la cartographie complète
    bot→modules est sérialisée dans `subscription_data[metadata][bots]` (JSON).
    Le webhook `checkout.session.completed` / `subscription.updated` la relit.

    Socle-inclusion (point 6) : ce service ne fabrique JAMAIS de line_item — il
    pose tels quels les `line_items` que l'appelant a construits. La règle « base
    facturé seul / inclus dès qu'un plan IA est pris » est donc appliquée en amont
    (`billing._line_items_for_codes`) : aucune ligne `base` n'arrive ici quand un
    plan IA est présent. Les prix unitaires des plans IA ne sont jamais modifiés.

    PAS de TVA (franchise en base) : ni automatic_tax, ni tax_id_collection, ni
    billing_address_collection. PAS de payment_method_types (dynamic methods).
    `customer_update[name]=auto` met à jour le nom du Customer depuis le paiement.

    MOCK_BILLING ⇒ URL locale, aucun appel Stripe (l'entitlement est appliqué
    directement par l'appelant / le routeur, simulant le webhook)."""
    if settings.MOCK_BILLING:
        return (f"{settings.APP_URL}/app/billing?checkout=success"
                f"&mock_session=cs_test_{uuid.uuid4().hex[:16]}")

    data: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        # A1 : AUCUN metadata par line_item (Checkout ne le propage pas).
        "subscription_data[metadata][bots]": json.dumps(bots_map, separators=(",", ":")),
        "subscription_data[metadata][group_key]": group_key,
        "subscription_data[metadata][user_id]": str(user_id),
        "success_url": (f"{settings.APP_URL}/app/billing"
                        f"?checkout=success&session_id={{CHECKOUT_SESSION_ID}}"),
        "cancel_url": f"{settings.APP_URL}/app/billing?checkout=cancelled",
        # MAJ du nom du Customer depuis l'étape de paiement.
        "customer_update[name]": "auto",
        # PAS de payment_method_types / automatic_tax / tax_id_collection /
        # billing_address_collection (dynamic methods + franchise en base TVA).
    }
    for i, item in enumerate(line_items):
        data[f"line_items[{i}][price]"] = item["price"]
        data[f"line_items[{i}][quantity]"] = str(item.get("quantity", 1))
    if trial_period_days:
        data["subscription_data[trial_period_days]"] = str(trial_period_days)

    resp = await _stripe_request("POST", "/checkout/sessions", data=data)
    return resp["url"]


async def create_subscription(
    customer_id: str,
    items: list[dict],
    metadata: Optional[dict[str, str]] = None,
) -> dict:
    """Crée une subscription par API (subs 2..n des formats per_bot/per_org).

    Contrairement au Checkout, `items[n][metadata][bot_id]` EST propagé vers les
    subscription_items (corrige A1, privilégié dès la 2e sub). `items` =
    [{"price": "price_...", "quantity": 1, "metadata": {"bot_id": "42",
    "module": "mod_rag"}}].

    PAS de TVA (automatic_tax non passé). MOCK_BILLING ⇒ objet sub factice."""
    if settings.MOCK_BILLING:
        return {"id": f"sub_mock_{uuid.uuid4().hex[:16]}", "status": "active",
                "items": {"data": [{"id": f"si_mock_{uuid.uuid4().hex[:12]}",
                                    "price": {"id": it["price"]}} for it in items]}}

    data: dict[str, Any] = {"customer": customer_id}
    for i, item in enumerate(items):
        data[f"items[{i}][price]"] = item["price"]
        data[f"items[{i}][quantity]"] = str(item.get("quantity", 1))
        for mk, mv in (item.get("metadata") or {}).items():
            data[f"items[{i}][metadata][{mk}]"] = str(mv)
    for mk, mv in (metadata or {}).items():
        data[f"metadata[{mk}]"] = str(mv)
    return await _stripe_request("POST", "/subscriptions", data=data)


async def update_subscription_items(
    subscription_id: str,
    target_items: list[dict],
    proration_behavior: str = "create_prorations",
) -> Optional[dict]:
    """Aligne les items d'une sub sur la liste cible (ajout/retrait/quantité).

    `target_items` = [{"id": "si_..."?, "price": "price_...", "quantity": 1,
    "deleted": bool?, "metadata": {...}}]. Si la liste cible est VIDE (0 item),
    Stripe refuse une sub sans item ⇒ on RÉSILIE (corrige D4, garde §2.4).

    MOCK_BILLING ⇒ no-op (retourne None)."""
    if not target_items:
        await cancel_subscription(subscription_id, prorate=True)
        return None
    if settings.MOCK_BILLING:
        return None

    data: dict[str, Any] = {"proration_behavior": proration_behavior}
    for i, item in enumerate(target_items):
        if item.get("id"):
            data[f"items[{i}][id]"] = item["id"]
        if item.get("deleted"):
            data[f"items[{i}][deleted]"] = "true"
            continue
        if item.get("price"):
            data[f"items[{i}][price]"] = item["price"]
        data[f"items[{i}][quantity]"] = str(item.get("quantity", 1))
        for mk, mv in (item.get("metadata") or {}).items():
            data[f"items[{i}][metadata][{mk}]"] = str(mv)
    return await _stripe_request("POST", f"/subscriptions/{subscription_id}", data=data)


async def create_portal_session(customer_id: str) -> str:
    """Portail client Stripe (downgrade, resiliation, moyens de paiement).
    MOCK_BILLING ⇒ URL locale, aucun appel sortant (spec §2.3)."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
    })
    return data["url"]


async def create_update_portal_session(customer_id: str, subscription_id: str,
                                       price_id: str) -> str:
    """Portail EPINGLE sur le changement vers `price_id` (flow
    subscription_update_confirm) : le client ne peut pas y choisir un autre
    price que celui deja valide par les garde-fous de l'appelant.

    `price_id` est résolu par l'appelant via `price_id_for_code(code, db)`
    (catalogue en base). MOCK_BILLING ⇒ URL locale."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    if not price_id:
        raise StripeError("Price Stripe manquant pour le changement d'abonnement")
    # L'item de l'abonnement (si_...) est requis par le flow de confirmation
    sub = await _stripe_request("GET", f"/subscriptions/{subscription_id}")
    items = (sub.get("items") or {}).get("data") or []
    if not items:
        raise StripeError("Abonnement Stripe sans item")
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
        "flow_data[type]": "subscription_update_confirm",
        "flow_data[subscription_update_confirm][subscription]": subscription_id,
        "flow_data[subscription_update_confirm][items][0][id]": items[0]["id"],
        "flow_data[subscription_update_confirm][items][0][price]": price_id,
        "flow_data[subscription_update_confirm][items][0][quantity]": "1",
    })
    return data["url"]


async def create_cancel_portal_session(customer_id: str, subscription_id: str) -> str:
    """Portail EPINGLE sur la resiliation (retour au free) : le webhook
    customer.subscription.deleted appliquera le plan. MOCK_BILLING ⇒ URL locale."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
        "flow_data[type]": "subscription_cancel",
        "flow_data[subscription_cancel][subscription]": subscription_id,
    })
    return data["url"]


async def cancel_subscription(subscription_id: str, prorate: bool = False) -> None:
    """Resilie une subscription. `prorate=True` ⇒ proration de fin (crédit du
    temps non consommé, regrouping §4.2) ; sinon résiliation immédiate sèche
    (reconciliation anti double abonnement apres un second checkout).

    L'appelant decide si une StripeError est bloquante (le webhook la loggue
    sans bloquer, pour rester idempotent). MOCK_BILLING ⇒ no-op."""
    if settings.MOCK_BILLING:
        return
    params = {"prorate": "true"} if prorate else None
    await _stripe_request("DELETE", f"/subscriptions/{subscription_id}", params=params)


async def expire_open_checkout_sessions(customer_id: str) -> None:
    """Expire les sessions de checkout encore ouvertes du customer : une seule
    session payable a la fois (deux onglets ou un retry ne peuvent pas aboutir
    a deux abonnements payes). MOCK_BILLING ⇒ no-op."""
    if settings.MOCK_BILLING:
        return
    data = await _stripe_request("GET", "/checkout/sessions",
                                 params={"customer": customer_id, "status": "open", "limit": 10})
    for session in data.get("data", []):
        await _stripe_request("POST", f"/checkout/sessions/{session['id']}/expire")


async def list_invoices(customer_id: Optional[str] = None, limit: int = 24) -> list[dict]:
    """Factures depuis l'API Stripe (a la demande, pas de table locale).
    Sans customer_id : toutes les factures du compte (vue staff agregee).
    MOCK_BILLING ⇒ liste vide (aucune facture réelle simulée)."""
    if settings.MOCK_BILLING:
        return []
    params: dict[str, Any] = {"limit": limit}
    if customer_id:
        params["customer"] = customer_id
    data = await _stripe_request("GET", "/invoices", params=params)
    # Clés du contrat Invoice (front) : amount_paid_cents (PAS amount_paid brut),
    # created en epoch SECONDES. Stripe exprime déjà amount_paid en centimes.
    return [{
        "id": inv.get("id"),
        "number": inv.get("number"),
        "status": inv.get("status"),
        "amount_paid_cents": inv.get("amount_paid") or 0,
        "currency": inv.get("currency"),
        "created": inv.get("created"),  # epoch SECONDES (brut Stripe), conforme au front
        "hosted_invoice_url": inv.get("hosted_invoice_url"),
        "invoice_pdf": inv.get("invoice_pdf"),
        # customer (cus_...) : neutre pour la vue payeur (filtrée par customer_id),
        # indispensable a la vue staff agregee pour mapper facture -> payeur.
        "customer": inv.get("customer"),
    } for inv in data.get("data", [])]


async def update_product(product_id: str, name: Optional[str] = None,
                         active: Optional[bool] = None,
                         description: Optional[str] = None) -> dict:
    """Met à jour un Product Stripe (POST /v1/products/{id}). Les Products sont
    MUTABLES (contrairement aux Prices) : on édite `name` / `active` /
    `description` en place.

    `description` (texte commercial affiché sur le Product Stripe / Checkout) est
    poussé tel quel quand fourni — None ⇒ champ non touché. `active=False` masque
    le produit (le Price associé doit être désactivé à part, via
    `deactivate_price`). MOCK_BILLING ⇒ no-op (retourne {})."""
    if settings.MOCK_BILLING:
        return {}
    data: dict[str, Any] = {}
    if name is not None:
        data["name"] = name
    if active is not None:
        data["active"] = "true" if active else "false"
    if description is not None:
        data["description"] = description
    if not data:
        return {}
    return await _stripe_request("POST", f"/products/{product_id}", data=data)


async def create_price(product_id: str, unit_amount: int, currency: str,
                       interval: str, code: str,
                       description: Optional[str] = None) -> dict:
    """Crée un NOUVEAU Price récurrent (POST /v1/prices) pour un product existant.

    Les Prices Stripe sont IMMUABLES : un changement de montant ne se fait JAMAIS
    en place — on crée un nouveau Price (ce helper) puis on désactive l'ancien
    (`deactivate_price`). `recurring[usage_type]=licensed` (les produits métrés ne
    sont pas vendus en v1).

    `description` n'est PAS un champ de Price (Stripe le porte sur le Product) :
    quand fourni, on le pousse sur le Product parent (POST /v1/products/{id})
    pour garder la description à jour lors d'un changement de prix. MOCK_BILLING
    ⇒ identifiant local `price_mock_<uuid>`."""
    if settings.MOCK_BILLING:
        return {"id": f"price_mock_{uuid.uuid4().hex[:16]}"}
    if description is not None:
        await update_product(product_id, description=description)
    return await _stripe_request("POST", "/prices", data={
        "product": product_id,
        "currency": currency,
        "unit_amount": str(unit_amount),
        "recurring[interval]": interval,
        "recurring[usage_type]": "licensed",
        "metadata[code]": code,
    })


async def deactivate_price(price_id: str) -> dict:
    """Désactive un Price (POST /v1/prices/{id} {active:false}). Seul `active` est
    mutable sur un Price ; le montant ne l'est jamais (cf. `create_price`).
    MOCK_BILLING ⇒ no-op (retourne {})."""
    if settings.MOCK_BILLING:
        return {}
    return await _stripe_request("POST", f"/prices/{price_id}", data={"active": "false"})


def verify_webhook_signature(payload: bytes, sig_header: Optional[str], tolerance: int = 300) -> dict:
    """Verifie le header "Stripe-Signature: t=<epoch>,v1=<hex>[,v1=...]" puis
    retourne l'evenement decode. Leve StripeError si signature absente,
    perimee (anti-rejeu, tolerance en secondes) ou invalide."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret or not sig_header:
        raise StripeError("Signature de webhook absente")

    timestamp: Optional[str] = None
    signatures: list[str] = []
    for part in sig_header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not signatures:
        raise StripeError("Signature de webhook malformée")

    try:
        ts = int(timestamp)
    except ValueError:
        raise StripeError("Signature de webhook malformée")
    if abs(time.time() - ts) > tolerance:
        raise StripeError("Signature de webhook expirée")

    signed = f"{timestamp}.".encode() + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, sig) for sig in signatures):
        raise StripeError("Signature de webhook invalide")

    return json.loads(payload)
