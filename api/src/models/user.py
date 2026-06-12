"""Multi-tenant : User (personne) <-> Organization (client SaaS) via Membership.

Une personne peut appartenir a PLUSIEURS organisations. Une organisation est de
type "perso" (une seule personne, meme architecture) ou "entreprise" (equipe).
Roles : admin (tout gerer) / member (permissions fines PAR BOT : copy, test,
appearance, context, security). Les superadmins (staff Kertios) voient tout.

Invitation : membre invite par email sans compte existant -> rejoint
automatiquement l'organisation a la creation de son compte.
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from src.core.database import Base

# Limites par plan (par organisation) : reponses IA mensuelles, nombre de bots,
# prix mensuel. Aligne sur la landing : Starter 19 / Pro 39 / Agence 119.
# "free" = decouverte : mode ARBRE uniquement (tree_only), nombre de bulles
# (noeuds) plafonne. Les reponses tree restent illimitees sur tous les plans.
# max_tree_nodes=None -> illimite. byok = droit d'utiliser sa propre cle API.
PLANS = {
    "free":    {"ai_messages": 0,     "max_bots": 1,  "price": 0,   "tree_only": True,  "max_tree_nodes": 10,   "byok": False},
    "starter": {"ai_messages": 500,   "max_bots": 1,  "price": 19,  "tree_only": False, "max_tree_nodes": None, "byok": False},
    "pro":     {"ai_messages": 2000,  "max_bots": 3,  "price": 39,  "tree_only": False, "max_tree_nodes": None, "byok": False},
    "agence":  {"ai_messages": 10000, "max_bots": 10, "price": 119, "tree_only": False, "max_tree_nodes": None, "byok": True},
}

# Libelles et descriptions marketing des plans (servis par GET /api/public/plans,
# source unique cote front — remplace le miroir manuel PLANS_INFO).
PLANS_META = {
    "free":    {"label": "Free",    "description": "Découverte : un chatbot à arbre de décision, sans IA."},
    "starter": {"label": "Starter", "description": "Un bot complet avec IA pour votre site."},
    "pro":     {"label": "Pro",     "description": "Jusqu'à 3 bots et 2 000 réponses IA par mois."},
    "agence":  {"label": "Agence",  "description": "Multi-sites : 10 bots, gros volumes et clés API personnelles (BYOK)."},
}

# Permissions par bot accordables aux membres (les admins ont tout)
BOT_PERMS = ["copy", "test", "appearance", "context", "security"]


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    auth_source = Column(String, default="local", nullable=False)  # local | intranet
    is_superadmin = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, default="entreprise", nullable=False)  # perso | entreprise
    plan = Column(String, default="free", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    # --- Stripe (facturation) ---
    stripe_customer_id = Column(String, nullable=True, index=True)   # cus_... (lookup webhook)
    stripe_subscription_id = Column(String, nullable=True)           # sub_... (abonnement actif)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    role = Column(String, default="member", nullable=False)  # admin | member
    # Permissions par bot pour les members : {"<bot_id>": ["copy", "test", ...]}
    permissions = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Invitation(Base):
    """Invitation en attente : email sans compte. Consommee a l'inscription."""
    __tablename__ = "invitations"
    __table_args__ = (UniqueConstraint("email", "organization_id"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    role = Column(String, default="member", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# --- Schemas Pydantic ---

class InvitePayload(BaseModel):
    email: EmailStr
    role: str = Field("member", pattern="^(admin|member)$")


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    account_type: str = Field("perso", pattern="^(perso|entreprise)$")
    organization_name: Optional[str] = None  # requis si entreprise
    invites: list[InvitePayload] = []        # entreprise uniquement


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class OrgOut(BaseModel):
    id: int
    name: str
    type: str = "entreprise"
    plan: str
    role: str = "member"                       # role du user courant
    permissions: dict[str, Any] = {}           # ses permissions par bot (member)

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    auth_source: str = "local"          # local | intranet
    is_superadmin: bool
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None
    organizations: list[OrgOut] = []

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
