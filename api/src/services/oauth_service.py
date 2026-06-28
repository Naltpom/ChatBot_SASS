"""OAuth « plugin » (Authorization Code + PKCE, RFC 7636) + cycle de vie des tokens.

Flux :
1. Le dashboard (page /authorize, utilisateur CONNECTÉ) crée un code via
   create_authorization_code() après consentement -> code clair concaténé au
   redirect_uri (page admin du plugin) + state.
2. Le plugin échange (server-to-server) le code via exchange_authorization_code()
   en prouvant la possession du code_verifier (PKCE S256) -> paire (access JWT
   scope='plugin' + refresh opaque). Erreurs OAuth : invalid_grant.
3. rotate_refresh() : rotation avec détection de rejeu. revoke() : déconnexion.

Sécurité : code d'autorisation et refresh_token stockés HACHÉS (SHA-256). PKCE
S256 : base64url-sans-padding(sha256(code_verifier)) comparé (temps constant) au
code_challenge stocké. L'access token est un JWT stateless
(src.core.security.create_oauth_token). Constantes de durée en module (même
pattern que les constantes 2FA de core/security)."""
import base64
import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import (
    OAUTH_AUTH_CODE_EXPIRE_MINUTES,
    OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES,
    OAUTH_PLUGIN_CLIENT_ID,
    create_oauth_token,
)
from src.core.time import utcnow
from src.models.oauth import OAuthAuthorizationCode, OAuthRedirectDomain, OAuthToken

# Slugs de la page admin du plugin WP : 'chapote-chatbot' (actuel) ou
# 'chapote-backoffice' (anciennes installs en transition).
_PLUGIN_ADMIN_PAGES = ("chapote-chatbot", "chapote-backoffice")

# Hôte LDH (letters-digits-hyphen) : seuls les caractères d'un nom de domaine DNS
# légitime. Bloque les différentiels de parseur (backslash, tab/CR, unicode brut)
# qui pourraient faire diverger l'hôte stocké de l'hôte réellement contacté.
# Punycode (xn--…) reste accepté (uniquement [a-z0-9.-]).
_LDH_HOST = re.compile(r"^[a-z0-9.-]+$")


def validated_redirect_host(uri: str, *, allow_insecure_localhost: bool) -> str | None:
    """Valide la FORME du redirect_uri (page admin du plugin WP) et renvoie son
    hôte EXACT en minuscule, ou None si la forme est invalide.

    Durcissements (§3.2 / §Qualité audit) : comparaison EXACTE du paramètre `page`
    (fini le match par sous-chaîne `:97`), https imposé (http toléré seulement sur
    localhost/127.x/::1 en dev), pas d'userinfo. L'hôte renvoyé sert de clé
    d'allowlist (comparaison exacte → un sous-domaine forgé est rejeté)."""
    parsed = urlparse(uri or "")
    host = (parsed.hostname or "").lower()
    if not parsed.netloc or not host or parsed.username or parsed.password:
        return None
    if parsed.scheme == "https":
        # Durcissement anti-différentiel de parseur : l'hôte d'un site public ne
        # doit contenir QUE des caractères LDH (un backslash/tab/CR/unicode brut
        # pourrait faire diverger l'hôte stocké de l'hôte réellement contacté).
        if not _LDH_HOST.match(host):
            return None
    elif parsed.scheme == "http" and allow_insecure_localhost and (
        host == "localhost" or host == "::1" or host.startswith("127.")
    ):
        # Hôtes dev validés par égalité exacte : le filtre LDH ne s'applique pas
        # (`::1` contient des `:`).
        pass
    else:
        return None
    if not parsed.path.endswith("/wp-admin/admin.php"):
        return None
    pages = parse_qs(parsed.query).get("page", [])
    if not any(p in _PLUGIN_ADMIN_PAGES for p in pages):
        return None
    return host


async def registered_domains(db: AsyncSession, user_id: int) -> set[str]:
    """Ensemble des hôtes WP enregistrés (allowlist redirect_uri) de l'utilisateur."""
    res = await db.execute(
        select(OAuthRedirectDomain).where(OAuthRedirectDomain.user_id == user_id)
    )
    return {row.domain for row in res.scalars().all()}


async def register_domain(db: AsyncSession, user_id: int, domain: str) -> None:
    """Enregistre un hôte WP dans l'allowlist de l'utilisateur (idempotent). Le
    router commit.

    On tente directement l'insert et on rattrape l'IntegrityError de la contrainte
    unique(user_id, domain) : deux /authorize concurrents du même user/domaine se
    sérialisent sans 500 (le domaine existe déjà = succès silencieux)."""
    db.add(OAuthRedirectDomain(user_id=user_id, domain=domain))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()

# Durée de vie d'un refresh opaque (promouvable en Settings si besoin prod).
OAUTH_PLUGIN_REFRESH_EXPIRE_DAYS = 90


