"""OAuth « plugin » (Authorization Code + PKCE, RFC 7636) — connexion des
intégrations externes (plugin WordPress) au compte Chapote, SANS exposer le JWT
dashboard.

Surface EXTERNE (cf. routers/external/) : authentifiée par un access token JWT de
scope 'plugin' (jamais 'dashboard'). Deux tables :

- OAuthAuthorizationCode : code d'autorisation à usage unique, émis par le
  dashboard (page /authorize, utilisateur CONNECTÉ) après consentement. Lié à un
  redirect_uri (la page admin du plugin) + un code_challenge PKCE (S256). Le
  plugin échange ensuite le code (server-to-server) contre une paire de tokens en
  prouvant la possession du code_verifier. Sécurité : PKCE + redirect_uri lié +
  state CSRF (côté client) + code one-time + TTL court.
- OAuthToken : refresh token OPAQUE persistant (rotation + détection de rejeu).
  L'access token est un JWT stateless scope='plugin' (aucune ligne ici).

Sécurité : les secrets (code d'autorisation, refresh_token) sont stockés HACHÉS
(SHA-256) — la valeur en clair n'est connue que du client. Conventions repo :
utcnow() (src/core/time), DateTime SANS timezone, server_default=text(...) pour
les NOT NULL.
"""
from sqlalchemy import (
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


class OAuthAuthorizationCode(Base):
    """Code d'autorisation OAuth (Authorization Code + PKCE S256).

    Émis par le dashboard après consentement de l'utilisateur connecté, à usage
    UNIQUE (used_at) et TTL court (~5 min). Le `code` est haché ; la valeur en
    clair n'est connue que du client. Lié à un redirect_uri (page admin du plugin)
    et à un code_challenge : l'échange exige redirect_uri identique + preuve PKCE
    (base64url-sans-padding(sha256(code_verifier)) == code_challenge)."""
    __tablename__ = "oauth_authorization_codes"

    id = Column(Integer, primary_key=True)
    code_hash = Column(String, unique=True, nullable=False, index=True)  # sha256 du code clair
    client_id = Column(String, nullable=False)                          # ex. 'chapote_wp'
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    redirect_uri = Column(String, nullable=False)                       # page admin du plugin (lié au code)
    code_challenge = Column(String, nullable=False)                     # PKCE : base64url-no-pad(sha256(verifier))
    code_challenge_method = Column(String, nullable=False, default="S256", server_default=text("'S256'"))
    scope = Column(String, nullable=False, default="plugin", server_default=text("'plugin'"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)  # NULL tant que non échangé (usage unique)


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
    # `jti` de l'access JWT (scope='plugin') émis avec CE refresh (même pair).
    # Révocation stateful (audit §3.4) : require_oauth_token charge la ligne par ce
    # jti et rejette l'access si is_revoked -> déconnexion/rotation coupent l'access
    # immédiatement (sans attendre l'expiration du JWT). Nullable (lignes héritées).
    access_jti = Column(String, nullable=True, index=True)
    scope = Column(String, nullable=False, default="plugin", server_default=text("'plugin'"))
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_id = Column(Integer, ForeignKey("oauth_tokens.id", ondelete="SET NULL"), nullable=True)
    last_used_at = Column(DateTime, nullable=True)


class OAuthRedirectDomain(Base):
    """Allowlist des domaines WordPress (hôte du redirect_uri) ENREGISTRÉS par un
    utilisateur pour le client public 'chapote_wp'.

    Anti-phishing de consentement (§3.2 audit) : la validation par FORME seule
    laissait un attaquant fabriquer une URL d'autorisation vers un WP qu'il
    contrôle. Désormais l'/authorize n'accepte un redirect_uri que si son hôte est
    enregistré ici pour CET utilisateur. Bootstrap : le 1er domaine d'un user
    s'auto-enregistre au consentement ; tout domaine NOUVEAU ensuite exige une
    confirmation explicite (re-consentement). Hôte stocké en clair, minuscule,
    exact (anti sous-domaine forgé : evil.site.com != site.com)."""
    __tablename__ = "oauth_redirect_domains"
    __table_args__ = (UniqueConstraint("user_id", "domain", name="uq_oauth_redirect_user_domain"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    domain = Column(String, nullable=False)  # hôte exact du redirect_uri, minuscule
    created_at = Column(DateTime, default=utcnow, nullable=False)
