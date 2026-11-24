"""Boîtes mail pour Claude (emails.chapote.fr) : serveur MCP distant + administration.

Réservé au superadmin. Cinq tables :

- Mailbox : une boîte IMAP/SMTP (Email Pro OVH, Gmail avec mot de passe d'application…),
  identifiée par un `slug` (paramètre `account` des outils MCP). Mot de passe CHIFFRÉ avec
  MAILBOX_ENCRYPTION_KEY (clé dédiée). Droits : `allow_send` (envoi SMTP, sinon brouillons
  seulement), `allow_delete` (corbeille ; faux par défaut). `save_sent` : copie de l'envoi
  dans « Envoyés » par APPEND (Gmail le fait déjà côté serveur : faux pour lui).
- McpOAuthClient : client OAuth inscrit dynamiquement (RFC 7591), en pratique Claude.
- McpOAuthCode : code d'autorisation (PKCE S256, usage unique, 5 min), haché.
- McpOAuthToken : une paire jeton d'accès (1 h) + jeton de rafraîchissement (rotation),
  tous deux HACHÉS (SHA-256). `family_id` relie les rotations successives : un
  rafraîchissement rejoué révoque toute la famille.
- McpAuditLog : un appel d'outil MCP (date, client, outil, boîte, statut, durée) —
  jamais de contenu (ni requête, ni objet, ni corps, ni destinataire).

Conventions repo : utcnow() (src/core/time), DateTime SANS timezone.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    text,
)

from src.core.database import Base
from src.core.time import utcnow

TLS_MODES = ("ssl", "starttls", "none")


class Mailbox(Base):
    __tablename__ = "mailboxes"

    id = Column(Integer, primary_key=True)
    slug = Column(String(40), nullable=False, unique=True)          # « contact », « perso-gmail »…
    address = Column(String(255), nullable=False)                   # adresse d'expédition (From)
    label = Column(String(120), nullable=True)                      # nom affiché (From) et dans l'interface
    preset = Column(String(30), nullable=True)                      # « ovh-email-pro », « gmail », NULL = manuel
    imap_host = Column(String(255), nullable=False)
    imap_port = Column(Integer, nullable=False, default=993)
    imap_tls = Column(String(10), nullable=False, default="ssl")    # ssl | starttls | none
    smtp_host = Column(String(255), nullable=False)
    smtp_port = Column(Integer, nullable=False, default=465)
    smtp_tls = Column(String(10), nullable=False, default="ssl")
    username = Column(String(255), nullable=False)                  # identifiant IMAP/SMTP
    password_encrypted = Column(Text, nullable=False)               # Fernet (MAILBOX_ENCRYPTION_KEY)
    allow_send = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    allow_delete = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    save_sent = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    # Dernier test de connexion (interface) : date et résultat lisible, sans secret.
    last_check_at = Column(DateTime, nullable=True)
    last_check_ok = Column(Boolean, nullable=True)
    last_check_error = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class McpOAuthClient(Base):
    __tablename__ = "mcp_oauth_clients"

    id = Column(Integer, primary_key=True)
    client_id = Column(String(64), nullable=False, unique=True)     # public, aléatoire
    client_secret_hash = Column(String(64), nullable=True)          # NULL = client public (PKCE seul)
    client_name = Column(String(200), nullable=True)
    redirect_uris = Column(JSON, nullable=False, default=list)
    token_endpoint_auth_method = Column(String(30), nullable=False, default="none")
    created_ip = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)


class McpOAuthCode(Base):
    __tablename__ = "mcp_oauth_codes"

    id = Column(Integer, primary_key=True)
    code_hash = Column(String(64), nullable=False, unique=True)
    client_pk = Column(Integer, ForeignKey("mcp_oauth_clients.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    redirect_uri = Column(Text, nullable=False)
    code_challenge = Column(String(128), nullable=False)
    scope = Column(String(100), nullable=False, default="emails")
    resource = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class McpOAuthToken(Base):
    __tablename__ = "mcp_oauth_tokens"
    __table_args__ = (Index("ix_mcp_oauth_tokens_family", "family_id"),)

    id = Column(Integer, primary_key=True)
    client_pk = Column(Integer, ForeignKey("mcp_oauth_clients.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    family_id = Column(String(32), nullable=False)
    code_id = Column(Integer, ForeignKey("mcp_oauth_codes.id", ondelete="SET NULL"), nullable=True)
    access_hash = Column(String(64), nullable=False, unique=True)
    access_expires_at = Column(DateTime, nullable=False)
    refresh_hash = Column(String(64), nullable=True, unique=True)
    refresh_expires_at = Column(DateTime, nullable=True)
    scope = Column(String(100), nullable=False, default="emails")
    resource = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    # Rotation : jeton de rafraîchissement déjà échangé (son successeur porte la famille).
    rotated_at = Column(DateTime, nullable=True)


class McpAuditLog(Base):
    __tablename__ = "mcp_audit_log"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    client_pk = Column(Integer, ForeignKey("mcp_oauth_clients.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    tool = Column(String(40), nullable=False)
    mailbox_slug = Column(String(40), nullable=True)
    status = Column(String(10), nullable=False)          # ok | error | denied
    error_code = Column(String(40), nullable=True)       # catégorie (auth_imap, timeout…), jamais un message
    duration_ms = Column(Integer, nullable=True)
    items = Column(Integer, nullable=True)               # nombre de résultats / messages touchés
