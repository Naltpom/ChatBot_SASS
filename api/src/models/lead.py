"""Leads captures par le widget : formulaire d'un noeud d'arbre type 'lead'
(source=tree) ou action IA capture_lead (source=ai).

La conversation d'origine est conservee si elle existe encore (SET NULL a sa
suppression) : le lead survit a la purge des conversations.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from src.core.database import Base


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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


# --- Schemas Pydantic ---

class LeadOut(BaseModel):
    id: int
    bot_id: int
    conversation_id: Optional[str] = None
    email: str
    phone: Optional[str] = None
    name: Optional[str] = None
    message: Optional[str] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True
