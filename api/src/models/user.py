"""Multi-tenant : User (personne) <-> Organization (client SaaS) via Membership.

Une personne peut appartenir a PLUSIEURS organisations. Une organisation est
toujours une equipe (la notion de type « perso » a disparu : un bot perso
appartient directement a un user via Bot.owner_user_id, sans org).
Roles : admin (tout gerer) / member (permissions fines PAR BOT : copy, test,
appearance, context, security, inbox). Les superadmins (staff) voient tout.

Invitation : membre invite par email sans compte existant -> rejoint
automatiquement l'organisation a la creation de son compte.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)

from src.core.database import Base
from src.core.time import utcnow

# Permissions par bot accordables aux membres (les admins ont tout).
# 'inbox' (live chat conseiller) volontairement EN FIN de liste : la matrice
# de la page Équipe suit cet ordre (contrainte e2e sur la 1re colonne).
BOT_PERMS = ["copy", "test", "appearance", "context", "security", "inbox"]


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    avatar_url = Column(String, nullable=True)  # photo de profil (SSO Google, hébergée localement)
    auth_source = Column(String, default="local", nullable=False)  # local | intranet | google
    is_superadmin = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    # --- Facturation (le User est le Customer Stripe — spec §1.3) ---
    stripe_customer_id = Column(String, unique=True, nullable=True, index=True)  # cus_...
    billing_grouping = Column(String, nullable=False, default="total",
                              server_default=text("'total'"))  # per_bot | total | per_org
    billing_email = Column(String, nullable=True)              # défaut applicatif = user.email


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    # Owner d'org = payeur des bots d'équipe (spec §1.1). L'owner est TOUJOURS
    # membre admin (invariant applicatif posé par le mini-volet owner §1.2).
    # nullable=False après backfill (migration M2). Le Customer Stripe a migré
    # vers le User : stripe_customer_id / stripe_subscription_id RETIRES.
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    role = Column(String, default="member", nullable=False)  # admin | member
    # Permissions par bot pour les members : {"<bot_id>": ["copy", "test", ...]}
    permissions = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class Invitation(Base):
    """Invitation en attente : email sans compte. Consommee a l'inscription."""
    __tablename__ = "invitations"
    __table_args__ = (UniqueConstraint("email", "organization_id"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    role = Column(String, default="member", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


# --- Schemas Pydantic ---

class InvitePayload(BaseModel):
    email: EmailStr
    role: str = Field("member", pattern="^(admin|member)$")


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    account_type: str = Field("perso", pattern="^(perso|entreprise)$")
    organization_name: str | None = None                       # requis si entreprise
    invites: list[InvitePayload] = Field(default_factory=list)  # entreprise uniquement


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class OrgOut(BaseModel):
    id: int
    name: str
    role: str = "member"                                  # role du user courant
    permissions: dict[str, Any] = Field(default_factory=dict)  # ses permissions par bot (member)
    is_owner: bool = False                                # org.owner_user_id == current_user.id

    model_config = ConfigDict(from_attributes=True)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    avatar_url: str | None = None       # photo de profil (SSO Google) ou null
    auth_source: str = "local"          # local | intranet | google
    is_superadmin: bool
    created_at: datetime | None = None
    last_login: datetime | None = None
    organizations: list[OrgOut] = Field(default_factory=list)
    # --- Facturation (lecture seule ; pilote l'affichage front) ---
    billing_grouping: str = "total"     # per_bot | total | per_org
    # Sérialisé sous la clé JSON `is_billing_enabled` (contrat front, spec §5.1 /
    # app/src/types/auth.ts). Reste accessible en `.billing_enabled` côté serveur.
    billing_enabled: bool = Field(False, serialization_alias="is_billing_enabled")
    owned_org_ids: list[int] = Field(default_factory=list)  # orgs où owner_user_id == user.id

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class BillingGroupingUpdate(BaseModel):
    """Payload de mutation du format de facture (spec §4.2)."""
    grouping: str = Field(pattern="^(per_bot|total|per_org)$")


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
