"""OAuth 2.1 du serveur MCP d'emails.chapote.fr (spécification d'autorisation MCP).

Rôles : emails.chapote.fr est à la fois la ressource protégée ({EMAILS_URL}/mcp, RFC 9728)
et le serveur d'autorisation (RFC 8414). Flux suivi par Claude :

1. /mcp sans jeton -> 401 + WWW-Authenticate (resource_metadata).
2. Découverte : /.well-known/oauth-protected-resource puis /.well-known/oauth-authorization-server.
3. Inscription dynamique (RFC 7591) : /oauth/register. redirect_uri limités aux hôtes de
   EMAILS_OAUTH_REDIRECT_HOSTS (Claude par défaut) : un tiers ne peut pas inscrire un
   client qui recevrait un code chez lui.
4. /oauth/authorize : PKCE S256 obligatoire ; session superadmin avec 2FA validée, puis
   écran de consentement (interface) ; code à usage unique, 5 min, haché.
5. /oauth/token : code + code_verifier -> jeton d'accès (1 h) + jeton de rafraîchissement
   (30 j, rotation à chaque usage). Un rafraîchissement rejoué ou un code réutilisé révoque
   toute la famille de jetons.
6. /oauth/revoke (RFC 7009), et révocation depuis l'interface.

Jetons opaques aléatoires (256 bits), stockés HACHÉS (SHA-256) : la base ne permet pas de
les rejouer. Les accès vérifient à chaque appel que l'utilisateur est toujours un superadmin
actif (et a toujours une 2FA si elle est exigée).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.emails import McpAuditLog, McpOAuthClient, McpOAuthCode, McpOAuthToken
from src.models.user import User
from src.services.emails_access import access_problem

SCOPE = "emails"
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=30)
CODE_TTL = timedelta(minutes=5)
MAX_CLIENTS = 50                 # clients actifs : borne l'inscription dynamique (ouverte)
MAX_REDIRECT_URIS = 5
ACCESS_PREFIX = "cem_at_"
REFRESH_PREFIX = "cem_rt_"


class OAuthError(Exception):
    """Erreur OAuth (RFC 6749 §5.2) : `error` renvoyé tel quel, `description` lisible."""

    def __init__(self, error: str, description: str = "", status_code: int = 400):
        super().__init__(error)
        self.error = error
        self.description = description
        self.status_code = status_code


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def pkce_s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def issuer() -> str:
    return settings.EMAILS_URL.rstrip("/")


def resource_ok(resource: Optional[str]) -> bool:
    """RFC 8707 : le jeton n'est émis que pour CE serveur MCP (avec ou sans /mcp)."""
    if not resource:
        return True
    r = resource.rstrip("/")
    return r in (settings.emails_resource, issuer())


def redirect_uri_ok(uri: str) -> bool:
    try:
        p = urlparse(uri)
    except ValueError:
        return False
    host = (p.hostname or "").lower()
    if not host or p.fragment or p.username or p.password:
        return False
    if p.scheme == "http" and not settings.is_production and host in ("localhost", "127.0.0.1"):
        return True
    if p.scheme != "https":
        return False
    allowed = [h.strip().lower() for h in settings.EMAILS_OAUTH_REDIRECT_HOSTS.split(",") if h.strip()]
    return any(host == h or host.endswith("." + h) for h in allowed)


# --------------------------------------------------------------------------
# Clients (inscription dynamique)
# --------------------------------------------------------------------------

