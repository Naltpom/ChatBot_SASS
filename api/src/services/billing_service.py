"""Logique MÉTIER de facturation partagée.

Ce module porte la logique de facturation RÉUTILISÉE par DEUX surfaces HTTP sans
qu'elles se couplent l'une à l'autre :
- le router DASHBOARD (routers/billing.py, auth get_current_user) ;
- la surface EXTERNE plugin (routers/external/account.py, auth require_oauth_token).

Logique PURE (pas de HTTP, pas de Depends) ; billing.py la RÉ-EXPOSE sous ses noms
historiques (alias `_billable_bots`, `_catalog_payload`, ...) pour ses appelants
internes et les tests.

Ce service ne doit JAMAIS importer un router (sinon cycle import).
"""
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import (
    CODE_TO_MODULE,
    MODULE_AI,
    MODULE_KEYS,
    MODULE_MCP,
    MODULE_RAG,
    OVERAGE_CAP_DEFAULT,
    is_metered_code,
)
from src.models.billing import (
    BillingPreset,
    BillingProduct,
    BillingProductOut,
    BillingSubscription,
    BotConfigPayload,
    BotUsageCounter,
)
from src.models.bot import Bot
from src.models.user import Organization, User
from src.services import stripe_service
from src.services.quota_service import quota_period

# Réponse standard quand le billing est OFF (clés Stripe absentes — invariant D0).
DISABLED = {"billing": "disabled"}

CATALOG_VERSION = "2026-06-20"

# Dépendances de modules exposées au front (CatalogModule.requires). Statique :
# rag et mcp sont pilotés par l'IA -> requires ['ai']. [] sinon.
_MODULE_REQUIRES: dict[str, list[str]] = {
    MODULE_RAG: [MODULE_AI],
    MODULE_MCP: [MODULE_AI],
}

# Prix métré du dépassement IA (centimes/réponse) : 0,015 € = 1,5 c. Le produit
# mtr_ai porte un unit_amount entier placeholder (le vrai tarif sub-centime vit
# dans le Price métré, unit_amount_decimal). On expose la valeur figée (1.5) tant
# que le catalogue ne stocke pas le décimal localement.
_OVERAGE_CENTS_PER_REPLY = 1.5


# --- Bots facturables du payeur -------------------------------------------

async def billable_bots(db: AsyncSession, user: User) -> list[Bot]:
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


# --- Validation de config -------------------------------------------------

def validate_config_modules(config: BotConfigPayload) -> None:
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


# --- Catalogue ------------------------------------------------------------

async def _catalog_rows(db: AsyncSession) -> list[BillingProduct]:
    return (await db.execute(
        select(BillingProduct).order_by(BillingProduct.id)
    )).scalars().all()


def _overage_cents_per_reply(mtr: BillingProduct | None) -> float:
    """Tarif métré du dépassement (centimes/réponse). Constante produit (1.5) si la
    ligne mtr_ai existe et est active, sinon 0 (métré absent du catalogue)."""
    if mtr is None or not mtr.is_active:
        return 0.0
    return _OVERAGE_CENTS_PER_REPLY


async def catalog_payload(db: AsyncSession) -> dict:
    """Corps du contrat de catalogue, FACTORISÉ pour être servi À L'IDENTIQUE sur
    DEUX surfaces : GET /api/billing/catalog (dashboard, get_current_user) ET
    GET /api/account/catalog (plugin, require_oauth_token). Le front ET le plugin
    consomment ainsi le MÊME contrat de prix (aucun prix codé en dur, parité D4).

    Billing OFF ⇒ {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return DISABLED

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


# --- Helpers MÉTIER Checkout / abonnement -----------------------------------
#
# Logique PURE (config -> codes -> line_items, classification du delta de
# proration, helpers de lecture du miroir/quota). Le router billing.py garde ses
# @router.post FINS (validation requête -> appel service -> réponse) et RÉ-EXPOSE
# ces helpers sous leurs noms historiques (alias) pour ses appelants internes
# (open_checkout / subscription_update / ...) et les tests. AUCUN HTTP ici.
# Ne JAMAIS importer un router (cycle).


async def reported_overage_this_month(db: AsyncSession, bot_id: int) -> int:
    """Dépassement IA déjà facturé ce mois (BotUsageCounter, 0 si absent)."""
    row = (await db.execute(
        select(BotUsageCounter).where(
            BotUsageCounter.bot_id == bot_id,
            BotUsageCounter.period == quota_period(),
        )
    )).scalar_one_or_none()
    return int(row.reported_overage or 0) if row is not None else 0


def metering_available_for_bot(ent) -> bool:
    """metering_available (contrat front) : le toggle dépassement n'est proposé que
    si le métrage est utilisable POUR CE BOT — metering_enabled() ET plan IA managé
    (quota non None) ET non BYOK. Indépendant de l'état du toggle (overage_mode)."""
    return (
        stripe_service.metering_enabled()
        and not ent.byok
        and ent.ai_monthly_quota is not None
        and MODULE_AI in ent.modules
    )


def config_has_ai(config: BotConfigPayload) -> bool:
    """True si la config embarque un plan IA (managé `ai_tier_id` OU BYOK forfait).

    Sert à la règle de socle-inclusion (point 6) : `base` n'est facturé QUE pour un
    bot arbre seul ; dès qu'un plan IA est pris, le socle est INCLUS dans le prix
    du plan IA (donc retiré des line_items Checkout)."""
    return bool(config.ai_byok or config.ai_tier_id)


