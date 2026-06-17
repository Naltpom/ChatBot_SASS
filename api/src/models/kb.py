"""Base de connaissances RAG : sources ingerees (url/sitemap/pdf/texte) et
extraits vectorises (pgvector + tsvector french).

ATTENTION autogenerate : embedding (type custom Vector) et tsv (colonne
GENEREE tsvector) sont mal compris d'Alembic -> toute future revision
--autogenerate peut produire du bruit sur ces colonnes et DOIT etre relue
avant sauvegarde (le --reload applique immediatement toute revision ecrite).
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Computed, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.types import UserDefinedType

from src.core.database import Base
from src.core.time import utcnow


class Vector(UserDefinedType):
    """Type pgvector minimal (le paquet Python pgvector n'est pas une
    dependance autorisee). Sert au metadata/DDL ; les requetes runtime
    passent par du SQL textuel avec CAST(:e AS vector)."""
    cache_ok = True

    def __init__(self, dim: int):
        self.dim = dim

    def get_col_spec(self, **kw):
        return f"vector({self.dim})"


class KbSource(Base):
    __tablename__ = "kb_sources"

    id = Column(Integer, primary_key=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String, nullable=False)  # url | sitemap | pdf | text
    ref = Column(Text, nullable=False)     # url / nom de fichier / titre du texte
    status = Column(String, default="pending", server_default="pending", nullable=False)  # pending | ready | error
    error = Column(Text, nullable=True)
    chunk_count = Column(Integer, default=0, server_default="0", nullable=False)
    page_count = Column(Integer, default=0, server_default="0", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class KbChunk(Base):
    __tablename__ = "kb_chunks"

    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("kb_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("bots.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    page_url = Column(String, nullable=True)  # page d'origine (sitemap) sinon NULL
    embedding = Column(Vector(384), nullable=True)  # NULL = FTS seul (modele indispo)
    # Config french_unaccent (unaccent + french_stem, creee par la migration) :
    # le FTS matche sans tenir compte des accents (saisie chat)
    tsv = Column(TSVECTOR, Computed("to_tsvector('french_unaccent', content)", persisted=True), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


# --- Schemas Pydantic ---

class KbSourceOut(BaseModel):
    id: int
    bot_id: int
    type: str
    ref: str
    status: str
    error: str | None = None
    chunk_count: int
    page_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class KbSourceCreate(BaseModel):
    # pdf passe par l'endpoint multipart dedie, pas par ce schema
    type: str = Field(pattern="^(url|sitemap|text)$")
    ref: str | None = Field(None, max_length=500)          # url | sitemap
    content: str | None = Field(None, max_length=200_000)  # text
    title: str | None = Field(None, max_length=120)        # text (libelle)


class KbSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
