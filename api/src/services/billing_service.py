"""Logique MÉTIER de facturation partagée — extraite de routers/billing.py (PR-19).

Ce module porte la logique de facturation RÉUTILISÉE par DEUX surfaces HTTP sans
qu'elles se couplent l'une à l'autre :
- le router DASHBOARD (routers/billing.py, auth get_current_user) ;
- la surface EXTERNE plugin (routers/external/account.py, auth require_oauth_token).

Avant PR-19, account.py importait routers/billing.py et appelait ses fonctions
PRIVÉES (`_billable_bots`, `_catalog_payload`, `_validate_config_modules`,
`_DISABLED`) — couplage router→router, abstraction fuyante. On déplace ici la
logique PURE (pas de HTTP, pas de Depends) ; billing.py la RÉ-EXPOSE sous ses noms
historiques (alias) pour ses appelants internes et les tests.

PÉRIMÈTRE (serré) : on ne déplace QUE la logique consommée par les deux surfaces.
Le moteur de Checkout/abonnement (`open_checkout` et sa cascade de helpers) reste
dans billing.py — son extraction est le chantier PR-20 (split de billing.py).

Ce service ne doit JAMAIS importer un router (sinon cycle import).
"""
from typing import Any

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
)
from src.models.billing import (
    BillingPreset,
    BillingProduct,
    BillingProductOut,
    BotConfigPayload,
)
from src.models.bot import Bot
from src.models.user import Organization, User
from src.services import stripe_service

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