def config_to_codes(config: BotConfigPayload) -> tuple[list[str], list[str]]:
    """Traduit une config de bot en codes catalogue.

    Renvoie (codes, modules_actifs). Codes = ['base', <ai_tier|mod_ai_byok>?,
    'mod_<module>'...]. `base` (socle, 9 €) toujours présent dans `codes` pour
    porter une ligne lisible / l'historique ; sa FACTURATION effective est décidée
    à la construction des line_items (point 6 : facturé seul, inclus dès qu'un plan
    IA est pris)."""
    codes: list[str] = ["base"]
    modules: list[str] = []
    # Module IA : variante BYOK forfait OU plan IA managé (pas d'IA gratuite).
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


async def line_items_for_codes(
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


async def ensure_customer(db: AsyncSession, user: User) -> str:
    """Customer Stripe du payeur (création paresseuse à la 1re souscription)."""
    if user.stripe_customer_id:
        return user.stripe_customer_id
    cus = await stripe_service.create_customer(user, user.billing_email or user.email)
    user.stripe_customer_id = cus
    await db.flush()
    return cus


def scope_for_bot(grouping: str, bot: Bot) -> tuple[str, int | None, int | None]:
    """(scope_kind, scope_bot_id, scope_org_id) d'une sub par bot selon le format."""
    if grouping == "per_bot":
        return "bot", bot.id, None
    if grouping == "per_org":
        if bot.organization_id is not None:
            return "org", None, bot.organization_id
        return "user_personal", None, None
    return "user_all", None, None  # total


async def active_sub_for_bot(
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


def current_codes_for_bot(sub: BillingSubscription, bot_id: int) -> list[str]:
    """Codes catalogue ACTUELLEMENT portés pour `bot_id` par la sub (miroir local).

    Sert au calcul du delta de proration (ADD vs REMOVE) : on compare la
    composition courante du bot (ses `raw_items[].code`) à la composition demandée
    (`config_to_codes`). Les items des AUTRES bots de la sub sont ignorés."""
    out: list[str] = []
    for it in (sub.raw_items or []):
        if it.get("bot_id") == bot_id and it.get("code"):
            out.append(it["code"])
    return out


def module_of_code(code: str) -> str | None:
    """Module d'entitlement porté par un code catalogue (None = socle `base` /
    code hors module). Les codes de plan IA (`ai_*`) et `mod_ai_byok` portent tous
    le module IA — c'est le même SLOT (un seul plan IA à la fois)."""
    if code == "base":
        return None
    if code.startswith("ai_") or code == "mod_ai_byok":
        return MODULE_AI
    return CODE_TO_MODULE.get(code)


def classify_code_changes(
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
    cur_modules = {m for m in (module_of_code(c) for c in current) if m}
    tgt_modules = {m for m in (module_of_code(c) for c in target) if m}

    removed_codes = sorted(
        c for c in current
        if (mod := module_of_code(c)) is not None and mod not in tgt_modules)

    changed_now: list[str] = []
    for c in target:
        if c in cur_set:
            continue  # code déjà porté à l'identique : rien à facturer
        mod = module_of_code(c)
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


def split_modules_delta(
    current: list[str], target: list[str]
) -> tuple[list[str], list[str]]:
    """Delta au niveau MODULE (added, removed) — utilisé par le MOCK, dont
    l'entitlement ne porte que `modules` (pas les codes/paliers précis). Un
    changement de palier IA qui ne change pas l'ensemble de modules n'apparaît donc
    ni en ajout ni en retrait (le quota cible est réappliqué tel quel)."""
    cur, tgt = set(current), set(target)
    return sorted(tgt - cur), sorted(cur - tgt)


async def ai_quota_for_codes(db: AsyncSession, codes: list[str]) -> int | None:
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


def intro_product_code(config: BotConfigPayload) -> str:
    """Code du produit catalogue portant la remise d'intro de `config` : le palier
    IA managé si présent, sinon 'base' (défaut IA off / BYOK)."""
    if not config.ai_byok and config.ai_tier_id:
        return config.ai_tier_id
    return "base"


async def intro_coupon_for(db: AsyncSession, config: BotConfigPayload) -> Optional[str]:
    """Id du coupon Stripe d'intro pour `config`, lu depuis billing_products
    (intro_coupon_id). None si non posé => aucune remise appliquée."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == intro_product_code(config))
    )).scalar_one_or_none()
    return row.intro_coupon_id if row else None


async def user_has_subscription(db: AsyncSession, user: User) -> bool:
    """True si le client a DÉJÀ un abonnement (toute ligne billing_subscription,
    statut quelconque — conservées même annulées). Sert à n'offrir la remise d'intro
    qu'au PREMIER bot souscrit (offre de bienvenue, UNE FOIS par client, pas par bot)."""
    row = (await db.execute(
        select(BillingSubscription.id)
        .where(BillingSubscription.user_id == user.id).limit(1)
    )).first()
    return row is not None


def month_bounds_iso(period: str) -> tuple[str, str]:
    """Bornes ISO (UTC) du mois calendaire "YYYY-MM" : (1er du mois, 1er du mois
    suivant). Aligné sur quota_period()/count_ai_messages_month (D8)."""
    year, month = (int(p) for p in period.split("-"))
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    return start.isoformat(), end.isoformat()


async def ai_tier_id_for_quota(db: AsyncSession, quota: int | None) -> Optional[str]:
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
