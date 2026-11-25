"""Application mobile de cm.chapote.fr : appareils connectés et notifications envoyées.

- `CmMobileDevice` : un téléphone connecté. Il garde un jeton longue durée (seulement son empreinte
  SHA-256 est stockée) qui lui donne des sessions courtes (cookie `chapote_session` d'une heure),
  révocable à tout moment, et, si l'utilisateur l'accepte, son jeton de notifications Expo.
- `CmPushEvent` : une notification déjà envoyée (vidéo publiée, échec, brouillon, commentaire) pour
  ne jamais l'envoyer deux fois, quel que soit le nombre de workers.
"""
from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Index, Integer, String

from src.core.database import Base
from src.core.time import utcnow


class CmMobileDevice(Base):
    __tablename__ = "cm_mobile_devices"
    __table_args__ = (
        Index("uq_cm_mobile_devices_token", "token_hash", unique=True),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False)
    name = Column(String(120), nullable=True)            # « iPhone de Nathan » (donné par l'app)
    platform = Column(String(20), nullable=True)         # ios | android
    push_token = Column(String(255), nullable=True, index=True)  # ExponentPushToken[…]
    push_prefs = Column(JSON, nullable=True)             # {published, failed, draft, comments} : booléens
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)


class CmPushEvent(Base):
    __tablename__ = "cm_push_events"
    __table_args__ = (
        Index("uq_cm_push_events_key", "kind", "ref_id", unique=True),
    )

    id = Column(Integer, primary_key=True)
    kind = Column(String(20), nullable=False)            # published | failed | draft | comment
    ref_id = Column(Integer, nullable=False)             # id de la cible ou du commentaire
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmUserIdentity(Base):
    """Informations données à l'inscription dans l'app : prénom, nom, date de naissance (âge minimum), et
    acceptation des conditions (CGU, CGV, confidentialité) avec leur version. La date de naissance ne se
    change plus ensuite (erreur : par le contact)."""
    __tablename__ = "cm_user_identities"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    first_name = Column(String(80), nullable=False)
    last_name = Column(String(80), nullable=False)
    birth_date = Column(Date, nullable=False)
    terms_version = Column(String(20), nullable=False)
    terms_accepted_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)
