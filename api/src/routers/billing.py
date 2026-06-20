"""Endpoints de facturation modulaire (spec §5.4 + §3.6).

Le PAYEUR est toujours le `current_user` (= Customer Stripe, spec §1.1) : il paie
ses bots perso ET les bots des organisations dont il est OWNER. Les routes sans
`bot_id` sont donc scopées sur lui-même ; les routes par bot passent par
`require_billing_owner` (scopée : owner d'org pour un bot d'équipe, owner pour un
bot perso, superadmin court-circuite).

INVARIANT DIRECTEUR (D0) : si `billing_enabled() == False` (clés Stripe absentes),
toutes les routes client renvoient `{"billing": "disabled"}` (200) — aucune
mutation, aucune erreur — pour rester strictement identique à aujourd'hui (app
100 % gratuite, 32 e2e verts). Le webhook fait no-op (E1) après vérification de
signature.

Stripe en httpx pur via `services/stripe_service` (jamais de SDK). PAS de TVA
(franchise en base, art. 293 B du CGI). Catalogue lu en base (`billing_products`)
et validé contre `MODULE_KEYS` (parité D4/F5).
"""
import calendar
import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import CODE_TO_MODULE, MODULE_AI, MODULE_KEYS
from src.core.database import get_db
from src.core.security import get_current_user, require_billing_owner
from src.core.time import utcnow
from src.models.billing import (
    BillingProduct,
    BillingProductOut,
    BillingSubscription,
    BillingWebhookEvent,
    BotEntitlement,
)
from src.models.bot import Bot
from src.models.user import Organization, User
from src.services import stripe_service
from src.services.entitlement_service import apply_subscription_event, resolve
from src.services.quota_service import ai_quota_usage, quota_period

logger = logging.getLogger("billing")

router = APIRouter(prefix="/api", tags=["billing"])

# Réponse standard quand le billing est OFF (clés Stripe absentes — invariant D0).
_DISABLED = {"billing": "disabled"}

# Présélections de configurateur (spec §2.2). Le total est la somme transparente
# des produits (recalculée serveur depuis billing_products) — aucun prix caché.
_PRESETS: list[dict] = [
    {"key": "vitrine", "label": "Vitrine / FAQ",
     "tagline": "Un bot qui répond aux questions courantes.",
     "ai_tier_id": "ai_starter", "modules": ["rag"], "recommended": False},
    {"key": "pro_ia_rag", "label": "Service client",
     "tagline": "IA + base de connaissances + live chat + actions.",
     "ai_tier_id": "ai_growth", "modules": ["rag", "inbox", "actions"],
     "recommended": True},
    {"key": "service_client", "label": "Sur-mesure / Volume",
     "tagline": "Tout débloqué, gros volume.",
     "ai_tier_id": "ai_scale",
     "modules": ["rag", "inbox", "actions", "ab", "white_label"],
     "recommended": False},
]

CATALOG_VERSION = "2026-06-20"


# --- Payloads -------------------------------------------------------------

class BotConfigPayload(BaseModel):
    """Composition d'un bot choisie au configurateur (spec §5.1 BotConfig)."""
    modules: list[str] = Field(default_factory=list)   # sous-ensemble de MODULE_KEYS
    ai_tier_id: Optional[str] = None                   # ai_free | ai_starter | ...
    ai_byok: bool = False


class CheckoutPayload(BaseModel):
    bot_id: int
    config: BotConfigPayload
    grouping: Optional[str] = Field(None, pattern="^(per_bot|total|per_org)$")


class SubscriptionUpdatePayload(BaseModel):
    bot_id: int
    config: BotConfigPayload


class ActivateFreePayload(BaseModel):
    bot_id: int
    config: BotConfigPayload


class GroupingPayload(BaseModel):
    grouping: str = Field(pattern="^(per_bot|total|per_org)$")


# --- Helpers --------------------------------------------------------------

async def _catalog_rows(db: AsyncSession) -> list[BillingProduct]:
    return (await db.execute(
        select(BillingProduct).order_by(BillingProduct.id)
    )).scalars().all()


def _validate_config_modules(config: BotConfigPayload) -> None:
    """Refuse 422 si un module demandé n'est pas dans MODULE_KEYS (parité D4)."""
    unknown = [m for m in config.modules if m not in MODULE_KEYS]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Modules inconnus : {', '.join(unknown)}",
        )
    if config.ai_byok and config.ai_tier_id:
        # BYOK et plan IA managé sont mutuellement exclusifs (spec §2.2).
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "BYOK et plan IA managé sont mutuellement exclusifs",
        )


def _config_to_codes(config: BotConfigPayload) -> tuple[list[str], list[str]]:
    """Traduit une config de bot en codes catalogue.

    Renvoie (codes, modules_actifs). Codes = ['base', <ai_tier|mod_ai_byok>?,
    'mod_<module>'...]. `base` (socle gratuit, 0 €) toujours inclus pour porter
    une ligne lisible sur la facture."""
    codes: list[str] = ["base"]
    modules: list[str] = []
    # Module IA : variante BYOK forfait OU plan IA managé.
    if config.ai_byok:
        codes.append("mod_ai_byok")
        modules.append(MODULE_AI)
    elif config.ai_tier_id and config.ai_tier_id != "ai_free":
        codes.append(config.ai_tier_id)
        modules.append(MODULE_AI)
    elif config.ai_tier_id == "ai_free":
        # Plan gratuit : module IA actif mais aucune ligne facturée.
        modules.append(MODULE_AI)
    # Add-ons : mapping module -> code mod_*.
    _module_to_code = {v: k for k, v in CODE_TO_MODULE.items() if k != "mod_ai_byok"}
    for mod in config.modules:
        if mod == MODULE_AI:
            continue  # géré par le plan IA / BYOK ci-dessus
        code = _module_to_code.get(mod)
        if code:
            codes.append(code)
            modules.append(mod)
    return codes, modules


