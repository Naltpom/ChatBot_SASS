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
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import (
    CODE_TO_MODULE,
    MODULE_AI,
    MODULE_KEYS,
    MODULE_MCP,
    MODULE_RAG,
    OVERAGE_CAP_DEFAULT,
    is_metered_code,
)
from src.core.database import get_db
from src.core.security import get_current_user, require_billing_owner
from src.core.time import utcnow
from src.models.billing import (
    BillingPreset,
    BillingProduct,
    BillingProductOut,
    BillingSubscription,
    BillingWebhookEvent,
    BotEntitlement,
    BotUsageCounter,
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

# Présélections du configurateur : pilotées en base (table `billing_presets`,
# éditable admin). Le total est recalculé serveur depuis billing_products.

CATALOG_VERSION = "2026-06-20"

# Dépendances de modules exposées au front (CatalogModule.requires). Statique :
# rag et mcp sont pilotés par l'IA -> requires ['ai']. [] sinon.
_MODULE_REQUIRES: dict[str, list[str]] = {
    MODULE_RAG: [MODULE_AI],
    MODULE_MCP: [MODULE_AI],
}


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
    # Consentement à l'exécution immédiate du service (renonciation au droit de
    # rétractation 14 j) coché au checkout. Horodaté serveur -> métadonnée Stripe.
    consent: bool = False


class SubscriptionUpdatePayload(BaseModel):
    bot_id: int
    config: BotConfigPayload
    consent: bool = False


class SubscriptionCancelPayload(BaseModel):
    # On accepte soit le bot (on retrouve sa sub active), soit la sub directement.
    bot_id: Optional[int] = None
    subscription_id: Optional[str] = None


class GroupingPayload(BaseModel):
    grouping: str = Field(pattern="^(per_bot|total|per_org)$")


class OveragePayload(BaseModel):
    """Toggle owner du dépassement IA métré d'un bot (contrat figé).

    `enabled` : True => overage_mode='meter' (servir + facturer au-delà du quota,
    avec plafond) ; False => 'block' (comportement par défaut). `cap` : plafond de
    sécurité (réponses facturées max/mois) ; null => défaut OVERAGE_CAP_DEFAULT ;
    >= 0 sinon."""
    enabled: bool
    cap: Optional[int] = Field(None, ge=0)


# --- Helpers --------------------------------------------------------------

async def _catalog_rows(db: AsyncSession) -> list[BillingProduct]:
    return (await db.execute(
        select(BillingProduct).order_by(BillingProduct.id)
    )).scalars().all()


# Prix métré du dépassement IA (centimes/réponse) : 0,015 € = 1,5 c. Le produit
# mtr_ai porte un unit_amount entier placeholder (le vrai tarif sub-centime vit
# dans le Price métré, unit_amount_decimal). On expose la valeur figée (1.5) tant
# que le catalogue ne stocke pas le décimal localement.
_OVERAGE_CENTS_PER_REPLY = 1.5


def _overage_cents_per_reply(mtr: BillingProduct | None) -> float:
    """Tarif métré du dépassement (centimes/réponse). Constante produit (1.5) si la
    ligne mtr_ai existe et est active, sinon 0 (métré absent du catalogue)."""
    if mtr is None or not mtr.is_active:
        return 0.0
    return _OVERAGE_CENTS_PER_REPLY


async def _reported_overage_this_month(db: AsyncSession, bot_id: int) -> int:
    """Dépassement IA déjà facturé ce mois (BotUsageCounter, 0 si absent)."""
    row = (await db.execute(
        select(BotUsageCounter).where(
            BotUsageCounter.bot_id == bot_id,
            BotUsageCounter.period == quota_period(),
        )
    )).scalar_one_or_none()
    return int(row.reported_overage or 0) if row is not None else 0


def _metering_available_for_bot(ent) -> bool:
    """metering_available (contrat front) : le toggle dépassement n'est proposé que
    si le métrage est utilisable POUR CE BOT — metering_enabled() ET plan IA managé
    (quota non None) ET non BYOK. Indépendant de l'état du toggle (overage_mode)."""
    return (
        stripe_service.metering_enabled()
        and not ent.byok
        and ent.ai_monthly_quota is not None
        and MODULE_AI in ent.modules
    )


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


def _config_has_ai(config: BotConfigPayload) -> bool:
    """True si la config embarque un plan IA (managé `ai_tier_id` OU BYOK forfait).

    Sert à la règle de socle-inclusion (point 6) : `base` n'est facturé QUE pour un
    bot arbre seul ; dès qu'un plan IA est pris, le socle est INCLUS dans le prix
    du plan IA (donc retiré des line_items Checkout)."""
    return bool(config.ai_byok or config.ai_tier_id)


def _config_to_codes(config: BotConfigPayload) -> tuple[list[str], list[str]]:
    """Traduit une config de bot en codes catalogue.

    Renvoie (codes, modules_actifs). Codes = ['base', <ai_tier|mod_ai_byok>?,
    'mod_<module>'...]. `base` (socle, 9 €) toujours présent dans `codes` pour
    porter une ligne lisible / l'historique ; sa FACTURATION effective est décidée
    à la construction des line_items (point 6 : facturé seul, inclus dès qu'un plan
    IA est pris)."""
    codes: list[str] = ["base"]
    modules: list[str] = []
    # Module IA : variante BYOK forfait OU plan IA managé. (`ai_free` supprimé du
    # catalogue : plus d'IA gratuite à vie — point 7.)
    if config.ai_byok:
        codes.append("mod_ai_byok")
        modules.append(MODULE_AI)
    elif config.ai_tier_id:
        codes.append(config.ai_tier_id)
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

    Point 6 (socle-inclusion) : `base` n'est facturé QUE pour un bot arbre seul
    (aucun plan IA dans `codes`). Dès qu'un plan IA est présent (`ai_*` ou
    `mod_ai_byok`), le socle est INCLUS dans le prix du plan IA et donc RETIRÉ des
    line_items (les prix unitaires des plans IA ne changent pas). Saute aussi les
    produits sans `stripe_price_id` (non seedés / billing OFF) — Stripe refuse
    `price=None`."""
    has_ai = any(c.startswith("ai_") or c == "mod_ai_byok" for c in codes)
    items: list[dict] = []
    for code in codes:
        if code == "base" and has_ai:
            continue  # socle inclus dans le plan IA : pas de ligne séparée
        if is_metered_code(code):
            continue  # ligne MÉTRÉE (mtr_ai) : jamais un line_item à quantité
            # fixe (Stripe 400 si quantity sur un price metered). Le dépassement
            # est (dé)câblé exclusivement par le toggle (_sync_overage_item) ;
            # il ne doit pas être (ré)injecté à la création/au swap de sub.
        row = (await db.execute(
            select(BillingProduct).where(
                BillingProduct.code == code,
                BillingProduct.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if row is None or row.unit_amount <= 0:
            continue  # produit gratuit / absent : pas de ligne facturée
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
            # Ligne MÉTRÉE conservée (mtr_ai) : marquée `metered`, AUCUNE quantity
            # (Stripe 400 sinon sur l'item metered).
            target = [
                {"id": it.get("si_id"), "price": it.get("price_id"),
                 "metered": True}
                if is_metered_code(it.get("code"))
                else {"id": it.get("si_id"), "price": it.get("price_id"),
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


async def _active_sub_for_bot(
    db: AsyncSession, user: User, bot_id: int
) -> BillingSubscription | None:
    """Sub du payeur ACTIVE (active|trialing|past_due) couvrant `bot_id`.

    On parcourt les subs non résiliées du payeur et on retient la 1re dont un
    `raw_items[].bot_id` pointe sur le bot. None si le bot n'a pas de sub active
    (-> relance Checkout côté appelant, point 3 : bot 'inactive')."""
    subs = (await db.execute(
        select(BillingSubscription).where(
            BillingSubscription.user_id == user.id,
            BillingSubscription.status.in_(["active", "trialing", "past_due"]),
        )
    )).scalars().all()
    for sub in subs:
        for item in (sub.raw_items or []):
            if item.get("bot_id") == bot_id:
                return sub
    return None


def _current_codes_for_bot(sub: BillingSubscription, bot_id: int) -> list[str]:
    """Codes catalogue ACTUELLEMENT portés pour `bot_id` par la sub (miroir local).

    Sert au calcul du delta de proration (ADD vs REMOVE) : on compare la
    composition courante du bot (ses `raw_items[].code`) à la composition demandée
    (`_config_to_codes`). Les items des AUTRES bots de la sub sont ignorés."""
    out: list[str] = []
    for it in (sub.raw_items or []):
        if it.get("bot_id") == bot_id and it.get("code"):
            out.append(it["code"])
    return out


def _module_of_code(code: str) -> str | None:
    """Module d'entitlement porté par un code catalogue (None = socle `base` /
    code hors module). Les codes de plan IA (`ai_*`) et `mod_ai_byok` portent tous
    le module IA — c'est le même SLOT (un seul plan IA à la fois)."""
    if code == "base":
        return None
    if code.startswith("ai_") or code == "mod_ai_byok":
        return MODULE_AI
    return CODE_TO_MODULE.get(code)


