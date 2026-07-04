"""Stripe via l'API REST (httpx exclusivement, pas de SDK).

Facturation MODULAIRE (spec §2.4). Le billing est actif dès que les DEUX clés
sont posées (`billing_enabled()` = secret + webhook) ; les price IDs vivent
dans `billing_products`.

Catalogue piloté en base : `price_id_for_code(code, db)` / `code_for_price(...)`.
Le Customer Stripe est attaché au User.

MOCK_BILLING (spec §2.3) : quand `settings.MOCK_BILLING` est vrai, ce service
N'ÉMET AUCUN appel sortant. Les fonctions retournent des URLs locales / des
identifiants `*_mock_*` pour que les e2e vérifient l'activation sans Stripe.
`verify_webhook_signature` reste INCHANGÉ (testé en vrai HMAC).

Aucune TVA (franchise en base, art. 293 B du CGI) : `automatic_tax`,
`tax_id_collection`, `billing_address_collection` NE SONT JAMAIS passés.
`payment_method_types` n'est JAMAIS passé (dynamic payment methods).

La verification de signature webhook (Stripe-Signature) est faite a la main :
HMAC-SHA256 sur "{timestamp}.{corps brut}" avec STRIPE_WEBHOOK_SECRET.
"""
import hashlib
import hmac
import json
import logging
import time
import uuid
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import is_metered_code
from src.models.billing import BillingProduct, BillingSubscription
from src.models.user import User

logger = logging.getLogger(__name__)

STRIPE_API_BASE = "https://api.stripe.com/v1"

# Mention légale de franchise en base (art. 293 B du CGI) : posée en pied de page
# de TOUTES les factures du Customer (invoice_settings.footer) — mention OBLIGATOIRE
# sur les factures d'un assujetti en franchise (pas de TVA facturée).
INVOICE_FOOTER_293B = "TVA non applicable, art. 293 B du CGI"


class StripeError(Exception):
    pass


def billing_enabled() -> bool:
    """Billing actif dès que secret + webhook sont posés (spec §6.1).

    Les price IDs vivent dans `billing_products` (catalogue seedé). Clés absentes
    ⇒ False ⇒ resolver ALL_UNLOCKED (invariant D0 : app 100 % gratuite)."""
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_WEBHOOK_SECRET)


def metering_enabled() -> bool:
    """Axe IA métré (Stripe Billing Meters) actif ET utilisable.

    ANDe billing_enabled() : sans clés Stripe, métrage INERTE (overage dormant,
    invariant D0). BILLING_METERING_ENABLED est True par défaut (feature mise en
    place), mais inoffensif tant que le billing est OFF."""
    return billing_enabled() and settings.BILLING_METERING_ENABLED


async def price_id_for_code(code: str, db: AsyncSession) -> Optional[str]:
    """Price ID Stripe d'un code catalogue (lookup `billing_products`).

    None si code inconnu, produit inactif ou price non seedé
    (`seed_billing_catalog.py` pose stripe_price_id)."""
    row = (await db.execute(
        select(BillingProduct).where(
            BillingProduct.code == code,
            BillingProduct.is_active.is_(True),
        )
    )).scalar_one_or_none()
    return row.stripe_price_id if row else None


