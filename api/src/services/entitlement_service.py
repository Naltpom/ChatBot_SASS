"""Couche entitlements : résolution des droits d'un bot + enforcement (spec §3.2).

Invariant directeur (D0) : **billing OFF ⇒ comportement strictement identique à
aujourd'hui** (tout débloqué, aucun gating). Le resolver garantit ça :

- RÈGLE 1 — `billing_enabled() == False` ⇒ `ALL_UNLOCKED` (les clés Stripe absentes
  rendent l'app 100 % gratuite ; les 32 e2e existants restent verts).
- RÈGLE 2 — bot sans ligne `bot_entitlements` (legacy / dev) ⇒ `ALL_UNLOCKED`
  (gratuit). Un nouveau bot n'a un entitlement `free` que si le billing est ON.
- RÈGLE 3 — BYOK (`bot.api_key_mode == 'byok'`) ⇒ module IA en forfait, bot non
  métré (`byok=True` ⇒ `ai_quota_for` renvoie None = illimité).

`apply_subscription_event` projette les subscriptions Stripe (miroir local
`BillingSubscription`) vers les `BotEntitlement`, de façon **déclarative** (on
réécrit l'état cible) et **idempotente** (table `billing_webhook_events` sur
`event.id`). Sur `subscription.deleted`, on recalcule l'état NET (union des items
de TOUTES les subs ACTIVES couvrant le bot) plutôt que de révoquer aveuglément
(anti-race regrouping↔webhook, D1).
"""
import logging
from dataclasses import dataclass, field, replace

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import CODE_TO_MODULE, MODULE_AI, MODULE_KEYS
from src.core.time import utcnow
from src.models.billing import (
    BillingProduct,
    BillingSubscription,
    BillingWebhookEvent,
    BotEntitlement,
)
from src.services.stripe_service import billing_enabled

logger = logging.getLogger("billing")


@dataclass
class Entitlement:
    """Droits effectifs d'un bot, tels que consommés par l'enforcement.

    `modules` = sous-ensemble de MODULE_KEYS débloqués. `ai_monthly_quota` :
    None = illimité, 0 = module IA absent, >=1 = quota mensuel. `overage_mode` :
    block (v1) | meter (v2). `byok` : clé IA portée par le client (non métré).
    """
    bot_id: int
    modules: set[str] = field(default_factory=set)
    ai_monthly_quota: int | None = None   # None = illimité
    overage_mode: str = "block"           # block | meter
    status: str = "active"                # active | past_due | canceled | inactive
    byok: bool = False


# Sentinelle « tout débloqué » (RÈGLE 1/2). bot_id=0 = non lié à un bot précis ;
# toujours copiée via `_unlocked_for(bot_id)` pour porter le bon id sans muter
# l'instance partagée.
ALL_UNLOCKED = Entitlement(
    bot_id=0,
    modules=set(MODULE_KEYS),
    ai_monthly_quota=None,   # illimité
    overage_mode="block",
    status="active",
    byok=False,
)
# Exposé aussi comme attribut de classe pour coller à la spec (`Entitlement.ALL_UNLOCKED`).
Entitlement.ALL_UNLOCKED = ALL_UNLOCKED  # type: ignore[attr-defined]


def _unlocked_for(bot_id: int) -> Entitlement:
    return replace(ALL_UNLOCKED, bot_id=bot_id, modules=set(MODULE_KEYS))


async def _load(db: AsyncSession, bot_id: int) -> BotEntitlement | None:
    return (
        await db.execute(
            select(BotEntitlement).where(BotEntitlement.bot_id == bot_id)
        )
    ).scalar_one_or_none()


def _to_entitlement(row: BotEntitlement) -> Entitlement:
    """Projette la ligne DB vers la dataclass effective (avant règle BYOK)."""
    return Entitlement(
        bot_id=row.bot_id,
        modules=set(row.modules or []),
        ai_monthly_quota=row.ai_monthly_quota,
        overage_mode=row.overage_mode or "block",
        status=row.status or "active",
        byok=False,
    )


async def resolve(db: AsyncSession, bot) -> Entitlement:
    """Droits effectifs d'un `bot` (objet Bot). Voir RÈGLES 1/2/3 ci-dessus."""
    # RÈGLE 1 — billing OFF : tout débloqué (= comportement actuel, 32 e2e verts).
    if not billing_enabled():
        return _unlocked_for(bot.id)
    row = await _load(db, bot.id)
    # RÈGLE 2 — pas d'entitlement (bot legacy / dev) : tout débloqué (gratuit).
    if row is None:
        return _unlocked_for(bot.id)
    ent = _to_entitlement(row)
    # RÈGLE 3 — BYOK : module IA forfait, jamais métré (quota illimité).
    if getattr(bot, "api_key_mode", "managed") == "byok":
        ent.byok = True
    return ent


def has_module(ent: Entitlement, module: str) -> bool:
    """True si `module` est débloqué ET l'abonnement est `active`.

    status past_due/canceled/inactive ⇒ False pour TOUS les modules payants
    (dégradation §6). ALL_UNLOCKED a status='active' ⇒ tout passe (billing OFF).
    """
    return ent.status == "active" and module in ent.modules


