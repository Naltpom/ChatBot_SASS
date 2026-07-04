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
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import (
    MODULE_AI,
    OVERAGE_CAP_DEFAULT,
    is_metered_code,
)
from src.core.database import get_db
from src.core.security import get_current_user, require_billing_owner
from src.core.time import utcnow
from src.models.billing import (
    BillingProduct,
    BillingSubscription,
    BotConfigPayload,
    BotEntitlement,
)
from src.models.bot import Bot
from src.models.user import User
from src.services import stripe_service
# Logique métier de facturation PARTAGÉE : vit dans billing_service pour être
# consommée par la surface plugin (routers/external/account.py) SANS coupler les
# routers entre eux. Ré-exposée ici sous ses noms historiques (alias) pour les
# appelants internes de ce module et les tests.
from src.services.billing_service import (  # noqa: F401 (ré-exports historiques)
    DISABLED as _DISABLED,
    _catalog_rows,
    _overage_cents_per_reply,
    active_sub_for_bot as _active_sub_for_bot,
    ai_quota_for_codes as _ai_quota_for_codes,
    ai_tier_id_for_quota as _ai_tier_id_for_quota,
    billable_bots as _billable_bots,
    catalog_payload as _catalog_payload,
    classify_code_changes as _classify_code_changes,
    config_has_ai as _config_has_ai,
    config_to_codes as _config_to_codes,
    current_codes_for_bot as _current_codes_for_bot,
    ensure_customer as _ensure_customer,
    intro_coupon_for as _intro_coupon_for,
    intro_product_code as _intro_product_code,
    line_items_for_codes as _line_items_for_codes,
    metering_available_for_bot as _metering_available_for_bot,
    module_of_code as _module_of_code,
    month_bounds_iso as _month_bounds_iso,
    reported_overage_this_month as _reported_overage_this_month,
    scope_for_bot as _scope_for_bot,
    split_modules_delta as _split_modules_delta,
    user_has_subscription as _user_has_subscription,
    validate_config_modules as _validate_config_modules,
)
from src.services.entitlement_service import (
    PlanState,
    grace as es_grace,
    resolve,
    set_bot_status,
)
from src.services.quota_service import ai_quota_usage, quota_period
# L'orchestration du webhook Stripe (idempotence / garde d'ordre / miroir
# + projection / commit) vit dans stripe_webhook_service. Le handler HTTP ci-dessous
# se contente de vérifier la signature puis de déléguer. `_sync_subscription_mirror`
# et `_last_event_created_for_sub` sont ré-exposés ici (alias) pour les appelants
# internes (routers/admin_billing : reconcile / reset) et les tests.
from src.services import stripe_webhook_service
from src.services.stripe_webhook_service import (  # noqa: F401 (ré-export)
    _last_event_created_for_sub,
    _sync_subscription_mirror,
)

logger = logging.getLogger("billing")

router = APIRouter(prefix="/api", tags=["billing"])


# --- Payloads -------------------------------------------------------------

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
    # P4 (surface plugin) : redirections de retour Checkout surchargées vers le site
    # WordPress, threadées à open_checkout SI la modif relance un Checkout (branche
    # needs_checkout). None (dashboard) ⇒ fallback APP_URL — appelants existants
    # intacts. Validées (anti open-redirect) comme le Checkout quand présentes.
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


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

    # (a) Retirer ces bots des subscriptions de l'ancien payeur (helper PARTAGÉ
    # avec bots._billing_on_move_payer_change : items retirés supprimés
    # EXPLICITEMENT côté Stripe, miroir mis à jour SEULEMENT si Stripe a suivi).
    if old_owner_id is not None:
        await stripe_service.remove_bot_items_from_payer_subs(
            db, old_owner_id, lambda bid: bid in bot_id_set, "billing.transfer")

    # (b) Côté nouveau payeur : chaque bot de l'org en grâce jusqu'à régularisation
    # (même façade `grace` que le move perso->équipe ; actor=system, garde sticky).
    for bid in bot_id_set:
        await es_grace(db, bid, reason="org_owner_change")
    await db.commit()


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
    # Via l'unique writer (actor=stripe).
    await set_bot_status(
        db, bot.id,
        new_status="active", actor_kind="stripe", reason="mock_checkout",
        plan=PlanState(modules=sorted(set(modules)), ai_monthly_quota=ai_quota, trial_end=None),
    )


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

    # Statut préservé (jamais de retour en arrière vers l'essai sur un payant) ; un
    # statut hors gestion réelle est normalisé en 'active'. Via l'unique writer
    # (actor=stripe) : préserve la garde sticky (un bot suspended reste suspended).
    target_status = ent.status if ent.status in ("active", "trialing", "past_due") else "active"
    await set_bot_status(
        db, bot.id,
        new_status=target_status, actor_kind="stripe", reason="mock_update",
        plan=PlanState(modules=effective_modules, ai_monthly_quota=ai_quota,
                       trial_end=ent.trial_end),
    )


# --- GET /api/billing/catalog ---------------------------------------------

