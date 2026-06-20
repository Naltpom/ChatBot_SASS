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


class CatalogPatch(BaseModel):
    """Édition d'une ligne catalogue (billing_products) — hors montant.

    Tous les champs sont optionnels (PATCH partiel). `included_replies` accepte
    null (illimité / non applicable) ou un entier >= 0. `description` (texte
    commercial, poussé sur le Product Stripe) accepte une chaîne ou null (efface).
    Le MONTANT ne se change PAS ici (Prices Stripe immuables) : voir POST
    .../price."""
    label: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    included_replies: Optional[int] = Field(None, ge=0)


class CatalogPrice(BaseModel):
    """Changement de prix d'une ligne catalogue. unit_amount en CENTIMES (>= 0)."""
    unit_amount: int = Field(..., ge=0)


def _catalog_product(row: BillingProduct) -> dict:
    """Sérialise une ligne `billing_products` au format CatalogProduct (contrat
    front). `included_replies`/`stripe_*` peuvent être None."""
    return {
        "code": row.code,
        "label": row.label,
        "description": row.description,
        "kind": row.kind,
        "unit_amount": row.unit_amount,
        "currency": row.currency,
        "interval": row.interval,
        "included_replies": row.included_replies,
        "is_active": row.is_active,
        "stripe_product_id": row.stripe_product_id,
        "stripe_price_id": row.stripe_price_id,
    }


# --- GET /api/admin/billing/overview --------------------------------------

@router.get("/billing/overview")
async def billing_overview(db: AsyncSession = Depends(get_db)):
    """Vue agrégée des payeurs : MRR, statut, abonnements, bots facturables.

    Un PAYEUR = un User ayant un `stripe_customer_id`, au moins une
    `billing_subscription`, OU au moins un bot en ESSAI 7 j (status='trialing' —
    fin du gratuit à vie). Pour chacun :
    - `monthly_cents` = somme (unit_amount × qty) des items des subs ACTIVES (via
      raw_items × prix `billing_products`). BYOK inclus, métré (mtr_*) exclu. Un
      payeur EN ESSAI (aucune sub payante) a monthly_cents=0 (pas encore de carte).
    - `status` = active si ≥1 sub active/trialing, past_due si seulement past_due,
      'trialing' si pas de sub mais ≥1 bot en essai EN COURS, sinon none.
    - `bots` = bots perso (owner_user_id) ∪ bots des orgs dont il est owner.
    `mrr_cents` = somme des `monthly_cents` des payeurs avec ≥1 sub active (les
    essais ne contribuent PAS au MRR, monthly_cents=0).

    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    now = utcnow()

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

    # Payeurs en ESSAI sans sub ni customer : bots avec un entitlement trialing.
    # On résout le payeur de chaque bot (perso = owner_user_id ; équipe = owner de
    # l'org) pour qu'un compte qui n'a QUE des essais apparaisse dans l'overview.
    trial_bots = (await db.execute(
        select(Bot.owner_user_id, Organization.owner_user_id).select_from(
            BotEntitlement).join(Bot, Bot.id == BotEntitlement.bot_id).outerjoin(
            Organization, Organization.id == Bot.organization_id).where(
            BotEntitlement.status == "trialing")
    )).all()
    for bot_owner_id, org_owner_id in trial_bots:
        payer = bot_owner_id if bot_owner_id is not None else org_owner_id
        if payer is not None:
            payer_ids.add(payer)

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

        # monthly_cents : somme des items des subs ACTIVES (métré exclu). Un payeur
        # en simple essai (aucune sub) reste donc à 0 (pas encore de carte).
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

        # Essai EN COURS = au moins un bot status='trialing' non expiré (point 4).
        has_live_trial = any(
            e.status == "trialing" and e.trial_end is not None and e.trial_end > now
            for e in ent_by_bot.values()
        )

        # Statut agrégé du payeur : une sub payante prime ; sinon l'essai 7 j ;
        # sinon rien. monthly_cents reste 0 pendant l'essai (pas de carte).
        statuses = {s.status for s in user_subs}
        if statuses & {"active", "trialing"}:
            payer_status = "active"
        elif "past_due" in statuses:
            payer_status = "past_due"
        elif has_live_trial:
            payer_status = "trialing"
        else:
            payer_status = "none"

        if payer_status == "active":
            mrr_cents += monthly_cents

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


# --- GET /api/admin/billing/catalog ---------------------------------------

@router.get("/billing/catalog")
async def billing_catalog(db: AsyncSession = Depends(get_db)):
    """Catalogue local (`billing_products`) au format CatalogProduct[].

    TABLEAU bare (contrat front). Renvoie TOUJOURS les lignes locales — MÊME
    billing OFF : la console doit pouvoir visualiser/éditer le catalogue local
    (les colonnes stripe_* restent simplement NULL si jamais seedé)."""
    rows = (await db.execute(
        select(BillingProduct).order_by(BillingProduct.id)
    )).scalars().all()
    return [_catalog_product(r) for r in rows]


# --- PATCH /api/admin/billing/catalog/{code} -------------------------------

@router.patch("/billing/catalog/{code}")
async def patch_billing_catalog(code: str, body: CatalogPatch,
                                db: AsyncSession = Depends(get_db)):
    """Édite une ligne catalogue (label / description / is_active / included_replies).

    Met à jour `billing_products` (PATCH partiel : seuls les champs fournis).
    SI billing_enabled() ET la ligne a un stripe_product_id : POST
    /v1/products/{id} {name=label, description, active=is_active} (Product
    MUTABLE) ; si is_active passe à false, désactive AUSSI le Price (POST
    /v1/prices/{id} {active:false}). `included_replies` est app-side (quota),
    AUCUN équivalent Stripe. Renvoie le CatalogProduct mis à jour."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == code)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produit catalogue introuvable")

    fields = body.model_dump(exclude_unset=True)
    if "label" in fields:
        row.label = fields["label"]
    if "description" in fields:
        row.description = fields["description"]
    if "included_replies" in fields:
        row.included_replies = fields["included_replies"]
    deactivating = False
    if "is_active" in fields:
        deactivating = row.is_active and not fields["is_active"]
        row.is_active = fields["is_active"]
    row.updated_at = utcnow()

    # Réplique sur Stripe seulement si billing actif ET produit déjà poussé.
    if stripe_service.billing_enabled() and row.stripe_product_id:
        await stripe_service.update_product(
            row.stripe_product_id,
            name=fields.get("label"),
            active=fields.get("is_active"),
            description=fields.get("description"),
        )
        # is_active false ⇒ on désactive aussi le Price (le Product seul reste
        # achetable sinon via un Price actif orphelin).
        if deactivating and row.stripe_price_id:
            await stripe_service.deactivate_price(row.stripe_price_id)

    await db.commit()
    return _catalog_product(row)