async def code_for_price(price_id: str, db: AsyncSession) -> Optional[str]:
    """Inverse de price_id_for_code (sync webhook subscription.updated).

    None si le price n'est dans aucun `billing_products`."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.stripe_price_id == price_id)
    )).scalar_one_or_none()
    return row.code if row else None


async def _stripe_request(method: str, path: str,
                          data: Optional[dict] = None,
                          params: Optional[dict] = None) -> dict:
    """Appel REST Stripe (corps form-encode, cles imbriquees style metadata[x])."""
    headers = {"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.request(method, f"{STRIPE_API_BASE}{path}",
                                        headers=headers, data=data, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("Stripe %s : %s", e.response.status_code, e.response.text[:500])
        raise StripeError("Le service de paiement a renvoyé une erreur")
    except httpx.HTTPError as e:
        logger.error("Stripe injoignable : %s", e)
        raise StripeError("Service de paiement injoignable")


async def create_customer(user: User, email: Optional[str]) -> str:
    """Cree le Customer Stripe du USER -> cus_... (l'appelant stocke et commit).

    Le Customer est attaché au User (spec §1.1).
    `metadata[user_id]` permet au webhook de remonter au payeur.
    `invoice_settings[footer]` pose la mention légale de franchise en base
    (art. 293 B du CGI) sur TOUTES les factures générées pour ce Customer.
    MOCK_BILLING ⇒ identifiant local `cus_mock_<uuid>` (aucun appel sortant)."""
    if settings.MOCK_BILLING:
        return f"cus_mock_{uuid.uuid4().hex[:16]}"
    data = await _stripe_request("POST", "/customers", data={
        "name": user.name,
        "email": email or user.email or "",
        "metadata[user_id]": str(user.id),
        # Mention obligatoire : pas de TVA facturée (franchise en base).
        "invoice_settings[footer]": INVOICE_FOOTER_293B,
    })
    return data["id"]


async def create_checkout_session(
    customer_id: str,
    line_items: list[dict],
    bots_map: dict[str, list[str]],
    group_key: str,
    user_id: int,
    intro_coupon: Optional[str] = None,
    consent_immediate_execution_at: Optional[str] = None,
    success_url: Optional[str] = None,
    cancel_url: Optional[str] = None,
) -> str:
    """Session de checkout abonnement -> URL de paiement hebergee par Stripe.

    Plusieurs `line_items` (spec §2.4), 1 par produit (base + plan IA +
    add-ons), chacun `[{"price": "price_...", "quantity": 1}]`.

    INTRO 1er MOIS REMISÉ (modèle actuel) : plus d'essai gratuit. Le Checkout crée
    un abonnement ACTIF immédiatement, dont la 1re facture est remisée par
    `intro_coupon` (coupon Stripe `duration:once`, % borné par palier IA).
    `payment_method_collection='if_required'` : la carte n'est demandée que s'il
    reste un montant dû — donc demandée pour un plan payant (intro > 0 €), MAIS
    sautée si un coupon 100 % ramène le dû à 0 € (parcours « offert » sans carte).
    Aux renouvellements, le plein tarif s'applique (coupon `once` consommé).

    Checkout ne propage AUCUN metadata par line_item ⇒ la cartographie complète
    bot→modules est sérialisée dans `subscription_data[metadata][bots]` (JSON).
    Le webhook `checkout.session.completed` / `subscription.updated` la relit.

    Socle-inclusion (point 6) : ce service ne fabrique JAMAIS de line_item — il
    pose tels quels les `line_items` que l'appelant a construits. La règle « base
    facturé seul / inclus dès qu'un plan IA est pris » est donc appliquée en amont
    (`billing._line_items_for_codes`) : aucune ligne `base` n'arrive ici quand un
    plan IA est présent. Les prix unitaires des plans IA ne sont jamais modifiés.

    PAS de TVA (franchise en base) : ni automatic_tax, ni tax_id_collection, ni
    billing_address_collection. PAS de payment_method_types (dynamic methods).
    `customer_update[name]=auto` met à jour le nom du Customer depuis le paiement.

    `success_url`/`cancel_url` (P4) : SURCHARGENT les redirections par défaut (sur
    APP_URL) quand fournis — sert à la surface EXTERNE (plugin WordPress) pour
    ramener le client sur SON site après paiement. None (appels dashboard) ⇒
    comportement historique inchangé (redirections APP_URL).

    MOCK_BILLING ⇒ URL locale, aucun appel Stripe (l'entitlement est appliqué
    directement par l'appelant / le routeur, simulant le webhook)."""
    if settings.MOCK_BILLING:
        # P4 : en MOCK, on redirige vers le success_url fourni (parcours plugin)
        # s'il existe, sinon l'URL locale dashboard historique (mock_session).
        if success_url:
            return success_url
        return (f"{settings.APP_URL}/app/billing?checkout=success"
                f"&mock_session=cs_test_{uuid.uuid4().hex[:16]}")

    data: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        # AUCUN metadata par line_item (Checkout ne le propage pas).
        "subscription_data[metadata][bots]": json.dumps(bots_map, separators=(",", ":")),
        "subscription_data[metadata][group_key]": group_key,
        "subscription_data[metadata][user_id]": str(user_id),
        # Carte demandée SEULEMENT s'il reste un montant dû (if_required) : oui pour
        # un plan payant (intro 1er mois > 0 €), NON si un coupon 100 % ramène à 0 €
        # (parcours « offert » sans carte). Compatible désormais car il n'y a plus
        # d'essai à 0 € (qui aurait fait sauter la carte pour tout le monde).
        "payment_method_collection": "if_required",
        # P4 : redirections surchargeables (plugin WordPress -> retour sur le site
        # client) ; fallback = comportement historique sur APP_URL si non fournies.
        "success_url": success_url or (f"{settings.APP_URL}/app/billing"
                        f"?checkout=success&session_id={{CHECKOUT_SESSION_ID}}"),
        "cancel_url": cancel_url or f"{settings.APP_URL}/app/billing?checkout=cancelled",
        # MAJ du nom du Customer depuis l'étape de paiement.
        "customer_update[name]": "auto",
        # PAS de `allow_promotion_codes` : Stripe l'INTERDIT avec `discounts` (un seul
        # rabais par session). L'intro est appliquée d'office via `discounts`
        # ci-dessous ; les gratuités/comps passent par l'override admin « offert »
        # (entitlement source=staff, hors Stripe, sans carte).
        # PAS de payment_method_types / automatic_tax / tax_id_collection /
        # billing_address_collection (dynamic methods + franchise en base TVA).
    }
    for i, item in enumerate(line_items):
        data[f"line_items[{i}][price]"] = item["price"]
        data[f"line_items[{i}][quantity]"] = str(item.get("quantity", 1))
    # Intro 1er mois remisée : coupon Stripe `duration:once` appliqué au TOTAL de la
    # 1re facture (mutuellement exclusif avec allow_promotion_codes côté Stripe).
    if intro_coupon:
        data["discounts[0][coupon]"] = intro_coupon
    # Preuve du consentement à l'exécution immédiate (renonciation rétractation 14 j) :
    # horodatage ISO stocké en métadonnée d'abonnement (lisible Dashboard / API Stripe).
    if consent_immediate_execution_at:
        data["subscription_data[metadata][consent_immediate_execution_at]"] = consent_immediate_execution_at

    resp = await _stripe_request("POST", "/checkout/sessions", data=data)
    return resp["url"]


async def create_subscription(
    customer_id: str,
    items: list[dict],
    metadata: Optional[dict[str, str]] = None,
) -> dict:
    """Crée une subscription par API (subs 2..n des formats per_bot/per_org).

    Contrairement au Checkout, `items[n][metadata][bot_id]` EST propagé vers les
    subscription_items (privilégié dès la 2e sub). `items` =
    [{"price": "price_...", "quantity": 1, "metadata": {"bot_id": "42",
    "module": "mod_rag"}}].

    PAS de TVA (automatic_tax non passé). MOCK_BILLING ⇒ objet sub factice."""
    if settings.MOCK_BILLING:
        return {"id": f"sub_mock_{uuid.uuid4().hex[:16]}", "status": "active",
                "items": {"data": [{"id": f"si_mock_{uuid.uuid4().hex[:12]}",
                                    "price": {"id": it["price"]}} for it in items]}}

    data: dict[str, Any] = {"customer": customer_id}
    for i, item in enumerate(items):
        data[f"items[{i}][price]"] = item["price"]
        data[f"items[{i}][quantity]"] = str(item.get("quantity", 1))
        for mk, mv in (item.get("metadata") or {}).items():
            data[f"items[{i}][metadata][{mk}]"] = str(mv)
    for mk, mv in (metadata or {}).items():
        data[f"metadata[{mk}]"] = str(mv)
    return await _stripe_request("POST", "/subscriptions", data=data)


async def update_subscription_items(
    subscription_id: str,
    target_items: list[dict],
    proration_behavior: str = "create_prorations",
) -> Optional[dict]:
    """Aligne les items d'une sub sur la liste cible (ajout/retrait/quantité).

    `target_items` = [{"id": "si_..."?, "price": "price_...", "quantity": 1,
    "deleted": bool?, "metered": bool?, "metadata": {...}}]. Si la liste cible est
    VIDE (0 item), Stripe refuse une sub sans item ⇒ on RÉSILIE (garde §2.4).

    Un item MÉTRÉ (`metered=True`, usage_type metered : axe IA dépassement) N'ACCEPTE
    PAS de `quantity` (Stripe 400 sinon) : on l'omet pour ces items. Les items
    licenciés gardent `quantity` (défaut 1).

    `proration_behavior` (best practice Stripe, point proration) :
    - `always_invoice` : facture IMMÉDIATEMENT le prorata du temps restant (ajout
      de module/upgrade « payant à la modif ») ;
    - `none` : aucune proration ni facture intermédiaire — le prix PLEIN s'applique
      à la prochaine échéance (utilisé PENDANT l'essai : les changements ne font que
      remodeler ce qui sera facturé en fin d'essai) ;
    - `create_prorations` : crée des lignes de prorata appliquées à la prochaine
      facture (défaut historique, conservé pour les autres appelants : regrouping,
      transfert de payeur).

    Pour un RETRAIT de module sans crédit en fin de période, NE PAS supprimer
    l'item ici : utiliser `schedule_subscription_downgrade` (le module reste actif
    et facturé jusqu'à `current_period_end`).

    MOCK_BILLING ⇒ no-op (retourne None)."""
    if not target_items:
        await cancel_subscription(subscription_id, prorate=True)
        return None
    if settings.MOCK_BILLING:
        return None

    data: dict[str, Any] = {"proration_behavior": proration_behavior}
    for i, item in enumerate(target_items):
        if item.get("id"):
            data[f"items[{i}][id]"] = item["id"]
        if item.get("deleted"):
            data[f"items[{i}][deleted]"] = "true"
            continue
        if item.get("price"):
            data[f"items[{i}][price]"] = item["price"]
        # Item MÉTRÉ (usage_type metered) : PAS de quantity (Stripe la refuse).
        if not item.get("metered"):
            data[f"items[{i}][quantity]"] = str(item.get("quantity", 1))
        for mk, mv in (item.get("metadata") or {}).items():
            data[f"items[{i}][metadata][{mk}]"] = str(mv)
    return await _stripe_request("POST", f"/subscriptions/{subscription_id}", data=data)


async def remove_bot_items_from_payer_subs(
    db: AsyncSession,
    payer_user_id: int,
    should_remove,
    log_prefix: str,
) -> None:
    """Retire des subscriptions d'un payeur les items dont `should_remove(bot_id)`
    est vrai (changement de payeur : move perso->équipe, transfert d'org).

    Factorise le bloc dupliqué entre `routers/billing.billing_on_org_owner_change`
    et `routers/bots._billing_on_move_payer_change` — seuls le prédicat et le
    préfixe de log différaient. Sémantique :

    - les items CONSERVÉS sont reconduits tels quels (si_id + price + quantity) ;
      une ligne MÉTRÉE conservée (mtr_ai) est marquée `metered` -> AUCUNE quantity
      (Stripe 400 sinon sur l'item metered) ;
    - les items RETIRÉS sont envoyés EXPLICITEMENT `{id, deleted:true}` : sans
      cela Stripe les CONSERVAIT sur la sub (seul le miroir local était amputé)
      et continuait de facturer l'ancien payeur pour le bot parti ;
    - 0 item conservé ⇒ cible vide ⇒ `update_subscription_items` RÉSILIE la sub
      (Stripe refuse une sub sans item) ;
    - le miroir local (`raw_items` / `status`) n'est mis à jour QUE si l'appel
      Stripe a RÉUSSI : sur StripeError on loggue et on laisse le miroir INTACT
      (sinon miroir amputé/canceled alors que Stripe facture toujours, et la
      garde de résurrection bloquerait la resynchronisation).

    Best-effort : la StripeError est avalée (un move/transfert ne doit jamais
    échouer à cause du billing). Ne commit pas (l'appelant commit)."""
    subs = (await db.execute(
        select(BillingSubscription).where(
            BillingSubscription.user_id == payer_user_id)
    )).scalars().all()
    for sub in subs:
        items = list(sub.raw_items or [])
        kept = [it for it in items if not should_remove(it.get("bot_id"))]
        if len(kept) == len(items):
            continue  # cette sub ne portait aucun bot concerné
        removed = [it for it in items if should_remove(it.get("bot_id"))]
        target = [
            {"id": it.get("si_id"), "price": it.get("price_id"),
             "metered": True}
            if is_metered_code(it.get("code"))
            else {"id": it.get("si_id"), "price": it.get("price_id"),
                  "quantity": it.get("qty", 1)}
            for it in kept if it.get("price_id")]
        if target:
            # Suppression EXPLICITE côté Stripe des items retirés (sinon ils
            # restent facturés chez l'ancien payeur). Cible entièrement vide :
            # on n'émet PAS de deleted (la résiliation ci-dessous s'en charge).
            target += [{"id": it["si_id"], "deleted": True}
                       for it in removed if it.get("si_id")]
        try:
            # 0 item cible ⇒ update_subscription_items résilie la sub (Stripe
            # refuse une sub sans item) ; sinon proration crédit.
            await update_subscription_items(
                sub.stripe_subscription_id, target,
                proration_behavior="create_prorations",
            )
        except StripeError:
            # Stripe N'A PAS été mis à jour : le miroir reste INTACT (resync
            # possible via webhook/reconcile), on loggue seulement.
            logger.warning("%s: maj sub %s échouée (miroir conservé)",
                           log_prefix, sub.stripe_subscription_id)
            continue
        sub.raw_items = kept
        if not kept:
            sub.status = "canceled"


async def schedule_subscription_downgrade(
    subscription_id: str,
    phase_items: list[dict],
) -> Optional[dict]:
    """Programme un RETRAIT de module en FIN DE PÉRIODE, SANS crédit (règle
    proration, point « removal = end-of-period, no credit »).

    Le module retiré reste ACTIF et FACTURÉ jusqu'à `current_period_end` ; la
    composition réduite (`phase_items`) ne prend effet qu'au renouvellement. On
    s'appuie sur les Subscription Schedules Stripe (mécanisme natif de phases) :

    1) `POST /v1/subscription_schedules {from_subscription}` : « libère » la sub
       dans un schedule dont la phase courante reflète l'abonnement actuel
       (Stripe la pose avec les bonnes dates `start_date`/`end_date`).
    2) On relit le schedule pour récupérer la phase courante (items + bornes),
       puis on RÉÉCRIT `phases` = [phase_courante (inchangée), phase_réduite] où
       la 2e phase démarre exactement à la fin de la 1re (= fin de période) avec
       `proration_behavior='none'` (aucune proration/crédit au passage de phase).
       `end_behavior='release'` : à la fin du schedule la sub redevient autonome.

    `phase_items` = [{"price": "price_...", "quantity": 1}] = la composition CIBLE
    (après retrait). Un item MÉTRÉ (`metered=True`, usage_type metered : axe IA
    dépassement) N'EMPORTE PAS de quantity (Stripe 400 sinon). Liste VIDE
    interdite (une sub sans item est une résiliation : passer par
    `cancel_at_period_end`). Idempotent côté appelant : ré-appeler réécrit
    simplement la 2e phase.

    MOCK_BILLING ⇒ no-op (retourne None) : la sémantique de report est simulée
    côté routeur (entitlement « pending downgrade »)."""
    if settings.MOCK_BILLING:
        return None
    if not phase_items:
        # Sécurité : un schedule sans item de phase 2 est une résiliation ; le
        # caller doit router ce cas vers cancel_at_period_end. On ne devine pas.
        raise StripeError(
            "schedule_subscription_downgrade : phase cible vide (utiliser "
            "cancel_at_period_end pour une résiliation)")

    # 1) Libère la sub dans un schedule (la phase courante reflète l'état actuel).
    schedule = await _stripe_request(
        "POST", "/subscription_schedules",
        data={"from_subscription": subscription_id})
    schedule_id = schedule.get("id")
    if not schedule_id:
        raise StripeError("Stripe n'a pas renvoyé d'identifiant de schedule")

    phases = schedule.get("phases") or []
    now = int(time.time())
    # `current_phase` (Stripe) porte les bornes de la phase en cours ; on retrouve
    # la phase correspondante dans `phases` par sa fin. À défaut, on prend la phase
    # dont les bornes encadrent maintenant, sinon la dernière phase posée.
    cur_phase_meta = schedule.get("current_phase") or {}
    cur_end_hint = cur_phase_meta.get("end_date")
    cur = None
    if isinstance(cur_end_hint, int):
        cur = next((ph for ph in phases if ph.get("end_date") == cur_end_hint), None)
    if cur is None:
        for ph in phases:
            start = ph.get("start_date")
            end = ph.get("end_date")
            if isinstance(start, int) and isinstance(end, int) and start <= now < end:
                cur = ph
                break
    if cur is None and phases:
        cur = phases[-1]
    if cur is None or not isinstance(cur.get("end_date"), int):
        raise StripeError("Schedule sans phase courante exploitable")

    period_end = cur["end_date"]

    # 2) Réécrit les phases : phase courante CONSERVÉE telle quelle (items + dates,
    #    le module retiré reste facturé jusqu'à period_end), puis phase réduite à
    #    partir de period_end, sans proration (aucun crédit).
    data: dict[str, Any] = {
        "end_behavior": "release",
        "phases[0][start_date]": str(cur.get("start_date") or now),
        "phases[0][end_date]": str(period_end),
        "phases[0][proration_behavior]": "none",
    }
    for j, item in enumerate(cur.get("items") or []):
        price = item.get("price")
        # Sur un objet schedule, item.price est l'id (string) du price (ou un
        # objet price expansé).
        price_obj = price if isinstance(price, dict) else None
        if isinstance(price, dict):
            price = price.get("id")
        if not price:
            continue
        data[f"phases[0][items][{j}][price]"] = price
        # Un item MÉTRÉ (usage_type=metered) n'a PAS de quantity (Stripe 400
        # sinon). Stripe ne renvoie pas de `quantity` pour ces items : on
        # n'émet la quantité QUE si la source en porte une (item licencié).
        recurring = (price_obj or {}).get("recurring") or {}
        is_metered = recurring.get("usage_type") == "metered"
        if not is_metered and item.get("quantity") is not None:
            data[f"phases[0][items][{j}][quantity]"] = str(item.get("quantity", 1))

    data["phases[1][start_date]"] = str(period_end)
    data["phases[1][proration_behavior]"] = "none"
    for j, item in enumerate(phase_items):
        data[f"phases[1][items][{j}][price]"] = item["price"]
        # Item MÉTRÉ : aucune quantity (axe IA dépassement, mtr_ai).
        if not item.get("metered"):
            data[f"phases[1][items][{j}][quantity]"] = str(item.get("quantity", 1))

    return await _stripe_request(
        "POST", f"/subscription_schedules/{schedule_id}", data=data)


async def create_portal_session(customer_id: str) -> str:
    """Portail client Stripe (downgrade, resiliation, moyens de paiement).
    MOCK_BILLING ⇒ URL locale, aucun appel sortant (spec §2.3)."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
    })
    return data["url"]


async def create_update_portal_session(customer_id: str, subscription_id: str,
                                       price_id: str) -> str:
    """Portail EPINGLE sur le changement vers `price_id` (flow
    subscription_update_confirm) : le client ne peut pas y choisir un autre
    price que celui deja valide par les garde-fous de l'appelant.

    `price_id` est résolu par l'appelant via `price_id_for_code(code, db)`
    (catalogue en base). MOCK_BILLING ⇒ URL locale."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    if not price_id:
        raise StripeError("Price Stripe manquant pour le changement d'abonnement")
    # L'item de l'abonnement (si_...) est requis par le flow de confirmation
    sub = await _stripe_request("GET", f"/subscriptions/{subscription_id}")
    items = (sub.get("items") or {}).get("data") or []
    if not items:
        raise StripeError("Abonnement Stripe sans item")
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
        "flow_data[type]": "subscription_update_confirm",
        "flow_data[subscription_update_confirm][subscription]": subscription_id,
        "flow_data[subscription_update_confirm][items][0][id]": items[0]["id"],
        "flow_data[subscription_update_confirm][items][0][price]": price_id,
        "flow_data[subscription_update_confirm][items][0][quantity]": "1",
    })
    return data["url"]


