"""Logique MÉTIER « bot » partagée — extraite de routers/bots.py (PR-19).

Logique RÉUTILISÉE par le router DASHBOARD (routers/bots.py) ET la surface EXTERNE
plugin (routers/external/account.py) sans coupler les routers entre eux :
- `billing_status_for_bots` : badge billing_status / trial_end par bot (1 select) ;
- `strip_notnull_nulls` + `enforce_config_modules` : pipeline de gating des modules
  au PATCH (parité + 402 sur capacité payante non souscrite).

Avant PR-19, account.py appelait ces fonctions sous leurs noms PRIVÉS dans
routers/bots.py (`_billing_status_for_bots`, `_strip_notnull_nulls`,
`_enforce_config_modules`) — couplage router→router. bots.py les RÉ-EXPOSE
désormais sous ces alias historiques (appelants internes + tests inchangés).

Ce service ne doit JAMAIS importer un router (sinon cycle import).
"""
import calendar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import (
    MODULE_ACTIONS,
    MODULE_AB,
    MODULE_AI,
    MODULE_MCP,
    MODULE_WHITELABEL,
)
from src.core.time import utcnow
from src.models.billing import BotEntitlement
from src.models.bot import Bot
from src.services.entitlement_service import gate
from src.services.stripe_service import billing_enabled
from src.services.tree_engine import validate_tree


# --- Badge billing_status par bot -----------------------------------------

async def billing_status_for_bots(
    db: AsyncSession, bot_ids: list[int]
) -> dict[int, tuple[str | None, int | None]]:
    """billing_status + trial_end (epoch s) par bot, pour le badge front (regle 4).

    INVARIANT billing OFF (D0) : billing_enabled()==False -> {} (tous les bots
    ressortent (None, None), aucun badge). Sinon on lit les bot_entitlements en
    UN seul select : status = le statut de la ligne (trialing|active|past_due|
    inactive|suspended), un bot sans ligne (legacy/dev) reste None. trial_end
    n'est porte que pour un status='trialing'."""
    if not billing_enabled() or not bot_ids:
        return {}
    rows = (await db.execute(
        select(BotEntitlement).where(BotEntitlement.bot_id.in_(bot_ids))
    )).scalars().all()
    out: dict[int, tuple[str | None, int | None]] = {}
    for row in rows:
        # 'canceled' (legacy) est replié sur 'inactive' (= paiement requis) ; les
        # autres statuts hors liste -> None (aucun badge).
        raw = row.status
        if raw == "canceled":
            status_ = "inactive"
        elif raw in ("trialing", "active", "past_due", "inactive", "suspended"):
            status_ = raw
        else:
            status_ = None
        trial_end: int | None = None
        if row.status == "trialing" and row.trial_end is not None:
            trial_end = calendar.timegm(row.trial_end.utctimetuple())
        out[row.bot_id] = (status_, trial_end)
    return out


# --- Pipeline de gating des modules au PATCH ------------------------------

# Colonnes NOT NULL : un null explicite entrant est retiré AVANT setattr (sinon
# JSON null persiste / intégrité violée). ab_split_pct n'y figure PAS : null
# explicite = désactivation voulue de la variante A/B.
_NOTNULL_NO_NULL_FIELDS = ("actions_json", "tree_json", "design_json", "allowed_domains",
                           "mcp_servers_json", "triggers_json", "ab_split_pct")


def strip_notnull_nulls(data: dict) -> None:
    """Retire (in place) les null explicites visant des colonnes NOT NULL,
    AVANT la boucle setattr (sinon JSON null persiste / integrite violee)."""
    for field in _NOTNULL_NO_NULL_FIELDS:
        if field in data and data[field] is None:
            data.pop(field)