class OAuthError(Exception):
    """Erreur OAuth (invalid_grant | invalid_request | server_error). `code` =
    chaîne renvoyée au client dans le corps de l'erreur OAuth (HTTP 400)."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _pkce_s256(code_verifier: str) -> str:
    """Transformation PKCE S256 (RFC 7636) : base64url-SANS-padding du sha256 du
    code_verifier. À comparer au code_challenge fourni à l'autorisation."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def create_authorization_code(
    db: AsyncSession,
    user_id: int,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    code_challenge_method: str,
    scope: str,
) -> str:
    """Crée un code d'autorisation à usage unique (après consentement dashboard).
    Retourne le code CLAIR (seul stocké : son hash). Le router commit."""
    code = secrets.token_urlsafe(32)
    row = OAuthAuthorizationCode(
        code_hash=_hash(code),
        client_id=client_id,
        user_id=user_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        scope=scope,
        expires_at=utcnow() + timedelta(minutes=OAUTH_AUTH_CODE_EXPIRE_MINUTES),
    )
    db.add(row)
    await db.flush()
    return code


async def _issue_token_pair(db: AsyncSession, user_id: int) -> tuple[str, str, int]:
    """Émet (access JWT, refresh opaque clair, expires_in access en secondes) et
    persiste le HASH du refresh."""
    refresh = secrets.token_urlsafe(48)
    tok = OAuthToken(
        user_id=user_id,
        client_id=OAUTH_PLUGIN_CLIENT_ID,
        refresh_token_hash=_hash(refresh),
        scope="plugin",
        expires_at=utcnow() + timedelta(days=OAUTH_PLUGIN_REFRESH_EXPIRE_DAYS),
    )
    db.add(tok)
    await db.flush()
    access = create_oauth_token(user_id)
    return access, refresh, OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES * 60


async def exchange_authorization_code(
    db: AsyncSession, code: str, redirect_uri: str, code_verifier: str
) -> tuple[str, str, int]:
    """Échange un code d'autorisation contre une paire de tokens (appel
    server-to-server du plugin). Valide : code existant (via hash), non utilisé,
    non expiré, redirect_uri identique à celui lié au code, et preuve PKCE S256.
    Sur succès : marque used_at (usage unique) et émet la paire. Lève
    OAuthError('invalid_grant') sinon."""
    # with_for_update : verrou ligne anti double-échange. Deux échanges concurrents
    # du même code sont sérialisés ; le 2e voit used_at non NULL -> invalid_grant
    # (sinon deux paires émises). No-op sous SQLite.
    res = await db.execute(
        select(OAuthAuthorizationCode)
        .where(OAuthAuthorizationCode.code_hash == _hash(code))
        .with_for_update()
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise OAuthError("invalid_grant")
    if row.used_at is not None:
        raise OAuthError("invalid_grant")
    if row.expires_at <= utcnow():
        raise OAuthError("invalid_grant")
    if row.redirect_uri != redirect_uri:
        raise OAuthError("invalid_grant")
    # PKCE S256 uniquement (le seul accepté à l'autorisation). Comparaison en
    # temps constant pour ne pas fuiter via timing.
    if row.code_challenge_method != "S256":
        raise OAuthError("invalid_grant")
    if not hmac.compare_digest(_pkce_s256(code_verifier or ""), row.code_challenge):
        raise OAuthError("invalid_grant")
    row.used_at = utcnow()
    return await _issue_token_pair(db, row.user_id)


async def _revoke_lineage(db: AsyncSession, tok: OAuthToken) -> None:
    """Révoque une chaîne de refresh (anti-rejeu) en suivant replaced_by_id."""
    seen: set[int] = set()
    cur: OAuthToken | None = tok
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        cur.is_revoked = True
        cur.revoked_at = utcnow()
        nxt_id = cur.replaced_by_id
        if nxt_id is None:
            break
        res = await db.execute(select(OAuthToken).where(OAuthToken.id == nxt_id))
        cur = res.scalar_one_or_none()


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str, int]:
    """Rotation : valide le refresh, émet une NOUVELLE paire, révoque l'ancien.
    Détection de rejeu : un refresh déjà révoqué/remplacé -> révoque la lignée et
    lève invalid_grant."""
    # with_for_update : verrou ligne anti-TOCTOU. Deux rotations concurrentes du
    # même refresh sont sérialisées ; la 2e voit is_revoked=True -> _revoke_lineage
    # + invalid_grant (sinon le rejeu d'un refresh volé passerait). No-op sous SQLite.
    res = await db.execute(
        select(OAuthToken).where(OAuthToken.refresh_token_hash == _hash(refresh_token)).with_for_update()
    )
    tok = res.scalar_one_or_none()
    if tok is None:
        raise OAuthError("invalid_grant")
    if tok.is_revoked or tok.replaced_by_id is not None:
        await _revoke_lineage(db, tok)
        raise OAuthError("invalid_grant")
    if tok.expires_at <= utcnow():
        raise OAuthError("invalid_grant")
    access, new_refresh, expires_in = await _issue_token_pair(db, tok.user_id)
    res2 = await db.execute(
        select(OAuthToken).where(OAuthToken.refresh_token_hash == _hash(new_refresh))
    )
    new_tok = res2.scalar_one()
    tok.is_revoked = True
    tok.revoked_at = utcnow()
    tok.replaced_by_id = new_tok.id
    tok.last_used_at = utcnow()
    return access, new_refresh, expires_in


async def revoke(db: AsyncSession, refresh_token: str) -> None:
    """Déconnexion : révoque le refresh (idempotent). L'access JWT expire seul."""
    res = await db.execute(
        select(OAuthToken).where(OAuthToken.refresh_token_hash == _hash(refresh_token))
    )
    tok = res.scalar_one_or_none()
    if tok is not None and not tok.is_revoked:
        tok.is_revoked = True
        tok.revoked_at = utcnow()
