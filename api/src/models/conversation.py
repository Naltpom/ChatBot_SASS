"""Conversations + messages des visiteurs finaux.

`visitor_id` = UUID anonyme genere par le widget et stocke en localStorage
(finalite strictement necessaire au fonctionnement du chat -> exempte de
consentement). On ne stocke PAS l'IP en clair : uniquement pour le rate
limiting en memoire, jamais en base.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    text,
)

from src.core.database import Base
from src.core.time import utcnow

# Cycle de vie live chat (handoff conseiller) :
# ai -> human_requested (demande visiteur) -> human (staff a pris la main)
# -> closed (cloture staff). Retours : timeout 15 min ou cloture -> ai.
CONVERSATION_STATUSES = ("ai", "human_requested", "human", "closed")


def generate_conversation_id() -> str:
    return uuid.uuid4().hex


class Conversation(Base):
    __tablename__ = "conversations"
    # Index composite pour l'inbox staff (liste filtree par statut)
    __table_args__ = (Index("ix_conversations_bot_status", "bot_id", "status"),)

    id = Column(String, primary_key=True, default=generate_conversation_id)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    visitor_id = Column(String, nullable=False, index=True)
    domain = Column(String, nullable=False)
    # Contexte injecte dans le prompt IA : "l'utilisateur est sur /tarifs"
    page_url = Column(String, nullable=True)
    # Parcours du visiteur AVANT d'ouvrir le chat : [{"p": "/tarifs", "t": 1750...}].
    # Pathnames uniquement (sans query/hash), max 10 entrees, validees dans
    # routers/widget.py. Sert exclusivement de contexte aux reponses IA —
    # ce n'est PAS de l'analytics (aucune UI ne l'expose).
    # none_as_null : absence de parcours = SQL NULL (pas un 'null' JSON).
    journey = Column(JSON(none_as_null=True), nullable=True)
    # A/B test d'arbre : 'a' | 'b' affecte a la creation de session (sticky
    # pour toute la conversation), NULL = pas d'A/B actif a la creation.
    # JAMAIS renvoye au widget (aucune fuite du variant au visiteur).
    variant = Column(String, nullable=True)
    started_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    last_activity_at = Column(DateTime, default=utcnow, nullable=False)
    # --- Live chat (handoff conseiller) ---
    # status : voir CONVERSATION_STATUSES. server_default = backfill des lignes
    # existantes par la migration. Le timeout 15 min (human_requested sans
    # staff) est evalue paresseusement dans routers/widget.py, pas de cron.
    status = Column(String, default="ai", server_default=text("'ai'"), nullable=False)
    human_requested_at = Column(DateTime, nullable=True)
    human_taken_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, nullable=False)    # user | assistant
    # tree | ai | system | human (visiteur en mode conseiller OU reponse staff,
    # selon role). Convention : human/system sont EXCLUS de l'historique IA,
    # du decompte d'usage (usage_service compte source='ai') et des stats
    # (whitelists).
    source = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    tokens_in = Column(Integer, default=0, nullable=False)
    tokens_out = Column(Integer, default=0, nullable=False)
    # CSAT widget : +1 (reponse utile) / -1 (peu utile), pose par
    # POST /api/widget/feedback — uniquement sur role=assistant source ai|tree
    # (garanti par l'endpoint). NULL = pas de retour visiteur.
    rating = Column(SmallInteger, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)


# --- Schemas Pydantic (inbox live chat) ---

class ConversationOut(BaseModel):
    id: str
    bot_id: int
    status: str
    visitor_id: str
    domain: str
    page_url: str | None = None
    started_at: datetime
    last_activity_at: datetime
    human_requested_at: datetime | None = None
    closed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MessageOut(BaseModel):
    id: int
    role: str
    source: str
    content: str
    rating: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
