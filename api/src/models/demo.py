"""Cache des generations de la demo publique « 1 URL -> chatbot ».

Une URL deja generee n'appelle PAS l'IA : on resert le tree_json mis en cache
(dans la limite du TTL DEMO_CACHE_TTL_DAYS). La liste des URLs testees est aussi
un signal commercial (prospects). Table alimentee UNIQUEMENT par l'endpoint
public /api/public/demo-tree — aucune donnee personnelle/sensible.
"""
from sqlalchemy import JSON, Column, DateTime, Integer, String, text

from src.core.database import Base
from src.core.time import utcnow


class DemoGeneration(Base):
    __tablename__ = "demo_generations"

    id = Column(Integer, primary_key=True)
    # Empreinte de l'URL normalisee = cle de cache (unique -> deduplication).
    url_hash = Column(String, unique=True, index=True, nullable=False)
    # URL normalisee, conservee lisible (host minuscule, sans fragment ni / final).
    url = Column(String, nullable=False)
    # Arbre genere (tree_json valide), reservi tel quel sur un cache hit.
    tree_json = Column(JSON, nullable=False)
    # Nombre de fois ou cette entree a ete RE-servie depuis le cache (sans IA).
    hits = Column(Integer, nullable=False, default=0, server_default=text("'0'"))
    # created_at = horloge de fraicheur (TTL). updated_at bouge a chaque hit.
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
