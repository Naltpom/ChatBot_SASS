"""Auth dashboard (JWT 24h) + sessions widget (JWT 30 min, scope restreint).

Deux types de tokens, distingues par le claim `scope` :
- scope="dashboard" : client SaaS connecte au back-office
- scope="widget"    : session ephemere d'un visiteur sur un site client,
                      liee a un bot + un domaine + une conversation
"""
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Optional

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db

if TYPE_CHECKING:
    # Annotations seules : import differe (les modeles importent indirectement
    # ce module au runtime — comme les imports paresseux des fonctions ci-dessous).
    from src.models.bot import Bot
    from src.models.user import Membership, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

# Session glissante widget : le serveur joint un refresh_token quand le JWT
# expire dans moins de ce seuil (10 min), pour ne pas couper le fil du visiteur.
WIDGET_REFRESH_THRESHOLD_SECONDS = 600


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _encode(claims: dict, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        **claims,
        "exp": now + expires_delta,
        "iat": now,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_dashboard_token(user_id: int) -> str:
    return _encode(
        {"sub": str(user_id), "scope": "dashboard"},
        timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
    )


# --- Cookie de session dashboard (audit §3.5 : JWT en cookie httpOnly) ---
# Le JWT dashboard ne transite plus par le corps de réponse ni par localStorage
# (où tout XSS l'exfiltrerait) : il vit UNIQUEMENT dans ce cookie httpOnly, donc
# inaccessible au JavaScript de la page.
#
# Défense CSRF = `SameSite=Lax` SEUL : un POST déclenché depuis un site tiers ne
# porte pas le cookie (Lax ne l'envoie que sur navigation top-level GET). On
# n'ajoute donc PAS de double-submit token (le plan l'autorisait) — superflu ici
# et coûteux à maintenir. `Secure` est conditionné à la prod : en dev http
# localhost un cookie Secure n'est tout simplement pas posé par le navigateur.
AUTH_COOKIE_NAME = "chapote_session"


def set_auth_cookie(response: Response, token: str) -> None:
    """Pose le JWT dashboard dans le cookie de session httpOnly (durée = TTL du
    JWT). À appeler par tout endpoint qui authentifie (login/register/SSO/2FA)."""
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    """Efface le cookie de session (logout). Mêmes attributs que la pose pour que
    le navigateur cible bien le cookie à supprimer."""
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=settings.is_production,
    )


# Challenge 2FA : émis après un 1er facteur (mot de passe/SSO) valide quand la
# 2FA est active. À échanger contre un dashboard token via /api/auth/2fa/login/*.
# Scope dédié (jamais accepté comme token dashboard) + courte durée (10 min).
TWOFA_CHALLENGE_EXPIRE_MINUTES = 10


def create_twofa_challenge_token(user_id: int) -> str:
    # `jti` (nonce unique) : sert d'identifiant anti-rejeu côté serveur — le
    # challenge est marqué consommé à la 1re vérification réussie du 2nd facteur
    # (cf. routers/twofa : single-use via SingleUseTokens), donc non rejouable.
    return _encode(
        {"sub": str(user_id), "scope": "twofa", "jti": uuid.uuid4().hex},
        timedelta(minutes=TWOFA_CHALLENGE_EXPIRE_MINUTES),
    )


def decode_twofa_challenge_payload(token: str) -> dict:
    """Payload complet (`sub`, `jti`) d'un challenge 2FA valide, sinon 401."""
    return decode_token(token, expected_scope="twofa")


async def user_has_2fa(db: AsyncSession, user: "User") -> bool:
    """True si l'utilisateur a au moins un 2nd facteur configuré (TOTP ou passkey)."""
    from src.models.user import WebAuthnCredential

    if user.totp_enabled:
        return True
    n = await db.execute(
        select(WebAuthnCredential.id).where(WebAuthnCredential.user_id == user.id).limit(1)
    )
    return n.first() is not None


# --- Tokens de compte signés (vérification email / réinitialisation mot de
# passe) : stateless, AUCUNE table dédiée (même SECRET/algo que l'auth). Le
# claim `fp` lie la signature à un état courant du compte (email ou hash du mot
# de passe) : dès que cet état change, le token est rejeté -> lien à usage unique
# de fait (le lien de reset casse une fois le mot de passe changé). ---
VERIFY_EMAIL_EXPIRE_HOURS = 48
PASSWORD_RESET_EXPIRE_MINUTES = 60


