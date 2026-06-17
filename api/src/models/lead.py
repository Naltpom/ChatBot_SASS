"""Leads captures par le widget : formulaire d'un noeud d'arbre type 'lead'
(source=tree) ou action IA capture_lead (source=ai).

La conversation d'origine est conservee si elle existe encore (SET NULL a sa
suppression) : le lead survit a la purge des conversations.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from src.core.database import Base
from src.core.time import utcnow


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    name = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    source = Column(String, default="tree", nullable=False)  # tree | ai
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)


# --- Schemas Pydantic ---

class LeadOut(BaseModel):
    id: int
    bot_id: int
    conversation_id: str | None = None
    email: str
    phone: str | None = None
    name: str | None = None
    message: str | None = None
    source: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