async def _line_items_for_codes(
    db: AsyncSession, codes: list[str]
) -> list[dict]:
    """Résout les codes en line_items Stripe [{price, quantity, code}].

    Saute les produits à 0 € (socle gratuit) et ceux sans `stripe_price_id`
    (non seedés / billing OFF) — Stripe refuse `price=None`."""
    items: list[dict] = []
    for code in codes:
        row = (await db.execute(
            select(BillingProduct).where(
                BillingProduct.code == code,
                BillingProduct.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if row is None or row.unit_amount <= 0:
            continue  # socle gratuit / produit absent : pas de ligne facturée
        if not row.stripe_price_id:
            continue
        items.append({"price": row.stripe_price_id, "quantity": 1, "code": code})
    return items


async def _billable_bots(db: AsyncSession, user: User) -> list[Bot]:
    """B(U) = bots facturables du payeur (spec §4.1) : bots perso (owner_user_id
    == user.id) ∪ bots des orgs dont il est OWNER. Un admin non-owner ne paie
    PAS les bots de l'org."""
    owned_org_ids = (await db.execute(
        select(Organization.id).where(Organization.owner_user_id == user.id)
    )).scalars().all()
    conditions = [Bot.owner_user_id == user.id]
    if owned_org_ids:
        conditions.append(Bot.organization_id.in_(list(owned_org_ids)))
    return (await db.execute(
        select(Bot).where(or_(*conditions)).order_by(Bot.created_at)
    )).scalars().all()


async def billing_on_org_owner_change(
    db: AsyncSession, org_id: int, old_owner_id: int | None, new_owner_id: int | None
) -> None:
    """Réaligne la facturation au transfert de propriété d'une org (#7, spec §4.3).

    Le PAYEUR des bots d'équipe = l'owner de l'org (`org.owner_user_id`). Quand il
    change, les BillingSubscription de l'ancien owner ne doivent plus porter ces
    bots : on les en retire (proration crédit côté Stripe, best-effort) et on pose
    chaque bot de l'org en GRACE (`status='past_due'`) jusqu'à ce que le NOUVEL
    owner régularise via le configurateur / le webhook. Analogue à
    `bots._billing_on_move_payer_change`.

    No-op si billing OFF, ou si le payeur ne change pas. Défensif : toute erreur
    Stripe est avalée (le transfert ne doit jamais échouer à cause du billing)."""
    if not stripe_service.billing_enabled():
        return
    if old_owner_id is not None and old_owner_id == new_owner_id:
        return  # même payeur : rien à re-facturer

    org_bot_ids = (await db.execute(
        select(Bot.id).where(Bot.organization_id == org_id)
    )).scalars().all()
    if not org_bot_ids:
        return
    bot_id_set = set(org_bot_ids)

    # (a) Retirer ces bots des subscriptions de l'ancien payeur.
    if old_owner_id is not None:
        subs = (await db.execute(
            select(BillingSubscription).where(
                BillingSubscription.user_id == old_owner_id)
        )).scalars().all()
        for sub in subs:
            items = list(sub.raw_items or [])
            kept = [it for it in items if it.get("bot_id") not in bot_id_set]
            if len(kept) == len(items):
                continue  # cette sub ne portait aucun bot de l'org
            target = [{"id": it.get("si_id"), "price": it.get("price_id"),
                       "quantity": it.get("qty", 1)}
                      for it in kept if it.get("price_id")]
            try:
                # 0 item cible ⇒ update_subscription_items résilie la sub (Stripe
                # refuse une sub sans item) ; sinon proration crédit.
                await stripe_service.update_subscription_items(
                    sub.stripe_subscription_id, target,
                    proration_behavior="create_prorations",
                )
            except stripe_service.StripeError:
                logger.warning("billing.transfer: maj sub %s échouée (ignorée)",
                               sub.stripe_subscription_id)
            sub.raw_items = kept
            if not kept:
                sub.status = "canceled"

    # (b) Côté nouveau payeur : chaque bot de l'org en grâce jusqu'à régularisation.
    for bid in bot_id_set:
        ent = (await db.execute(
            select(BotEntitlement).where(BotEntitlement.bot_id == bid)
        )).scalar_one_or_none()
        if ent is None:
            ent = BotEntitlement(bot_id=bid, source="stripe")
            db.add(ent)
        ent.modules = []
        ent.ai_monthly_quota = 0
        ent.status = "past_due"  # grâce : modules payants dégradés, socle gratuit OK
        ent.source = "stripe"
        ent.synced_at = utcnow()
    await db.commit()


async def _ensure_customer(db: AsyncSession, user: User) -> str:
    """Customer Stripe du payeur (création paresseuse à la 1re souscription)."""
    if user.stripe_customer_id:
        return user.stripe_customer_id
    cus = await stripe_service.create_customer(user, user.billing_email or user.email)
    user.stripe_customer_id = cus
    await db.flush()
    return cus


def _scope_for_bot(grouping: str, bot: Bot) -> tuple[str, int | None, int | None]:
    """(scope_kind, scope_bot_id, scope_org_id) d'une sub par bot selon le format."""
    if grouping == "per_bot":
        return "bot", bot.id, None
    if grouping == "per_org":
        if bot.organization_id is not None:
            return "org", None, bot.organization_id
        return "user_personal", None, None
    return "user_all", None, None  # total


async def _project_mock_entitlement(
    db: AsyncSession, bot: Bot, codes: list[str], modules: list[str]
) -> None:
    """MOCK_BILLING : applique directement l'entitlement attendu (simule
    checkout.session.completed) pour que les e2e vérifient l'activation sans
    Stripe (spec §2.3). En vrai Stripe, le webhook s'en charge."""
    ai_quota: int | None = 0
    if "mod_ai_byok" in codes:
        ai_quota = None  # illimité (BYOK)
    else:
        tier = next((c for c in codes if c.startswith("ai_")), None)
        if tier:
            row = (await db.execute(
                select(BillingProduct).where(BillingProduct.code == tier)
            )).scalar_one_or_none()
            ai_quota = row.included_replies if row is not None else 0
        elif MODULE_AI in modules:
            # Plan IA GRATUIT (ai_free) : module IA actif sans ligne facturée
            # (`_config_to_codes` n'émet aucun code ai_*). Le quota inclus doit
            # tout de même être posé (sinon le mock projette quota=0 et l'IA est
            # inutilisable). On lit included_replies du produit ai_free (50).
            row = (await db.execute(
                select(BillingProduct).where(BillingProduct.code == "ai_free")
            )).scalar_one_or_none()
            ai_quota = (row.included_replies if row is not None
                        and row.included_replies is not None else 50)
    ent = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
    )).scalar_one_or_none()
    if ent is None:
        ent = BotEntitlement(bot_id=bot.id)
        db.add(ent)
    ent.modules = sorted(set(modules))
    ent.ai_monthly_quota = ai_quota
    ent.status = "active"
    ent.source = "stripe"
    ent.synced_at = utcnow()


# --- GET /api/billing/catalog ---------------------------------------------

@router.get("/billing/catalog")
async def get_catalog(db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Catalogue de facturation (lit `billing_products`, valide contre
    MODULE_KEYS). Le front ne code aucun prix en dur : il consomme ce contrat.

    Billing OFF ⇒ {billing: disabled} (la nav/UI billing est masquée côté front).
    """
    if not stripe_service.billing_enabled():
        return _DISABLED

    rows = await _catalog_rows(db)
    by_code = {r.code: r for r in rows}

    base = by_code.get("base")
    base_cents = base.unit_amount if base is not None else 0

    # Modules add-on (kind=module hors BYOK) -> CatalogModule.
    modules_out: list[dict] = []
    byok = by_code.get("mod_ai_byok")
    for code, mod in CODE_TO_MODULE.items():
        if code in ("mod_ai", "mod_ai_byok"):
            continue
        row = by_code.get(code)
        if row is None or not row.is_active:
            continue
        if mod not in MODULE_KEYS:  # garde de parité (D4)
            continue
        entry: dict[str, Any] = {
            "key": mod,
            "label": row.label,
            "short": row.label,
            "desc": row.label,
            "price_cents": row.unit_amount,
        }
        modules_out.append(entry)

    # Module IA exposé comme module avec variante BYOK (byok_price_cents).
    if byok is not None and byok.is_active:
        modules_out.insert(0, {
            "key": MODULE_AI,
            "label": "Intelligence artificielle",
            "short": "IA",
            "desc": "Réponses générées par l'IA (plan managé ou BYOK).",
            "price_cents": 0,
            "byok_price_cents": byok.unit_amount,
        })

    ai_tiers = [{
        "id": r.code,
        "included_replies": r.included_replies or 0,
        "price_cents": r.unit_amount,
    } for r in rows if r.kind == "ai_tier" and r.is_active]

    mtr = by_code.get("mtr_ai")
    overage = mtr.unit_amount if mtr is not None else 0

    # Présélections : total recalculé serveur (somme transparente).
    presets_out: list[dict] = []
    for preset in _PRESETS:
        est = base_cents
        tier = by_code.get(preset["ai_tier_id"]) if preset["ai_tier_id"] else None
        if tier is not None:
            est += tier.unit_amount
        for mod in preset["modules"]:
            code = next((c for c, m in CODE_TO_MODULE.items()
                         if m == mod and c != "mod_ai_byok"), None)
            row = by_code.get(code) if code else None
            if row is not None:
                est += row.unit_amount
        presets_out.append({
            "key": preset["key"],
            "label": preset["label"],
            "tagline": preset["tagline"],
            "modules": preset["modules"],
            "ai_tier_id": preset["ai_tier_id"],
            "recommended": preset["recommended"],
            "est_price_cents": est,
        })

    return {
        "currency": "eur",
        "base_price_cents": base_cents,
        "modules": modules_out,
        "ai_tiers": ai_tiers,
        "overage_cents_per_reply": overage,
        "tax_note": "TVA non applicable, art. 293 B du CGI",
        "presets": presets_out,
        "version": CATALOG_VERSION,
        # Lecture seule, utile au debug / parité (jamais source de prix front).
        "products": [BillingProductOut.model_validate(r).model_dump() for r in rows],
    }


# --- GET /api/billing/summary ---------------------------------------------

@router.get("/billing/summary")
async def get_summary(db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Vue facturation du payeur : format de facture, abonnements miroir,
    bots facturables. Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    subs = (await db.execute(
        select(BillingSubscription).where(BillingSubscription.user_id == user.id)
    )).scalars().all()
    bots = await _billable_bots(db, user)

    # subscription_status agrégé du payeur (contrat front) : 'active' dès qu'une
    # sub est active/trialing, sinon 'past_due' si au moins une est past_due,
    # sinon 'none' (aucune sub facturante : tout gratuit / résilié).
    statuses = {s.status for s in subs}
    if statuses & {"active", "trialing"}:
        subscription_status = "active"
    elif "past_due" in statuses:
        subscription_status = "past_due"
    else:
        subscription_status = "none"

    # Prochaine échéance : la plus proche current_period_end parmi les subs
    # actives (epoch s). Montant estimé : somme des unit_amount des produits
    # portés par les raw_items de cette sub (null si non dérivable).
    next_invoice_at: int | None = None
    next_invoice_cents: int | None = None
    active_subs = [s for s in subs if s.status in ("active", "trialing", "past_due")]
    next_sub = min(
        (s for s in active_subs if s.current_period_end is not None),
        key=lambda s: s.current_period_end,
        default=None,
    )
    if next_sub is not None:
        # current_period_end est un datetime NAÏF UTC (cf. core/time.utcnow) :
        # timegm(utctimetuple) donne l'epoch s correct (timestamp() l'interpréterait
        # en heure locale).
        next_invoice_at = calendar.timegm(
            next_sub.current_period_end.utctimetuple())
        price_ids = [it.get("price_id") for it in (next_sub.raw_items or [])
                     if it.get("price_id")]
        if price_ids:
            prods = (await db.execute(
                select(BillingProduct).where(
                    BillingProduct.stripe_price_id.in_(price_ids))
            )).scalars().all()
            amount_by_price = {p.stripe_price_id: p.unit_amount for p in prods}
            total = 0
            for it in (next_sub.raw_items or []):
                amt = amount_by_price.get(it.get("price_id"))
                if amt is not None:
                    total += amt * int(it.get("qty", 1) or 1)
            next_invoice_cents = total

    return {
        "billing_grouping": user.billing_grouping,
        "has_customer": bool(user.stripe_customer_id),
        "billing_email": user.billing_email or user.email,
        "subscription_status": subscription_status,
        "next_invoice_cents": next_invoice_cents,
        "next_invoice_at": next_invoice_at,
        "subscriptions": [{
            "stripe_subscription_id": s.stripe_subscription_id,
            "grouping": s.grouping,
            "scope_kind": s.scope_kind,
            "scope_bot_id": s.scope_bot_id,
            "scope_org_id": s.scope_org_id,
            "status": s.status,
            "current_period_start": s.current_period_start,
            "current_period_end": s.current_period_end,
            "cancel_at_period_end": s.cancel_at_period_end,
        } for s in subs],
        "billable_bot_ids": [b.id for b in bots],
    }


# --- POST /api/billing/checkout -------------------------------------------

@router.post("/billing/checkout")
async def checkout(body: CheckoutPayload, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Crée une session de Checkout Stripe pour souscrire la config d'un bot.

    Owner-only (require_billing_owner scopée). Billing OFF ⇒ {billing: disabled}.
    Total 0 € (socle + ai_free seuls) ⇒ pas de Checkout (bot gratuit)."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    _validate_config_modules(body.config)
    bot = await db.get(Bot, body.bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    grouping = body.grouping or user.billing_grouping
    codes, modules = _config_to_codes(body.config)
    line_items = await _line_items_for_codes(db, codes)

    if not line_items:
        # Tout gratuit (socle + ai_free) : aucune souscription nécessaire.
        if settings.MOCK_BILLING:
            await _project_mock_entitlement(db, bot, codes, modules)
        await db.commit()
        return {"checkout_url": None, "free": True}

    customer_id = await _ensure_customer(db, user)
    # Une seule session payable à la fois (anti double-abonnement).
    await stripe_service.expire_open_checkout_sessions(customer_id)

    bots_map = {str(bot.id): [c for c in codes if c != "base"]}
    group_key = f"{grouping}:{user.id}"

    url = await stripe_service.create_checkout_session(
        customer_id=customer_id,
        line_items=[{"price": it["price"], "quantity": it["quantity"]}
                    for it in line_items],
        bots_map=bots_map,
        group_key=group_key,
        user_id=user.id,
    )

    if settings.MOCK_BILLING:
        # Simule checkout.session.completed : applique l'entitlement directement.
        await _project_mock_entitlement(db, bot, codes, modules)
    await db.commit()
    return {"checkout_url": url}


# --- POST /api/billing/activate-free --------------------------------------

@router.post("/billing/activate-free")
async def activate_free(body: ActivateFreePayload, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Active le plan IA GRATUIT (`ai_free`, total 0 €) SANS passer par Stripe.

    Le front l'appelle (au lieu de sauter silencieusement) quand
    `billingActive && total==0 && ai_tier_id==='ai_free'` : aucune souscription
    n'est créée mais l'entitlement MODULE_AI + quota inclus (50) doit être posé,
    sinon l'IA reste inutilisable (quota 0). Owner-only (require_billing_owner).

    Refuse 422 si la config n'est pas réellement gratuite (un plan IA payant ou
    BYOK doit passer par /checkout). Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    _validate_config_modules(body.config)
    bot = await db.get(Bot, body.bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    codes, modules = _config_to_codes(body.config)
    # Cet endpoint est réservé au cas STRICTEMENT gratuit : aucune ligne facturable.
    # Une config payante (plan IA managé, add-on, BYOK forfaité) doit passer par
    # /checkout — on refuse pour ne pas projeter un entitlement non payé.
    line_items = await _line_items_for_codes(db, codes)
    if line_items:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Configuration payante : utilisez /billing/checkout",
        )

    # Projette directement l'entitlement gratuit (MODULE_AI + quota inclus 50 via
    # ai_free) ; même règle que la simulation mock (pas de Stripe à appeler).
    await _project_mock_entitlement(db, bot, codes, modules)
    await db.commit()

    ent = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
    )).scalar_one_or_none()
    return {
        "bot_id": bot.id,
        "free": True,
        "modules": list(ent.modules or []) if ent is not None else sorted(set(modules)),
        "ai_monthly_quota": ent.ai_monthly_quota if ent is not None else None,
        "status": ent.status if ent is not None else "active",
    }


# --- POST /api/billing/subscription/update --------------------------------

@router.post("/billing/subscription/update")
async def subscription_update(body: SubscriptionUpdatePayload,
                              db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Met à jour les modules d'un bot déjà souscrit (ajout/retrait).

    Owner-only. Sans abonnement actif sur le bot ⇒ on bascule sur un Checkout
    (renvoie {portal_url} = l'URL de paiement) ; sinon on aligne les items via
    le portail épinglé / l'API. Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    _validate_config_modules(body.config)
    bot = await db.get(Bot, body.bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    codes, modules = _config_to_codes(body.config)

    if settings.MOCK_BILLING:
        # Applique directement le nouvel état (e2e dégradation/activation).
        await _project_mock_entitlement(db, bot, codes, modules)
        await db.commit()
        return {"status": "updated"}

    # Vrai Stripe : on dirige l'owner vers le portail (downgrade/upgrade encadré).
    customer_id = await _ensure_customer(db, user)
    portal_url = await stripe_service.create_portal_session(customer_id)
    await db.commit()
    return {"status": "portal", "portal_url": portal_url}


# --- POST /api/billing/portal + /portal/cancel ----------------------------

@router.post("/billing/portal")
async def portal(db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Portail client Stripe (moyens de paiement, factures, résiliation).
    Réservé au payeur (lui-même = Customer). Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED
    if not user.stripe_customer_id:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Aucun abonnement : rien à gérer dans le portail")
    url = await stripe_service.create_portal_session(user.stripe_customer_id)
    return {"portal_url": url}


@router.post("/billing/portal/cancel")
async def portal_cancel(subscription_id: str, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Portail épinglé sur la résiliation d'UNE subscription du payeur.
    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED
    if not user.stripe_customer_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Aucun abonnement")
    # La sub doit appartenir au payeur (anti-énumération inter-comptes).
    sub = (await db.execute(
        select(BillingSubscription).where(
            BillingSubscription.stripe_subscription_id == subscription_id,
            BillingSubscription.user_id == user.id,
        )
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Abonnement introuvable")
    url = await stripe_service.create_cancel_portal_session(
        user.stripe_customer_id, subscription_id)
    return {"portal_url": url}


# --- PUT /api/billing/grouping --------------------------------------------

@router.put("/billing/grouping")
async def put_grouping(body: GroupingPayload, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Change le format de facture (per_bot | total | per_org).

    Procédure « créer-puis-résilier » (spec §4.2) qui PRÉSERVE les entitlements :
    on snapshot B(U), on construit la cible, on crée les nouvelles subs, on
    résilie les anciennes, puis on commit `billing_grouping`. Verrou
    `pg_advisory_lock(user.id)` + fenêtre `billing_regrouping_at` (anti-race
    webhook D1 : `apply_subscription_event` recalcule l'état NET, jamais de
    révocation aveugle). Owner-only (le payeur lui-même).

    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    target = body.grouping
    bots = await _billable_bots(db, user)
    owned_org_ids = {b.organization_id for b in bots if b.organization_id}
    has_personal = any(b.organization_id is None for b in bots)

    if target == "per_org" and not owned_org_ids and not has_personal:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Format « par organisation » impossible : aucun bot d'organisation "
            "ni bot perso facturable",
        )

    if target == user.billing_grouping:
        return {"billing_grouping": user.billing_grouping, "changed": False}

    # Verrou applicatif : sérialise les regroupings concurrents du même payeur.
    await db.execute(sa_text("SELECT pg_advisory_lock(:k)"), {"k": user.id})
    try:
        existing = (await db.execute(
            select(BillingSubscription).where(
                BillingSubscription.user_id == user.id,
                BillingSubscription.status.in_(["active", "trialing", "past_due"]),
            )
        )).scalars().all()

        # Fenêtre anti-race (D1) : posée si la colonne existe (mini-volet owner).
        if hasattr(user, "billing_regrouping_at"):
            user.billing_regrouping_at = utcnow()
            await db.flush()

        if settings.MOCK_BILLING or not existing:
            # MOCK / pas d'abonnement réel : on bascule le format sans toucher
            # Stripe. Les entitlements (bot_entitlements) restent inchangés.
            user.billing_grouping = target
            await db.commit()
            return {"billing_grouping": user.billing_grouping, "changed": True}

        # Vrai Stripe : créer-puis-résilier (préserve les entitlements).
        customer_id = await _ensure_customer(db, user)
        await stripe_service.expire_open_checkout_sessions(customer_id)

        # 1) Snapshot B(U) + reconstruction des items cibles par bot (depuis le
        #    miroir local : on regroupe les codes actuellement portés par bot).
        codes_by_bot: dict[int, list[str]] = {}
        for sub in existing:
            for item in (sub.raw_items or []):
                bid = item.get("bot_id")
                code = item.get("code")
                if isinstance(bid, int) and code:
                    codes_by_bot.setdefault(bid, []).append(code)

        # 2) Créer les nouvelles subs selon le format cible. billing_cycle_anchor
        #    gelé identique sur tout le jeu (proration cohérente). On délègue la
        #    création réelle au service Stripe ; le webhook projettera l'état.
        bot_by_id = {b.id: b for b in bots}
        if target in ("per_bot", "per_org"):
            for bid, codes in codes_by_bot.items():
                bot = bot_by_id.get(bid)
                if bot is None:
                    continue
                items = await _line_items_for_codes(db, ["base"] + codes)
                if not items:
                    continue
                scope_kind, scope_bot_id, scope_org_id = _scope_for_bot(target, bot)
                created = await stripe_service.create_subscription(
                    customer_id=customer_id,
                    items=[{"price": it["price"], "quantity": 1,
                            "metadata": {"bot_id": str(bid), "code": it["code"]}}
                           for it in items],
                    metadata={"user_id": str(user.id), "grouping": target},
                )
                db.add(BillingSubscription(
                    user_id=user.id,
                    stripe_subscription_id=created["id"],
                    grouping=target,
                    scope_kind=scope_kind,
                    scope_bot_id=scope_bot_id,
                    scope_org_id=scope_org_id,
                    status=created.get("status", "active"),
                ))
        else:  # total : une seule sub user_all reprenant tous les items.
            # Stripe REFUSE deux line_items au même price (400). Deux bots qui
            # partagent un module (même price) doivent donc être AGRÉGÉS en un
            # seul item dont on incrémente la quantité. La cartographie complète
            # bot→codes est portée par subscription_data[metadata][bots] (JSON),
            # que le webhook relit (le per-item metadata.bot_id ne peut référencer
            # qu'un seul bot et serait perdu sur l'item agrégé).
            qty_by_price: dict[str, int] = {}
            price_order: list[str] = []
            bots_map: dict[str, list[str]] = {}
            for bid, codes in codes_by_bot.items():
                for it in await _line_items_for_codes(db, codes):
                    price = it["price"]
                    if price not in qty_by_price:
                        qty_by_price[price] = 0
                        price_order.append(price)
                    qty_by_price[price] += 1
                    bots_map.setdefault(str(bid), []).append(it["code"])
            all_items = [{"price": price, "quantity": qty_by_price[price]}
                         for price in price_order]
            if all_items:
                created = await stripe_service.create_subscription(
                    customer_id=customer_id,
                    items=all_items,
                    metadata={"user_id": str(user.id), "grouping": target,
                              "bots": json.dumps(bots_map, separators=(",", ":"))},
                )
                db.add(BillingSubscription(
                    user_id=user.id,
                    stripe_subscription_id=created["id"],
                    grouping=target,
                    scope_kind="user_all",
                    status=created.get("status", "active"),
                ))

        # 3) Résilier les anciennes APRÈS confirmation des nouvelles (proration).
        for sub in existing:
            try:
                await stripe_service.cancel_subscription(
                    sub.stripe_subscription_id, prorate=True)
                sub.status = "canceled"
            except stripe_service.StripeError as exc:
                logger.warning("regrouping: résiliation %s échouée : %s",
                               sub.stripe_subscription_id, exc)

        user.billing_grouping = target
        await db.commit()
        return {"billing_grouping": user.billing_grouping, "changed": True}
    finally:
        await db.execute(sa_text("SELECT pg_advisory_unlock(:k)"), {"k": user.id})


# --- GET /api/billing/invoices --------------------------------------------

@router.get("/billing/invoices")
async def get_invoices(db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Factures du payeur (à la demande, API Stripe). Billing OFF ⇒ disabled.
    Sans customer ⇒ tableau vide (jamais d'erreur).

    Renvoie un TABLEAU bare `Invoice[]` (contrat front), pas l'enveloppe
    `{invoices: [...]}`."""
    if not stripe_service.billing_enabled():
        return _DISABLED
    if not user.stripe_customer_id:
        return []
    return await stripe_service.list_invoices(user.stripe_customer_id)


# --- GET /api/billing/usage -----------------------------------------------

@router.get("/billing/usage")
async def get_usage(db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Conso IA mensuelle vs quota, par bot facturable du payeur (spec §3.6).
    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    period = quota_period()
    bots = await _billable_bots(db, user)
    out = []
    for bot in bots:
        ent = await resolve(db, bot)
        used = await ai_quota_usage(db, bot.id)
        out.append({
            "bot_id": bot.id,
            "period": period,
            "usage_ai_replies": used,
            "quota_ai_replies": None if ent.byok else ent.ai_monthly_quota,
            "byok": ent.byok,
        })
    return {"period": period, "usage": out}


# --- GET /api/bots/{id}/entitlement ---------------------------------------

def _month_bounds_iso(period: str) -> tuple[str, str]:
    """Bornes ISO (UTC) du mois calendaire "YYYY-MM" : (1er du mois, 1er du mois
    suivant). Aligné sur quota_period()/count_ai_messages_month (D8)."""
    year, month = (int(p) for p in period.split("-"))
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start.isoformat(), end.isoformat()


@router.get("/bots/{bot_id}/entitlement")
async def get_bot_entitlement(bot_id: int, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Facturation effective d'un bot (contrat front `BotBilling`, spec §5.1).
    Owner-only (require_billing_owner scopée, E2 : un member ne voit pas la
    facturation).

    Retourne la forme consommée par BotPage (`active_modules`, `ai_byok`,
    `usage_ai_replies`, `quota_ai_replies`, `period_*`, `subscription_status`) —
    PAS le schéma brut `BotEntitlementOut`. Billing OFF ⇒ projection « tout
    débloqué » (resolver RÈGLE 1) : status 'none', modules débloqués, quota
    illimité — cohérent avec l'app 100 % gratuite, aucune donnée Stripe exposée."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    ent = await resolve(db, bot)
    period = quota_period()
    period_start, period_end = _month_bounds_iso(period)
    used = await ai_quota_usage(db, bot_id)

    # subscription_status : 'none' tant que le billing est OFF ou que le bot n'a
    # pas d'entitlement projeté par Stripe (gratuit). Sinon on remonte le statut
    # de la ligne (active | past_due | canceled).
    row = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
    )).scalar_one_or_none()
    if not stripe_service.billing_enabled() or row is None:
        sub_status = "none"
    else:
        sub_status = row.status if row.status in (
            "active", "past_due", "canceled") else "none"

    modules = sorted(ent.modules)
    return {
        "bot_id": bot_id,
        # `modules` (clés d'entitlement) ET `active_modules` (alias contrat front
        # BotBilling) : deux consommateurs (e2e billing-degradation lit `modules`,
        # BotPage lit `active_modules`). Même liste, jamais divergente.
        "modules": modules,
        "active_modules": modules,
        "ai_tier_id": None,   # le palier précis n'est pas porté par l'entitlement
        "ai_byok": ent.byok,
        "usage_ai_replies": used,
        "quota_ai_replies": None if ent.byok else ent.ai_monthly_quota,
        "period_start": period_start,
        "period_end": period_end,
        # `status` = statut effectif de l'entitlement (e2e billing-owner-gating) ;
        # `subscription_status` = même info sous la clé du contrat front BotBilling.
        "status": ent.status,
        "subscription_status": sub_status,
    }


# --- POST /api/billing/webhook (public, corps bytes bruts) ----------------

@router.post("/billing/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Webhook Stripe (subscription.*, checkout.session.completed).

    Corps en BYTES BRUTS (await request.body() AVANT tout parse JSON) : la
    signature HMAC porte sur les octets exacts. Idempotence par event.id
    (billing_webhook_events, gérée par apply_subscription_event).

    E1 : si `billing_enabled()==False`, no-op APRÈS vérification de signature
    (on retourne {received:True} sans appliquer — réversibilité R2 propre).
    Signature absente/invalide/expirée ⇒ 400."""
    payload = await request.body()
    sig = request.headers.get("Stripe-Signature")
    try:
        event = stripe_service.verify_webhook_signature(payload, sig)
    except stripe_service.StripeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    # E1 : billing OFF ⇒ no-op après vérif signature (corps déjà validé).
    if not stripe_service.billing_enabled():
        return {"received": True, "billing": "disabled"}

    event_type = event.get("type") or ""

    # Pour les events subscription.*, on reflète le miroir local AVANT de projeter
    # (apply_subscription_event lit billing_subscriptions comme source de l'état
    # cible). MAIS les gardes d'idempotence et d'ordre doivent passer AVANT tout
    # _sync (#6) : sinon un event rejoué / arrivé dans le désordre réécrit le
    # miroir et désynchronise l'état.
    if event_type.startswith("customer.subscription."):
        sub_obj = (event.get("data") or {}).get("object") or {}
        stripe_sub_id = sub_obj.get("id")
        event_id = event.get("id")

        # (1) Idempotence AVANT _sync : event déjà traité ⇒ no-op total (on ne
        #     touche pas au miroir). La projection a déjà été appliquée.
        if event_id:
            already = (await db.execute(
                select(BillingWebhookEvent.id).where(
                    BillingWebhookEvent.stripe_event_id == event_id)
            )).scalar_one_or_none()
            if already is not None:
                return {"received": True, "duplicate": True}

        # (2) Ordre : ne pas régresser sur un event PLUS ANCIEN que le dernier
        #     déjà appliqué pour CETTE subscription (replay / out-of-order). On
        #     compare le champ Stripe `created` (epoch s) mémorisé sur les events
        #     déjà traités de cette sub.
        incoming_created = event.get("created")
        if stripe_sub_id and isinstance(incoming_created, int):
            last_created = await _last_event_created_for_sub(db, stripe_sub_id)
            if last_created is not None and incoming_created < last_created:
                logger.info(
                    "billing: event %s (created=%s) plus ancien que l'état "
                    "synced (%s) pour %s — ignoré",
                    event_id, incoming_created, last_created, stripe_sub_id)
                return {"received": True, "stale": True}

        # (3) Ne pas RESSUSCITER une sub déjà résiliée : un .deleted est terminal.
        #     Un event non-.deleted arrivant après le .deleted (out-of-order) ne
        #     doit pas réactiver le miroir.
        if event_type != "customer.subscription.deleted" and stripe_sub_id:
            mirror = (await db.execute(
                select(BillingSubscription.status).where(
                    BillingSubscription.stripe_subscription_id == stripe_sub_id)
            )).scalar_one_or_none()
            if mirror == "canceled":
                logger.info(
                    "billing: sub %s déjà résiliée (terminal) — event %s ignoré",
                    stripe_sub_id, event_id)
                return {"received": True, "stale": True}

        await _sync_subscription_mirror(db, event)
        await apply_subscription_event(db, event)
        # Mémorise le `created` Stripe sur l'event tout juste enregistré par
        # apply_subscription_event (sert à la garde d'ordre ci-dessus).
        if event_id and isinstance(incoming_created, int):
            ev_row = (await db.execute(
                select(BillingWebhookEvent).where(
                    BillingWebhookEvent.stripe_event_id == event_id)
            )).scalar_one_or_none()
            if ev_row is not None:
                payload = dict(ev_row.payload or {})
                payload["created"] = incoming_created
                ev_row.payload = payload
        await db.commit()
    elif event_type == "checkout.session.completed":
        # Le checkout crée la 1re sub : Stripe émet ensuite customer.subscription
        # .created qui portera la cartographie. Ici on se contente d'accuser
        # réception (idempotence/projection gérées par l'event subscription).
        logger.info("billing: checkout.session.completed reçu (sub projetée via "
                    "l'event subscription.*)")
    else:
        logger.info("billing: event %s ignoré (non géré)", event_type)

    return {"received": True}


async def _last_event_created_for_sub(db: AsyncSession, stripe_sub_id: str) -> int | None:
    """Max du champ Stripe `created` (epoch s) parmi les events subscription.*
    déjà traités pour CETTE subscription (garde d'ordre webhook, #6).

    Le `created` est mémorisé dans `BillingWebhookEvent.payload['created']` par
    le routeur après projection. On filtre côté Python (peu d'events, portable
    SQLite/Postgres : pas d'accès JSON SQL)."""
    rows = (await db.execute(
        select(BillingWebhookEvent.payload).where(
            BillingWebhookEvent.type.like("customer.subscription.%"))
    )).scalars().all()
    best: int | None = None
    for payload in rows:
        if not isinstance(payload, dict):
            continue
        if payload.get("subscription") != stripe_sub_id:
            continue
        created = payload.get("created")
        if isinstance(created, int) and (best is None or created > best):
            best = created
    return best


async def _sync_subscription_mirror(db: AsyncSession, event: dict) -> None:
    """Met à jour `billing_subscriptions` depuis l'objet subscription de l'event.

    Reconstruit `raw_items` ([{si_id, price_id, code, bot_id, qty}]) depuis les
    items Stripe + la cartographie `metadata[bots]` (Checkout) ou les
    `item.metadata.bot_id` (subs créées par API). Le payeur est résolu via
    `metadata[user_id]` puis `User.stripe_customer_id`."""
    sub_obj = (event.get("data") or {}).get("object") or {}
    stripe_sub_id = sub_obj.get("id")
    if not stripe_sub_id:
        return

    deleted = event.get("type") == "customer.subscription.deleted"
    sub_status = "canceled" if deleted else (sub_obj.get("status") or "active")

    # Résolution du payeur (user_id).
    meta = sub_obj.get("metadata") or {}
    user_id: int | None = None
    raw_uid = meta.get("user_id")
    if raw_uid and str(raw_uid).isdigit():
        user_id = int(raw_uid)
    if user_id is None:
        customer = sub_obj.get("customer")
        if customer:
            user_id = await db.scalar(
                select(User.id).where(User.stripe_customer_id == customer)
            )

    # Cartographie bot par item.
    bots_map: dict[str, list[str]] = {}
    raw_bots = meta.get("bots")
    if raw_bots:
        try:
            bots_map = json.loads(raw_bots)
        except (ValueError, TypeError):
            bots_map = {}

    # Index price_id -> code (catalogue).
    products = (await db.execute(select(BillingProduct))).scalars().all()
    code_by_price = {p.stripe_price_id: p.code for p in products if p.stripe_price_id}

    raw_items: list[dict] = []
    for item in ((sub_obj.get("items") or {}).get("data") or []):
        price = (item.get("price") or {}).get("id")
        code = code_by_price.get(price)
        item_meta = item.get("metadata") or {}
        bot_id: int | None = None
        raw_bid = item_meta.get("bot_id")
        if raw_bid and str(raw_bid).isdigit():
            bot_id = int(raw_bid)
        # Repli : cartographie Checkout (subscription_data.metadata.bots).
        if bot_id is None and code:
            for bid_str, codes in bots_map.items():
                if code in codes and str(bid_str).isdigit():
                    bot_id = int(bid_str)
                    break
        raw_items.append({
            "si_id": item.get("id"),
            "price_id": price,
            "code": code,
            "bot_id": bot_id,
            "qty": item.get("quantity", 1),
        })

    row = (await db.execute(
        select(BillingSubscription).where(
            BillingSubscription.stripe_subscription_id == stripe_sub_id
        )
    )).scalar_one_or_none()

    if row is None:
        if user_id is None:
            logger.warning("billing: sub %s sans payeur résoluble, miroir ignoré",
                           stripe_sub_id)
            return
        row = BillingSubscription(
            user_id=user_id,
            stripe_subscription_id=stripe_sub_id,
            grouping=meta.get("grouping") or "total",
            scope_kind="user_all",
        )
        db.add(row)
    row.status = sub_status
    row.raw_items = raw_items
    if not deleted:
        cpe = sub_obj.get("cancel_at_period_end")
        if cpe is not None:
            row.cancel_at_period_end = bool(cpe)
    await db.flush()
