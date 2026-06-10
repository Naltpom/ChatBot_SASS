"""Bot = un widget configurable embarque sur le(s) site(s) d'un client.

La config complete (tree, design, IA) est exportable/importable en JSON :
c'est l'angle "config par fichiers versionnables" du produit.

Securite : `public_key` (pk_...) est un identifiant PUBLIC, pas un secret.
Les vraies cles IA restent cote serveur (env managed ou BYOK chiffree).
"""
import secrets
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)

from src.core.database import Base

DEFAULT_TREE = {
    "start": "root",
    "nodes": {
        "root": {
            "message": "Bonjour ! Comment puis-je vous aider ?",
            "options": [
                {"label": "Découvrir vos services", "next": "services"},
                {"label": "Poser une question", "next": "__ai__"},
            ],
        },
        "services": {
            "message": "Nous proposons... (éditez cet arbre dans le dashboard)",
            "options": [
                {"label": "↩ Retour", "next": "root"},
                {"label": "Une autre question ?", "next": "__ai__"},
            ],
        },
    },
}

# Tokens du design Kertios Chat (prototype claude.ai/design) : icone SVG de
# bulle (chat/spark/help) ou image uploadee, degrade 2 couleurs, liseré blanc,
# animations dots/wave/pulse.
DEFAULT_DESIGN = {
    "title": "Assistant",
    "primaryColor": "#0d9488",     # couleur de marque du CLIENT FINAL
    "secondaryColor": None,        # 2e couleur -> degrade si definie
    "position": "right",           # right | left
    "size": "md",                  # sm | md | lg (bulle 48/58/68 px)
    "borderRadius": 16,            # arrondi du panneau (4-24 px)
    "icon": "chat",                # chat | spark | help | image
    "avatarImage": "",             # URL image uploadee (icon="image")
    "bordered": False,             # liseré blanc autour de la bulle
    "welcomeMessage": "",
    "placeholder": "Écrivez votre message…",
    "loadingAnimation": "dots",    # dots | wave | pulse
    "poweredBy": True,
}


def generate_public_key() -> str:
    return "pk_" + secrets.token_urlsafe(24)


class Bot(Base):
    __tablename__ = "bots"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    public_key = Column(String, unique=True, index=True, nullable=False, default=generate_public_key)
    is_active = Column(Boolean, default=True, nullable=False)

    # tree : clics sur options uniquement / ai : texte libre direct /
    # hybrid : arbre d'abord, l'option "__ai__" ou le texte libre bascule sur l'IA
    mode = Column(String, default="hybrid", nullable=False)

    # --- IA ---
    ai_provider = Column(String, default="anthropic", nullable=False)  # anthropic | openai | gemini
    ai_model = Column(String, default="claude-haiku-4-5-20251001", nullable=False)
    system_prompt = Column(Text, default="Tu es un assistant utile et concis pour ce site web.", nullable=False)
    temperature = Column(Integer, default=70, nullable=False)  # x100 (70 = 0.7)
    # managed : cles du SaaS (env), conso decomptee du quota du plan
    # byok    : cle du client, chiffree -> quota IA non decompte (plan moins cher)
    api_key_mode = Column(String, default="managed", nullable=False)
    byok_key_encrypted = Column(Text, nullable=True)

    # --- Config fichiers (exportable JSON) ---
    tree_json = Column(JSON, default=DEFAULT_TREE, nullable=False)
    design_json = Column(JSON, default=DEFAULT_DESIGN, nullable=False)

    # --- Securite widget ---
    # Domaines autorises a charger le widget (verif Origin cote serveur).
    # Vide = widget inutilisable : on force la declaration du domaine.
    allowed_domains = Column(JSON, default=list, nullable=False)
    captcha_provider = Column(String, default="turnstile", nullable=False)  # turnstile | recaptcha_v3 | disabled
    captcha_site_key = Column(String, nullable=True)        # si reCAPTCHA client
    captcha_secret_encrypted = Column(Text, nullable=True)  # si reCAPTCHA client

    # Hard cap : au-dela de N reponses IA / jour, le widget passe en mode
    # degrade (tree only). Protection cash-flow, par bot.
    daily_ai_message_cap = Column(Integer, default=500, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


# --- Schemas Pydantic ---

class BotCreate(BaseModel):
    name: str
    mode: Optional[str] = Field("hybrid", pattern="^(tree|ai|hybrid)$")


class BotUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    mode: Optional[str] = Field(None, pattern="^(tree|ai|hybrid)$")
    ai_provider: Optional[str] = Field(None, pattern="^(anthropic|openai|gemini)$")
    ai_model: Optional[str] = None
    system_prompt: Optional[str] = None
    temperature: Optional[int] = Field(None, ge=0, le=100)
    api_key_mode: Optional[str] = Field(None, pattern="^(managed|byok)$")
    byok_key: Optional[str] = None  # en clair a l'entree, chiffree au stockage
    tree_json: Optional[dict[str, Any]] = None
    design_json: Optional[dict[str, Any]] = None
    allowed_domains: Optional[list[str]] = None
    captcha_provider: Optional[str] = Field(None, pattern="^(turnstile|recaptcha_v3|disabled)$")
    captcha_site_key: Optional[str] = None
    captcha_secret: Optional[str] = None  # en clair a l'entree, chiffree au stockage
    daily_ai_message_cap: Optional[int] = Field(None, ge=0)


class BotOut(BaseModel):
    id: int
    organization_id: int
    name: str
    public_key: str
    is_active: bool
    mode: str
    ai_provider: str
    ai_model: str
    system_prompt: str
    temperature: int
    api_key_mode: str
    byok_key_set: bool = False
    tree_json: dict[str, Any]
    design_json: dict[str, Any]
    allowed_domains: list[str]
    captcha_provider: str
    captcha_site_key: Optional[str] = None
    captcha_secret_set: bool = False
    daily_ai_message_cap: int
    created_at: datetime
    updated_at: datetime
    # Renseignes par les endpoints de liste (cards) uniquement
    msgs_7d: int = 0
    visitors_7d: int = 0

    class Config:
        from_attributes = True

    @classmethod
    def from_bot(cls, bot: "Bot") -> "BotOut":
        out = cls.model_validate(bot)
        out.byok_key_set = bool(bot.byok_key_encrypted)
        out.captcha_secret_set = bool(bot.captcha_secret_encrypted)
        return out
