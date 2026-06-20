"""Console admin facturation (SUPERADMIN UNIQUEMENT) — vue opérateur sur
les payeurs, leurs abonnements, leurs bots et les factures Stripe du compte.

SÉCURITÉ : ce router porte `dependencies=[Depends(require_superadmin)]` (vérif
CÔTÉ SERVEUR, identique à `routers/admin.py`). Le front masque EN PLUS la nav.

INVARIANT billing-OFF (D0) : si `billing_enabled() == False` (clés Stripe
absentes), TOUTES les routes renvoient `{"billing": "disabled"}` (200) — aucune
mutation, aucun crash. L'entitlement d'un bot est alors projeté « tout débloqué »
(resolver RÈGLE 1), jamais lu depuis Stripe.

Stripe en httpx pur via `services/stripe_service` (jamais de SDK). Catalogue lu
en base (`billing_products`) et modules validés contre `MODULE_KEYS` (parité D4).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import MODULE_AI, MODULE_KEYS
from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.models.billing import BillingProduct, BillingSubscription, BotEntitlement
from src.models.bot import Bot
from src.models.user import Organization, User
from src.services import stripe_service

logger = logging.getLogger("billing")

router = APIRouter(
    prefix="/api/admin",
    tags=["admin-billing"],
    dependencies=[Depends(require_superadmin)],
)

# Réponse standard quand le billing est OFF (clés Stripe absentes — invariant D0).
_DISABLED = {"billing": "disabled"}

# Statuts de subscription Stripe considérés « actifs » (aligné entitlement_service).
_ACTIVE_SUB_STATUSES = {"active", "trialing", "past_due"}


# --- Payloads -------------------------------------------------------------

class EntitlementOverride(BaseModel):
    """Override manuel staff d'un entitlement bot (sans Stripe)."""
    modules: list[str] = Field(default_factory=list)   # sous-ensemble de MODULE_KEYS
    ai_monthly_quota: Optional[int] = None             # None = illimité ; >=0 sinon
    status: Optional[str] = Field(None, pattern="^(active|past_due|canceled|inactive)$")


# --- GET /api/admin/billing/overview --------------------------------------

@router.get("/billing/overview")
async def billing_overview(db: AsyncSession = Depends(get_db)):
    """Vue agrégée des payeurs : MRR, statut, abonnements, bots facturables.

    Un PAYEUR = un User ayant un `stripe_customer_id` OU au moins une
    `billing_subscription`. Pour chacun :
    - `monthly_cents` = somme (unit_amount × qty) des items des subs ACTIVES (via
      raw_items × prix `billing_products`). BYOK inclus, métré (mtr_*) exclu.
    - `status` = active si ≥1 sub active/trialing, past_due si seulement past_due,
      sinon none.
    - `bots` = bots perso (owner_user_id) ∪ bots des orgs dont il est owner.
    `mrr_cents` = somme des `monthly_cents` des payeurs avec ≥1 sub active.

    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    # Index prix Stripe -> produit (montant + kind), pour valoriser raw_items.
    products = (await db.execute(select(BillingProduct))).scalars().all()
    product_by_price = {p.stripe_price_id: p for p in products if p.stripe_price_id}

    # Toutes les subs, groupées par payeur.
    subs = (await db.execute(select(BillingSubscription))).scalars().all()
    subs_by_user: dict[int, list[BillingSubscription]] = {}
    for s in subs:
        subs_by_user.setdefault(s.user_id, []).append(s)

    # Payeurs = users avec customer Stripe OU au moins une sub.
    payer_ids = set(subs_by_user.keys())
    customers = (await db.execute(
        select(User).where(User.stripe_customer_id.is_not(None))
    )).scalars().all()
    users_by_id: dict[int, User] = {u.id: u for u in customers}
    payer_ids |= {u.id for u in customers}

    missing = payer_ids - set(users_by_id.keys())
    if missing:
        for u in (await db.execute(
            select(User).where(User.id.in_(list(missing)))
        )).scalars().all():
            users_by_id[u.id] = u

    payers: list[dict] = []
    mrr_cents = 0
    for uid in sorted(payer_ids):
        user = users_by_id.get(uid)
        if user is None:
            continue  # payeur fantôme (user supprimé) : ignoré
        user_subs = subs_by_user.get(uid, [])

        # Statut agrégé du payeur.
        statuses = {s.status for s in user_subs}
        if statuses & {"active", "trialing"}:
            payer_status = "active"
        elif "past_due" in statuses:
            payer_status = "past_due"
        else:
            payer_status = "none"

        # monthly_cents : somme des items des subs ACTIVES (métré exclu).
        monthly_cents = 0
        active_sub_count = 0
        for s in user_subs:
            if s.status not in _ACTIVE_SUB_STATUSES:
                continue
            active_sub_count += 1
            for item in (s.raw_items or []):
                product = product_by_price.get(item.get("price_id"))
                if product is None or product.kind == "metered":
                    continue  # produit inconnu ou métré : hors abonnement récurrent
                monthly_cents += product.unit_amount * int(item.get("qty", 1) or 1)

        if payer_status == "active":
            mrr_cents += monthly_cents

        # Bots facturables du payeur : perso ∪ orgs dont il est owner.
        owned_org_ids = (await db.execute(
            select(Organization.id).where(Organization.owner_user_id == uid)
        )).scalars().all()
        conditions = [Bot.owner_user_id == uid]
        if owned_org_ids:
            conditions.append(Bot.organization_id.in_(list(owned_org_ids)))
        bots = (await db.execute(
            select(Bot).where(or_(*conditions)).order_by(Bot.created_at)
        )).scalars().all()

        # Entitlements de ces bots (une requête).
        bot_ids = [b.id for b in bots]
        ent_by_bot: dict[int, BotEntitlement] = {}
        if bot_ids:
            for ent in (await db.execute(
                select(BotEntitlement).where(BotEntitlement.bot_id.in_(bot_ids))
            )).scalars().all():
                ent_by_bot[ent.bot_id] = ent

        bots_out = []
        for b in bots:
            ent = ent_by_bot.get(b.id)
            bots_out.append({
                "bot_id": b.id,
                "name": b.name,
                "scope": "personal" if b.owner_user_id else "team",
                "modules": sorted(ent.modules or []) if ent is not None else [],
                "ai_monthly_quota": ent.ai_monthly_quota if ent is not None else None,
                "status": ent.status if ent is not None else "none",
                "source": ent.source if ent is not None else "free",
            })

        payers.append({
            "user_id": uid,
            "email": user.email,
            "name": user.name,
            "stripe_customer_id": user.stripe_customer_id,
            "status": payer_status,
            "monthly_cents": monthly_cents,
            "subscription_count": active_sub_count,
            "bots": bots_out,
        })

    return {
        "currency": "eur",
        "mrr_cents": mrr_cents,
        "payers": payers,
    }


# --- GET /api/admin/billing/invoices --------------------------------------

@router.get("/billing/invoices")
async def billing_invoices(db: AsyncSession = Depends(get_db)):
    """Toutes les factures du compte Stripe (vue staff agrégée).

    TABLEAU bare `Invoice[]` (contrat front), pas l'enveloppe `{invoices:[...]}`.
    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED
    # customer_id=None ⇒ toutes les factures du compte (cf. stripe_service).
    # list_invoices projette `customer` (cus_...) : la vue staff l'utilise pour
    # mapper chaque facture à son payeur. setdefault = garde défensive si absent.
    invoices = await stripe_service.list_invoices(customer_id=None)
    for inv in invoices:
        inv.setdefault("customer", None)
    return invoices


