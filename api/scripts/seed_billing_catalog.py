"""Seed idempotent du catalogue de facturation (spec §2.2, §2.4, §9.4).

Catalogue FIGÉ 2026-06-20 (prix nets, TVA non applicable art. 293 B du CGI,
par bot / mois). Pour CHAQUE produit du catalogue :
  1. upsert la ligne `billing_products` (code = clé d'idempotence),
  2. si `billing_enabled()` ET la ligne n'a pas encore de `stripe_product_id` :
     POST /v1/products puis POST /v1/prices (Prices IMMUABLES côté Stripe),
     puis on persiste `stripe_product_id` / `stripe_price_id`.

Idempotent : relancer ne recrée RIEN (ni ligne en double, ni Product/Price
Stripe) — on saute toute ligne qui a déjà un `stripe_product_id`. Un changement
de montant = nouveau Price + bascule `is_active` (jamais d'édition d'un Price).

`mtr_ai` (métré, recurring[usage_type]=metered) est créé en base avec
`is_active=False` mais N'EST PAS poussé chez Stripe en v1 (blocage au quota,
non vendu). Il sera activé/poussé en v2 (Stripe Meters).

Usage (depuis api/) :
    python -m scripts.seed_billing_catalog

Sans clés Stripe (billing désactivé) : seed UNIQUEMENT la base locale (les
colonnes stripe_* restent NULL), pratique pour le catalogue front / la parité.

Conventions repo : Stripe via `_stripe_request` (httpx pur, pas de SDK) ;
session async ; `utcnow()` géré par les défauts de colonne.
"""
import asyncio
import logging

from sqlalchemy import select

from src.core.database import AsyncSessionLocal
from src.models.billing import BillingPreset, BillingProduct
from src.services import stripe_service

logger = logging.getLogger(__name__)

CURRENCY = "eur"
INTERVAL = "month"