async def register_client(db: AsyncSession, data: dict, ip: Optional[str]) -> tuple[McpOAuthClient, Optional[str]]:
    uris = data.get("redirect_uris")
    if not isinstance(uris, list) or not uris or len(uris) > MAX_REDIRECT_URIS \
            or not all(isinstance(u, str) and len(u) <= 500 for u in uris):
        raise OAuthError("invalid_redirect_uri", "redirect_uris : 1 à 5 URL attendues.")
    bad = [u for u in uris if not redirect_uri_ok(u)]
    if bad:
        raise OAuthError("invalid_redirect_uri", "redirect_uri non autorisé (hôte hors liste ou non https).")
    method = data.get("token_endpoint_auth_method") or "none"
    if method not in ("none", "client_secret_post", "client_secret_basic"):
        raise OAuthError("invalid_client_metadata", "token_endpoint_auth_method non pris en charge.")
    grants = data.get("grant_types") or ["authorization_code", "refresh_token"]
    if not isinstance(grants, list) or any(g not in ("authorization_code", "refresh_token") for g in grants):
        raise OAuthError("invalid_client_metadata", "grant_types : authorization_code et refresh_token seulement.")
    rtypes = data.get("response_types") or ["code"]
    if rtypes != ["code"]:
        raise OAuthError("invalid_client_metadata", "response_types : code seulement.")
    active = (await db.execute(select(McpOAuthClient.id).where(McpOAuthClient.revoked_at.is_(None)))).all()
    if len(active) >= MAX_CLIENTS:
        raise OAuthError("access_denied", "Trop de clients inscrits : révoquez-en depuis emails.chapote.fr.", 403)
    name = data.get("client_name")
    name = name.strip()[:200] if isinstance(name, str) and name.strip() else None
    secret = secrets.token_urlsafe(32) if method != "none" else None
    client = McpOAuthClient(
        client_id="cem_" + secrets.token_urlsafe(18), client_secret_hash=hash_secret(secret) if secret else None,
        client_name=name, redirect_uris=uris, token_endpoint_auth_method=method, created_ip=(ip or "")[:64] or None,
    )
    db.add(client)
    await db.flush()
    return client, secret


async def active_client(db: AsyncSession, client_id: Optional[str]) -> Optional[McpOAuthClient]:
    if not client_id:
        return None
    c = (await db.execute(select(McpOAuthClient).where(McpOAuthClient.client_id == client_id))).scalar_one_or_none()
    return c if c is not None and c.revoked_at is None else None


def check_client_secret(client: McpOAuthClient, secret: Optional[str]) -> None:
    if client.client_secret_hash is None:
        return
    if not secret or not hmac.compare_digest(hash_secret(secret), client.client_secret_hash):
        raise OAuthError("invalid_client", "Authentification du client échouée.", 401)


def client_out(c: McpOAuthClient, secret: Optional[str] = None) -> dict:
    out = {
        "client_id": c.client_id,
        "client_id_issued_at": int(c.created_at.timestamp()) if c.created_at else None,
        "client_name": c.client_name,
        "redirect_uris": c.redirect_uris,
        "token_endpoint_auth_method": c.token_endpoint_auth_method,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": SCOPE,
    }
    if secret:
        out["client_secret"] = secret
        out["client_secret_expires_at"] = 0
    return out


# --------------------------------------------------------------------------
# Codes et jetons
# --------------------------------------------------------------------------

async def create_code(db: AsyncSession, client: McpOAuthClient, user_id: int, redirect_uri: str,
                      code_challenge: str, scope: str, resource: Optional[str]) -> str:
    code = secrets.token_urlsafe(32)
    db.add(McpOAuthCode(code_hash=hash_secret(code), client_pk=client.id, user_id=user_id, redirect_uri=redirect_uri,
                        code_challenge=code_challenge, scope=scope, resource=resource,
                        expires_at=utcnow() + CODE_TTL))
    await db.flush()
    return code


async def _issue(db: AsyncSession, *, client_pk: int, user_id: int, family_id: str, scope: str,
                 resource: Optional[str], code_id: Optional[int]) -> dict:
    access = ACCESS_PREFIX + secrets.token_urlsafe(32)
    refresh = REFRESH_PREFIX + secrets.token_urlsafe(32)
    now = utcnow()
    db.add(McpOAuthToken(client_pk=client_pk, user_id=user_id, family_id=family_id, code_id=code_id,
                         access_hash=hash_secret(access), access_expires_at=now + ACCESS_TTL,
                         refresh_hash=hash_secret(refresh), refresh_expires_at=now + REFRESH_TTL,
                         scope=scope, resource=resource))
    await db.flush()
    return {"access_token": access, "token_type": "Bearer", "expires_in": int(ACCESS_TTL.total_seconds()),
            "refresh_token": refresh, "scope": scope}