# --- POST /api/admin/billing/catalog/{code}/price --------------------------

@router.post("/billing/catalog/{code}/price")
async def set_billing_catalog_price(code: str, body: CatalogPrice,
                                    db: AsyncSession = Depends(get_db)):
    """CHANGEMENT DE PRIX d'une ligne catalogue (unit_amount en centimes).

    Prices Stripe IMMUABLES : jamais d'édition en place. SI billing_enabled() ET
    stripe_product_id : crée un NOUVEAU Price (même product, nouveau montant,
    recurring interval) PUIS désactive l'ANCIEN ; met à jour
    `billing_products.unit_amount` + `stripe_price_id`. SI billing OFF : met à
    jour `unit_amount` localement seulement. Les abonnés existants gardent
    l'ancien prix (Stripe ne rétro-applique pas — attendu). Renvoie le
    CatalogProduct mis à jour."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == code)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Produit catalogue introuvable")

    if stripe_service.billing_enabled() and row.stripe_product_id:
        old_price_id = row.stripe_price_id
        price = await stripe_service.create_price(
            row.stripe_product_id,
            unit_amount=body.unit_amount,
            currency=row.currency,
            interval=row.interval,
            code=row.code,
        )
        row.stripe_price_id = price["id"]
        # Désactive l'ancien Price APRÈS création du nouveau (jamais de produit
        # sans Price achetable entre les deux).
        if old_price_id:
            await stripe_service.deactivate_price(old_price_id)

    row.unit_amount = body.unit_amount
    row.updated_at = utcnow()
    await db.commit()
    return _catalog_product(row)


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