async def create_cancel_portal_session(customer_id: str, subscription_id: str) -> str:
    """Portail EPINGLE sur la resiliation (retour au free) : le webhook
    customer.subscription.deleted appliquera le plan. MOCK_BILLING ⇒ URL locale."""
    if settings.MOCK_BILLING:
        return f"{settings.APP_URL}/app/billing?portal=mock"
    data = await _stripe_request("POST", "/billing_portal/sessions", data={
        "customer": customer_id,
        "return_url": f"{settings.APP_URL}/app/billing",
        "flow_data[type]": "subscription_cancel",
        "flow_data[subscription_cancel][subscription]": subscription_id,
    })
    return data["url"]


async def cancel_subscription(subscription_id: str, prorate: bool = False) -> None:
    """Resilie une subscription. `prorate=True` ⇒ proration de fin (crédit du
    temps non consommé, regrouping §4.2) ; sinon résiliation immédiate sèche
    (reconciliation anti double abonnement apres un second checkout).

    L'appelant decide si une StripeError est bloquante (le webhook la loggue
    sans bloquer, pour rester idempotent). MOCK_BILLING ⇒ no-op."""
    if settings.MOCK_BILLING:
        return
    params = {"prorate": "true"} if prorate else None
    await _stripe_request("DELETE", f"/subscriptions/{subscription_id}", params=params)


