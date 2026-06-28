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
from sqlalchemy import (JSON, Boolean, Column, DateTime, ForeignKey, Integer,
                        String, Text)

from src.core.database import Base
from src.core.time import utcnow

# Statuts du cycle de vie d'un prospect.
PROSPECT_STATUSES = ("found", "enriched", "drafted", "sent", "rejected")

# Decisions de l'operateur sur un prospect score par l'IA (apprentissage few-shot).
PROSPECT_DECISIONS = ("accepted", "rejected")


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

    # Enrichissement riche et variable (scraping pousse) : { sirene: {...},
    # web: {emails, phones, socials, description, logo, cms, tech, ...} }.
    # Les colonnes scalaires ci-dessus restent les valeurs « principales »
    # retenues pour le flux email.
    enrichment = Column(JSON, nullable=True)

    # Scoring IA (proba de besoin 0..100) + feedback de l'operateur. Le detail
    # du scoring (formule/modules/integrations recommandes) vit dans
    # enrichment['scoring'] ; fit_score est denormalise ici pour tri/index.
    fit_score = Column(Integer, nullable=True, index=True)
    decision = Column(String, nullable=True, index=True)  # 'accepted' | 'rejected' | None
    decision_reason = Column(Text, nullable=True)
    decision_at = Column(DateTime, nullable=True)
    # Critere/requete de decouverte qui a fait surgir ce prospect.
    discovery_query = Column(String, nullable=True)

    # Brouillon d'email de prospection (IA), editable par le superadmin.
    email_subject = Column(Text, nullable=True)
    email_body = Column(Text, nullable=True)

    status = Column(String, default="found", nullable=False, index=True)

    # Opt-out RGPD / prospection à froid (art. 21 RGPD, droit d'opposition).
    # opt_out=True => le prospect ne doit JAMAIS recevoir de cold email (garde-fou
    # à l'envoi) et ses PII sont purgeables immédiatement. Posé soit par le lien de
    # désinscription (token signé, endpoint public), soit par une action admin.
    opt_out = Column(Boolean, default=False, server_default="false",
                     nullable=False, index=True)
    opt_out_at = Column(DateTime, nullable=True)

    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    sent_at = Column(DateTime, nullable=True)


class ProspectingProfile(Base):
    """Profil cible persistant du superadmin (1 ligne par operateur).

    Memorise le critere de recherche prefere (mode web ou annuaire SIRENE)
    pour prefiller les champs de decouverte, et des notes libres injectees
    dans le contexte de scoring IA (en plus du few-shot des decisions).
    """
    __tablename__ = "prospecting_profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    web_query = Column(String, nullable=True)
    sector = Column(String, nullable=True)
    departement = Column(String, nullable=True)
    code_postal = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


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
    enrichment: dict | None = None
    fit_score: int | None = None
    decision: str | None = None
    decision_reason: str | None = None
    decision_at: datetime | None = None
    discovery_query: str | None = None
    email_subject: str | None = None
    email_body: str | None = None
    status: str
    opt_out: bool = False
    opt_out_at: datetime | None = None
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


class ProfileOut(BaseModel):
    """Profil cible renvoye au front (None partout si pas encore enregistre)."""
    web_query: str | None = None
    sector: str | None = None
    departement: str | None = None
    code_postal: str | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)
