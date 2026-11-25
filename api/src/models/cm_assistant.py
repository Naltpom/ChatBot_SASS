"""Assistant Chapote CM, mode « mes données » (docs/CM_MCP.md).

- CmAiConsent : accord IA d'un utilisateur (général + types de données + comptes exclus), avec
  la version de la politique IA et le prestataire affichés au moment de l'accord. `rev` augmente
  à chaque changement : il est copié dans le jeton assistant (champ `crev`), un jeton émis
  avant un changement est donc refusé.
- CmAiConsentEvent : historique de chaque changement (jamais modifié, sans adresse IP).
- CmAccountAiPermission : tableau de permissions d'un compte connecté, réglé par son possesseur
  (administrateur de l'espace qui contient le compte). Pas de ligne = rien n'est envoyé.
- CmAssistantAudit : un appel d'outil = une ligne (qui, quel outil, quand, catégories de données,
  sans aucun contenu).
"""
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String

from src.core.database import Base
from src.core.time import utcnow


class CmAiConsent(Base):
    __tablename__ = "cm_ai_consents"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    policy_version = Column(String(20), nullable=True)
    provider = Column(String(40), nullable=True)          # prestataire affiché lors de l'accord
    rev = Column(Integer, nullable=False, default=0)
    stats = Column(Boolean, nullable=False, default=True)
    planning = Column(Boolean, nullable=False, default=True)
    captions = Column(Boolean, nullable=False, default=False)
    excluded_accounts = Column(JSON, nullable=False, default=list)   # ["tiktok:12", …]
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmAiConsentEvent(Base):
    __tablename__ = "cm_ai_consent_events"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    at = Column(DateTime, default=utcnow, nullable=False)
    source = Column(String(20), nullable=False)           # inscription | profil | chat | mobile
    policy_version = Column(String(20), nullable=True)
    provider = Column(String(40), nullable=True)
    change = Column(JSON, nullable=False)                  # {"avant": {...}, "apres": {...}}


class CmAccountAiPermission(Base):
    __tablename__ = "cm_account_ai_permissions"
    __table_args__ = (Index("uq_cm_account_ai_permissions", "platform", "account_id", unique=True),)

    id = Column(Integer, primary_key=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    stats = Column(Boolean, nullable=False, default=True)
    planning = Column(Boolean, nullable=False, default=True)
    captions = Column(Boolean, nullable=False, default=False)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmAssistantAudit(Base):
    __tablename__ = "cm_assistant_audit"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    tool = Column(String(40), nullable=False)
    status = Column(String(10), nullable=False)            # ok | denied | error
    error_code = Column(String(40), nullable=True)         # catégorie, jamais un message
    duration_ms = Column(Integer, nullable=True)
    items = Column(Integer, nullable=True)
    categories = Column(JSON, nullable=True)               # ["stats", "planning", "captions", "accounts"]
    jti_hash = Column(String(16), nullable=True)           # empreinte courte du jeton (jamais le jeton)