async def cancel_at_period_end(subscription_id: str) -> Optional[dict]:
    """Programme la résiliation d'une sub en FIN DE PÉRIODE (règle 2, point 2).

    POST /v1/subscriptions/{id} {cancel_at_period_end:true} : le bot reste actif
    jusqu'à `current_period_end` (AUCUN remboursement, pas de proration), puis
    Stripe émet `customer.subscription.deleted` -> le webhook recalcule l'état NET
    et gate le bot. Contrairement à `cancel_subscription` (résiliation immédiate),
    ce helper NE résilie PAS tout de suite.

    Retourne l'objet subscription Stripe (porte `current_period_end`, epoch s) ou
    None en MOCK_BILLING (aucun appel sortant)."""
    if settings.MOCK_BILLING:
        return None
    return await _stripe_request(
        "POST", f"/subscriptions/{subscription_id}",
        data={"cancel_at_period_end": "true"})


async def expire_open_checkout_sessions(customer_id: str) -> None:
    """Expire les sessions de checkout encore ouvertes du customer : une seule
    session payable a la fois (deux onglets ou un retry ne peuvent pas aboutir
    a deux abonnements payes). MOCK_BILLING ⇒ no-op."""
    if settings.MOCK_BILLING:
        return
    data = await _stripe_request("GET", "/checkout/sessions",
                                 params={"customer": customer_id, "status": "open", "limit": 10})
    for session in data.get("data", []):
        await _stripe_request("POST", f"/checkout/sessions/{session['id']}/expire")


