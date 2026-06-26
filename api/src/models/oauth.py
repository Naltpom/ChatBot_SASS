"""OAuth « plugin » (device flow RFC 8628) — connexion des intégrations externes
(plugin WordPress) au compte Chapote, SANS exposer le JWT dashboard.

Surface EXTERNE (cf. routers/external/) : authentifiée par un access token JWT de
scope 'plugin' (jamais 'dashboard'). Deux tables :

- OAuthDeviceAuthorization : appairage par device flow. Le plugin obtient un
  device_code + un user_code court ; l'utilisateur (connecté au dashboard) saisit
  le user_code sur /link et approuve ; le plugin échange ensuite le device_code
  contre une paire de tokens. Aucune URL de redirection => zéro open-redirect,
  fonctionne sur des domaines WordPress arbitraires.
- OAuthToken : refresh token OPAQUE persistant (rotation + détection de rejeu).
  L'access token est un JWT stateless scope='plugin' (aucune ligne ici).

Sécurité : les secrets (device_code, refresh_token) sont stockés HACHÉS (SHA-256)
— la valeur en clair n'est connue que du client. Conventions repo : utcnow()
(src/core/time), DateTime SANS timezone, server_default=text(...) pour les NOT NULL.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    text,
)

from src.core.database import Base
from src.core.time import utcnow


class OAuthDeviceAuthorization(Base):
    """Appairage device flow (RFC 8628).

    Statuts : pending -> approved -> consumed (token émis) ; ou denied / expired.
    Codes à usage unique et courts (TTL ~10 min). Le device_code est haché ;
    le user_code (court, affiché/saisi) est stocké en clair sous forme canonique
    « XXXX-XXXX »."""
    __tablename__ = "oauth_device_authorizations"

    id = Column(Integer, primary_key=True)
    client_id = Column(String, nullable=False)                                  # ex. 'chapote_wp'
    device_code_hash = Column(String, unique=True, nullable=False, index=True)  # sha256 du device_code
    user_code = Column(String, unique=True, nullable=False, index=True)         # court, saisi par l'utilisateur
    scope = Column(String, nullable=False, default="plugin", server_default=text("'plugin'"))
    # pending | approved | consumed | denied | expired
    status = Column(String, nullable=False, default="pending", server_default=text("'pending'"))
    # Lié à l'approbation (NULL tant que pending) :
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    # Contexte facultatif fourni par le plugin (affiché dans l'écran de consentement) :
    site_url = Column(String, nullable=True)
    interval_seconds = Column(Integer, nullable=False, default=5, server_default=text("'5'"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    approved_at = Column(DateTime, nullable=True)
    last_polled_at = Column(DateTime, nullable=True)


class OAuthToken(Base):
    """Refresh token opaque (haché) émis pour un user, scope 'plugin'.

    Rotation : à chaque /refresh on émet une nouvelle ligne et on marque
    l'ancienne is_revoked + replaced_by_id ; un 2e usage d'un refresh déjà
    remplacé = rejeu -> révocation de la lignée + 401. L'access token (JWT) n'a
    PAS de ligne ici (stateless)."""
    __tablename__ = "oauth_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id = Column(String, nullable=False)
    refresh_token_hash = Column(String, unique=True, nullable=False, index=True)  # sha256
    scope = Column(String, nullable=False, default="plugin", server_default=text("'plugin'"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_id = Column(Integer, ForeignKey("oauth_tokens.id", ondelete="SET NULL"), nullable=True)
    last_used_at = Column(DateTime, nullable=True)