def _classify_code_changes(
    current: list[str], target: list[str]
) -> tuple[list[str], list[str]]:
    """Classe le passage `current` -> `target` en (removed_codes, changed_now).

    La décision « différé vs immédiat » se prend au niveau MODULE (un SLOT) :
    - `removed_codes` = codes courants dont le MODULE n'est PLUS dans la cible
      (vrai RETRAIT de module) -> à programmer en FIN DE PÉRIODE, sans crédit ;
    - `changed_now` = codes cibles soit d'un module AJOUTÉ, soit d'un code MODIFIÉ
      dans un slot CONSERVÉ (ex. swap de palier IA starter->growth : le module IA
      reste, seul le price change) -> à appliquer MAINTENANT (prorata immédiat).
      Un code cible inchangé (déjà porté) n'y figure pas (rien à facturer).

    `base` (socle) n'est jamais un module : il suit la composition cible des
    line_items (inclus dès qu'un plan IA est pris, point 6) et n'est ni un retrait
    ni un ajout facturable séparé hors bascule arbre<->IA."""
    cur_set = set(current)
    cur_modules = {m for m in (_module_of_code(c) for c in current) if m}
    tgt_modules = {m for m in (_module_of_code(c) for c in target) if m}

    removed_codes = sorted(
        c for c in current
        if (mod := _module_of_code(c)) is not None and mod not in tgt_modules)

    changed_now: list[str] = []
    for c in target:
        if c in cur_set:
            continue  # code déjà porté à l'identique : rien à facturer
        mod = _module_of_code(c)
        if mod is None:
            # `base` (socle) n'est jamais un changement immédiat À LUI SEUL : il ne
            # (ré)apparaît que lors d'une bascule du slot IA (un plan IA retiré ->
            # tree-only fait réapparaître `base`). Il suit donc la phase de cette
            # bascule (différée si l'IA est retirée en fin de période) — jamais
            # facturé maintenant en doublon du plan IA encore actif.
            continue
        # Module AJOUTÉ (mod ∉ courant) OU code MODIFIÉ dans un slot conservé
        # (mod ∈ courant ET ∈ cible mais le code précis diffère) : immédiat.
        if mod not in cur_modules or mod in tgt_modules:
            changed_now.append(c)
    return removed_codes, sorted(changed_now)


def _split_modules_delta(
    current: list[str], target: list[str]
) -> tuple[list[str], list[str]]:
    """Delta au niveau MODULE (added, removed) — utilisé par le MOCK, dont
    l'entitlement ne porte que `modules` (pas les codes/paliers précis). Un
    changement de palier IA qui ne change pas l'ensemble de modules n'apparaît donc
    ni en ajout ni en retrait (le quota cible est réappliqué tel quel)."""
    cur, tgt = set(current), set(target)
    return sorted(tgt - cur), sorted(cur - tgt)


async def _ai_quota_for_codes(db: AsyncSession, codes: list[str]) -> int | None:
    """Quota IA mensuel induit par les codes d'une config : None = illimité (BYOK),
    0 = pas d'IA, sinon `included_replies` du plan IA managé."""
    if "mod_ai_byok" in codes:
        return None  # illimité (BYOK)
    tier = next((c for c in codes if c.startswith("ai_")), None)
    if tier:
        row = (await db.execute(
            select(BillingProduct).where(BillingProduct.code == tier)
        )).scalar_one_or_none()
        return row.included_replies if row is not None else 0
    return 0


async def _project_mock_entitlement(
    db: AsyncSession, bot: Bot, codes: list[str], modules: list[str]
) -> None:
    """MOCK_BILLING : applique directement l'entitlement attendu (simule
    l'abonnement créé au Checkout) pour que les e2e vérifient l'activation sans
    Stripe (spec §2.3). En vrai Stripe, le webhook s'en charge.

    INTRO 1er MOIS REMISÉ (modèle actuel) : plus d'essai gratuit. Le Checkout
    ouvre un abonnement ACTIF immédiatement (1re facture remisée par un coupon
    `duration:once`, carte via if_required). On reflète donc `status='active'`,
    PAS de `trial_end`, et AUCUN plafond IA (le client paie dès le 1er mois)."""
    ai_quota = await _ai_quota_for_codes(db, codes)
    ent = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
    )).scalar_one_or_none()
    if ent is None:
        ent = BotEntitlement(bot_id=bot.id)
        db.add(ent)
    ent.modules = sorted(set(modules))
    ent.ai_monthly_quota = ai_quota
    # Plus d'essai gratuit : l'abo est ACTIF dès la 1re facture (intro 1er mois
    # remisé, carte via if_required). Pas de trial_end ni de plafond IA d'essai.
    ent.status = "active"
    ent.source = "stripe"
    ent.trial_end = None
    ent.synced_at = utcnow()