@router.get("/billing/catalog")
async def get_catalog(db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Catalogue de facturation (lit `billing_products`, valide contre
    MODULE_KEYS). Le front ne code aucun prix en dur : il consomme ce contrat.

    Billing OFF ⇒ {billing: disabled} (la nav/UI billing est masquée côté front).
    Corps factorisé dans `_catalog_payload`, réutilisé TEL QUEL par la surface
    plugin (GET /api/account/catalog) — sortie strictement identique."""
    return await _catalog_payload(db)


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


# --- POST /api/billing/checkout -------------------------------------------

async def open_checkout(
    db: AsyncSession, user: User, bot: Bot, grouping: str,
    config: BotConfigPayload, consent: bool = False,
    success_url: str | None = None, cancel_url: str | None = None,
) -> dict:
    """Ouvre une session de Checkout Stripe pour `bot` selon `config` (intro 1er
    mois remisé) et renvoie le dict de réponse — SANS commit (l'appelant commit).

    PUBLIC : consommé aussi par la surface plugin (account.account_checkout)
    pour passer des success_url/cancel_url vers le site WordPress. Reste un point
    d'entrée de ce router (orchestration Checkout + projection MOCK) ; sa cascade de
    helpers MÉTIER PURS (config_to_codes, line_items_for_codes, ensure_customer,
    intro_coupon_for…) vit dans services/billing_service, consommée ici via les
    alias historiques (_config_to_codes, …).

    Factorisé pour servir DEUX chemins (point 3) : la 1re souscription
    (POST /billing/checkout) ET la relance de paiement d'un bot 'inactive'
    (POST /billing/subscription/update sans sub active sur le bot). Le caller a
    déjà validé la config et l'ownership.

    `success_url`/`cancel_url` (P4) : surchargent les redirections par défaut
    (APP_URL) — la surface EXTERNE (plugin WordPress) y passe les URLs de retour
    sur le site client. None (chemins dashboard) ⇒ redirections APP_URL inchangées."""
    # Anti double-abonnement : un bot DÉJÀ couvert par une subscription ACTIVE du
    # payeur ne rouvre PAS de Checkout (deux subs factureraient le même bot) — la
    # modification passe par /billing/subscription/update. Le re-checkout reste
    # permis pour un bot réellement inactif (Checkout annulé/abandonné, sub
    # résiliée) : _active_sub_for_bot ne voit que active|trialing|past_due.
    if await _active_sub_for_bot(db, user, bot.id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Ce bot a déjà un abonnement actif : modifiez votre abonnement au "
            "lieu d'ouvrir un nouveau paiement")

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
        # P4 : redirections surchargées par la surface plugin (retour site client).
        success_url=success_url,
        cancel_url=cancel_url,
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
    result = await open_checkout(db, user, bot, grouping, body.config, consent=body.consent)
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

    # P4 : si la modif relance un Checkout (branche needs_checkout), ses redirections
    # de retour peuvent être surchargées vers le site WordPress (surface plugin).
    # Présentes UNIQUEMENT via /api/account/* — le dashboard ne les envoie pas
    # (None ⇒ fallback APP_URL, appelants existants intacts). On les VALIDE ici
    # (anti open-redirect, même hôte que le site WP lié) comme le Checkout plugin, en
    # RÉUTILISANT son helper. _assert_checkout_urls vit dans la surface plugin (qui
    # importe ce module) ⇒ import différé pour casser le cycle d'import.
    ck_success = ck_cancel = None
    if body.success_url and body.cancel_url:
        from src.routers.external.account import _assert_checkout_urls
        await _assert_checkout_urls(db, bot, body.success_url, body.cancel_url)
        ck_success, ck_cancel = body.success_url, body.cancel_url

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
            result = await open_checkout(
                db, user, bot, user.billing_grouping, body.config,
                consent=body.consent, success_url=ck_success, cancel_url=ck_cancel)
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
        result = await open_checkout(
            db, user, bot, user.billing_grouping, body.config,
            consent=body.consent, success_url=ck_success, cancel_url=ck_cancel)
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

    Handler FIN : intrinsèquement HTTP. Il lit le corps en BYTES BRUTS
    (await request.body() AVANT tout parse JSON — la signature HMAC porte sur les
    octets exacts), vérifie la signature, applique la garde billing-OFF, puis
    DÉLÈGUE toute l'orchestration (idempotence par event.id, garde d'ordre, miroir
    + projection d'entitlement, commit) au `stripe_webhook_service`.

    E1 : si `billing_enabled()==False`, no-op APRÈS vérification de signature
    (on retourne {received:True} sans appliquer — réversibilité R2 propre).
    Signature absente/invalide/expirée ⇒ 400."""
    raw_body = await request.body()
    sig = request.headers.get("Stripe-Signature")
    try:
        event = stripe_service.verify_webhook_signature(raw_body, sig)
    except stripe_service.StripeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    # E1 : billing OFF ⇒ no-op après vérif signature (corps déjà validé).
    if not stripe_service.billing_enabled():
        return {"received": True, "billing": "disabled"}

    return await stripe_webhook_service.process_webhook_event(db, event)
