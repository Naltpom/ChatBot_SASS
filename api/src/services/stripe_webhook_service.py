"""Orchestration du webhook Stripe — extraite de routers/billing.py (PR-20).

Le webhook est le module le PLUS revenue-critical du repo. Cette couche service
porte TOUTE la logique métier de traitement d'un event Stripe subscription.* :

- IDEMPOTENCE par `event.id` (court-circuit total si l'event a déjà été vu :
  `billing_webhook_events`) — la projection a déjà été appliquée, on ne retouche
  PAS le miroir ;
- GARDE D'ORDRE : on ne régresse pas sur un event PLUS ANCIEN (champ Stripe
  `created`) que le dernier déjà appliqué pour CETTE subscription (replay /
  out-of-order) ;
- GARDE DE RÉSURRECTION : un `.deleted` est TERMINAL — un event non-`.deleted`
  arrivant après ne doit pas réactiver une sub déjà résiliée ;
- MIROIR puis PROJECTION : `_sync_subscription_mirror` reflète l'abonnement dans
  `billing_subscriptions` (source de l'état cible), PUIS `apply_subscription_event`
  projette les entitlements. Cet ORDRE est critique (la projection lit le miroir).

Le handler HTTP (routers/billing.py) se limite à : lire le corps BRUT, vérifier
la signature, garde billing-OFF, puis déléguer ici. Le COMMIT DB est fait ICI au
MÊME point qu'avant l'extraction (après mémorisation du `created`, dans la branche
subscription.*) pour préserver exactement l'ordre des opérations DB.

Ce module ne doit JAMAIS importer un router (sinon cycle d'import).
"""
import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.billing import (
    BillingProduct,
    BillingSubscription,
    BillingWebhookEvent,
)
from src.models.user import User
from src.services.entitlement_service import (
    _epoch_to_naive_utc,
    apply_subscription_event,
)

logger = logging.getLogger("billing")


async def process_webhook_event(db: AsyncSession, event: dict) -> dict:
    """Traite un event Stripe déjà vérifié (signature OK, billing ON) et renvoie
    le dict de réponse du webhook. COMPORTEMENT STRICTEMENT IDENTIQUE au handler
    historique : seules les branches subscription.* mutent l'état ; les gardes
    d'idempotence/ordre/résurrection court-circuitent AVANT tout `_sync` ; le
    commit a lieu au même point.
    """
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
                event_payload = dict(ev_row.payload or {})
                event_payload["created"] = incoming_created
                ev_row.payload = event_payload
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
    `process_webhook_event` après projection. Requête BORNÉE : on FILTRE par
    subscription dans le JSON et on ne remonte que la ligne au `created` MAX
    (`ORDER BY created DESC LIMIT 1`) — une seule ligne traverse la frontière DB,
    au lieu du scan complet O(n) historique (toute la table chargée en Python).
    Sémantique identique (le plus récent `created` vu pour cette sub).

    Accès JSON via les comparateurs GÉNÉRIQUES `as_string()`/`as_integer()` (et
    non `.astext`, spécifique PG) — `payload['k'].as_string()` rend `->> 'k'` sur
    Postgres tout en restant portable au type JSON générique du modèle."""
    created_int = BillingWebhookEvent.payload["created"].as_integer()
    return await db.scalar(
        select(created_int)
        .where(
            BillingWebhookEvent.type.like("customer.subscription.%"),
            BillingWebhookEvent.payload["subscription"].as_string() == stripe_sub_id,
            BillingWebhookEvent.payload["created"].as_string().isnot(None),
        )
        .order_by(created_int.desc())
        .limit(1)
    )


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
        # Repli : cartographie Checkout (subscription_data.metadata.bots). Un item
        # AGRÉGÉ (format total : qty>1, price PARTAGÉ entre bots, aucun
        # item.metadata.bot_id) couvre PLUSIEURS bots : on émet UNE entrée
        # raw_items PAR bot porteur du code (chacune qty=1, 1 unité par bot),
        # sinon seule la 1re correspondance serait projetée et les AUTRES bots
        # payés resteraient gatés (la projection lit raw_items[].bot_id).
        if bot_id is None and code:
            matched = [int(bid_str) for bid_str, codes in bots_map.items()
                       if code in codes and str(bid_str).isdigit()]
            if len(matched) > 1:
                for mbid in matched:
                    raw_items.append({
                        "si_id": item.get("id"),
                        "price_id": price,
                        "code": code,
                        "bot_id": mbid,
                        "qty": 1,
                    })
                continue
            if matched:
                bot_id = matched[0]
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
        # Bornes de période courante (epoch Stripe -> datetime naïf UTC) : lues
        # par le summary (prochaine échéance) et le cancel (fin d'accès). On ne
        # les écrase pas avec None si Stripe ne les fournit pas.
        period_start = _epoch_to_naive_utc(sub_obj.get("current_period_start"))
        period_end = _epoch_to_naive_utc(sub_obj.get("current_period_end"))
        if period_start is not None:
            row.current_period_start = period_start
        if period_end is not None:
            row.current_period_end = period_end
    await db.flush()