async def revoke_family(db: AsyncSession, family_id: str) -> int:
    res = await db.execute(update(McpOAuthToken)
                           .where(McpOAuthToken.family_id == family_id, McpOAuthToken.revoked_at.is_(None))
                           .values(revoked_at=utcnow()))
    return res.rowcount or 0


async def _user_still_allowed(db: AsyncSession, user_id: int) -> bool:
    user = await db.get(User, user_id)
    return await access_problem(db, user, None) is None


async def exchange_code(db: AsyncSession, client: McpOAuthClient, code: str, redirect_uri: Optional[str],
                        verifier: Optional[str], resource: Optional[str]) -> dict:
    if not code or not verifier:
        raise OAuthError("invalid_request", "code et code_verifier sont requis.")
    h = hash_secret(code)
    now = utcnow()
    # Prise atomique (UPDATE … WHERE used_at IS NULL) : deux échanges simultanés du même
    # code, même sur deux workers, ne peuvent pas réussir tous les deux.
    row = (await db.execute(update(McpOAuthCode)
                            .where(McpOAuthCode.code_hash == h, McpOAuthCode.used_at.is_(None))
                            .values(used_at=now)
                            .returning(McpOAuthCode.id))).first()
    if row is None:
        used = (await db.execute(select(McpOAuthCode).where(McpOAuthCode.code_hash == h))).scalar_one_or_none()
        if used is not None:
            # Code rejoué (RFC 6749 §4.1.2) : les jetons déjà émis avec lui sont révoqués.
            fams = (await db.execute(select(McpOAuthToken.family_id).where(McpOAuthToken.code_id == used.id))).scalars().all()
            for f in set(fams):
                await revoke_family(db, f)
            db.add(McpAuditLog(client_pk=used.client_pk, user_id=used.user_id, tool="oauth.code_replay", status="denied"))
            await db.commit()
        raise OAuthError("invalid_grant", "Code invalide, expiré ou déjà utilisé.")
    c = await db.get(McpOAuthCode, row[0])
    if c.client_pk != client.id or c.expires_at < now:
        await db.commit()
        raise OAuthError("invalid_grant", "Code invalide, expiré ou déjà utilisé.")
    if redirect_uri is not None and redirect_uri != c.redirect_uri:
        await db.commit()
        raise OAuthError("invalid_grant", "redirect_uri différent de celui de l'autorisation.")
    if not hmac.compare_digest(pkce_s256(verifier), c.code_challenge):
        await db.commit()
        raise OAuthError("invalid_grant", "Vérification PKCE échouée.")
    if resource and not resource_ok(resource):
        await db.commit()
        raise OAuthError("invalid_target", "Ressource inconnue.")
    if not await _user_still_allowed(db, c.user_id):
        await db.commit()
        raise OAuthError("access_denied", "Compte non autorisé.", 403)
    tokens = await _issue(db, client_pk=client.id, user_id=c.user_id, family_id=secrets.token_hex(16),
                          scope=c.scope, resource=c.resource or settings.emails_resource, code_id=c.id)
    client.last_used_at = now
    db.add(McpAuditLog(client_pk=client.id, user_id=c.user_id, tool="oauth.token", status="ok"))
    await db.commit()
    return tokens