def account_fingerprint(value: str) -> str:
    """Empreinte courte (sha256 tronqué) liant un token signé à un état du compte
    (email courant / hash du mot de passe), sans exposer la valeur elle-même."""
    return hashlib.sha256(value.encode()).hexdigest()[:16]


def create_verify_email_token(user_id: int, email: str) -> str:
    """Token de confirmation d'email (48h), lié à l'email courant (rejeté si
    l'email change ensuite)."""
    return _encode(
        {"sub": str(user_id), "scope": "verify_email", "fp": account_fingerprint(email)},
        timedelta(hours=VERIFY_EMAIL_EXPIRE_HOURS),
    )


def create_password_reset_token(user_id: int, hashed_password: str) -> str:
    """Token de réinitialisation (1h), lié au hash courant du mot de passe :
    changer le mot de passe invalide le lien (usage unique de fait)."""
    return _encode(
        {"sub": str(user_id), "scope": "password_reset",
         "fp": account_fingerprint(hashed_password)},
        timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES),
    )


def create_widget_token(bot_id: int, conversation_id: str, domain: str) -> str:
    return _encode(
        {
            "sub": conversation_id,
            "scope": "widget",
            "bot_id": bot_id,
            "domain": domain,
        },
        timedelta(minutes=settings.WIDGET_SESSION_EXPIRE_MINUTES),
    )


def widget_token_needs_refresh(payload: dict) -> bool:
    """Session glissante : True si le JWT widget expire dans moins de 10 min.
    Le serveur joint alors un `refresh_token` a la reponse (meme conversation)
    pour que le visiteur ne perde pas son fil apres 30 min d'echange."""
    exp = payload.get("exp")
    if not exp:
        return False
    return exp - datetime.now(timezone.utc).timestamp() < WIDGET_REFRESH_THRESHOLD_SECONDS