async def list_invoices(customer_id: Optional[str] = None, limit: int = 24) -> list[dict]:
    """Factures depuis l'API Stripe (a la demande, pas de table locale).
    Sans customer_id : toutes les factures du compte (vue staff agregee).
    MOCK_BILLING ⇒ liste vide (aucune facture réelle simulée)."""
    if settings.MOCK_BILLING:
        return []
    params: dict[str, Any] = {"limit": limit}
    if customer_id:
        params["customer"] = customer_id
    data = await _stripe_request("GET", "/invoices", params=params)
    # Clés du contrat Invoice (front) : amount_paid_cents (PAS amount_paid brut),
    # created en epoch SECONDES. Stripe exprime déjà amount_paid en centimes.
    return [{
        "id": inv.get("id"),
        "number": inv.get("number"),
        "status": inv.get("status"),
        "amount_paid_cents": inv.get("amount_paid") or 0,
        "currency": inv.get("currency"),
        "created": inv.get("created"),  # epoch SECONDES (brut Stripe), conforme au front
        "hosted_invoice_url": inv.get("hosted_invoice_url"),
        "invoice_pdf": inv.get("invoice_pdf"),
        # customer (cus_...) : neutre pour la vue payeur (filtrée par customer_id),
        # indispensable a la vue staff agregee pour mapper facture -> payeur.
        "customer": inv.get("customer"),
    } for inv in data.get("data", [])]