# --- GET /api/admin/bots/{bot_id}/entitlement -----------------------------

@router.get("/bots/{bot_id}/entitlement")
async def get_bot_entitlement(bot_id: int, db: AsyncSession = Depends(get_db)):
    """Entitlement brut d'un bot (ligne `bot_entitlements`), ou valeurs
    ALL_UNLOCKED projetées si billing OFF (resolver RÈGLE 1).

    Superadmin only (court-circuite require_billing_owner : vue opérateur sur
    n'importe quel bot)."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")

    if not stripe_service.billing_enabled():
        # ALL_UNLOCKED projeté : tout débloqué, illimité, gratuit (D0).
        return {
            "bot_id": bot_id,
            "modules": list(MODULE_KEYS),
            "ai_monthly_quota": None,
            "overage_mode": "block",
            "status": "active",
            "source": "free",
        }

    row = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
    )).scalar_one_or_none()
    if row is None:
        # Pas de ligne (bot gratuit / legacy) : socle gratuit projeté.
        return {
            "bot_id": bot_id,
            "modules": [],
            "ai_monthly_quota": None,
            "overage_mode": "block",
            "status": "none",
            "source": "free",
        }
    return {
        "bot_id": bot_id,
        "modules": sorted(row.modules or []),
        "ai_monthly_quota": row.ai_monthly_quota,
        "overage_mode": row.overage_mode or "block",
        "status": row.status or "active",
        "source": row.source or "free",
    }


# --- POST /api/admin/bots/{bot_id}/entitlement ----------------------------

@router.post("/bots/{bot_id}/entitlement")
async def set_bot_entitlement(bot_id: int, body: EntitlementOverride,
                              db: AsyncSession = Depends(get_db)):
    """Override manuel staff de l'entitlement d'un bot (sans Stripe).

    Upsert la ligne `bot_entitlements` avec `source='staff'`. Valide
    `modules ⊂ MODULE_KEYS` et `ai_monthly_quota` (int ≥ 0 | null). Superadmin
    only. Billing OFF ⇒ {billing: disabled} (aucune mutation : le resolver
    renvoie ALL_UNLOCKED de toute façon, un override serait inerte)."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")

    # Validation modules ⊂ MODULE_KEYS (parité D4).
    unknown = [m for m in body.modules if m not in MODULE_KEYS]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Modules inconnus : {', '.join(unknown)}",
        )
    # Quota : None (illimité) ou entier >= 0.
    if body.ai_monthly_quota is not None and body.ai_monthly_quota < 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "ai_monthly_quota doit être >= 0 ou null (illimité)",
        )

    modules = sorted(set(body.modules))
    # Cohérence : le quota IA n'a de sens que si le module IA est débloqué. Si IA
    # absent, on force le quota à 0 (module IA absent, convention D4/B4).
    ai_quota = body.ai_monthly_quota
    if MODULE_AI not in modules:
        ai_quota = 0

    row = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
    )).scalar_one_or_none()
    if row is None:
        row = BotEntitlement(bot_id=bot_id)
        db.add(row)
    row.modules = modules
    row.ai_monthly_quota = ai_quota
    row.status = body.status or "active"
    row.source = "staff"
    row.synced_at = utcnow()
    await db.commit()

    return {
        "bot_id": bot_id,
        "modules": sorted(row.modules or []),
        "ai_monthly_quota": row.ai_monthly_quota,
        "overage_mode": row.overage_mode or "block",
        "status": row.status,
        "source": row.source,
    }
