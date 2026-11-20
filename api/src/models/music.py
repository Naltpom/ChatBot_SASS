"""Boutique de partitions (music.chapote.fr) : catalogue, prix, codes promo, commandes.

- MusicSheet : une partition (un morceau joué sur un instrument), envoyée par la
  chaîne de production des vidéos (POST /api/music/ingest). `published` décide si
  elle est en vente : vrai d'office pour une œuvre du domaine public, faux sinon
  (badge « privé » dans l'admin) ; l'admin peut changer ce choix pour n'importe
  quelle partition. Les fichiers (PDF, aperçus) vivent sous MUSIC_DIR, jamais
  sous UPLOAD_DIR (public).
- MusicSettings : une seule ligne (id = 1), les prix appliqués par le back :
  prix d'une partition et prix du lot « plusieurs instruments d'un même morceau ».
- MusicPromoCode : code en pourcentage ou en montant, plafond d'utilisations, date de fin.
- MusicOrder / MusicOrderItem : une commande (sans compte client), son montant
  calculé par le back, le consentement à l'exécution immédiate (perte du droit de
  rétractation, contenu numérique), l'état du paiement Stripe.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)

from src.core.database import Base
from src.core.time import utcnow

# Statuts d'une commande
ORDER_PENDING = "pending"     # Checkout Stripe créé, paiement pas encore confirmé
ORDER_PAID = "paid"           # payée (ou gratuite) : liens de téléchargement actifs
ORDER_EXPIRED = "expired"     # session Checkout expirée sans paiement
ORDER_FAILED = "failed"       # paiement asynchrone refusé
ORDER_REFUNDED = "refunded"   # remboursée par l'admin dans Stripe : liens coupés

PROMO_PERCENT = "percent"
PROMO_AMOUNT = "amount"


class MusicSheet(Base):
    __tablename__ = "music_sheets"

    id = Column(Integer, primary_key=True)
    # Référence côté production (« ghost-hands/2026-11-20_12h20 ») : clé d'upsert.
    source_ref = Column(String(200), nullable=False, unique=True)
    # Un morceau regroupe ses instruments (lot) : même piece_slug.
    piece_slug = Column(String(160), nullable=False, index=True)
    piece_title = Column(String(300), nullable=False)
    composer = Column(String(200), nullable=True)
    instrument = Column(String(40), nullable=False)        # clé : piano, violon, guitare, batterie…
    instrument_label = Column(String(60), nullable=False)  # libellé anglais : Piano, Violin…
    title = Column(String(400), nullable=False)            # titre de la vidéo
    rights = Column(String(80), nullable=True)             # « domaine public », « protégé (reprise) »…
    public_domain = Column(Boolean, nullable=False, default=False)
    published = Column(Boolean, nullable=False, default=False)
    published_at = Column(DateTime, nullable=True)
    pages = Column(Integer, nullable=False, default=1)
    reel_url = Column(Text, nullable=True)
    has_cover = Column(Boolean, nullable=False, default=False)
    # Prix propre à cette partition (centimes) ; NULL = prix général.
    price_cents = Column(Integer, nullable=True)
    # Date de sortie de la vidéo (tri « nouveautés »).
    released_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class MusicSettings(Base):
    __tablename__ = "music_settings"

    id = Column(Integer, primary_key=True)  # toujours 1
    unit_price_cents = Column(Integer, nullable=False, default=199)
    # Prix de toutes les partitions d'un même morceau (≥ 2 instruments) ; NULL = pas de lot.
    bundle_price_cents = Column(Integer, nullable=True, default=299)
    currency = Column(String(3), nullable=False, default="eur")
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class MusicPromoCode(Base):
    __tablename__ = "music_promo_codes"

    id = Column(Integer, primary_key=True)
    code = Column(String(40), nullable=False, unique=True)  # majuscules
    kind = Column(String(10), nullable=False)               # percent | amount
    value = Column(Integer, nullable=False)                 # % (1-100) ou centimes
    active = Column(Boolean, nullable=False, default=True)
    max_uses = Column(Integer, nullable=True)               # NULL = illimité
    uses = Column(Integer, nullable=False, default=0)       # commandes payées
    expires_at = Column(DateTime, nullable=True)
    note = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class MusicOrder(Base):
    __tablename__ = "music_orders"
    __table_args__ = (
        Index("ix_music_orders_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    public_id = Column(String(40), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default=ORDER_PENDING)
    email = Column(String(320), nullable=True)
    lang = Column(String(5), nullable=False, default="en")
    subtotal_cents = Column(Integer, nullable=False)  # après lot, avant code promo
    discount_cents = Column(Integer, nullable=False, default=0)
    amount_cents = Column(Integer, nullable=False)    # payé
    currency = Column(String(3), nullable=False, default="eur")
    promo_code_id = Column(Integer, ForeignKey("music_promo_codes.id", ondelete="SET NULL"), nullable=True)
    promo_code = Column(String(40), nullable=True)
    stripe_session_id = Column(String(255), nullable=True, unique=True)
    stripe_payment_intent = Column(String(255), nullable=True)
    # Consentement horodaté : exécution immédiate + renonciation au droit de rétractation.
    consent_at = Column(DateTime, nullable=False)
    paid_at = Column(DateTime, nullable=True)
    emailed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class MusicOrderItem(Base):
    __tablename__ = "music_order_items"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("music_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sheet_id = Column(Integer, ForeignKey("music_sheets.id", ondelete="RESTRICT"), nullable=False, index=True)
    label = Column(String(500), nullable=False)
    price_cents = Column(Integer, nullable=False)
    downloads = Column(Integer, nullable=False, default=0)
