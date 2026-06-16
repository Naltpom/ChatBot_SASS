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
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
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

# Tokens du design Chapote (prototype claude.ai/design) : icone SVG de
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
    # --- Personnalisation étendue (lot apparence). Rétro-compat : un design
    # existant SANS ces clés rend pixel-identique (défauts = rendu actuel).
    # Toute nouvelle clé doit aussi être bornée dans routers/widget.py
    # (_sanitize_design) : c'est LÀ que vit la sanitisation (au bootstrap).
    "font": "system",              # system | serif | mono (aucune police externe chargée)
    "headerStyle": "solid",        # solid (en-tête brand) | soft (en-tête clair, badge contour)
    "darkMode": False,             # palette sombre du panneau (couleur de marque conservée)
    "bubbleStyle": "rounded",      # rounded (radii asymétriques) | square (radius uniformes)
    "density": "cozy",             # cozy | compact (panneau 420px, textes resserrés)
    "launcherText": "",            # <= 40 chars : bulle flottante -> pilule [icône + texte]
    "offsetX": 18,                 # marge latérale bulle/panneau (0-120 px)
    "offsetY": 18,                 # marge basse (0-120 px)
    "locale": "fr",                # auto | fr | en — langue de l'UI du widget
}


def generate_public_key() -> str:
    return "pk_" + secrets.token_urlsafe(24)


