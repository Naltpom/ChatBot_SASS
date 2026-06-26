"""Prospects de l'outil de prospection commerciale (back-office superadmin).

Une entreprise candidate trouvee via l'API publique recherche-entreprises
(base SIRENE) : metadonnees legales (SIREN, NAF, ville), enrichissement
best-effort du site web + email de contact, puis brouillon d'email de
prospection redige par l'IA, relu et envoye manuellement par le superadmin.

Aucune donnee de particulier : on ne cible que des contacts professionnels
d'entreprises. Le superadmin peut effacer un prospect a tout moment (RGPD).
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from src.core.database import Base
from src.core.time import utcnow

# Statuts du cycle de vie d'un prospect.
PROSPECT_STATUSES = ("found", "enriched", "drafted", "sent", "rejected")


class Prospect(Base):
    __tablename__ = "prospects"

    id = Column(Integer, primary_key=True)
    # Identite legale (source SIRENE). siren unique => dedoublonnage a l'import.
    siren = Column(String, nullable=True, unique=True, index=True)
    siret = Column(String, nullable=True)
    company_name = Column(String, nullable=False)
    naf_code = Column(String, nullable=True)
    sector_label = Column(String, nullable=True)
    city = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    contact_name = Column(String, nullable=True)  # dirigeant (si expose par l'API)

    # Enrichissement best-effort (site + email + detection chatbot existant).
    website = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    site_summary = Column(Text, nullable=True)
    has_existing_chatbot = Column(Boolean, nullable=True)

    # Brouillon d'email de prospection (IA), editable par le superadmin.
    email_subject = Column(Text, nullable=True)
    email_body = Column(Text, nullable=True)

    status = Column(String, default="found", nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    sent_at = Column(DateTime, nullable=True)


# --- Schemas Pydantic ---

class ProspectOut(BaseModel):
    id: int
    siren: str | None = None
    siret: str | None = None
    company_name: str
    naf_code: str | None = None
    sector_label: str | None = None
    city: str | None = None
    postal_code: str | None = None
    contact_name: str | None = None
    website: str | None = None
    contact_email: str | None = None
    site_summary: str | None = None
    has_existing_chatbot: bool | None = None
    email_subject: str | None = None
    email_body: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    sent_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ProspectPatch(BaseModel):
    """Edition manuelle d'un prospect par le superadmin (champs optionnels)."""
    company_name: str | None = None
    website: str | None = None
    contact_email: str | None = None
    contact_name: str | None = None
    email_subject: str | None = None
    email_body: str | None = None
    status: str | None = None