def enforce_config_modules(bot: Bot, data: dict, ent) -> None:
    """Enforcement CONFIG des modules forfaitaires au PATCH (spec §3.3).

    Check d'entitlement AVANT l'effet : modifier une capacite payante d'un bot
    non souscrit -> 402 (mode enforce) ou log-only (mode observe). Billing OFF /
    bot sans entitlement -> ALL_UNLOCKED -> `gate` no-op (invariant D0).

    - Module IA : toucher `mode` (ai|hybrid) / `system_prompt` / `ai_provider`
      / `ai_model` -> MODULE_AI.
    - Module Actions : `actions_json` non vide -> MODULE_ACTIONS (webhooks /
      capture de leads / tickets / créneaux : exécutables dans un arbre SANS IA).
    - Module MCP : `mcp_servers_json` non vide -> MODULE_MCP (serveurs MCP appelés
      par l'IA).
    - Module A/B : `tree_variant_json` non null OU `ab_split_pct>0` -> MODULE_AB.
    - Module White-label : `design_json.poweredBy` mis a FALSY (retrait du badge
      « Powered by ») -> MODULE_WHITELABEL. Les autres champs d'apparence
      (couleurs, polices...) restent GRATUITS (socle apparence libre).

    Partage par le PATCH et l'import de config (meme gate, meme 402).
    """
    # --- IA ---
    touches_ai = (
        ("mode" in data and data["mode"] in ("ai", "hybrid"))
        or "system_prompt" in data
        or "ai_provider" in data
        or "ai_model" in data
    )
    if touches_ai:
        gate(ent, MODULE_AI)

    # --- Actions --- (webhooks/leads/tickets/créneaux : exécutables SANS IA)
    if data.get("actions_json"):
        gate(ent, MODULE_ACTIONS)
    # --- MCP --- (serveurs MCP appelés par l'IA)
    if data.get("mcp_servers_json"):
        gate(ent, MODULE_MCP)

    # --- A/B --- tree_variant_json non-null = variante active ; ab_split_pct>0 =
    # split actif. strip_notnull_nulls a deja retire un ab_split_pct null ; un
    # tree_variant_json explicitement null = desactivation (jamais gate).
    variant_set = data.get("tree_variant_json") is not None and "tree_variant_json" in data
    split_set = isinstance(data.get("ab_split_pct"), int) and data["ab_split_pct"] > 0
    if variant_set or split_set:
        gate(ent, MODULE_AB)

    # --- White-label --- retirer le badge « Powered by » (poweredBy falsy dans le
    # design entrant) exige le module. SEUL poweredBy=false est gate : toutes les
    # autres cles d'apparence (couleurs, police, themes...) restent gratuites.
    # SEUL un retrait explicite est gate (la cle doit etre presente ET falsy) ;
    # garder poweredBy=true, ou ne pas toucher au design, ne gate jamais. Belt &
    # suspenders : widget.py force poweredBy=true au bootstrap sans le module.
    design = data.get("design_json")
    if isinstance(design, dict) and "poweredBy" in design and not design["poweredBy"]:
        gate(ent, MODULE_WHITELABEL)


# --- Orchestration arbre / apparence (partagée dashboard / plugin / embed) --

async def apply_tree_update(bot: Bot, tree_json: dict, db: AsyncSession) -> tuple[dict, str]:
    """Valide puis persiste l'arbre d'un bot. Lève TreeError si l'arbre est
    structurellement invalide (l'appelant -> 422). Renvoie (tree_json persisté,
    updated_at ISO-8601). Partagé par les surfaces /api/account et /api/embed."""
    validate_tree(tree_json)
    bot.tree_json = tree_json
    bot.updated_at = utcnow()
    await db.commit()
    await db.refresh(bot)
    return bot.tree_json, bot.updated_at.isoformat()


async def apply_appearance_update(bot: Bot, design_json: dict, db: AsyncSession, ent) -> dict:
    """Sanitise + gate (white-label) puis persiste design_json. Pipeline IDENTIQUE
    aux PATCH dashboard/plugin/embed : sanitize_design -> strip_notnull_nulls ->
    enforce_config_modules (402 si retrait du « Powered by » sans le module) -> set
    design_json. `ent` = entitlement déjà résolu par l'appelant. Renvoie le
    design_json persisté."""
    # Import paresseux : widget_helpers vit dans le package routers (cf. invariant
    # « ce service n'importe jamais un router au chargement »).
    from src.routers.widget_helpers import sanitize_design

    data = {"design_json": sanitize_design(design_json)}
    strip_notnull_nulls(data)                   # parité (no-op si dict non-null)
    enforce_config_modules(bot, data, ent)      # gate poweredBy -> whitelabel
    if "design_json" in data:
        bot.design_json = data["design_json"]
    await db.commit()
    await db.refresh(bot)
    return bot.design_json