async def update_product(product_id: str, name: Optional[str] = None,
                         active: Optional[bool] = None,
                         description: Optional[str] = None) -> dict:
    """Met à jour un Product Stripe (POST /v1/products/{id}). Les Products sont
    MUTABLES (contrairement aux Prices) : on édite `name` / `active` /
    `description` en place.

    `description` (texte commercial affiché sur le Product Stripe / Checkout) est
    poussé tel quel quand fourni — None ⇒ champ non touché. `active=False` masque
    le produit (le Price associé doit être désactivé à part, via
    `deactivate_price`). MOCK_BILLING ⇒ no-op (retourne {})."""
    if settings.MOCK_BILLING:
        return {}
    data: dict[str, Any] = {}
    if name is not None:
        data["name"] = name
    if active is not None:
        data["active"] = "true" if active else "false"
    if description is not None:
        data["description"] = description
    if not data:
        return {}
    return await _stripe_request("POST", f"/products/{product_id}", data=data)


async def create_price(product_id: str, unit_amount: int, currency: str,
                       interval: str, code: str,
                       description: Optional[str] = None) -> dict:
    """Crée un NOUVEAU Price récurrent (POST /v1/prices) pour un product existant.

    Les Prices Stripe sont IMMUABLES : un changement de montant ne se fait JAMAIS
    en place — on crée un nouveau Price (ce helper) puis on désactive l'ancien
    (`deactivate_price`). `recurring[usage_type]=licensed` (les produits métrés ne
    sont pas vendus en v1).

    `description` n'est PAS un champ de Price (Stripe le porte sur le Product) :
    quand fourni, on le pousse sur le Product parent (POST /v1/products/{id})
    pour garder la description à jour lors d'un changement de prix. MOCK_BILLING
    ⇒ identifiant local `price_mock_<uuid>`."""
    if settings.MOCK_BILLING:
        return {"id": f"price_mock_{uuid.uuid4().hex[:16]}"}
    if description is not None:
        await update_product(product_id, description=description)
    return await _stripe_request("POST", "/prices", data={
        "product": product_id,
        "currency": currency,
        "unit_amount": str(unit_amount),
        "recurring[interval]": interval,
        "recurring[usage_type]": "licensed",
        "metadata[code]": code,
    })