def ai_quota_for(ent: Entitlement) -> int | None:
    """Quota IA mensuel effectif. None = illimité (BYOK ou pas de quota posé)."""
    return None if ent.byok else ent.ai_monthly_quota


def gate(ent: Entitlement, capability: str) -> None:
    """Enforce l'accès à `capability` (un module). No-op si le module est actif.

    Mode observe (`BILLING_ENFORCE=false`) : log `billing.observe`, ne bloque pas
    (rollout dé-risqué). Sinon : 402 Payment Required (distinct du 403 perm et du
    429 rate-limit), détail machine-lisible `{error, module}`.
    """
    if has_module(ent, capability):
        return
    if not getattr(settings, "BILLING_ENFORCE", False):
        logger.info("billing.observe: module '%s' manquant (non bloqué)", capability)
        return
    raise HTTPException(
        status_code=402,
        detail={"error": "module_required", "module": capability},
    )


# --- Projection webhook : subscriptions Stripe -> entitlements -------------

# Statuts de subscription Stripe considérés « actifs » pour le calcul NET.
_ACTIVE_SUB_STATUSES = {"active", "trialing", "past_due"}


async def _product_index(db: AsyncSession) -> dict[str, BillingProduct]:
    """Index stripe_price_id -> BillingProduct (mapping prix Stripe → code)."""
    rows = (await db.execute(select(BillingProduct))).scalars().all()
    return {r.stripe_price_id: r for r in rows if r.stripe_price_id}


def _items_of(sub: BillingSubscription) -> list[dict]:
    """Items normalisés d'une sub (raw_items est [{si_id, price_id, code, bot_id, qty}])."""
    return list(sub.raw_items or [])


def _net_modules_quota(
    bot_id: int,
    subs: list[BillingSubscription],
    products: dict[str, BillingProduct],
) -> tuple[set[str], int | None, str]:
    """Calcule l'état NET d'un bot = union des items de TOUTES les subs ACTIVES
    couvrant ce bot (D1). Renvoie (modules, ai_monthly_quota, status).

    - Un item `kind='ai_tier'` active le module IA et pose le quota = included_replies
      (illimité si included_replies est None — variante BYOK forfait).
    - Un item `kind='module'` active le module mappé via CODE_TO_MODULE.
    - status : 'active' si au moins une sub VRAIMENT active (active/trialing) couvre
      le bot ; sinon 'past_due' si seule une sub en impayé le couvre ; sinon 'inactive'.
      `past_due` dégrade tous les modules payants (has_module -> False, finding #4) :
      un client en impayé ne garde PAS l'accès aux modules tant que le paiement n'est
      pas régularisé. Les items past_due restent néanmoins comptés dans `modules`
      (pour conserver l'historique de synchro / re-bascule rapide), c'est le `status`
      qui gate l'accès effectif.
    """
    modules: set[str] = set()
    ai_quota: int | None = 0           # 0 = module IA absent par défaut
    ai_unlimited = False
    has_active = False     # sub active/trialing couvrant le bot
    has_past_due = False   # sub en impayé couvrant le bot

    for sub in subs:
        if sub.status not in _ACTIVE_SUB_STATUSES:
            continue
        for item in _items_of(sub):
            if item.get("bot_id") != bot_id:
                continue
            if sub.status == "past_due":
                has_past_due = True
            else:
                has_active = True
            code = item.get("code")
            product = products.get(item.get("price_id")) if item.get("price_id") else None
            kind = product.kind if product is not None else None

            module = CODE_TO_MODULE.get(code or "")
            if module:
                modules.add(module)

            # Plan IA (ai_tier) : pose le quota inclus ; mod_ai_byok (module) =
            # IA illimitée forfait.
            if kind == "ai_tier" or code == "mod_ai_byok":
                modules.add(MODULE_AI)
                included = product.included_replies if product is not None else None
                if code == "mod_ai_byok" or included is None:
                    ai_unlimited = True
                elif not ai_unlimited:
                    # Quota = max des plans IA actifs (cas de chevauchement transitoire).
                    ai_quota = max(ai_quota or 0, included)

    final_quota: int | None = None if ai_unlimited else ai_quota
    # Priorité : une sub vraiment active prime sur un impayé ; sinon past_due
    # (dégradation, finding #4) ; sinon plus rien -> inactive.
    if has_active:
        status = "active"
    elif has_past_due:
        status = "past_due"
    else:
        status = "inactive"
    return modules, final_quota, status


async def _bots_covered(subs: list[BillingSubscription]) -> set[int]:
    bot_ids: set[int] = set()
    for sub in subs:
        for item in _items_of(sub):
            bid = item.get("bot_id")
            if isinstance(bid, int):
                bot_ids.add(bid)
    return bot_ids


