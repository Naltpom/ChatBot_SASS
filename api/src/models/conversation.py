"""Conversations + messages des visiteurs finaux.

`visitor_id` = UUID anonyme genere par le widget et stocke en localStorage
(finalite strictement necessaire au fonctionnement du chat -> exempte de
consentement). On ne stocke PAS l'IP en clair : uniquement pour le rate
limiting en memoire, jamais en base.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)

from src.core.database import Base


def generate_conversation_id() -> str:
    return uuid.uuid4().hex


class Conversation(Base):
    __tablename__ = "conversations"

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
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    last_activity_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String, nullable=False)    # user | assistant
    source = Column(String, nullable=False)  # tree | ai | system
    content = Column(Text, nullable=False)
    tokens_in = Column(Integer, default=0, nullable=False)
    tokens_out = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