async def create_coupon(percent_off: int, duration: str = "once",
                        name: Optional[str] = None) -> dict:
    """Crée un coupon Stripe (POST /v1/coupons). Les coupons sont IMMUABLES sur leur
    montant : changer un % => nouveau coupon (comme les Prices). Sert à la remise
    d'intro 1er mois (`duration='once'`). MOCK_BILLING ⇒ identifiant local factice."""
    if settings.MOCK_BILLING:
        return {"id": f"coupon_mock_{uuid.uuid4().hex[:12]}"}
    data: dict[str, Any] = {"percent_off": str(percent_off), "duration": duration}
    if name:
        data["name"] = name
    return await _stripe_request("POST", "/coupons", data=data)


async def deactivate_price(price_id: str) -> dict:
    """Désactive un Price (POST /v1/prices/{id} {active:false}). Seul `active` est
    mutable sur un Price ; le montant ne l'est jamais (cf. `create_price`).
    MOCK_BILLING ⇒ no-op (retourne {})."""
    if settings.MOCK_BILLING:
        return {}
    return await _stripe_request("POST", f"/prices/{price_id}", data={"active": "false"})


# --- Stripe Billing Meters (axe IA dépassement métré, v2) ------------------
#
# Pipeline : create_meter (1 Meter par event_name) -> create_metered_price (Price
# usage_type=metered lié au Meter) -> report_meter_event (à chaque réponse au-delà
# du quota). Le Meter mappe l'usage au CUSTOMER (payeur) via customer_mapping :
# pour le format 'total' (1 sub/customer) c'est exact ; per_bot/per_org (multi-sub)
# rapportent par customer — limitation connue documentée (scope serré, pas de
# sur-construction). MOCK_BILLING ⇒ objets factices / no-op (aucun appel sortant).