async def refresh_tokens(db: AsyncSession, client: McpOAuthClient, refresh: Optional[str]) -> dict:
    if not refresh:
        raise OAuthError("invalid_request", "refresh_token requis.")
    h = hash_secret(refresh)
    now = utcnow()
    row = (await db.execute(update(McpOAuthToken)
                            .where(McpOAuthToken.refresh_hash == h, McpOAuthToken.rotated_at.is_(None),
                                   McpOAuthToken.revoked_at.is_(None))
                            .values(rotated_at=now)
                            .returning(McpOAuthToken.id))).first()
    if row is None:
        old = (await db.execute(select(McpOAuthToken).where(McpOAuthToken.refresh_hash == h))).scalar_one_or_none()
        if old is not None and old.rotated_at is not None:
            # Rejeu d'un jeton déjà échangé : vol probable, toute la famille tombe.
            await revoke_family(db, old.family_id)
            db.add(McpAuditLog(client_pk=old.client_pk, user_id=old.user_id, tool="oauth.refresh_replay", status="denied"))
            await db.commit()
        raise OAuthError("invalid_grant", "Jeton de rafraîchissement invalide, expiré ou révoqué.")
    tok = await db.get(McpOAuthToken, row[0])
    if tok.client_pk != client.id or (tok.refresh_expires_at and tok.refresh_expires_at < now):
        await db.rollback()
        raise OAuthError("invalid_grant", "Jeton de rafraîchissement invalide, expiré ou révoqué.")
    if not await _user_still_allowed(db, tok.user_id):
        await revoke_family(db, tok.family_id)
        await db.commit()
        raise OAuthError("access_denied", "Compte non autorisé.", 403)
    # L'ancien jeton d'accès cesse aussi de valoir : un seul couple vivant par famille.
    tok.revoked_at = now
    tokens = await _issue(db, client_pk=client.id, user_id=tok.user_id, family_id=tok.family_id,
                          scope=tok.scope, resource=tok.resource, code_id=None)
    client.last_used_at = now
    await db.commit()
    return tokens


async def revoke_token(db: AsyncSession, client: Optional[McpOAuthClient], token: str) -> None:
    """RFC 7009 : jeton d'accès ou de rafraîchissement ; toute la famille est révoquée.
    Jeton inconnu : succès silencieux (pas d'oracle)."""
    h = hash_secret(token or "")
    tok = (await db.execute(select(McpOAuthToken).where(
        (McpOAuthToken.access_hash == h) | (McpOAuthToken.refresh_hash == h)))).scalar_one_or_none()
    if tok is None or (client is not None and tok.client_pk != client.id):
        return
    await revoke_family(db, tok.family_id)
    db.add(McpAuditLog(client_pk=tok.client_pk, user_id=tok.user_id, tool="oauth.revoke", status="ok"))
    await db.commit()


async def revoke_client(db: AsyncSession, client: McpOAuthClient) -> int:
    client.revoked_at = utcnow()
    res = await db.execute(update(McpOAuthToken)
                           .where(McpOAuthToken.client_pk == client.id, McpOAuthToken.revoked_at.is_(None))
                           .values(revoked_at=utcnow()))
    return res.rowcount or 0


# --------------------------------------------------------------------------
# Vérification d'un jeton d'accès (/mcp)
# --------------------------------------------------------------------------

@dataclass
class AccessInfo:
    token_pk: int
    family_id: str
    client_pk: int
    client_name: Optional[str]
    user_id: int


async def verify_access(db: AsyncSession, token: str) -> Optional[AccessInfo]:
    if not token or not token.startswith(ACCESS_PREFIX) or len(token) > 200:
        return None
    tok = (await db.execute(select(McpOAuthToken).where(McpOAuthToken.access_hash == hash_secret(token)))).scalar_one_or_none()
    now = utcnow()
    if tok is None or tok.revoked_at is not None or tok.access_expires_at < now:
        return None
    if tok.resource and not resource_ok(tok.resource):
        return None
    client = await db.get(McpOAuthClient, tok.client_pk)
    if client is None or client.revoked_at is not None:
        return None
    if not await _user_still_allowed(db, tok.user_id):
        return None
    # Dernière utilisation : au plus une écriture par minute et par jeton.
    if tok.last_used_at is None or (now - tok.last_used_at).total_seconds() > 60:
        tok.last_used_at = now
        client.last_used_at = now
        await db.commit()
    return AccessInfo(token_pk=tok.id, family_id=tok.family_id, client_pk=client.id,
                      client_name=client.client_name, user_id=tok.user_id)