class Bot(Base):
    __tablename__ = "bots"
    # Ownership polymorphe : un bot appartient SOIT a un user (perso) SOIT a une
    # organisation (equipe). XOR garanti par la contrainte SQL.
    __table_args__ = (
        CheckConstraint(
            "(owner_user_id IS NULL) <> (organization_id IS NULL)",
            name="ck_bots_owner_xor_org",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    # owner_user_id (perso) XOR organization_id (equipe) — l'un des deux exactement
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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

    # --- A/B test d'arbre ---
    # Variante B optionnelle de l'arbre (none_as_null : NULL SQL = A/B
    # desactive), servie aux conversations affectees 'b' a la creation de
    # session (sticky). ab_split_pct = % de nouvelles sessions envoyees sur la
    # variante (0 = off). Memes contraintes de plan que l'arbre principal.
    # EXCLU de config.json (comme triggers_json — decision actee).
    tree_variant_json = Column(JSON(none_as_null=True), nullable=True)
    ab_split_pct = Column(Integer, default=0, nullable=False, server_default=text("'0'"))

    # --- Triggers proactifs (widget) ---
    # Max 5 : {type time_on_page|scroll_depth|exit_intent|url_pattern, value,
    # message <=300, once_per_session}. Valides au PATCH (routers/bots.py),
    # re-sanitises au bootstrap widget, evalues 100% cote client (aucun appel
    # serveur au declenchement). server_default : backfill migration.
    triggers_json = Column(JSON, default=list, nullable=False, server_default=text("'[]'"))

    # --- Actions IA (tool-use) : webhooks signes et capture de lead ---
    # [{"name","description","type":"webhook"|"capture_lead","url","secret_encrypted","fields":[...]}]
    # server_default OBLIGATOIRE : la migration ajoute la colonne NOT NULL sur
    # des lignes existantes. Secrets chiffres (Fernet), jamais en sortie API.
    actions_json = Column(JSON, default=list, nullable=False, server_default=text("'[]'"))

    # --- Live chat (handoff conseiller) ---
    # Webhook de notification optionnel quand un visiteur demande un conseiller
    # (payload JSON compatible Slack, envoi SSRF strict via safe_fetch).
    # ATTENTION : un webhook entrant Slack/Teams EST un credential (le token
    # vit dans le chemin de l'URL) -> en sortie API, l'URL n'est renvoyee
    # qu'aux ayants droit de la perm 'context' (masquage dans routers/bots.py),
    # les autres ne voient que le flag handoff_webhook_set.
    handoff_webhook_url = Column(String, nullable=True)

    # --- Connecteur MCP generique ---
    # Max 2 serveurs : [{"name", "url", "auth_token_encrypted"}]. Le jeton est
    # chiffre Fernet, write-only (flag auth_token_set en sortie). EXCLU de
    # config.json (comme actions_json). server_default : backfill migration.
    mcp_servers_json = Column(JSON, default=list, nullable=False, server_default=text("'[]'"))

    # --- Securite widget ---
    # Domaines autorises a charger le widget (verif Origin cote serveur).
    # Vide = widget inutilisable : on force la declaration du domaine.
    allowed_domains = Column(JSON, default=list, nullable=False)
    captcha_provider = Column(String, default="turnstile", nullable=False)  # turnstile | recaptcha_v3 | disabled
    captcha_site_key = Column(String, nullable=True)        # si reCAPTCHA client
    captcha_secret_encrypted = Column(Text, nullable=True)  # si reCAPTCHA client

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
    # A/B : null EXPLICITE = desactiver la variante (distingue d'« absent »
    # par exclude_unset dans routers/bots.py)
    tree_variant_json: Optional[dict[str, Any]] = None
    ab_split_pct: Optional[int] = Field(None, ge=0, le=100)
    # Validation metier (types, bornes par type) dans routers/bots.py
    triggers_json: Optional[list[dict[str, Any]]] = None
    # Validation metier (formats, types, secrets) dans routers/bots.py
    actions_json: Optional[list[dict[str, Any]]] = None
    # https:// + <=500 chars (valide dans routers/bots.py), "" = effacer
    handoff_webhook_url: Optional[str] = None
    # Validation metier (noms, urls https, jetons) dans routers/bots.py
    mcp_servers_json: Optional[list[dict[str, Any]]] = None
    allowed_domains: Optional[list[str]] = None
    captcha_provider: Optional[str] = Field(None, pattern="^(turnstile|recaptcha_v3|disabled)$")
    captcha_site_key: Optional[str] = None
    captcha_secret: Optional[str] = None  # en clair a l'entree, chiffree au stockage


class BotOut(BaseModel):
    id: int
    # Ownership polymorphe : exactement l'un des deux est renseigne
    organization_id: Optional[int] = None
    owner_user_id: Optional[int] = None
    scope: str = "team"            # "personal" (owner_user_id) | "team" (organization_id)
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
    tree_variant_json: Optional[dict[str, Any]] = None
    ab_split_pct: int = 0
    triggers_json: list[dict[str, Any]] = []
    actions_json: list[dict[str, Any]] = []
    # URL masquee (None) pour les members sans la perm 'context' — le flag
    # handoff_webhook_set permet au dashboard de distinguer « configure » de
    # « vide » (masquage applique dans routers/bots.py)
    handoff_webhook_url: Optional[str] = None
    handoff_webhook_set: bool = False
    # Serveurs MCP : jeton jamais en sortie, flag auth_token_set uniquement
    mcp_servers_json: list[dict[str, Any]] = []
    allowed_domains: list[str]
    captcha_provider: str
    captcha_site_key: Optional[str] = None
    captcha_secret_set: bool = False
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
        out.scope = "personal" if bot.owner_user_id else "team"
        out.byok_key_set = bool(bot.byok_key_encrypted)
        out.captcha_secret_set = bool(bot.captcha_secret_encrypted)
        out.handoff_webhook_set = bool(bot.handoff_webhook_url)
        # Actions : les secrets (chiffres ou non) ne sortent JAMAIS, seuls des
        # flags secret_set / api_key_set indiquent au dashboard qu'un secret
        # est configure (api_key_set pose pour tous les types : inoffensif).
        out.actions_json = [
            {**{k: v for k, v in a.items()
                if k not in ("secret_encrypted", "secret", "api_key_encrypted", "api_key")},
             "secret_set": bool(a.get("secret_encrypted")),
             "api_key_set": bool(a.get("api_key_encrypted"))}
            for a in (bot.actions_json or [])
        ]
        # Serveurs MCP : le jeton (chiffre ou non) ne sort JAMAIS
        out.mcp_servers_json = [
            {"name": s.get("name"), "url": s.get("url"),
             "auth_token_set": bool(s.get("auth_token_encrypted"))}
            for s in (bot.mcp_servers_json or [])
        ]
        return out
