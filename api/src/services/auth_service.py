"""Authentification : intranet Kertios d'abord (si active), fallback local.

Meme flux qu'ao_scrapping : POST {mail, mdp} sur INTRANET_AUTH_URL, succes si
redirect vers /main ou JSON {"retour": "Ok"}. Les comptes intranet (staff
Kertios) sont crees superadmins du SaaS : vue sur tous les clients.
"""
import logging
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.security import hash_password, verify_password
from src.models.user import User

logger = logging.getLogger(__name__)


class AuthenticationError(Exception):
    pass


async def authenticate_intranet(email: str, password: str) -> Optional[dict]:
    """Retourne {email, name} si l'intranet valide les identifiants, None sinon."""
    if not settings.INTRANET_AUTH_ENABLED:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.post(
                settings.INTRANET_AUTH_URL,
                data={"mail": email, "mdp": password},
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": "https://intranet.kertios.com",
                    "Referer": "https://intranet.kertios.com/main/auth",
                },
            )
            if response.status_code in (302, 303):
                location = response.headers.get("location", "")
                if "/main" in location and "auth" not in location:
                    return _user_info_from_email(email)
            if response.status_code == 200:
                try:
                    data = response.json()
                    # Comparaison stricte : un champ "success" truthy quelconque ne suffit pas
                    if data.get("retour") == "Ok" or data.get("success") is True or data.get("authenticated") is True:
                        logger.info("Intranet auth success for %s", email)
                        return _user_info_from_email(email)
                except Exception:
                    pass
            logger.info("Intranet auth failed for %s (status=%s)", email, response.status_code)
            return None
    except httpx.RequestError as e:
        logger.warning("Intranet injoignable : %s", e)
        return None


def _user_info_from_email(email: str) -> dict:
    """prenom.nom@kertios.com -> 'Prenom Nom'."""
    parts = email.split("@")[0].split(".")
    name = " ".join(p.capitalize() for p in parts if p) or email
    return {"email": email, "name": name}


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    """1. Intranet si active -> cree/maj le user (superadmin). 2. Fallback local."""
    email = email.lower().strip()  # les emails sont stockes en minuscules
    if settings.INTRANET_AUTH_ENABLED:
        info = await authenticate_intranet(email, password)
        if info:
            user = await _get_or_create_intranet_user(db, info, password)
            if not user.is_active:
                raise AuthenticationError("Votre compte a été désactivé. Contactez un administrateur.")
            return user

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.hashed_password):
        if not user.is_active:
            raise AuthenticationError("Votre compte a été désactivé. Contactez un administrateur.")
        user.last_login = datetime.utcnow()
        await db.commit()
        return user

    raise AuthenticationError("Email ou mot de passe incorrect")


async def _get_or_create_intranet_user(db: AsyncSession, info: dict, password: str) -> User:
    result = await db.execute(select(User).where(User.email == info["email"]))
    user = result.scalar_one_or_none()
    if user:
        user.auth_source = "intranet"
        user.is_superadmin = True
        user.last_login = datetime.utcnow()
        user.hashed_password = hash_password(password)  # fallback local si intranet down
    else:
        user = User(
            email=info["email"],
            name=info["name"],
            hashed_password=hash_password(password),
            auth_source="intranet",
            is_superadmin=True,
            last_login=datetime.utcnow(),
        )
        db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


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
    ))
    await db.commit()
    logger.warning("Compte admin dev créé : %s (AUTO_LOGIN_ADMIN_DEV)", settings.ADMIN_EMAIL)
