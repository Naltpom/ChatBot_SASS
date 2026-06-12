"""Webhook Stripe : seule source de verite pour APPLIQUER un plan paye.

Pas d'auth Bearer : l'authentification est la signature Stripe-Signature
(HMAC-SHA256 sur le corps BRUT, verifiee par stripe_service). Les handlers
sont idempotents (set de champs) : une re-livraison d'evenement est sans effet.
Le webhook applique le plan paye (la realite du paiement prime) PUIS force la
mise en conformite des bots (_enforce_plan_limits) : un downgrade via le
portail ne laisse ni bots excedentaires actifs, ni BYOK hors plan, ni IA sur
un plan tree_only.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.models.bot import Bot
from src.models.user import PLANS, Organization
from src.services import stripe_service
from src.services.stripe_service import StripeError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/billing", tags=["billing"])


async def _resolve_org(db: AsyncSession, metadata: dict,
                       customer_id: Optional[str]) -> Optional[Organization]:
    """Org visee par l'evenement : metadata[org_id] en priorite, sinon lookup
    par stripe_customer_id. Fetch verrouille (serialise avec change_plan)."""
    org_id = None
    try:
        org_id = int(metadata.get("org_id", ""))
    except (TypeError, ValueError):
        pass
    if org_id is not None:
        org = (await db.execute(
            select(Organization).where(Organization.id == org_id).with_for_update()
        )).scalar_one_or_none()
        if org is not None:
            return org
    if customer_id:
        return (await db.execute(
            select(Organization).where(Organization.stripe_customer_id == customer_id).with_for_update()
        )).scalar_one_or_none()
    return None


async def _enforce_plan_limits(db: AsyncSession, org: Organization, plan: str) -> None:
    """Mise en conformite forcee des bots apres un plan applique par webhook
    (les garde-fous de change_plan ne s'appliquent pas au portail Stripe) :
    - bots excedentaires desactives (ordre created_at, on garde les premiers)
    - api_key_mode byok -> managed si le plan cible n'a pas l'option
    - mode -> tree si le plan est tree_only (« free reste tree-only »)
    Les arbres trop grands restent en l'etat : bloques a la prochaine ecriture
    par _check_plan_constraints. L'appelant commit."""
    limits = PLANS[plan]
    bots = (await db.execute(
        select(Bot).where(Bot.organization_id == org.id).order_by(Bot.created_at)
    )).scalars().all()
    changed: list[str] = []
    for i, bot in enumerate(bots):
        if i >= limits["max_bots"] and bot.is_active:
            bot.is_active = False
            changed.append(f"{bot.name} : désactivé (limite {limits['max_bots']} bots)")
        if bot.api_key_mode == "byok" and not limits.get("byok"):
            bot.api_key_mode = "managed"
            changed.append(f"{bot.name} : BYOK -> clé managée")
        if limits.get("tree_only") and bot.mode != "tree":
            bot.mode = "tree"
            changed.append(f"{bot.name} : mode -> tree")
    if changed:
        logger.warning("Org %s : mise en conformité plan %s — %s",
                       org.id, plan, " ; ".join(changed))


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    if not stripe_service.billing_enabled():
        # Masque l'existence de l'endpoint quand le billing est desactive
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Facturation non configurée")

    payload = await request.body()  # corps BRUT, jamais de modele Pydantic ici
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe_service.verify_webhook_signature(payload, sig)
    except StripeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Signature de webhook invalide")

    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    metadata = obj.get("metadata") or {}

    if event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        # Paiement differe (SEPA...) : completed peut arriver payment_status
        # 'unpaid' -> on n'applique le plan qu'une fois PAYE.
        # async_payment_succeeded porte les memes metadata et repasse ici.
        if obj.get("payment_status") != "paid":
            logger.info("Webhook %s : paiement en attente (payment_status=%s), plan non appliqué",
                        event_type, obj.get("payment_status"))
            return {"received": True}
        org = await _resolve_org(db, metadata, obj.get("customer"))
        if org is None:
            logger.warning("Webhook %s : organisation introuvable (metadata=%s)", event_type, metadata)
            return {"received": True}
        plan = metadata.get("plan")
        if plan not in PLANS or PLANS[plan]["price"] == 0:
            logger.error("Webhook checkout : plan invalide '%s' (org %s)", plan, org.id)
            return {"received": True}
        new_sub = obj.get("subscription")
        old_sub = org.stripe_subscription_id
        org.plan = plan
        org.stripe_customer_id = org.stripe_customer_id or obj.get("customer")
        org.stripe_subscription_id = new_sub or old_sub
        await _enforce_plan_limits(db, org, plan)
        # Commit AVANT l'appel Stripe eventuel : libere le row lock
        await db.commit()
        if old_sub and new_sub and old_sub != new_sub:
            # Double checkout (deux onglets, retry) : resilier l'ancienne
            # subscription sinon elle facture indefiniment sans etre trackee.
            # Non bloquant (handler idempotent, l'echec est logge).
            try:
                await stripe_service.cancel_subscription(old_sub)
                logger.info("Org %s : ancienne subscription %s résiliée (remplacée par %s)",
                            org.id, old_sub, new_sub)
            except StripeError:
                logger.error("Org %s : résiliation de l'ancienne subscription %s impossible",
                             org.id, old_sub)
        logger.info("Org %s passée au plan %s (checkout)", org.id, plan)

    elif event_type == "customer.subscription.updated":
        org = await _resolve_org(db, metadata, obj.get("customer"))
        if org is None:
            logger.warning("Webhook %s : organisation introuvable (metadata=%s)", event_type, metadata)
            return {"received": True}
        sub_id = obj.get("id")
        if org.stripe_subscription_id and sub_id != org.stripe_subscription_id:
            # Subscription orpheline (ancien double checkout en cours de
            # resiliation) : elle ne doit pas reprendre la main sur le plan
            logger.warning("Webhook %s : subscription %s ignorée (org %s suit %s)",
                           event_type, sub_id, org.id, org.stripe_subscription_id)
            return {"received": True}
        sub_status = obj.get("status")
        items = ((obj.get("items") or {}).get("data")) or [{}]
        price_id = ((items[0].get("price")) or {}).get("id")
        if sub_status in ("active", "trialing"):
            plan = stripe_service.plan_for_price(price_id) if price_id else None
            if plan:
                org.plan = plan
                org.stripe_subscription_id = sub_id
                await _enforce_plan_limits(db, org, plan)
                await db.commit()
                logger.info("Org %s synchronisée au plan %s (subscription %s)", org.id, plan, sub_status)
        elif sub_status in ("canceled", "unpaid", "incomplete_expired"):
            org.plan = "free"
            org.stripe_subscription_id = None
            await _enforce_plan_limits(db, org, "free")
            await db.commit()
            logger.info("Org %s repassée au plan free (subscription %s)", org.id, sub_status)
        # Autres statuts (past_due, cancel_at_period_end...) : no-op, on attend deleted

    elif event_type == "customer.subscription.deleted":
        org = await _resolve_org(db, metadata, obj.get("customer"))
        if org is None:
            logger.warning("Webhook %s : organisation introuvable (metadata=%s)", event_type, metadata)
            return {"received": True}
        if org.stripe_subscription_id and obj.get("id") != org.stripe_subscription_id:
            # Resiliation d'une subscription orpheline (reconciliation double
            # checkout) : l'abonnement suivi reste actif, ne pas downgrader
            logger.info("Webhook %s : subscription orpheline %s ignorée (org %s suit %s)",
                        event_type, obj.get("id"), org.id, org.stripe_subscription_id)
            return {"received": True}
        org.plan = "free"
        org.stripe_subscription_id = None
        await _enforce_plan_limits(db, org, "free")
        await db.commit()
        logger.info("Org %s repassée au plan free (subscription supprimée)", org.id)

    # Tout autre type d'evenement : no-op, ack quand meme (pas de retry Stripe)
    return {"received": True}
