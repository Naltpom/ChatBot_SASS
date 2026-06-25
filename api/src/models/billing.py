"""Modèle de données de la facturation modulaire (spec §1.4 — schémas CANONIQUES).

Tout le modèle billing vit ICI (décision D3) :
- BotEntitlement      : droits d'un bot, projetés depuis Stripe par le webhook
                        (jamais édités via PATCH /api/bots). Absence de ligne =
                        socle gratuit (resolver RÈGLE 2).
- BillingSubscription : miroir local des subscriptions Stripe (multi-sub sous
                        1 customer = le User).
- BillingProduct      : catalogue piloté en base (plus de STRIPE_PRICE_* en .env).
- BillingWebhookEvent : idempotence webhook (event.id).
- BotUsageCounter     : report v2 UNIQUEMENT (la conso IA durable vit dans Message).

Conventions repo : utcnow() (src/core/time), DateTime SANS timezone,
server_default=text(...) pour les colonnes NOT NULL, JSON pour les collections.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)

from src.core.database import Base
from src.core.time import utcnow


class BotEntitlement(Base):
    """Droits d'un bot, projetés depuis Stripe (jamais édités via PATCH /api/bots).
    Absence de ligne = socle gratuit. Schéma CANONIQUE (corrige B3/B4)."""
    __tablename__ = "bot_entitlements"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"),
                    unique=True, nullable=False, index=True)

    modules = Column(JSON, default=list, nullable=False, server_default=text("'[]'"))  # sous-ensemble de MODULE_KEYS
    # Convention D4/B4 : NULL = illimité/non applicable ; 0 = module IA absent ; >=1 = quota mensuel
    ai_monthly_quota = Column(Integer, nullable=True)
    overage_mode = Column(String, nullable=False, default="block",
                          server_default=text("'block'"))  # block (v1) | meter (v2)
    status = Column(String, nullable=False, default="active",
                    server_default=text("'active'"))        # active | trialing | past_due | canceled | inactive
    # Fin de l'essai 7 j AVEC carte (status='trialing', carte posée au Checkout) :
    # au-delà -> GATE (resolver) si non débité. NULL quand status != 'trialing'
    # (essai converti => status='active', trial_end ignoré).
    trial_end = Column(DateTime, nullable=True)
    # source : stripe (payé / essai avec carte) | staff (override) | free (billing-OFF)
    source = Column(String, nullable=False, default="free",
                    server_default=text("'free'"))

    # Caps dérivés (null = constante technique par défaut)
    max_kb_sources = Column(Integer, nullable=True)   # def. kb_service.MAX_SOURCES_PER_BOT
    max_actions = Column(Integer, nullable=True)      # def. bots_helpers._MAX_ACTIONS=5
    max_mcp_servers = Column(Integer, nullable=True)  # def. bots_helpers._MAX_MCP_SERVERS=2

    stripe_subscription_id = Column(String, nullable=True, index=True)  # sub_...
    stripe_item_id = Column(String, nullable=True)                      # si_... (item metered v2)
    synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class BillingSubscription(Base):
    """Miroir local des subscriptions Stripe (multi-sub sous 1 customer = le User).
    Index Stripe↔scope que le webhook traduit en entitlements. Schéma CANONIQUE."""
    __tablename__ = "billing_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)             # le payeur (= customer)
    stripe_subscription_id = Column(String, unique=True, nullable=False, index=True)

    # Découpage selon billing_grouping au moment de la création :
    grouping = Column(String, nullable=False)     # total | per_bot | per_org
    scope_kind = Column(String, nullable=False)   # user_all | bot | org | user_personal
    scope_bot_id = Column(Integer, ForeignKey("bots.id", ondelete="SET NULL"),
                          nullable=True, index=True)
    scope_org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"),
                          nullable=True, index=True)

    status = Column(String, nullable=False, default="active")  # active|trialing|past_due|canceled|...
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False,
                                  server_default=text("false"))
    raw_items = Column(JSON, nullable=True)  # [{si_id, price_id, code, bot_id, qty}] (idempotence/resync)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class BillingProduct(Base):
    """Catalogue piloté en base (plus de STRIPE_PRICE_* en .env)."""
    __tablename__ = "billing_products"

    id = Column(Integer, primary_key=True)
    # base, ai_starter/growth/scale, mod_ai_byok, mod_rag, mod_inbox,
    # mod_actions, mod_mcp, mod_ab, mod_whitelabel, mtr_ai
    code = Column(String, unique=True, nullable=False, index=True)
    label = Column(String, nullable=False)
    description = Column(String, nullable=True)  # texte commercial, poussé sur le Product Stripe
    kind = Column(String, nullable=False)   # base | ai_tier | module | metered
    included_replies = Column(Integer, nullable=True)  # quota mensuel des lignes kind='ai_tier' (NULL sinon)
    # Remise d'intro 1er mois (éditable admin) : % porté par les paliers IA (ai_*)
    # et par 'base' (= défaut IA off / BYOK) ; coupon Stripe duration:once associé
    # (rotation à chaque changement de %). NULL ailleurs / pas de remise.
    intro_percent = Column(Integer, nullable=True)
    intro_coupon_id = Column(String, nullable=True)
    stripe_product_id = Column(String, nullable=True)
    stripe_price_id = Column(String, nullable=True, index=True)
    unit_amount = Column(Integer, nullable=False)            # centimes
    currency = Column(String, nullable=False, default="eur")
    interval = Column(String, nullable=False, default="month")
    is_active = Column(Boolean, nullable=False, default=True,
                       server_default=text("true"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class BillingPreset(Base):
    """Présélections du configurateur (bundles), pilotées en base (éditable admin).
    Le total affiché est recalculé serveur depuis billing_products (aucun prix ici)."""
    __tablename__ = "billing_presets"

    id = Column(Integer, primary_key=True)
    key = Column(String, unique=True, nullable=False, index=True)
    label = Column(String, nullable=False)
    tagline = Column(String, nullable=False, default="", server_default="")
    ai_tier_id = Column(String, nullable=True)    # code du palier IA (ou None)
    modules = Column(JSON, nullable=True)          # liste de clés de module (add-ons)
    recommended = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    sort_order = Column(Integer, nullable=False, default=0, server_default=text("'0'"))
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class BillingWebhookEvent(Base):
    """Idempotence webhook (nom CANONIQUE, corrige B6 : ni billing_events ni
    processed_webhook_events)."""
    __tablename__ = "billing_webhook_events"

    id = Column(Integer, primary_key=True)
    stripe_event_id = Column(String, unique=True, nullable=False, index=True)  # evt_...
    type = Column(String, nullable=False)
    received_at = Column(DateTime, default=utcnow, nullable=False)
    payload = Column(JSON, nullable=True)


class BotUsageCounter(Base):
    """Report v2 UNIQUEMENT (D7). PAS de ai_replies ici : la conso vit dans Message."""
    __tablename__ = "bot_usage_counters"
    __table_args__ = (UniqueConstraint("bot_id", "period", name="uq_bot_usage_bot_period"),)

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    period = Column(String(7), nullable=False)   # "YYYY-MM" UTC (D8)
    reported_overage = Column(Integer, nullable=False, default=0, server_default=text("'0'"))
    period_start = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


# --- Schémas Pydantic (lecture seule, hors BOT_PERMS) ----------------------

class BillingProductOut(BaseModel):
    code: str
    label: str
    description: str | None = None
    kind: str                              # base | ai_tier | module | metered
    included_replies: int | None = None
    unit_amount: int                       # centimes
    currency: str = "eur"
    interval: str = "month"
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)


class BotEntitlementOut(BaseModel):
    bot_id: int
    modules: list[str] = Field(default_factory=list)
    ai_monthly_quota: int | None = None    # None = illimité
    overage_mode: str = "block"            # block | meter
    status: str = "active"                 # active | trialing | past_due | canceled | inactive
    trial_end: datetime | None = None      # fin de l'essai 7 j (null hors essai)
    source: str = "free"                   # stripe | staff | free
    max_kb_sources: int | None = None
    max_actions: int | None = None
    max_mcp_servers: int | None = None
    stripe_subscription_id: str | None = None
    synced_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class BillingSubscriptionOut(BaseModel):
    stripe_subscription_id: str
    grouping: str                          # total | per_bot | per_org
    scope_kind: str                        # user_all | bot | org | user_personal
    scope_bot_id: int | None = None
    scope_org_id: int | None = None
    status: str = "active"
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False

    model_config = ConfigDict(from_attributes=True)


class BotUsageOut(BaseModel):
    bot_id: int
    period: str                            # "YYYY-MM" UTC
    usage_ai_replies: int = 0              # conso durable (source = Message)
    quota_ai_replies: int | None = None    # None = illimité (BYOK / pas de quota)
    reported_overage: int = 0
