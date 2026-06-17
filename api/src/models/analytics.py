"""Analytics : evenements d'arbre (funnel) + rapports insights IA.

TreeEvent : un enregistrement par noeud d'arbre SERVI au visiteur (premier
noeud de session, clic d'option, texte libre en mode tree, degrade hybrid).
Ecrit en best-effort dans le commit du flux principal de routers/widget.py,
JAMAIS bloquant. Alimente le funnel d'abandon par noeud (routers/stats.py),
splitte par variante A/B le cas echeant.

InsightsReport : sortie de l'analyse IA « questions sans reponse »
(services/insights_service.py) — clusters de questions visiteurs des
30 derniers jours, generation IA a la demande cote dashboard (limiteur Redis
3/jour/org = borne anti-cout provider, pas un gating de plan).
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String

from src.core.database import Base
from src.core.time import utcnow


class TreeEvent(Base):
    __tablename__ = "tree_events"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    # conversations.id est un String (uuid hex) -> FK String. SET NULL a la
    # purge d'une conversation : l'evenement reste compte dans le funnel mais
    # sort du calcul des abandons (on ne sait plus le rattacher).
    conversation_id = Column(String, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True)
    node_key = Column(String(80), nullable=False)
    variant = Column(String, nullable=True)   # 'a' | 'b' | NULL (pas d'A/B)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)


class InsightsReport(Base):
    __tablename__ = "insights_reports"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    report_json = Column(JSON, nullable=False)
    message_count = Column(Integer, default=0, server_default="0", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


# --- Schemas Pydantic ---

class InsightsReportOut(BaseModel):
    id: int
    bot_id: int
    message_count: int
    created_at: datetime
    report_json: dict[str, Any]

    model_config = ConfigDict(from_attributes=True)
