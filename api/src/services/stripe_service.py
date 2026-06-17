"""Stripe via l'API REST (httpx exclusivement, pas de SDK).

DORMANT / parking-lot : la facturation est DESACTIVEE (application 100 %
gratuite) et AUCUNE route n'appelle ce service. Module, settings STRIPE_* et
colonnes stripe_* sont CONSERVES a dessein : le billing reviendra sous la forme
d'un modele « 1 plan + quota usage » (roadmap). Logique "tout-ou-rien" : ne
serait actif que si les 5 variables STRIPE_* etaient definies (cle secrete,
secret webhook, 3 price IDs).

ATTENTION — les plans starter/pro/agence n'existent PLUS : `price_id_for` /
`plan_for_price` les referencent encore comme PLACEHOLDERS inertes (jamais
appeles, ne plantent pas a l'import) et seront recables sur le futur plan
unique le jour ou la facturation est reactivee.

La verification de signature webhook (Stripe-Signature) est faite a la main :
HMAC-SHA256 sur "{timestamp}.{corps brut}" avec STRIPE_WEBHOOK_SECRET.
"""
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Optional

import httpx

from src.core.config import settings
from src.models.user import Organization

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"


class StripeError(Exception):
    pass


def billing_enabled() -> bool:
    """Billing actif uniquement si la config est COMPLETE (tout-ou-rien)."""
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_WEBHOOK_SECRET
                and settings.STRIPE_PRICE_STARTER and settings.STRIPE_PRICE_PRO
                and settings.STRIPE_PRICE_AGENCE)


def price_id_for(plan: str) -> Optional[str]:
    """Price ID Stripe d'un plan payant (None pour free / plan inconnu).

    PLACEHOLDER (parking-lot) : starter/pro/agence sont des plans SUPPRIMES, ce
    mapping est inerte (settings STRIPE_PRICE_* a None tant que billing dormant)
    et sera recable sur le plan unique a la reactivation. Aucun appelant cable.
    """
    return {
        "starter": settings.STRIPE_PRICE_STARTER,
        "pro": settings.STRIPE_PRICE_PRO,
        "agence": settings.STRIPE_PRICE_AGENCE,
    }.get(plan)


def plan_for_price(price_id: str) -> Optional[str]:
    """Inverse de price_id_for (sync webhook customer.subscription.updated).

    PLACEHOLDER (parking-lot) : itere sur les plans SUPPRIMES starter/pro/agence
    — inerte tant que la facturation est dormante. Aucun appelant cable.
    """
    for plan in ("starter", "pro", "agence"):
        if price_id_for(plan) == price_id:
            return plan
    return None


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


async def create_customer(org: Organization, email: Optional[str]) -> str:
    """Cree le customer Stripe de l'org -> cus_... (l'appelant stocke et commit)."""
    data = await _stripe_request("POST", "/customers", data={
        "name": org.name,
        "email": email or "",
        "metadata[org_id]": str(org.id),
    })
    return data["id"]


async def create_checkout_session(customer_id: str, plan: str, org_id: int) -> str:
    """Session de checkout abonnement -> URL de paiement hebergee par Stripe.
    org_id/plan en metadata (session ET subscription) : le webhook s'en sert
    pour appliquer le plan sans deviner."""
    data = await _stripe_request("POST", "/checkout/sessions", data={
        "mode": "subscription",
        "customer": customer_id,
        "line_items[0][price]": price_id_for(plan),
        "line_items[0][quantity]": "1",
        "success_url": f"{settings.APP_URL}/app/billing?checkout=success",
        "cancel_url": f"{settings.APP_URL}/app/billing?checkout=cancelled",
        "metadata[org_id]": str(org_id),
        "metadata[plan]": plan,
        "subscription_data[metadata][org_id]": str(org_id),
        "subscription_data[metadata][plan]": plan,
    })
    return data["url"]


async def create_portal_session(customer_id: str) -> str:
    """Portail client Stripe (downgrade, resiliation, moyens de paiement)."""
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
    })
    return data["url"]


async def create_update_portal_session(customer_id: str, subscription_id: str, plan: str) -> str:
    """Portail EPINGLE sur le changement vers `plan` (flow
    subscription_update_confirm) : le client ne peut pas y choisir un autre
    plan que celui deja valide par les garde-fous de change_plan."""
    price_id = price_id_for(plan)
    if not price_id:
        raise StripeError(f"Pas de price Stripe pour le plan {plan}")
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
    customer.subscription.deleted appliquera le plan."""
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
        "flow_data[type]": "subscription_cancel",
        "flow_data[subscription_cancel][subscription]": subscription_id,
    })
    return data["url"]


async def cancel_subscription(subscription_id: str) -> None:
    """Resilie immediatement une subscription (reconciliation anti double
    abonnement apres un second checkout). L'appelant decide si une StripeError
    est bloquante (le webhook la loggue sans bloquer, pour rester idempotent)."""
    await _stripe_request("DELETE", f"/subscriptions/{subscription_id}")


async def expire_open_checkout_sessions(customer_id: str) -> None:
    """Expire les sessions de checkout encore ouvertes du customer : une seule
    session payable a la fois (deux onglets ou un retry ne peuvent pas aboutir
    a deux abonnements payes)."""
    data = await _stripe_request("GET", "/checkout/sessions",
                                 params={"customer": customer_id, "status": "open", "limit": 10})
    for session in data.get("data", []):
        await _stripe_request("POST", f"/checkout/sessions/{session['id']}/expire")


async def list_invoices(customer_id: Optional[str] = None, limit: int = 24) -> list[dict]:
    """Factures depuis l'API Stripe (a la demande, pas de table locale).
    Sans customer_id : toutes les factures du compte (vue staff agregee)."""
    params: dict[str, Any] = {"limit": limit}
    if customer_id:
        params["customer"] = customer_id
    data = await _stripe_request("GET", "/invoices", params=params)
    return [{
        "id": inv.get("id"),
        "number": inv.get("number"),
        "status": inv.get("status"),
        "total": inv.get("total"),
        "amount_paid": inv.get("amount_paid"),
        "currency": inv.get("currency"),
        "created": inv.get("created"),  # epoch SECONDES (brut Stripe), conforme au front
        "hosted_invoice_url": inv.get("hosted_invoice_url"),
        "invoice_pdf": inv.get("invoice_pdf"),
        "customer": inv.get("customer"),
    } for inv in data.get("data", [])]


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