async def create_meter(display_name: str, event_name: str) -> dict:
    """Crée un Billing Meter Stripe (POST /v1/billing/meters).

    `event_name` est UNIQUE : référencé par le Price métré (`recurring[meter]`) et
    par les meter_events rapportés. Agrégation `sum` des `value` ; mapping vers le
    Customer payeur via `payload[stripe_customer_id]`. MOCK_BILLING ⇒ id factice."""
    if settings.MOCK_BILLING:
        return {"id": f"mtr_mock_{uuid.uuid4().hex[:16]}", "event_name": event_name}
    return await _stripe_request("POST", "/billing/meters", data={
        "display_name": display_name,
        "event_name": event_name,
        "default_aggregation[formula]": "sum",
        "customer_mapping[type]": "by_id",
        "customer_mapping[event_payload_key]": "stripe_customer_id",
        "value_settings[event_payload_key]": "value",
    })


async def create_metered_price(product_id: str, unit_amount_decimal: str,
                               currency: str, interval: str, code: str,
                               meter_id: str) -> dict:
    """Crée un Price MÉTRÉ (POST /v1/prices, recurring[usage_type]=metered).

    `unit_amount_decimal` est une chaîne décimale en CENTIMES (ex. "1.5" = 1,5 c =
    0,015 €) : `billing_scheme=per_unit` facture `value` × ce montant. Lié au Meter
    `meter_id` (recurring[meter]). MOCK_BILLING ⇒ id factice."""
    if settings.MOCK_BILLING:
        return {"id": f"price_mock_{uuid.uuid4().hex[:16]}"}
    return await _stripe_request("POST", "/prices", data={
        "product": product_id,
        "currency": currency,
        "recurring[interval]": interval,
        "recurring[usage_type]": "metered",
        "recurring[meter]": meter_id,
        "billing_scheme": "per_unit",
        "unit_amount_decimal": unit_amount_decimal,
        "metadata[code]": code,
    })


async def report_meter_event(event_name: str, customer_id: str, value: int = 1,
                             identifier: Optional[str] = None) -> None:
    """Rapporte un meter event (POST /v1/billing/meter_events) — usage métré.

    `payload[stripe_customer_id]` mappe l'usage au Customer payeur ; `payload[value]`
    porte la quantité (str). `identifier` (ex. "bot:{id}:{period}:{n}") déduplique
    les events sur une fenêtre GLISSANTE de 24 h côté Stripe (PAS une idempotence
    durable) ; l'appelant le choisit STRICTEMENT MONOTONE (n incrémente à chaque
    dépassement) donc il ne se répète jamais — c'est le compteur local
    reported_overage qui borne et fait foi, pas ce paramètre.

    BEST-EFFORT côté APPELANT : un hoquet Stripe (StripeError) NE DOIT PAS casser la
    réponse au visiteur — l'appelant avale l'exception ; le compteur local
    reported_overage fait foi et permettra une réconciliation. MOCK_BILLING ⇒ no-op."""
    if settings.MOCK_BILLING:
        return
    data: dict[str, Any] = {
        "event_name": event_name,
        "payload[stripe_customer_id]": customer_id,
        "payload[value]": str(value),
    }
    if identifier:
        data["identifier"] = identifier
    await _stripe_request("POST", "/billing/meter_events", data=data)


def verify_webhook_signature(payload: bytes, sig_header: Optional[str], tolerance: int = 300) -> dict:
    """Verifie le header "Stripe-Signature: t=<epoch>,v1=<hex>[,v1=...]" puis
    retourne l'evenement decode. Leve StripeError si signature absente,
    perimee (anti-rejeu, tolerance en secondes) ou invalide."""
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret or not sig_header:
        raise StripeError("Signature de webhook absente")

    timestamp: Optional[str] = None
    signatures: list[str] = []
    for part in sig_header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not signatures:
        raise StripeError("Signature de webhook malformée")

    try:
        ts = int(timestamp)
    except ValueError:
        raise StripeError("Signature de webhook malformée")
    if abs(time.time() - ts) > tolerance:
        raise StripeError("Signature de webhook expirée")

    signed = f"{timestamp}.".encode() + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, sig) for sig in signatures):
        raise StripeError("Signature de webhook invalide")

    return json.loads(payload)
