"""Device flow OAuth « plugin » (RFC 8628) + cycle de vie des tokens.

Flux (aucune URL de redirection => fonctionne sur tout domaine WordPress) :
1. Le backend PHP du plugin appelle new_device_authorization() -> device_code + user_code.
2. L'utilisateur, connecté au dashboard, saisit le user_code sur /link et l'approuve
   (find_pending_by_user_code + approve_device).
3. Le plugin échange (polling) le device_code via exchange_device_code() -> paire
   (access JWT scope='plugin' + refresh opaque). Erreurs RFC 8628 :
   authorization_pending | expired_token | access_denied | invalid_grant.
4. rotate_refresh() : rotation avec détection de rejeu. revoke() : déconnexion.

Sécurité : device_code et refresh_token stockés HACHÉS (SHA-256). L'access token
est un JWT stateless (src.core.security.create_oauth_token). Constantes de durée
en module (même pattern que les constantes 2FA de core/security)."""
import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import (
    OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES,
    OAUTH_PLUGIN_CLIENT_ID,
    create_oauth_token,
)
from src.core.time import utcnow
from src.models.oauth import OAuthDeviceAuthorization, OAuthToken

# Durées du device flow (promouvables en Settings si besoin prod).
OAUTH_DEVICE_CODE_EXPIRE_MINUTES = 10
OAUTH_DEVICE_POLL_INTERVAL_SECONDS = 5
OAUTH_PLUGIN_REFRESH_EXPIRE_DAYS = 90

# Alphabet user_code sans caractères ambigus (0/O, 1/I/L) — saisie humaine fiable.
_USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class DeviceFlowError(Exception):
    """Erreur RFC 8628 (authorization_pending | slow_down | expired_token |
    access_denied | invalid_grant | server_error). `code` = chaîne renvoyée au
    client dans le corps de l'erreur OAuth."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canon_user_code(s: str) -> str:
    """Forme canonique « XXXX-XXXX » (insensible casse/espaces/tirets)."""
    raw = "".join(c for c in (s or "").upper() if c.isalnum())
    return f"{raw[:4]}-{raw[4:8]}" if len(raw) >= 8 else raw


def _new_user_code() -> str:
    raw = "".join(secrets.choice(_USER_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


async def new_device_authorization(db: AsyncSession, site_url: str | None) -> tuple[str, OAuthDeviceAuthorization]:
    """Crée une autorisation device. Retourne (device_code_clair, row).
    Le user_code (affiché au client) est porté par la row."""
    device_code = secrets.token_urlsafe(32)
    user_code = None
    for _ in range(6):
        candidate = _new_user_code()
        exists = await db.execute(
            select(OAuthDeviceAuthorization.id).where(OAuthDeviceAuthorization.user_code == candidate)
        )
        if exists.first() is None:
            user_code = candidate
            break
    if user_code is None:
        raise DeviceFlowError("server_error")
    row = OAuthDeviceAuthorization(
        client_id=OAUTH_PLUGIN_CLIENT_ID,
        device_code_hash=_hash(device_code),
        user_code=user_code,
        scope="plugin",
        status="pending",
        site_url=(site_url or None),
        interval_seconds=OAUTH_DEVICE_POLL_INTERVAL_SECONDS,
        expires_at=utcnow() + timedelta(minutes=OAUTH_DEVICE_CODE_EXPIRE_MINUTES),
    )
    db.add(row)
    await db.flush()
    return device_code, row


async def find_pending_by_user_code(db: AsyncSession, user_code: str) -> OAuthDeviceAuthorization | None:
    code = _canon_user_code(user_code)
    if not code:
        return None
    res = await db.execute(
        select(OAuthDeviceAuthorization).where(OAuthDeviceAuthorization.user_code == code)
    )
    return res.scalar_one_or_none()


async def approve_device(db: AsyncSession, row: OAuthDeviceAuthorization, user_id: int) -> None:
    """Approbation par l'utilisateur connecté au dashboard."""
    if row.status != "pending":
        raise DeviceFlowError("invalid_grant")
    if row.expires_at <= utcnow():
        row.status = "expired"
        raise DeviceFlowError("expired_token")
    row.status = "approved"
    row.user_id = user_id
    row.approved_at = utcnow()


async def deny_device(db: AsyncSession, row: OAuthDeviceAuthorization) -> None:
    if row.status == "pending":
        row.status = "denied"


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


async def exchange_device_code(db: AsyncSession, device_code: str) -> tuple[str, str, int]:
    """Échange un device_code (polling du plugin). Lève DeviceFlowError tant que
    l'échange n'est pas possible (authorization_pending | expired_token |
    access_denied | invalid_grant). Sur succès : émet la paire et CONSOMME (usage
    unique)."""
    # with_for_update : verrou ligne pour que deux polls concurrents du même
    # device_code ne puissent pas tous deux franchir status=='approved' et émettre
    # deux paires (le 2e attend, puis voit status='consumed'). No-op sous SQLite.
    res = await db.execute(
        select(OAuthDeviceAuthorization).where(
            OAuthDeviceAuthorization.device_code_hash == _hash(device_code)
        ).with_for_update()
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise DeviceFlowError("invalid_grant")
    row.last_polled_at = utcnow()
    if row.status == "consumed":
        raise DeviceFlowError("invalid_grant")
    if row.status == "denied":
        raise DeviceFlowError("access_denied")
    if row.expires_at <= utcnow():
        row.status = "expired"
        raise DeviceFlowError("expired_token")
    if row.status == "pending":
        raise DeviceFlowError("authorization_pending")
    if row.status != "approved" or row.user_id is None:
        raise DeviceFlowError("invalid_grant")
    access, refresh, expires_in = await _issue_token_pair(db, row.user_id)
    row.status = "consumed"
    return access, refresh, expires_in


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
        raise DeviceFlowError("invalid_grant")
    if tok.is_revoked or tok.replaced_by_id is not None:
        await _revoke_lineage(db, tok)
        raise DeviceFlowError("invalid_grant")
    if tok.expires_at <= utcnow():
        raise DeviceFlowError("invalid_grant")
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