async def _project_mock_update(
    db: AsyncSession, bot: Bot, ent: BotEntitlement,
    target_codes: list[str], target_modules: list[str],
    removed_modules: list[str],
) -> None:
    """MOCK_BILLING : applique la MODIFICATION d'un bot DÉJÀ souscrit avec la même
    sémantique de proration que le vrai Stripe, sur l'entitlement projeté :

    - AJOUTS effectifs MAINTENANT (modules ajoutés débloqués tout de suite, comme
      la facture de prorata immédiate côté Stripe) ;
    - RETRAITS DIFFÉRÉS en fin de période, SANS crédit : le module retiré reste
      ACTIF (et facturé) jusqu'au renouvellement. En MOCK on n'a pas de cron de
      renouvellement : on CONSERVE donc le module dans `modules` (il reste
      débloqué), conformément à « le module retiré reste actif jusqu'à la fin de
      période ». L'état CIBLE (après période) = `target_modules` — non appliqué
      tant que la période n'est pas écoulée.

    Le STATUT existant est préservé (un abonnement `active` reste `active`, un essai
    LEGACY résiduel reste `trialing`) : une modification ne « rétrograde » jamais un
    abonnement payant en essai. Pour un essai legacy encore en cours, les changements
    ne font que remodeler ce qui sera facturé en fin d'essai (le plafond IA reste
    appliqué par `ai_quota_for`).
    """
    # Modules effectifs MAINTENANT = cible ∪ retraits (les retraits NE quittent PAS
    # l'accès avant la fin de période).
    effective_modules = sorted(set(target_modules) | set(removed_modules))

    # Quota IA : si l'IA est RETIRÉE, on CONSERVE le quota courant jusqu'à la fin de
    # période (accès maintenu) ; sinon (IA ajoutée ou inchangée) on aligne sur la
    # cible demandée.
    if MODULE_AI in removed_modules:
        ai_quota = ent.ai_monthly_quota  # conservé jusqu'à la fin de période
    else:
        ai_quota = await _ai_quota_for_codes(db, target_codes)

    ent.modules = effective_modules
    ent.ai_monthly_quota = ai_quota
    # Statut préservé (jamais de retour en arrière vers l'essai sur un payant).
    if ent.status not in ("active", "trialing", "past_due"):
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
            # `desc` = description commerciale réelle (seed) si posée, sinon label.
            "desc": row.description or row.label,
            "price_cents": row.unit_amount,
            # Dépendances statiques exposées au front (rag/mcp -> ['ai'], [] sinon).
            "requires": _MODULE_REQUIRES.get(mod, []),
        }
        modules_out.append(entry)

    # Module IA exposé comme module avec variante BYOK (byok_price_cents).
    if byok is not None and byok.is_active:
        modules_out.insert(0, {
            "key": MODULE_AI,
            "label": "Intelligence artificielle",
            "short": "IA",
            "desc": byok.description or "Réponses générées par l'IA (plan managé ou BYOK).",
            "price_cents": 0,
            "byok_price_cents": byok.unit_amount,
            # L'IA ne dépend d'aucun module.
            "requires": [],
        })

    ai_tiers = [{
        "id": r.code,
        "included_replies": r.included_replies or 0,
        "price_cents": r.unit_amount,
        "desc": r.description or r.label,
    } for r in rows if r.kind == "ai_tier" and r.is_active]

    # Prix MÉTRÉ réel du dépassement IA : 0,015 € = 1,5 centime par réponse. Le
    # produit mtr_ai porte un unit_amount entier placeholder (2) — le vrai tarif
    # sub-centime vit dans le Price métré (unit_amount_decimal "1.5"). On expose
    # donc la VALEUR en centimes (1.5), pas mtr.unit_amount.
    overage = _overage_cents_per_reply(by_code.get("mtr_ai"))

    # Présélections (pilotées en base, éditable admin) : total recalculé serveur
    # (somme transparente depuis billing_products). Actifs seuls, ordre sort_order.
    preset_rows = (await db.execute(
        select(BillingPreset).where(BillingPreset.is_active.is_(True))
        .order_by(BillingPreset.sort_order, BillingPreset.id)
    )).scalars().all()
    presets_out: list[dict] = []
    for preset in preset_rows:
        est = base_cents
        tier = by_code.get(preset.ai_tier_id) if preset.ai_tier_id else None
        if tier is not None:
            est += tier.unit_amount
        for mod in (preset.modules or []):
            code = next((c for c, m in CODE_TO_MODULE.items()
                         if m == mod and c != "mod_ai_byok"), None)
            row = by_code.get(code) if code else None
            if row is not None:
                est += row.unit_amount
        presets_out.append({
            "key": preset.key,
            "label": preset.label,
            "tagline": preset.tagline,
            "modules": preset.modules or [],
            "ai_tier_id": preset.ai_tier_id,
            "recommended": preset.recommended,
            "est_price_cents": est,
        })

    return {
        "currency": "eur",
        "base_price_cents": base_cents,
        # Socle (9 €) facturé pour un bot arbre seul, inclus dès qu'un plan IA est
        # pris (point 6). Description commerciale réelle (seed) si posée.
        "base_description": base.description if base is not None else None,
        "modules": modules_out,
        "ai_tiers": ai_tiers,
        # Vrai prix métré du dépassement IA (centimes/réponse, ex. 1.5 = 0,015 €).
        "overage_cents_per_reply": overage,
        # Plafond de dépassement par défaut (réponses facturées max/mois) proposé au
        # toggle owner quand aucun cap n'est saisi.
        "overage_cap_default": OVERAGE_CAP_DEFAULT,
        "tax_note": "TVA non applicable, art. 293 B du CGI",
        "presets": presets_out,
        # Remise intro 1er mois (%) lue depuis billing_products.intro_percent
        # ('default' = socle = IA off/BYOK ; ai_* = palier). Affichage front « -X% ».
        "intro_discounts": {
            ("default" if r.code == "base" else r.code): r.intro_percent
            for r in rows if r.intro_percent is not None
        },
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

    # Essais LEGACY du payeur (clients legacy encore en essai : on ne CRÉE plus
    # d'essai, mais des abonnements Stripe `trialing` antérieurs peuvent subsister).
    # Un tel sub projette `status='trialing'` + `trial_end` (= subscription.trial_end)
    # sur bot_entitlements. `trial_end` agrégé = le plus PROCHE parmi ces essais
    # résiduels encore en cours (epoch s) ; null sinon.
    now = utcnow()
    trial_end: int | None = None
    if bots:
        ents = (await db.execute(
            select(BotEntitlement).where(
                BotEntitlement.bot_id.in_([b.id for b in bots]))
        )).scalars().all()
        live_trials = [e.trial_end for e in ents
                       if e.status == "trialing" and e.trial_end is not None
                       and e.trial_end > now]
        if live_trials:
            trial_end = calendar.timegm(min(live_trials).utctimetuple())

    # subscription_status agrégé du payeur (contrat front) : 'active' dès qu'une
    # sub est VRAIMENT active (1er débit passé), sinon 'trialing' si au moins un
    # abonnement LEGACY est encore en essai (clients legacy, plus jamais créé —
    # affiché en neutre « Actif » côté front), sinon 'past_due' si au moins une est
    # past_due, sinon 'none' (tout résilié / aucune sub).
    statuses = {s.status for s in subs}
    if "active" in statuses:
        subscription_status = "active"
    elif "trialing" in statuses or trial_end is not None:
        subscription_status = "trialing"
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
        # Fin du plus proche essai LEGACY en cours (clients legacy, epoch s), null sinon.
        "trial_end": trial_end,
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


# --- Intro 1er mois remisé (piloté en base, éditable admin) ----------------
#
# Remise appliquée au TOTAL de la 1re facture via un coupon Stripe `duration:once`.
# Le % et l'id du coupon sont stockés sur `billing_products` (intro_percent /
# intro_coupon_id) : sur les paliers IA (ai_*) et sur 'base' (= défaut IA off/BYOK).
# Plus aucune valeur en dur : l'admin les édite (rotation du coupon au changement).
def _intro_product_code(config: BotConfigPayload) -> str:
    """Code du produit catalogue portant la remise d'intro de `config` : le palier
    IA managé si présent, sinon 'base' (défaut IA off / BYOK)."""
    if not config.ai_byok and config.ai_tier_id:
        return config.ai_tier_id
    return "base"


async def _intro_coupon_for(db: AsyncSession, config: BotConfigPayload) -> Optional[str]:
    """Id du coupon Stripe d'intro pour `config`, lu depuis billing_products
    (intro_coupon_id). None si non posé => aucune remise appliquée."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == _intro_product_code(config))
    )).scalar_one_or_none()
    return row.intro_coupon_id if row else None


async def _user_has_subscription(db: AsyncSession, user: User) -> bool:
    """True si le client a DÉJÀ un abonnement (toute ligne billing_subscription,
    statut quelconque — conservées même annulées). Sert à n'offrir la remise d'intro
    qu'au PREMIER bot souscrit (offre de bienvenue, UNE FOIS par client, pas par bot)."""
    row = (await db.execute(
        select(BillingSubscription.id)
        .where(BillingSubscription.user_id == user.id).limit(1)
    )).first()
    return row is not None


# --- POST /api/billing/checkout -------------------------------------------

async def _open_checkout(
    db: AsyncSession, user: User, bot: Bot, grouping: str,
    config: BotConfigPayload, consent: bool = False,
) -> dict:
    """Ouvre une session de Checkout Stripe pour `bot` selon `config` (intro 1er
    mois remisé) et renvoie le dict de réponse — SANS commit (l'appelant commit).

    Factorisé pour servir DEUX chemins (point 3) : la 1re souscription
    (POST /billing/checkout) ET la relance de paiement d'un bot 'inactive'
    (POST /billing/subscription/update sans sub active sur le bot). Le caller a
    déjà validé la config et l'ownership."""
    codes, modules = _config_to_codes(config)
    line_items = await _line_items_for_codes(db, codes)

    if not line_items:
        # Aucune ligne facturable (catalogue non seedé / prix manquants) : on ne
        # peut pas créer de Checkout. En MOCK on projette tout de même l'état ACTIF
        # pour que les e2e vérifient l'activation sans Stripe ni catalogue prix réel.
        if settings.MOCK_BILLING:
            await _project_mock_entitlement(db, bot, codes, modules)
        return {"checkout_url": None, "free": True}

    customer_id = await _ensure_customer(db, user)
    # Une seule session payable à la fois (anti double-abonnement).
    await stripe_service.expire_open_checkout_sessions(customer_id)

    # Cartographie bot -> codes RÉELLEMENT facturés (= line_items). On NE retire
    # plus `base` aveuglément : pour un bot arbre seul, `base` EST l'unique ligne
    # facturée et doit être mappée au bot, sinon le webhook ne sait pas l'associer
    # (status resterait gaté). Quand un plan IA est pris, `base` est déjà absent
    # des line_items (point 6).
    bots_map = {str(bot.id): [it["code"] for it in line_items]}
    group_key = f"{grouping}:{user.id}"

    # Consentement à l'exécution immédiate (renonciation rétractation 14 j) :
    # horodaté côté serveur, stocké en métadonnée d'abonnement Stripe (preuve).
    consent_at = utcnow().isoformat() if consent else None
    # Offre de bienvenue : la remise d'intro ne s'applique qu'au PREMIER abonnement
    # du client (1er bot), jamais aux suivants (anti-cumul ; pas une remise par bot).
    intro_coupon = (
        await _intro_coupon_for(db, config)
        if not await _user_has_subscription(db, user) else None
    )
    url = await stripe_service.create_checkout_session(
        customer_id=customer_id,
        line_items=[{"price": it["price"], "quantity": it["quantity"]}
                    for it in line_items],
        bots_map=bots_map,
        group_key=group_key,
        user_id=user.id,
        # Intro 1er mois remisée selon le palier IA (coupon `duration:once`, base).
        intro_coupon=intro_coupon,
        consent_immediate_execution_at=consent_at,
    )

    if settings.MOCK_BILLING:
        # Simule checkout.session.completed : applique l'entitlement directement.
        await _project_mock_entitlement(db, bot, codes, modules)
    return {"checkout_url": url}


@router.post("/billing/checkout")
async def checkout(body: CheckoutPayload, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Crée une session de Checkout Stripe : c'est le SEUL chemin de souscription.

    Abonnement PAYANT IMMÉDIAT : le Checkout ouvre un abonnement Stripe ACTIF dès la
    1re facture (plus d'essai gratuit). Cette 1re facture est REMISÉE par le coupon
    d'intro (`duration:once`, % borné par palier IA — offre de bienvenue, 1x/client).
    La carte n'est demandée que s'il reste un montant dû
    (`payment_method_collection='if_required'`) : oui pour un plan payant (intro 1er
    mois > 0 €), sautée si un coupon 100 % ramène le dû à 0 €. Sans engagement :
    l'abonnement reste annulable à tout moment au Customer Portal (-> subscription.
    deleted -> bot gaté à la fin de période).

    Sert AUSSI à RELANCER le paiement d'un bot 'inactive' (Checkout annulé/abandonné,
    point 3) : même payload, même chemin.

    Socle-inclusion (point 6) : `base` (9 €) n'est facturé QUE pour un bot arbre
    seul (aucun plan IA) ; dès qu'un plan IA est pris, le socle est inclus dans le
    prix du plan et n'apparaît PAS comme line_item.

    Owner-only (require_billing_owner scopée). Billing OFF ⇒ {billing: disabled}.
    Aucun line_item facturable (catalogue non seedé) ⇒ pas de Checkout."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    _validate_config_modules(body.config)
    bot = await db.get(Bot, body.bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    grouping = body.grouping or user.billing_grouping
    result = await _open_checkout(db, user, bot, grouping, body.config, consent=body.consent)
    await db.commit()
    return result


# --- POST /api/billing/subscription/update --------------------------------

@router.post("/billing/subscription/update")
async def subscription_update(body: SubscriptionUpdatePayload,
                              db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Modifie le PLAN/modules d'un bot déjà souscrit, AU PRORATA (règle proration).

    On calcule le DELTA entre la composition COURANTE du bot (ses items de sub) et
    la composition DEMANDÉE (config), puis on applique deux sémantiques distinctes :

    - AJOUTS (modules/paliers ajoutés) : appliqués IMMÉDIATEMENT à la sub Stripe
      avec `proration_behavior='always_invoice'` -> le client est facturé tout de
      suite le prorata du temps restant (« paiement à la modification ») ;
    - RETRAITS (modules retirés) : AUCUN crédit, AUCUNE perte d'accès immédiate. La
      rétrogradation est PROGRAMMÉE en FIN DE PÉRIODE via un Subscription Schedule
      (`schedule_subscription_downgrade`) : le module reste actif et facturé
      jusqu'à `current_period_end`, puis la composition réduite prend effet ;
    - ESSAI LEGACY (`status='trialing'`, clients legacy encore en essai : on n'en
      crée plus) : AUCUN débit immédiat. Les ajouts sont posés avec
      `proration_behavior='none'` -> le prix PLEIN s'appliquera en fin d'essai (la
      facture de fin d'essai porte les items alors présents). Les retraits prennent
      aussi effet en fin de période/essai.

    Changement mixte (ajout + retrait) : on fait les ajouts maintenant
    (always_invoice / none en essai) ET on programme les retraits en fin de période.
    Un retrait ne crédite ni n'abaisse JAMAIS la facture courante. L'état effectif
    (entitlement) est reprojeté par le webhook subscription.updated. Renvoie
    {status:'updated'}.

    Sans subscription ACTIVE sur le bot (bot 'inactive' : Checkout annulé/abandonné,
    point 3) ⇒ on relance le Checkout et renvoie {status:'needs_checkout',
    checkout_url} (l'owner repasse par le Checkout payant, intro 1er mois remisé).

    Owner-only. MOCK_BILLING ⇒ on simule la MÊME sémantique sur l'entitlement
    projeté (ajouts effectifs maintenant, retraits différés en fin de période),
    sauf sur un bot encore 'inactive' (jamais souscrit) -> needs_checkout. Billing
    OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    _validate_config_modules(body.config)
    bot = await db.get(Bot, body.bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    codes, modules = _config_to_codes(body.config)

    if settings.MOCK_BILLING:
        # MOCK : pas de subscription Stripe réelle. Le bot est « souscrit » dès que
        # son entitlement a un statut actif/essai legacy/impayé (posé par un Checkout MOCK
        # antérieur). Un bot jamais souscrit (status 'inactive' / pas d'entitlement)
        # -> relance Checkout (point 3) ; sinon on projette la MÊME sémantique de
        # proration (ajouts maintenant, retraits différés en fin de période).
        row = (await db.execute(
            select(BotEntitlement).where(BotEntitlement.bot_id == bot.id)
        )).scalar_one_or_none()
        subscribed = row is not None and row.status in (
            "active", "trialing", "past_due")
        if not subscribed:
            result = await _open_checkout(
                db, user, bot, user.billing_grouping, body.config, consent=body.consent)
            await db.commit()
            return {"status": "needs_checkout",
                    "checkout_url": result.get("checkout_url")}
        # Delta au niveau MODULE (le MOCK n'a pas de raw_items par bot : la compo
        # courante est portée par `row.modules`). On calcule les modules ajoutés /
        # retirés pour appliquer la sémantique (ajouts maintenant, retraits différés).
        _added_mods, removed_mods = _split_modules_delta(
            list(row.modules or []), modules)
        await _project_mock_update(
            db, bot, row, codes, modules, removed_mods)
        await db.commit()
        return {"status": "updated"}

    # Vrai Stripe : changement au prorata sur la subscription du bot.
    sub = await _active_sub_for_bot(db, user, bot.id)
    if sub is None:
        # Bot sans sub active (jamais payé / annulé) : relance Checkout (point 3).
        result = await _open_checkout(
            db, user, bot, user.billing_grouping, body.config, consent=body.consent)
        await db.commit()
        return {"status": "needs_checkout",
                "checkout_url": result.get("checkout_url")}

    # Items CIBLES (composition demandée) résolus en line_items facturables, et
    # composition COURANTE du bot (codes portés par ses raw_items). On en déduit le
    # DELTA, classé au niveau MODULE (slot) : retraits de module (différés) vs
    # ajouts/modifications dans un slot (immédiats).
    new_items = await _line_items_for_codes(db, codes)
    target_codes = [it["code"] for it in new_items]
    current_codes = _current_codes_for_bot(sub, bot.id)
    removed_codes, changed_now = _classify_code_changes(current_codes, target_codes)

    is_trial = sub.status == "trialing"

    existing = list(sub.raw_items or [])
    # Index price->code des line_items cibles (les ajouts/modifs portent leur price).
    price_by_code = {it["code"]: it["price"] for it in new_items}
    # si_id du bot par price (réutilisé quand le price est déjà porté -> Stripe
    # aligne l'item au lieu d'en créer un doublon).
    si_by_price = {it.get("price_id"): it.get("si_id")
                   for it in existing
                   if it.get("bot_id") == bot.id and it.get("price_id")}
    removed_set = set(removed_codes)
    target_set = set(target_codes)

    def _reconduct(it: dict) -> dict:
        """Reconduit un raw_item TEL QUEL pour update_subscription_items. Un item
        MÉTRÉ (mtr_ai) est marqué `metered` et N'EMPORTE PAS de quantity (Stripe
        400 sinon) ; les items licenciés gardent leur quantité."""
        entry: dict[str, Any] = {"id": it["si_id"], "price": it["price_id"]}
        if is_metered_code(it.get("code")):
            entry["metered"] = True
        else:
            entry["quantity"] = it.get("qty", 1)
        return entry

    other_bot_items = [
        _reconduct(it)
        for it in existing
        if it.get("bot_id") != bot.id and it.get("price_id") and it.get("si_id")]

    # --- (1) MODIFICATIONS IMMÉDIATES (ajout de module / swap de palier dans un
    # slot conservé) : appliquées MAINTENANT. Les RETRAITS de module restent sur la
    # sub (toujours facturés jusqu'à la fin de période). always_invoice hors essai
    # (prorata facturé tout de suite) ; none pour un essai LEGACY résiduel (clients
    # legacy : prix plein en fin d'essai). Pas de modif immédiate -> on ne touche PAS
    # la sub (pas de facture).
    if changed_now:
        now_target: list[dict] = list(other_bot_items)
        bot_existing = [it for it in existing
                        if it.get("bot_id") == bot.id and it.get("si_id")]
        # (a) Ajouts/modifs IMMÉDIATS (changed_now) : créés depuis les line_items
        #     cibles (kept réutilise le si_id par price ; ajout/swap crée l'item).
        for code in changed_now:
            price = price_by_code.get(code)
            if not price:
                continue
            entry: dict[str, Any] = {
                "price": price, "quantity": 1,
                "metadata": {"bot_id": str(bot.id), "code": code}}
            if price in si_by_price:
                entry["id"] = si_by_price[price]
            now_target.append(entry)
        # (b) Codes courants CONSERVÉS (cible inchangée) OU en RETRAIT DIFFÉRÉ
        #     (toujours actifs/facturés jusqu'à la fin de période) : reconduits TELS
        #     QUELS depuis le raw_item (price + si_id), sans repasser par les
        #     line_items cibles (un retrait n'y figure pas). On ne (ré)introduit PAS
        #     un code cible absent (ex. `base` réapparu après un retrait IA différé :
        #     il n'arrive qu'en phase 2, jamais maintenant en doublon du plan IA).
        for it in bot_existing:
            code = it.get("code")
            if code in changed_now:
                continue  # déjà posé en (a)
            # Ligne MÉTRÉE (mtr_ai) : INVARIANTE du changement de plan. Elle ne
            # figure ni dans target_set ni dans removed_set (elle ne porte aucun
            # module) ; sans ce cas elle tomberait dans la boucle de suppression
            # (c) -> item métré retiré alors que le runtime sert + facture le
            # dépassement (fuite de revenu). On la RECONDUIT TELLE QUELLE
            # (metered, sans quantity), (dé)câblée uniquement par le toggle.
            if is_metered_code(code) and it.get("price_id"):
                now_target.append(_reconduct(it))
                continue
            if (code in target_set or code in removed_set) and it.get("price_id"):
                now_target.append(_reconduct(it))
        # (c) SWAP dans un slot conservé : l'ANCIEN item du slot (code courant ni
        #     dans la cible ni en retrait différé, ex. ancien palier IA) est SUPPRIMÉ
        #     MAINTENANT (le nouveau code du slot est déjà posé en (a)). La ligne
        #     MÉTRÉE est exclue (déjà reconduite en (b)) : on ne la supprime JAMAIS
        #     ici (elle n'est pas un slot de plan).
        for it in bot_existing:
            if is_metered_code(it.get("code")):
                continue
            if (it.get("code") not in target_set
                    and it.get("code") not in removed_set):
                now_target.append({"id": it["si_id"], "deleted": True})
        await stripe_service.update_subscription_items(
            sub.stripe_subscription_id, now_target,
            proration_behavior="none" if is_trial else "always_invoice")

    # --- (2) RETRAITS de module : programmés en FIN DE PÉRIODE, SANS crédit. Phase
    # cible = autres bots + items CIBLES du bot (les retraits tombent au
    # renouvellement). Si la phase cible est VIDE (sub entièrement vidée), c'est une
    # résiliation : on garde le flow cancel_at_period_end (intact).
    if removed_codes:
        # Composition CIBLE de la sub en fin de période = autres bots + items CIBLES
        # du bot. Stripe refuse deux items au même price (format total où deux bots
        # partagent un module) -> on AGRÈGE par price en cumulant la quantité.
        qty_by_price: dict[str, int] = {}
        price_order: list[str] = []

        def _add_price(price: str, qty: int) -> None:
            if price not in qty_by_price:
                qty_by_price[price] = 0
                price_order.append(price)
            qty_by_price[price] += qty

        metered_phase_prices: list[str] = []
        for it in existing:
            if not it.get("price_id"):
                continue
            if is_metered_code(it.get("code")):
                # Ligne MÉTRÉE (mtr_ai) : reconduite dans la phase cible SANS
                # quantity (Stripe 400 sinon) et hors agrégation par price. Sans
                # ce report, le retrait de module au renouvellement effacerait
                # l'item métré -> dépassement servi/compté mais plus facturable.
                if it["price_id"] not in metered_phase_prices:
                    metered_phase_prices.append(it["price_id"])
                continue
            if it.get("bot_id") != bot.id:
                _add_price(it["price_id"], int(it.get("qty", 1) or 1))
        for code in target_codes:
            _add_price(price_by_code[code], 1)

        phase_items = [{"price": price, "quantity": qty_by_price[price]}
                       for price in price_order]
        phase_items += [{"price": price, "metered": True}
                        for price in metered_phase_prices]
        if phase_items:
            await stripe_service.schedule_subscription_downgrade(
                sub.stripe_subscription_id, phase_items)
        else:
            # Plus aucun item en fin de période -> résiliation en fin de période
            # (sans remboursement) : on réutilise le flow de résiliation existant.
            await stripe_service.cancel_at_period_end(sub.stripe_subscription_id)
            sub.cancel_at_period_end = True

    # L'état effectif (entitlement) est reprojeté par le webhook subscription.updated
    # (les ajouts immédiatement ; les retraits au renouvellement / passage de phase).
    await db.commit()
    return {"status": "updated"}


# --- POST /api/billing/subscription/cancel --------------------------------

@router.post("/billing/subscription/cancel")
async def subscription_cancel(body: SubscriptionCancelPayload,
                              db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Annule l'abonnement d'un bot en FIN DE PÉRIODE (règle 2, point 2).

    `cancel_at_period_end=true` sur la sub Stripe : AUCUN remboursement, le bot
    reste ACTIF jusqu'à `current_period_end`, puis Stripe émet
    subscription.deleted -> le webhook gate le bot. Renvoie {status:'cancel_scheduled',
    current_period_end} (epoch s | null).

    Cible : `subscription_id` (doit appartenir au payeur) OU `bot_id` (on retrouve
    sa sub active). Owner-only via la possession de la sub / require_billing_owner.
    MOCK_BILLING : marque la sub localement (cancel_at_period_end=True). Billing OFF
    ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    sub: BillingSubscription | None = None
    if body.subscription_id:
        # La sub doit appartenir au payeur (anti-énumération inter-comptes).
        sub = (await db.execute(
            select(BillingSubscription).where(
                BillingSubscription.stripe_subscription_id == body.subscription_id,
                BillingSubscription.user_id == user.id,
            )
        )).scalar_one_or_none()
    elif body.bot_id is not None:
        bot = await db.get(Bot, body.bot_id)
        if bot is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
        await require_billing_owner(bot, user, db)
        sub = await _active_sub_for_bot(db, user, bot.id)
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "bot_id ou subscription_id requis")

    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Aucun abonnement actif à annuler")

    # Programme la résiliation en fin de période (sans remboursement, sans proration).
    stripe_sub = await stripe_service.cancel_at_period_end(sub.stripe_subscription_id)
    sub.cancel_at_period_end = True

    # current_period_end (epoch s) : depuis l'objet Stripe (vrai), sinon le miroir
    # local (MOCK / Stripe muet). Le bot reste actif jusque-là.
    period_end: int | None = None
    if isinstance(stripe_sub, dict) and isinstance(
            stripe_sub.get("current_period_end"), int):
        period_end = stripe_sub["current_period_end"]
    elif sub.current_period_end is not None:
        period_end = calendar.timegm(sub.current_period_end.utctimetuple())

    await db.commit()
    return {"status": "cancel_scheduled", "current_period_end": period_end}


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
        reported_overage = await _reported_overage_this_month(db, bot.id)
        out.append({
            "bot_id": bot.id,
            "period": period,
            "usage_ai_replies": used,
            "quota_ai_replies": None if ent.byok else ent.ai_monthly_quota,
            "byok": ent.byok,
            # Axe IA métré (dépassement) : mode (block|meter), conso de dépassement
            # du mois, plafond (null = défaut OVERAGE_CAP_DEFAULT).
            "overage_mode": ent.overage_mode,
            "reported_overage": reported_overage,
            "overage_cap": ent.overage_cap,
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


async def _ai_tier_id_for_quota(db: AsyncSession, quota: int | None) -> Optional[str]:
    """Déduit le palier IA managé (`ai_*`) à partir du quota mensuel stocké sur
    l'entitlement. Le palier précis n'est pas persisté : on le retrouve via le
    quota (paliers à `included_replies` distincts — 1000/3000/10000). None si pas
    de correspondance (BYOK, pas d'IA, ou quota plafonné sur un essai legacy). Sert au
    pré-remplissage du configurateur (Facturation) et au diff « évolution du plan »."""
    if not quota:
        return None
    rows = await _catalog_rows(db)
    for r in rows:
        if r.kind == "ai_tier" and r.is_active and (r.included_replies or 0) == quota:
            return r.code
    return None


async def _bot_entitlement_response(db: AsyncSession, bot: Bot) -> dict:
    """Construit la réponse `BotBilling` d'un bot (forme FIGÉE, réutilisée par
    GET /bots/{id}/entitlement ET POST /bots/{id}/overage : le front re-render avec
    la même structure). L'ownership est vérifié par l'APPELANT."""
    bot_id = bot.id
    ent = await resolve(db, bot)
    period = quota_period()
    period_start, period_end = _month_bounds_iso(period)
    used = await ai_quota_usage(db, bot_id)

    # subscription_status : 'none' tant que le billing est OFF ou que le bot n'a
    # pas d'entitlement projeté (gratuit). Sinon on remonte le statut de la ligne
    # (active | trialing | past_due | canceled). 'trialing' = essai LEGACY encore en
    # cours (clients legacy, plus jamais créé) — le gate à l'expiration est porté par
    # `ent.status` (resolve).
    row = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
    )).scalar_one_or_none()
    trial_end_epoch: int | None = None
    if not stripe_service.billing_enabled() or row is None:
        sub_status = "none"
    else:
        sub_status = row.status if row.status in (
            "active", "trialing", "past_due", "canceled") else "none"
        if row.status == "trialing" and row.trial_end is not None:
            trial_end_epoch = calendar.timegm(row.trial_end.utctimetuple())

    modules = sorted(ent.modules)
    # Palier IA précis (non stocké sur l'entitlement) : déduit du quota mensuel.
    # Sert au pré-remplissage du configurateur + au diff d'évolution du plan.
    ai_tier_id = (
        await _ai_tier_id_for_quota(db, row.ai_monthly_quota)
        if row is not None and not ent.byok and MODULE_AI in ent.modules
        else None
    )

    # --- Axe IA métré (dépassement) : champs additifs du contrat front ---
    # metering_available : le toggle owner n'est affiché QUE si true (métrage
    # utilisable + plan IA managé + non BYOK). reported_overage : conso de
    # dépassement du mois. overage_cents_per_reply : vrai prix métré (1.5).
    reported_overage = await _reported_overage_this_month(db, bot_id)
    metering_available = _metering_available_for_bot(ent)
    mtr = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == "mtr_ai")
    )).scalar_one_or_none()
    overage_cents = _overage_cents_per_reply(mtr)
    return {
        "bot_id": bot_id,
        # `modules` (clés d'entitlement) ET `active_modules` (alias contrat front
        # BotBilling) : deux consommateurs (e2e billing-degradation lit `modules`,
        # BotPage lit `active_modules`). Même liste, jamais divergente.
        "modules": modules,
        "active_modules": modules,
        "ai_tier_id": ai_tier_id,
        "ai_byok": ent.byok,
        "usage_ai_replies": used,
        "quota_ai_replies": None if ent.byok else ent.ai_monthly_quota,
        "period_start": period_start,
        "period_end": period_end,
        # `status` = statut effectif de l'entitlement (e2e billing-owner-gating) ;
        # `subscription_status` = même info sous la clé du contrat front BotBilling.
        "status": ent.status,
        "subscription_status": sub_status,
        # Fin d'essai LEGACY (epoch s) pour un essai résiduel, sinon null.
        "trial_end": trial_end_epoch,
        # Essai LEGACY expiré (clients legacy uniquement) : distinct du quota épuisé.
        # False hors essai / essai en cours / payé.
        "trial_expired": ent.trial_expired,
        # --- Dépassement IA métré (contrat front BotBilling) ---
        "overage_mode": ent.overage_mode,                 # block | meter
        "overage_enabled": ent.overage_mode == "meter",   # = toggle owner armé
        "overage_cap": ent.overage_cap,                   # null = défaut 1000
        "reported_overage": reported_overage,             # dépassement facturé ce mois
        "overage_cents_per_reply": overage_cents,         # vrai prix métré (1.5)
        # Le front n'affiche le toggle dépassement QUE si metering_available est true.
        "metering_available": metering_available,
    }


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
    return await _bot_entitlement_response(db, bot)


# --- POST /api/bots/{bot_id}/overage --------------------------------------

@router.post("/bots/{bot_id}/overage")
async def set_bot_overage(bot_id: int, body: OveragePayload,
                          db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Toggle OWNER du dépassement IA métré d'un bot (contrat figé).

    Au-delà du quota : SERVIR + FACTURER avec PLAFOND de sécurité (mode 'meter'),
    ou bloquer (mode 'block', défaut). Owner-only (require_billing_owner scopée).

    - billing OFF ⇒ {billing: disabled} (200, aucune mutation).
    - métrage indisponible (metering_enabled() faux) ⇒ 409 metering_unavailable.
    - bot BYOK OU pas de plan IA managé (quota None/0) ⇒ 409 overage_not_applicable.
    - sinon : upsert bot_entitlements (overage_mode = 'meter' si enabled sinon
      'block' ; overage_cap = cap ou OVERAGE_CAP_DEFAULT si null ; source inchangée).
      Vrai Stripe + enabled : attache l'item MÉTRÉ mtr_ai (sans quantity) à la sub
      ACTIVE du bot ; disabled : retire cet item (best-effort). MOCK ⇒ colonnes
      seulement. Renvoie la MÊME forme que GET /bots/{id}/entitlement (re-render)."""
    if not stripe_service.billing_enabled():
        return _DISABLED

    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    if not stripe_service.metering_enabled():
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"error": "metering_unavailable"})

    ent = await resolve(db, bot)
    # BYOK ou pas de plan IA managé (quota None = illimité/BYOK, 0 = pas d'IA) :
    # le dépassement n'a pas de sens (rien à dépasser).
    if ent.byok or not ent.ai_monthly_quota:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"error": "overage_not_applicable"})

    cap = body.cap if body.cap is not None else OVERAGE_CAP_DEFAULT

    row = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
    )).scalar_one_or_none()
    if row is None:
        # Bot avec un plan IA managé mais sans ligne projetée : ne devrait pas
        # arriver (resolve a vu un quota), mais on crée défensivement (source free
        # -> staff serait trompeur ; on laisse le défaut de colonne).
        row = BotEntitlement(bot_id=bot_id)
        db.add(row)
    row.overage_mode = "meter" if body.enabled else "block"
    row.overage_cap = cap
    # source INCHANGÉE (le toggle dépassement n'est pas un override de plan).
    row.synced_at = utcnow()

    # Vrai Stripe (hors MOCK) : (dé)attache l'item MÉTRÉ mtr_ai sur la sub active.
    if not settings.MOCK_BILLING:
        await _sync_overage_item(db, user, bot, row, enabled=body.enabled)

    await db.commit()
    return await _bot_entitlement_response(db, bot)


def _metered_si_id(sub_obj: Optional[dict], price_id: str) -> Optional[str]:
    """si_id (si_...) de l'item métré (price == price_id) dans un objet subscription
    Stripe renvoyé par update_subscription_items. None si absent / Stripe muet."""
    if not isinstance(sub_obj, dict):
        return None
    for it in ((sub_obj.get("items") or {}).get("data") or []):
        if ((it.get("price") or {}).get("id")) == price_id:
            return it.get("id")
    return None


async def _sync_overage_item(db: AsyncSession, user: User, bot: Bot,
                             ent_row: BotEntitlement, enabled: bool) -> None:
    """Attache (enabled) ou retire (disabled) l'item MÉTRÉ mtr_ai sur la sub ACTIVE
    du bot. Best-effort : toute StripeError est AVALÉE (le toggle DB fait foi ;
    un hoquet Stripe ne doit pas faire échouer l'activation côté owner)."""
    sub = await _active_sub_for_bot(db, user, bot.id)
    if sub is None:
        return  # pas de sub active : rien à câbler côté Stripe (toggle DB seul)

    mtr = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == "mtr_ai")
    )).scalar_one_or_none()
    if mtr is None or not mtr.stripe_price_id:
        return  # mtr_ai non poussé chez Stripe (métrage non seedé) : toggle DB seul

    existing = list(sub.raw_items or [])
    # Tous les items courants reconduits TELS QUELS (price + si_id), sans quantity
    # pour les items métrés.
    target: list[dict] = []
    metered_item_present = False
    for it in existing:
        price = it.get("price_id")
        if not price:
            continue
        entry: dict[str, Any] = {"id": it.get("si_id"), "price": price}
        if price == mtr.stripe_price_id:
            metered_item_present = True
            entry["metered"] = True
            if not enabled:
                entry["deleted"] = True
        else:
            entry["quantity"] = it.get("qty", 1)
        target.append(entry)

    if enabled and not metered_item_present:
        # Ajoute l'item métré (AUCUNE quantity) lié au bot (metadata bot_id).
        target.append({
            "price": mtr.stripe_price_id, "metered": True,
            "metadata": {"bot_id": str(bot.id), "code": "mtr_ai"}})

    try:
        updated = await stripe_service.update_subscription_items(
            sub.stripe_subscription_id, target, proration_behavior="none")
        # Refléter le miroir local (sub.raw_items) ET capturer le vrai si_id de
        # l'item métré. Un webhook subscription.updated reprojettera raw_items, mais
        # s'il N'EST PAS encore arrivé et que l'owner désactive aussitôt, le miroir
        # local doit déjà porter l'item métré — sinon il resterait ORPHELIN sur la
        # sub Stripe et facturerait l'usage rapporté (metered_item_present le retrouve
        # alors et émet sa suppression).
        items = list(sub.raw_items or [])
        if enabled:
            ent_row.stripe_item_id = _metered_si_id(updated, mtr.stripe_price_id)
            if not any(it.get("price_id") == mtr.stripe_price_id for it in items):
                items.append({"si_id": ent_row.stripe_item_id,
                              "price_id": mtr.stripe_price_id,
                              "code": "mtr_ai", "bot_id": bot.id, "qty": 1})
        else:
            ent_row.stripe_item_id = None
            items = [it for it in items
                     if it.get("price_id") != mtr.stripe_price_id]
        sub.raw_items = items
    except stripe_service.StripeError as exc:
        logger.warning("overage: maj item métré sub %s échouée (ignorée) : %s",
                       sub.stripe_subscription_id, exc)


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
