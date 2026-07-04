"""Couche entitlements : résolution des droits d'un bot + enforcement (spec §3.2).

Invariant directeur (D0) : **billing OFF ⇒ comportement strictement identique à
aujourd'hui** (tout débloqué, aucun gating). Le resolver garantit ça :

- RÈGLE 1 — `billing_enabled() == False` ⇒ `ALL_UNLOCKED` (les clés Stripe absentes
  rendent l'app 100 % gratuite).
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
from datetime import datetime, timezone

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
    BotStatusHistory,
)
from src.services.stripe_service import billing_enabled, metering_enabled

logger = logging.getLogger("billing")


@dataclass
class Entitlement:
    """Droits effectifs d'un bot, tels que consommés par l'enforcement.

    `modules` = sous-ensemble de MODULE_KEYS débloqués. `ai_monthly_quota` :
    None = illimité, 0 = module IA absent, >=1 = quota mensuel. `overage_mode` :
    block (v1) | meter (v2). `byok` : clé IA portée par le client (non métré).

    Modèle d'essai (CARTE à l'inscription) : l'essai est un ABONNEMENT Stripe en
    statut `trialing` créé au Checkout (carte requise, 0 € pendant 7 j). Le webhook
    projette `status='trialing'` avec `trial_end = subscription.trial_end` (évalué
    paresseusement, pas de cron). Tant que `utcnow() < trial_end`, les modules de
    l'abonnement sont DÉBLOQUÉS (IA plafonnée à TRIAL_AI_CAP) ; passé `trial_end`
    (auto-débit imminent ou résiliation), `trial_expired` passe à True. À J+7 sans
    résiliation, Stripe débite et émet un event statut `active` -> `status='active'`
    (trial_end ignoré) ; en cas de résiliation au portail -> `subscription.deleted`
    -> bot gaté, 0 € débité.
    """
    bot_id: int
    modules: set[str] = field(default_factory=set)
    ai_monthly_quota: int | None = None   # None = illimité
    overage_mode: str = "block"           # block | meter
    overage_cap: int | None = None        # plafond dépassement IA (None = défaut 1000)
    status: str = "active"                # active | trialing | past_due | canceled | inactive
    byok: bool = False
    trial_end: datetime | None = None     # fin d'essai (NULL hors essai)
    trial_expired: bool = False           # essai dépassé (gate, comme inactive)


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


def _trial_active(row: BotEntitlement) -> bool:
    """True si la ligne est un essai EN COURS (`status='trialing'` ET non expiré).

    Évaluation paresseuse (pas de cron) : `trial_end` NULL sur un essai = état
    incohérent traité comme expiré (gate), jamais d'essai illimité par accident.
    """
    if (row.status or "active") != "trialing":
        return False
    # getattr défensif : les helpers de test seedent des lignes PARTIELLES (Obj
    # sans `trial_end`) ; sur une vraie BotEntitlement la colonne existe toujours.
    trial_end = getattr(row, "trial_end", None)
    return trial_end is not None and utcnow() < trial_end


def _to_entitlement(row: BotEntitlement) -> Entitlement:
    """Projette la ligne DB vers la dataclass effective (avant règle BYOK).

    `status='trialing'` est conservé tel quel ; c'est `trial_expired` qui porte la
    bascule : essai EN COURS ⇒ trial_expired=False (has_module débloque les
    modules de l'essai) ; essai EXPIRÉ ⇒ trial_expired=True (has_module gate tous
    les modules, comme `inactive`, point 4).
    """
    status = row.status or "active"
    trial_expired = status == "trialing" and not _trial_active(row)
    return Entitlement(
        bot_id=row.bot_id,
        modules=set(row.modules or []),
        ai_monthly_quota=row.ai_monthly_quota,
        overage_mode=row.overage_mode or "block",
        # getattr défensif : tolère les lignes partielles des helpers de test
        # (Obj sans `overage_cap`/`trial_end`) ; colonnes déclarées sur le modèle.
        overage_cap=getattr(row, "overage_cap", None),
        status=status,
        byok=False,
        trial_end=getattr(row, "trial_end", None),
        trial_expired=trial_expired,
    )


async def resolve(db: AsyncSession, bot) -> Entitlement:
    """Droits effectifs d'un `bot` (objet Bot). Voir RÈGLES 1/2/3 ci-dessus.

    Modèle d'essai (point 4) : `status='trialing'` ET `utcnow() < trial_end` ⇒
    modules de l'essai débloqués ; `trialing` expiré ⇒ GATE (has_module False,
    comme `inactive`). `status='active'` ⇒ normal (trial_end ignoré).
    """
    # RÈGLE 1 — billing OFF : tout débloqué.
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


async def resolve_many(db: AsyncSession, bots) -> dict[int, Entitlement]:
    """Résout les droits effectifs de PLUSIEURS bots en UNE requête (anti N+1).

    Sémantique STRICTEMENT identique à `resolve` appelé bot par bot (mêmes RÈGLES
    1/2/3), mais les lignes `bot_entitlements` sont chargées en UN seul select
    (`bot_id IN (...)`) au lieu d'un select par bot. Renvoie {bot_id: Entitlement}.

    Utilisé par les listes plugin/dashboard qui résolvent une collection de bots.
    """
    # RÈGLE 1 — billing OFF : tout débloqué.
    if not billing_enabled():
        return {b.id: _unlocked_for(b.id) for b in bots}
    if not bots:
        return {}
    rows = (await db.execute(
        select(BotEntitlement).where(
            BotEntitlement.bot_id.in_([b.id for b in bots]))
    )).scalars().all()
    by_id = {r.bot_id: r for r in rows}
    out: dict[int, Entitlement] = {}
    for bot in bots:
        row = by_id.get(bot.id)
        # RÈGLE 2 — pas d'entitlement (bot legacy / dev) : tout débloqué (gratuit).
        if row is None:
            out[bot.id] = _unlocked_for(bot.id)
            continue
        ent = _to_entitlement(row)
        # RÈGLE 3 — BYOK : module IA forfait, jamais métré (quota illimité).
        if getattr(bot, "api_key_mode", "managed") == "byok":
            ent.byok = True
        out[bot.id] = ent
    return out


def is_usable(ent: Entitlement) -> bool:
    """Dérivé UNIQUE d'éligibilité : le bot est-il utilisable (modules du plan
    exposés) ? = `status='active'` (souscrit OU activé par un admin/bypass) OU
    essai EN COURS (`status='trialing'` non expiré). TOUT le reste — past_due,
    canceled, inactive, **suspended** (blocage admin), essai EXPIRÉ — ⇒ False.

    Source unique de la notion « utilisable » : has_module / ai_quota_for /
    overage_active la consomment au lieu de recalculer chacun le bool inline.
    ALL_UNLOCKED a status='active' ⇒ True (billing OFF, tout passe).
    """
    if ent.status == "active":
        return True
    if ent.status == "trialing":
        return not ent.trial_expired
    return False


def has_module(ent: Entitlement, module: str) -> bool:
    """True si `module` est débloqué ET l'abonnement est utilisable (is_usable).

    status past_due/canceled/inactive/suspended — et un essai EXPIRÉ — ⇒ False
    pour TOUS les modules (dégradation §6 / gate fin d'essai / blocage admin).
    ALL_UNLOCKED a status='active' ⇒ tout passe (billing OFF).
    """
    return is_usable(ent) and module in ent.modules


TRIAL_AI_CAP = 50  # plafond de réponses IA managées pendant l'essai (anti-abus coût provider)


def ai_quota_for(ent: Entitlement) -> int | None:
    """Quota IA mensuel effectif. None = illimité (BYOK ou pas de quota posé).

    Plafond d'essai (point produit) : pendant un essai EN COURS, l'IA managée est
    plafonnée à TRIAL_AI_CAP (50) quel que soit le plan configuré (anti-abus du
    coût provider) ; le BYOK reste illimité (aucun coût plateforme). Souscrire
    (status='active') lève le plafond et applique le quota plein du plan.
    """
    if ent.byok:
        return None
    if ent.status == "trialing" and not ent.trial_expired:
        q = ent.ai_monthly_quota
        return TRIAL_AI_CAP if q is None else min(q, TRIAL_AI_CAP)
    return ent.ai_monthly_quota


def overage_active(ent: Entitlement) -> bool:
    """True si le DÉPASSEMENT IA métré est ARMÉ pour ce bot (servir + facturer
    au-delà du quota, avec plafond de sécurité).

    Conditions cumulatives (toutes requises) :
    - `metering_enabled()` : billing ON ET BILLING_METERING_ENABLED (sans Stripe,
      métrage inerte -> False, invariant D0) ;
    - `overage_mode == 'meter'` : l'OWNER a activé le toggle (défaut 'block' =>
      AUCUN dépassement facturé tant qu'il ne l'a pas demandé — argent) ;
    - `not byok` : BYOK jamais métré (clé du client, illimité) ;
    - `ai_monthly_quota is not None` : plan IA managé avec quota (un plan illimité
      managé -> None ne dépasse jamais ; pas d'IA -> 0 n'est pas None mais le
      quota_precheck bloque déjà) ;
    - `MODULE_AI in modules` ET `status == 'active'` : module IA souscrit et
      abonnement utilisable (un essai/past_due ne facture pas de dépassement).
    """
    return (
        metering_enabled()
        and ent.overage_mode == "meter"
        and not ent.byok
        and ent.ai_monthly_quota is not None
        and MODULE_AI in ent.modules
        and ent.status == "active"
    )


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


def _epoch_to_naive_utc(epoch: object) -> datetime | None:
    """Convertit un epoch Stripe (secondes, ex. `subscription.trial_end`) en
    datetime NAÏF UTC (convention des colonnes DateTime du projet, cf. core/time).
    None / valeur non entière -> None (pas d'essai borné)."""
    if not isinstance(epoch, (int, float)):
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).replace(tzinfo=None)


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
    - status : 'active' si au moins une sub VRAIMENT active couvre le bot ; sinon
      'trialing' si seul un abonnement en ESSAI (Stripe status='trialing', carte
      posée au Checkout, 0 € pendant 7 j) le couvre ; sinon 'past_due' si seule une
      sub en impayé le couvre ; sinon 'inactive'.
      `past_due` dégrade tous les modules payants (has_module -> False) :
      un client en impayé ne garde PAS l'accès aux modules tant que le paiement n'est
      pas régularisé. Les items past_due restent néanmoins comptés dans `modules`
      (pour conserver l'historique de synchro / re-bascule rapide), c'est le `status`
      qui gate l'accès effectif.

      L'essai (trialing) débloque les modules de l'abonnement (carte déjà collectée
      au Checkout) ; le plafond IA de l'essai (TRIAL_AI_CAP=50) est appliqué par
      `ai_quota_for`, pas ici. Statut Stripe 'active' (après le 1er débit à J+7)
      prime sur 'trialing'.
    """
    modules: set[str] = set()
    ai_quota: int | None = 0           # 0 = module IA absent par défaut
    ai_unlimited = False
    has_active = False     # sub VRAIMENT active couvrant le bot
    has_trialing = False   # sub en essai (Stripe trialing) couvrant le bot
    has_past_due = False   # sub en impayé couvrant le bot

    for sub in subs:
        if sub.status not in _ACTIVE_SUB_STATUSES:
            continue
        for item in _items_of(sub):
            if item.get("bot_id") != bot_id:
                continue
            if sub.status == "past_due":
                has_past_due = True
            elif sub.status == "trialing":
                has_trialing = True
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
    # Priorité : une sub vraiment active prime sur un essai, qui prime sur un
    # impayé (dégradation) ; sinon plus rien -> inactive. L'essai
    # (trialing) débloque les modules mais plafonne l'IA (ai_quota_for).
    if has_active:
        status = "active"
    elif has_trialing:
        status = "trialing"
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


# --- Point d'écriture UNIQUE du statut d'éligibilité (D-unified) -----------

# Valeur de statut COLLANTE : un bot 'suspended' (blocage admin) ne peut être
# levé QUE par un acteur 'staff'. Aucun event Stripe (même un paiement réussi le
# mois suivant) ne le déverrouille — Stripe continue d'encaisser, le bot reste
# inutilisable tant qu'un admin ne débloque pas.
STICKY_STATUSES = {"suspended"}
_STAFF = "staff"


def _source_for(actor_kind: str) -> str:
    """Mappe actor_kind -> colonne `source` (compat lectures admin/WP, domaine
    inchangé {stripe, staff, free}). staff -> 'staff' ; tout le reste -> 'stripe'.
    `source` n'est utilisée par AUCUNE logique d'éligibilité (le statut gate) ;
    l'audit fin vit désormais dans bot_status_history (candidate suppression)."""
    return _STAFF if actor_kind == _STAFF else "stripe"


@dataclass
class PlanState:
    """État MOTEUR projeté d'un bot (séparé de l'AUDIT statut/acteur/raison).

    Passé à set_bot_status pour (ré)écrire les droits effectifs. `None` côté
    helper = NE PAS toucher au moteur (transition de statut seule ⇒ on ne vide
    jamais les modules). overage_mode/overage_cap ne sont JAMAIS portés ici
    (choix owner préservé)."""
    modules: list[str]
    ai_monthly_quota: int | None
    trial_end: datetime | None = None


async def set_bot_status(
    db: AsyncSession,
    bot_id: int,
    *,
    new_status: str,
    actor_kind: str,
    actor_user_id: int | None = None,
    reason: str | None = None,
    stripe_event_id: str | None = None,
    plan: PlanState | None = None,
) -> BotEntitlement:
    """UNIQUE point d'écriture du statut d'éligibilité d'un bot.

    Écrit `bot_entitlements.status` (cache lu sur le chemin chaud) ET journalise
    la transition dans `bot_status_history` (audit qui/quand/comment/pourquoi),
    dans la MÊME transaction → zéro drift par construction.

    - Charge la ligne FOR UPDATE (verrou anti-concurrence pour évaluer la garde
      sticky sur une valeur stable). Crée la ligne si absente (genèse).
    - GARDE STICKY : si le statut courant est dans STICKY_STATUSES (suspended) et
      l'acteur n'est pas 'staff', le statut RESTE collé (un paiement Stripe ne
      débloque pas), mais le MOTEUR (plan) est tout de même rafraîchi si fourni.
    - MOTEUR : n'écrit modules/quota/trial_end QUE si `plan` est fourni (jamais
      de vidage de modules sur une transition de statut seule). overage_*
      jamais touchés.
    - JOURNAL : une ligne SEULEMENT si le statut effectif change (ou genèse).
    - NE COMMIT PAS : l'appelant orchestre la transaction (cohérence avec le
      miroir Stripe). Retourne la ligne entitlement.
    """
    row = (
        await db.execute(
            select(BotEntitlement)
            .where(BotEntitlement.bot_id == bot_id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    created = row is None
    old_status = None if created else (row.status or "active")

    # Garde sticky : un statut collant ne se lève que par 'staff'.
    target_status = new_status
    if (
        not created
        and old_status in STICKY_STATUSES
        and actor_kind != _STAFF
        and new_status != old_status
    ):
        logger.warning(
            "billing: transition '%s' -> '%s' ignorée pour bot %s "
            "(statut collant, acteur=%s)",
            old_status, new_status, bot_id, actor_kind,
        )
        target_status = old_status

    if created:
        row = BotEntitlement(bot_id=bot_id)
        db.add(row)

    # MOTEUR (optionnel) — jamais de vidage implicite sur transition de statut.
    if plan is not None:
        row.modules = sorted(plan.modules)
        row.ai_monthly_quota = plan.ai_monthly_quota
        row.trial_end = plan.trial_end
    # overage_mode / overage_cap : JAMAIS touchés ici (choix owner).

    # JOURNAL — uniquement si le statut effectif change (genèse incluse).
    if created or target_status != old_status:
        db.add(
            BotStatusHistory(
                bot_id=bot_id,
                old_status=old_status,
                new_status=target_status,
                actor_kind=actor_kind,
                actor_user_id=actor_user_id,
                reason=reason,
                stripe_event_id=stripe_event_id,
            )
        )

    row.status = target_status
    row.source = _source_for(actor_kind)
    row.synced_at = utcnow()
    return row


async def grace(db: AsyncSession, bot_id: int, *, reason: str) -> BotEntitlement:
    """Met un bot en GRÂCE (`past_due`) : modules payants dégradés, socle gratuit
    conservé, jusqu'à régularisation. Façade unique du changement de payeur (move
    perso->équipe, transfert d'org). actor_kind='system'. Respecte la garde sticky
    (un bot suspended reste suspended)."""
    return await set_bot_status(
        db, bot_id,
        new_status="past_due", actor_kind="system", reason=reason,
        plan=PlanState(modules=[], ai_monthly_quota=0),
    )


async def baseline(db: AsyncSession, bot_id: int, *, actor_kind: str,
                   actor_user_id: int | None = None, reason: str | None = None) -> BotEntitlement:
    """Repasse un bot au socle GATÉ (`inactive`, modules=[], quota=0) — jamais
    ALL_UNLOCKED (on garde une ligne). Utilisé au seed (system) et au reset
    d'override staff avant reprojection Stripe."""
    return await set_bot_status(
        db, bot_id,
        new_status="inactive", actor_kind=actor_kind,
        actor_user_id=actor_user_id, reason=reason,
        plan=PlanState(modules=[], ai_monthly_quota=0, trial_end=None),
    )


async def _project_bot(
    db: AsyncSession,
    bot_id: int,
    subs: list[BillingSubscription],
    products: dict[str, BillingProduct],
    trial_end: datetime | None = None,
    *,
    stripe_event_id: str | None = None,
    reason: str | None = None,
) -> None:
    """Réécrit (déclaratif) la ligne bot_entitlements du bot depuis l'état NET,
    via l'unique writer set_bot_status (actor_kind='stripe').

    `trial_end` (issu de `subscription.trial_end` Stripe, naïf UTC) n'est posé que
    si l'état NET est 'trialing' ; effacé sinon (point produit). Préserve RÈGLE 2 :
    si aucune sub ne couvre le bot ET qu'aucune ligne n'existe, on NE crée PAS de
    ligne ex nihilo (absence de ligne = socle gratuit, has_module débloqué)."""
    modules, ai_quota, status = _net_modules_quota(bot_id, subs, products)

    if not modules and status == "inactive":
        # Plus aucune sub couvrante : on ne dégrade QUE si une ligne existe déjà
        # (sinon on flipperait un bot legacy gratuit vers 'inactive' gaté).
        if await _load(db, bot_id) is None:
            return

    te = trial_end if status == "trialing" else None
    await set_bot_status(
        db,
        bot_id,
        new_status=status,
        actor_kind="stripe",
        stripe_event_id=stripe_event_id,
        reason=reason,
        plan=PlanState(modules=sorted(modules), ai_monthly_quota=ai_quota, trial_end=te),
    )


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
    # Essai avec carte : `subscription.trial_end` (epoch s) -> datetime naïf UTC.
    # Source de vérité de la fin d'essai (le miroir billing_subscriptions ne porte
    # pas trial_end) ; n'est appliqué par _project_bot que si l'état NET reste
    # 'trialing'. Un .deleted (trial_end absent) -> None -> trial_end effacé.
    trial_end = _epoch_to_naive_utc(sub_obj.get("trial_end"))

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

    # Payeur non résolu : si le miroir local ne connaît pas encore
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
        await _project_bot(
            db, bot_id, user_subs, products, trial_end=trial_end,
            stripe_event_id=event_id, reason=event.get("type") or "subscription.event",
        )

    # Marque l'event traité (idempotence). On stocke un payload léger.
    db.add(
        BillingWebhookEvent(
            stripe_event_id=event_id,
            type=event.get("type") or "unknown",
            payload={"subscription": stripe_sub_id} if stripe_sub_id else None,
        )
    )
    await db.flush()