# Catalogue FIGÉ 2026-06-20 (spec §2.2). unit_amount en CENTIMES.
# kind : base | ai_tier | module | metered.
# included_replies : quota mensuel des plans IA (NULL sinon).
# is_active : False => seedé en base mais NON poussé chez Stripe en v1.
CATALOG: list[dict] = [
    # --- Socle (9 €/mois) : facturé UNIQUEMENT pour un bot ARBRE SEUL ; INCLUS
    #     (non ajouté au Checkout) dès qu'un plan IA (ai_tier OU mod_ai_byok) est pris.
    #     Tout nouveau bot démarre par un essai 7 j SANS carte ; à J+7 sans
    #     souscription -> GATE. ---
    {"code": "base", "label": "Socle", "kind": "base",
     "unit_amount": 900, "included_replies": None, "is_active": True,
     "intro_percent": 45, "intro_coupon_id": "intro_base_45",
     "description": "Bot conversationnel en arbre : menus à clics illimités, "
                    "personnalisation de l'apparence, déclencheurs proactifs et "
                    "analytics. Fonctionne sans IA."},

    # --- Plans IA (kind=ai_tier ; un plan active le module `ai` et pose
    #     ai_monthly_quota = included_replies). Plus d'IA gratuite à vie. ---
    {"code": "ai_starter", "label": "IA Starter", "kind": "ai_tier",
     "unit_amount": 1900, "included_replies": 1000, "is_active": True,
     "intro_percent": 50, "intro_coupon_id": "intro_starter_50",
     "description": "Moteur IA (Claude Haiku / GPT-4o-mini) pour répondre en "
                    "langage naturel. 1 000 réponses IA incluses par mois."},
    {"code": "ai_growth", "label": "IA Growth", "kind": "ai_tier",
     "unit_amount": 3900, "included_replies": 3000, "is_active": True,
     "intro_percent": 65, "intro_coupon_id": "intro_growth_65",
     "description": "Moteur IA avec Claude Sonnet en plus. 3 000 réponses IA par "
                    "mois — pour un support client actif."},
    {"code": "ai_scale", "label": "IA Scale", "kind": "ai_tier",
     "unit_amount": 8900, "included_replies": 10000, "is_active": True,
     "intro_percent": 80, "intro_coupon_id": "intro_scale_80",
     "description": "Moteur IA haut volume : 10 000 réponses IA par mois, pour les "
                    "sites à fort trafic."},

    # --- Variante IA BYOK (forfait plateforme, bot non métré, kind=module) ---
    {"code": "mod_ai_byok", "label": "IA — clé du client (BYOK)", "kind": "module",
     "unit_amount": 2900, "included_replies": None, "is_active": True,
     "description": "Utilisez votre propre clé IA (Anthropic/OpenAI/Gemini) : "
                    "réponses illimitées, vous payez votre fournisseur. Forfait "
                    "plateforme fixe."},

    # --- Add-ons (forfait on/off, kind=module) ---
    {"code": "mod_rag", "label": "Connaissances (RAG)", "kind": "module",
     "unit_amount": 900, "included_replies": None, "is_active": True,
     "description": "Base de connaissances : indexez vos pages, PDF et FAQ ; l'IA "
                    "répond à partir de VOS contenus (recherche sémantique)."},
    {"code": "mod_inbox", "label": "Live chat / Inbox", "kind": "module",
     "unit_amount": 1500, "included_replies": None, "is_active": True,
     "description": "Chat en direct : vos conseillers reprennent la main sur une "
                    "conversation, avec boîte de réception et notifications."},
    {"code": "mod_actions", "label": "Actions", "kind": "module",
     "unit_amount": 1200, "included_replies": None, "is_active": True,
     "description": "Actions exécutables dans un arbre, SANS IA : webhooks, "
                    "capture de leads, ouverture de tickets, propositions de "
                    "créneaux."},
    {"code": "mod_mcp", "label": "MCP (outils IA)", "kind": "module",
     "unit_amount": 900, "included_replies": None, "is_active": True,
     "description": "Serveurs / outils MCP appelés par l'IA pour interroger vos "
                    "systèmes et agir en votre nom."},
    {"code": "mod_ab", "label": "A/B testing", "kind": "module",
     "unit_amount": 700, "included_replies": None, "is_active": True,
     "description": "Test A/B d'arbres : comparez deux versions de votre scénario "
                    "et mesurez laquelle convertit le mieux."},
    {"code": "mod_whitelabel", "label": "White-label", "kind": "module",
     "unit_amount": 900, "included_replies": None, "is_active": True,
     "description": "Marque blanche : retire la mention Propulsé par Chapote du "
                    "widget."},

    # --- Axe métré IA (v2 : 0,015 €/réponse = 1,5 c au-delà du quota). v1 : NON
    #     vendu, is_active=False => seedé en base, jamais poussé chez Stripe. Le
    #     prix sub-centime (1,5 c) se posera en v2 via unit_amount_decimal /
    #     Stripe Meters ; unit_amount=2 ici est un placeholder inerte (non poussé). ---
    {"code": "mtr_ai", "label": "Dépassement IA (par réponse)", "kind": "metered",
     "unit_amount": 2, "included_replies": None, "is_active": False,
     "description": "Facturation à l'usage des réponses IA au-delà du quota "
                    "(activée en v2)."},
]


# Présélections du configurateur (bundles) — pilotées en base (billing_presets,
# éditable admin). Le total est recalculé serveur depuis billing_products.
PRESETS: list[dict] = [
    {"key": "vitrine", "label": "Vitrine / FAQ",
     "tagline": "Un bot qui répond aux questions courantes.",
     "ai_tier_id": "ai_starter", "modules": ["rag"],
     "recommended": False, "sort_order": 10},
    {"key": "pro_ia_rag", "label": "Service client",
     "tagline": "IA + base de connaissances + live chat + actions.",
     "ai_tier_id": "ai_growth", "modules": ["rag", "inbox", "actions"],
     "recommended": True, "sort_order": 20},
    {"key": "service_client", "label": "Sur-mesure / Volume",
     "tagline": "Tout débloqué, gros volume.",
     "ai_tier_id": "ai_scale", "modules": ["rag", "inbox", "actions", "ab", "white_label"],
     "recommended": False, "sort_order": 30},
]