async def _project_bot(
    db: AsyncSession,
    bot_id: int,
    subs: list[BillingSubscription],
    products: dict[str, BillingProduct],
) -> None:
    """Réécrit (déclaratif) la ligne bot_entitlements du bot depuis l'état NET."""
    modules, ai_quota, status = _net_modules_quota(bot_id, subs, products)
    row = await _load(db, bot_id)

    if not modules and status == "inactive":
        # Plus aucune sub active ne couvre ce bot : repasser au socle gratuit.
        # On garde la ligne (source='stripe') mais vidée + status inactive, ce
        # qui dégrade tous les modules (has_module -> False) sans supprimer
        # l'historique de synchro.
        if row is not None:
            row.modules = []
            row.ai_monthly_quota = 0
            row.status = "inactive"
            row.synced_at = utcnow()
        return

    if row is None:
        row = BotEntitlement(bot_id=bot_id, source="stripe")
        db.add(row)
    row.modules = sorted(modules)
    row.ai_monthly_quota = ai_quota
    row.status = status
    row.source = "stripe"
    row.synced_at = utcnow()


async def apply_subscription_event(db: AsyncSession, event: dict) -> None:
    """Projette un event Stripe subscription.* vers les entitlements (déclaratif).

    Idempotent par `event['id']` (table billing_webhook_events) : un même event
    rejoué ne réapplique rien. Déclaratif : on recalcule l'état NET de chaque bot
    couvert (union des subs actives, D1) plutôt que de muter incrémentalement —
    un `subscription.deleted` pendant un regrouping ne révoque donc pas un bot
    encore couvert par une autre sub active.

    Pré-condition : le miroir local `billing_subscriptions` reflète déjà l'event
    (mis à jour par le routeur webhook AVANT cet appel). Ce service lit ce miroir
    comme source de l'état cible — il ne parle pas à Stripe.
    """
    event_id = event.get("id")
    if not event_id:
        logger.warning("billing: subscription event sans id, ignoré")
        return

    # Idempotence : event déjà traité ?
    already = (
        await db.execute(
            select(BillingWebhookEvent.id).where(
                BillingWebhookEvent.stripe_event_id == event_id
            )
        )
    ).scalar_one_or_none()
    if already is not None:
        logger.info("billing: event %s déjà traité (idempotent), ignoré", event_id)
        return

    sub_obj = (event.get("data") or {}).get("object") or {}
    stripe_sub_id = sub_obj.get("id")

    # Anti-race regrouping↔webhook (D1) : si une fenêtre de regrouping est ouverte
    # sur le payeur, un subscription.deleted ne doit pas révoquer (l'état NET est
    # recalculé sur le miroir, qui peut encore porter les subs cibles). On loggue
    # mais on poursuit le recalcul NET (jamais de révocation aveugle).
    if event.get("type") == "customer.subscription.deleted":
        logger.info(
            "billing: subscription.deleted %s -> recalcul NET (pas de révocation aveugle)",
            stripe_sub_id,
        )

    # Bots impactés = ceux couverts par la sub de l'event, plus (par sécurité)
    # ceux que le miroir associe encore à cette sub.
    products = await _product_index(db)

    # Toutes les subs actives du payeur concerné, pour le calcul NET.
    target_sub = None
    if stripe_sub_id:
        target_sub = (
            await db.execute(
                select(BillingSubscription).where(
                    BillingSubscription.stripe_subscription_id == stripe_sub_id
                )
            )
        ).scalar_one_or_none()

    affected_bot_ids: set[int] = set()
    user_subs: list[BillingSubscription] = []
    if target_sub is not None:
        user_subs = (
            await db.execute(
                select(BillingSubscription).where(
                    BillingSubscription.user_id == target_sub.user_id
                )
            )
        ).scalars().all()
        affected_bot_ids |= await _bots_covered([target_sub])
        affected_bot_ids |= await _bots_covered(user_subs)

    # Finding #5 — payeur non résolu : si le miroir local ne connaît pas encore
    # la sub de l'event (target_sub is None), on n'a AUCUN bot à projeter et le
    # `user_id` du payeur est inconnu. Marquer l'event comme traité (idempotence)
    # ici perdrait l'activation : au replay (une fois le customer/sub lié), on
    # zapperait l'event sans jamais reprojeter. On NE marque donc PAS, et on lève
    # pour que Stripe retente le webhook (back-off) jusqu'à résolution du payeur.
    if target_sub is None:
        logger.warning(
            "billing: event %s (sub %s) sans payeur résolu (miroir absent) -> "
            "pas de marqueur d'idempotence, retry attendu",
            event_id,
            stripe_sub_id,
        )
        raise HTTPException(
            status_code=409,
            detail={"error": "subscription_not_yet_mirrored", "event": event_id},
        )

    for bot_id in affected_bot_ids:
        await _project_bot(db, bot_id, user_subs, products)

    # Marque l'event traité (idempotence). On stocke un payload léger.
    db.add(
        BillingWebhookEvent(
            stripe_event_id=event_id,
            type=event.get("type") or "unknown",
            payload={"subscription": stripe_sub_id} if stripe_sub_id else None,
        )
    )
    await db.flush()
