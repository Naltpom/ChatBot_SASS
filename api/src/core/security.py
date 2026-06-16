"""Auth dashboard (JWT 24h) + sessions widget (JWT 30 min, scope restreint).

Deux types de tokens, distingues par le claim `scope` :
- scope="dashboard" : client SaaS connecte au back-office
- scope="widget"    : session ephemere d'un visiteur sur un site client,
                      liee a un bot + un domaine + une conversation
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _encode(claims: dict, expires_delta: timedelta) -> str:
    payload = {
        **claims,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_dashboard_token(user_id: int) -> str:
    return _encode(
        {"sub": str(user_id), "scope": "dashboard"},
        timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
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
    return exp - datetime.now(timezone.utc).timestamp() < 600


def decode_token(token: str, expected_scope: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide ou expiré")
    if payload.get("scope") != expected_scope:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Scope de token invalide")
    return payload


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    from src.models.user import User

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    payload = decode_token(credentials.credentials, expected_scope="dashboard")
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


async def require_superadmin(user=Depends(get_current_user)):
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé aux administrateurs")
    return user


async def get_membership(org_id: int, user, db: AsyncSession):
    from src.models.user import Membership

    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def require_org_access(org_id: int, user, db: AsyncSession):
    """Membre de l'organisation OU superadmin (le staff peut tout configurer).
    Retourne la Membership (None pour un superadmin non membre)."""
    if user.is_superadmin:
        return await get_membership(org_id, user, db)
    membership = await get_membership(org_id, user, db)
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    return membership


async def require_org_admin(org_id: int, user, db: AsyncSession):
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


async def require_bot_access(bot, user, db: AsyncSession):
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


async def require_bot_admin(bot, user, db: AsyncSession):
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