async def _upsert_local(db, item: dict) -> BillingProduct:
    """Crée/met à jour la ligne `billing_products` (idempotent par `code`).
    Ne touche JAMAIS stripe_product_id / stripe_price_id (gérés par _push_stripe)."""
    row = (await db.execute(
        select(BillingProduct).where(BillingProduct.code == item["code"])
    )).scalar_one_or_none()
    if row is None:
        row = BillingProduct(code=item["code"], currency=CURRENCY, interval=INTERVAL)
        db.add(row)
    # Champs déclaratifs (label/montant/description peuvent évoluer ; code figé).
    row.label = item["label"]
    row.description = item.get("description")
    row.kind = item["kind"]
    row.included_replies = item["included_replies"]
    row.unit_amount = item["unit_amount"]
    row.currency = CURRENCY
    row.interval = INTERVAL
    row.is_active = item["is_active"]
    # Remise d'intro (éditable admin ensuite) : posée au seed pour les paliers IA
    # + le socle (défaut). Absente => None (pas de remise sur ce produit).
    row.intro_percent = item.get("intro_percent")
    row.intro_coupon_id = item.get("intro_coupon_id")
    await db.flush()
    return row


async def _upsert_preset(db, item: dict) -> None:
    """Crée/met à jour une présélection `billing_presets` (idempotent par `key`)."""
    row = (await db.execute(
        select(BillingPreset).where(BillingPreset.key == item["key"])
    )).scalar_one_or_none()
    if row is None:
        row = BillingPreset(key=item["key"])
        db.add(row)
    row.label = item["label"]
    row.tagline = item.get("tagline", "")
    row.ai_tier_id = item.get("ai_tier_id")
    row.modules = item.get("modules", [])
    row.recommended = item.get("recommended", False)
    row.sort_order = item.get("sort_order", 0)
    row.is_active = item.get("is_active", True)
    await db.flush()


async def _push_stripe(row: BillingProduct, item: dict) -> bool:
    """Crée le Product puis le Price chez Stripe si absent (idempotent).

    Retourne True si un push a eu lieu. Saute : produits inactifs (mtr_ai en v1),
    lignes déjà liées (stripe_product_id présent). Prices IMMUABLES : un montant
    différent => nouveau Price (géré hors seed, par bascule is_active)."""
    if not stripe_service.billing_enabled():
        return False
    if not item["is_active"]:
        # mtr_ai (et tout produit v2) : non vendu en v1, pas de push.
        return False
    if row.stripe_product_id:
        return False  # déjà seedé chez Stripe.

    product_data = {
        "name": row.label,
        "metadata[code]": row.code,
    }
    if row.description:
        # Champ `description` du Product Stripe (texte commercial).
        product_data["description"] = row.description
    product = await stripe_service._stripe_request("POST", "/products", data=product_data)
    row.stripe_product_id = product["id"]

    recurring_usage = "metered" if row.kind == "metered" else "licensed"
    price = await stripe_service._stripe_request("POST", "/prices", data={
        "product": product["id"],
        "currency": row.currency,
        "unit_amount": str(row.unit_amount),
        "recurring[interval]": row.interval,
        "recurring[usage_type]": recurring_usage,
        "metadata[code]": row.code,
    })
    row.stripe_price_id = price["id"]
    return True


async def seed() -> None:
    pushed = 0
    async with AsyncSessionLocal() as db:
        for item in CATALOG:
            row = await _upsert_local(db, item)
            if await _push_stripe(row, item):
                pushed += 1
                logger.info("Stripe seedé : %s -> %s / %s",
                            row.code, row.stripe_product_id, row.stripe_price_id)
        for preset in PRESETS:
            await _upsert_preset(db, preset)
        await db.commit()

    if stripe_service.billing_enabled():
        logger.info("Catalogue seedé (%d lignes, %d poussées chez Stripe).",
                    len(CATALOG), pushed)
    else:
        logger.info("Catalogue seedé en base uniquement (%d lignes) — billing "
                    "désactivé, colonnes stripe_* laissées NULL.", len(CATALOG))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(seed())
