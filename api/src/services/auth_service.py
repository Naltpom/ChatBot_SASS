"""Authentification locale (email + mot de passe verifies en base).

Le SSO Google (flux ID token) vit dans routers/auth.py + services/google_oauth.py.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.security import hash_password, verify_password
from src.core.time import utcnow
from src.models.user import User

logger = logging.getLogger(__name__)


class AuthenticationError(Exception):
    pass


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    """Lookup local + verify_password. Leve AuthenticationError sinon."""
    email = email.lower().strip()  # les emails sont stockes en minuscules
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.hashed_password):
        if not user.is_active:
            raise AuthenticationError("Votre compte a été désactivé. Contactez un administrateur.")
        user.last_login = utcnow()
        await db.commit()
        return user

    raise AuthenticationError("Email ou mot de passe incorrect")


async def ensure_dev_admin(db: AsyncSession) -> None:
    """Seed du compte admin de dev (AUTO_LOGIN_ADMIN_DEV). Appele au demarrage."""
    if not (settings.AUTO_LOGIN_ADMIN_DEV and not settings.is_production):
        return
    result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
    if result.scalar_one_or_none():
        return
    db.add(User(
        email=settings.ADMIN_EMAIL,
        name="Admin Dev",
        hashed_password=hash_password(settings.ADMIN_PASSWORD),
        is_superadmin=True,
        email_verified=True,
    ))
    await db.commit()
    logger.warning("Compte admin dev créé : %s (AUTO_LOGIN_ADMIN_DEV)", settings.ADMIN_EMAIL)