def decode_token(token: str, expected_scope: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré")
    if payload.get("scope") != expected_scope:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Scope de token invalide")
    return payload


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Authentifie le client SaaS du dashboard via le cookie httpOnly
    `chapote_session` (audit §3.5). Le JWT n'est plus lu d'un header Authorization :
    la surface plugin a son propre `require_oauth_token` (Bearer), inchangé."""
    from src.models.user import User

    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(token, expected_scope="dashboard")
    result = await db.execute(select(User).where(User.id == int(payload["sub"])))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur introuvable")
    return user


def get_widget_session(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session widget requise")
    return decode_token(credentials.credentials, expected_scope="widget")


async def require_superadmin(
    user: "User" = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs")
    # 2FA OBLIGATOIRE pour le staff (prod) : tant qu'aucun 2nd facteur n'est
    # configuré, l'accès à l'administration est refusé. Le détail `twofa_setup_required`
    # est reconnu côté front pour rediriger vers l'enrôlement. Non appliqué en dev
    # (auto-login admin, e2e) ni si TWOFA_ENFORCE_ADMIN est désactivé.
    if settings.is_production and settings.TWOFA_ENFORCE_ADMIN:
        if not await user_has_2fa(db, user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "twofa_setup_required")
    return user


async def get_membership(org_id: int, user: "User", db: AsyncSession):
    from src.models.user import Membership

    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def require_org_access(org_id: int, user: "User", db: AsyncSession):
    """Membre de l'organisation OU superadmin (le staff peut tout configurer).
    Retourne la Membership (None pour un superadmin non membre)."""
    if user.is_superadmin:
        return await get_membership(org_id, user, db)
    membership = await get_membership(org_id, user, db)
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    return membership


async def require_org_admin(org_id: int, user: "User", db: AsyncSession):
    """Admin de l'organisation OU superadmin. Pour la gestion d'equipe,
    le changement de nom d'org, la suppression de bots."""
    if user.is_superadmin:
        return None
    membership = await get_membership(org_id, user, db)
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    if membership.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs de l'organisation")
    return membership


async def require_bot_access(bot: "Bot", user: "User", db: AsyncSession):
    """Acces en LECTURE/usage a un bot, ownership polymorphe.

    Retourne la Membership pertinente (None = « tous droits » : owner perso ou
    superadmin non membre — _check_bot_perm/_mask_bot_out interpretent None
    comme un acces total).
    - Bot d'EQUIPE (organization_id) : delegue a require_org_access.
    - Bot PERSO (owner_user_id) : seul l'owner (ou un superadmin) y accede,
      404 anti-enumeration sinon. Le superadmin n'a pas de membership perso ->
      None (tous droits)."""
    if user.is_superadmin:
        return await get_membership(bot.organization_id, user, db) if bot.organization_id else None
    if bot.owner_user_id is not None:
        if user.id == bot.owner_user_id:
            return None
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    return await require_org_access(bot.organization_id, user, db)


async def require_bot_admin(bot: "Bot", user: "User", db: AsyncSession):
    """Acces ADMIN a un bot (suppression, deplacement), ownership polymorphe.
    - Bot d'EQUIPE : admin de l'org (ou superadmin).
    - Bot PERSO : l'owner (ou superadmin)."""
    if user.is_superadmin:
        return None
    if bot.owner_user_id is not None:
        if user.id == bot.owner_user_id:
            return None
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    return await require_org_admin(bot.organization_id, user, db)


async def require_billing_owner(bot: "Bot", user: "User", db: AsyncSession):
    """Acces FACTURATION a un bot (spec §1.1 / §5.4, corrige C3) — scopée.

    Le PAYEUR seul gere la facturation (un admin non-owner d'une org ne voit pas
    la facturation, contrairement a require_org_admin) :
    - Bot d'EQUIPE (organization_id) : SEUL l'owner de l'org (`Organization.
      owner_user_id`) — pas les autres admins. 404 anti-enumeration si l'org est
      introuvable ; 403 si le user est membre mais pas owner.
    - Bot PERSO (owner_user_id) : SEUL l'owner. 404 anti-enumeration sinon.
    - superadmin : court-circuite (acces total).

    Retourne None (pas de membership pertinente : la facturation est une notion
    de payeur, pas de role d'equipe)."""
    from src.models.user import Organization

    if user.is_superadmin:
        return None
    if bot.owner_user_id is not None:
        # Bot perso : seul le proprietaire paie.
        if user.id == bot.owner_user_id:
            return None
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    # Bot d'equipe : seul l'owner de l'org paie (un admin non-owner est exclu).
    org = await db.get(Organization, bot.organization_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    if org.owner_user_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Réservé au propriétaire de l'organisation (facturation)",
        )
    return None


# --- OAuth « plugin » : surface EXTERNE (plugin WordPress), Authorization Code + PKCE (S256), RFC 7636 ---
# Token scope='plugin' (JAMAIS 'dashboard') : un access JWT volé ne donne accès
# qu'à l'API de compte (/api/account/*), bornée par l'ownership (require_billing_owner).
# Constantes de module (même pattern que TWOFA_CHALLENGE_EXPIRE_MINUTES).
OAUTH_PLUGIN_CLIENT_ID = "chapote_wp"
OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES = 30  # access JWT scope='plugin' (30 min ; refresh opaque rotatif 90j en base — le plugin refresh réactivement sur 401)
OAUTH_AUTH_CODE_EXPIRE_MINUTES = 5  # code d'autorisation (Authorization Code + PKCE) : usage unique, TTL court


def create_oauth_token(user_id: int) -> tuple[str, str]:
    """Access token JWT pour la surface EXTERNE (plugin). Scope 'plugin' (jamais
    'dashboard'). Porte un `jti` (uuid4) qui lie l'access à la ligne OAuthToken du
    pair (access_jti) : révoquer cette ligne (déconnexion / rotation) rejette
    l'access IMMÉDIATEMENT (audit §3.4). Renvoie (token, jti)."""
    jti = uuid.uuid4().hex
    token = _encode(
        {"sub": str(user_id), "scope": "plugin", "jti": jti},
        timedelta(minutes=OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES),
    )
    return token, jti


async def require_oauth_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Authentifie un appel de la surface EXTERNE (plugin) via un access token
    scope='plugin'. Renvoie le User (is_active) — calque get_current_user — afin
    que les routes /api/account/* réutilisent TELLES QUELLES require_billing_owner
    / require_bot_access (même anti-énumération 404, zéro logique d'ownership
    dupliquée)."""
    from src.models.oauth import OAuthToken
    from src.models.user import User

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(credentials.credentials, expected_scope="plugin")
    # Révocation stateful (audit §3.4) : l'access porte un `jti` lié à la ligne
    # OAuthToken du pair (access_jti). Un access sans jti = ancien token émis
    # avant ce durcissement -> rejeté (le plugin le refresh sur 401). Sinon on
    # exige que la ligne existe ET ne soit PAS révoquée : déconnexion (revoke) et
    # rotation (rotate_refresh) marquent is_revoked sur cette ligne -> l'access
    # est rejeté immédiatement, sans attendre l'expiration du JWT.
    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré")
    res = await db.execute(select(OAuthToken).where(OAuthToken.access_jti == jti))
    tok = res.scalar_one_or_none()
    if tok is None or tok.is_revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token révoqué")
    result = await db.execute(select(User).where(User.id == int(payload["sub"])))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur introuvable")
    return user


# --- Onboarding guidé du plugin WordPress : tokens courts dédiés -----------
# Deux scopes ÉPHÉMÈRES, distincts de 'plugin'/'dashboard'/'widget', jamais
# acceptés par require_oauth_token (scope='plugin') ni get_current_user
# (scope='dashboard') — decode_token rejette tout scope non concordant (401).
#
# - 'embed'          : éditeur de bot embarqué (front dashboard rendu en iframe
#                      dans le back-office WP). Porte le bot_id (le routeur embed
#                      n'a PAS de path param) + l'user (sub). ~20 min.
# - 'widget_preview' : aperçu LIVE du widget avant paiement. Autorise le
#                      bootstrap/session widget à bypasser origine + captcha pour
#                      CE bot uniquement, en session sans side-effects. ~15 min.
EMBED_TOKEN_EXPIRE_MINUTES = 20
WIDGET_PREVIEW_EXPIRE_MINUTES = 15


def create_embed_token(bot_id: int, user_id: int) -> str:
    """Token d'éditeur embarqué (scope='embed', ~20 min) : lie un bot à son
    propriétaire pour la surface /api/embed (bot_id issu du token, pas du chemin)."""
    return _encode(
        {"sub": str(user_id), "scope": "embed", "bot_id": bot_id},
        timedelta(minutes=EMBED_TOKEN_EXPIRE_MINUTES),
    )


def verify_embed_token(token: str) -> dict:
    """Décode un token d'éditeur embarqué valide (scope='embed') ou lève 401."""
    return decode_token(token, expected_scope="embed")


def create_widget_preview_token(bot_id: int, user_id: int) -> str:
    """Token d'aperçu widget (scope='widget_preview', ~15 min) : autorise le
    bootstrap/session du widget à bypasser origine+captcha pour CE bot."""
    return _encode(
        {"sub": str(user_id), "scope": "widget_preview", "bot_id": bot_id},
        timedelta(minutes=WIDGET_PREVIEW_EXPIRE_MINUTES),
    )


def verify_widget_preview_token(token: str) -> Optional[dict]:
    """Décode un token d'aperçu widget (scope='widget_preview'). Renvoie le
    payload, ou None si invalide/expiré/mauvais scope — le widget retombe alors
    SILENCIEUSEMENT sur le comportement public (jamais de 4xx). Volontairement
    NON levant (contrairement à decode_token) : un token d'aperçu périmé ne doit
    pas casser une page publique, juste perdre le bypass d'aperçu."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("scope") != "widget_preview":
        return None
    return payload


async def require_embed_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> "tuple[Bot, User, Optional[Membership]]":
    """Authentifie la surface EMBED (/api/embed) via un access token scope='embed'.
    Renvoie (bot, user, membership) — le bot_id vient du TOKEN (aucun path param).
    Réutilise require_bot_access pour l'anti-énumération 404 (même garde que le
    dashboard) : un token 'embed' volé n'ouvre QUE le bot pour lequel il a été émis,
    et seul un ayant droit du bot passe. Le `membership` retourné (None = accès
    complet : owner perso / superadmin) est réutilisé par les handlers pour
    _check_bot_perm, sans re-résoudre l'accès."""
    from src.models.bot import Bot
    from src.models.user import User

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(credentials.credentials, expected_scope="embed")
    bot_id, user_id = payload.get("bot_id"), payload.get("sub")
    if not bot_id or not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur introuvable")
    bot = await db.get(Bot, int(bot_id))
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    membership = await require_bot_access(bot, user, db)  # 404 anti-énumération si non ayant droit
    return bot, user, membership
