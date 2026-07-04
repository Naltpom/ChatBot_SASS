"""Authentification : intranet d'abord (si active, emails staff uniquement), fallback local.

Meme flux qu'ao_scrapping : POST {mail, mdp} sur INTRANET_AUTH_URL, succes si
redirect vers /main ou JSON {"retour": "Ok"}. Les comptes intranet (staff)
sont crees superadmins du SaaS : vue sur tous les clients.
"""
import hashlib
import json
import logging
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.security import hash_password, verify_password
from src.core.time import utcnow
from src.models.user import User

logger = logging.getLogger(__name__)


class AuthenticationError(Exception):
    pass


def _is_staff_email(email: str) -> bool:
    """True si l'email appartient au domaine staff (seuls ces comptes passent
    par l'intranet et peuvent devenir superadmins)."""
    return email.lower().strip().endswith("@" + settings.INTRANET_STAFF_DOMAIN.lower())


def _log_ref(email: str) -> str:
    """Identifiant de log non-PII (hash court de l'email, jamais l'email brut)."""
    return hashlib.sha256(email.encode("utf-8")).hexdigest()[:8]


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
                        logger.info("Intranet auth success (ref=%s)", _log_ref(email))
                        return _user_info_from_email(email)
                except (ValueError, json.JSONDecodeError) as e:
                    # Reponse 200 non-JSON (ex : page HTML) -> echec d'auth, pas une erreur
                    logger.debug("Intranet 200 non-JSON (ref=%s) : %s", _log_ref(email), e)
            logger.info("Intranet auth failed (ref=%s, status=%s)", _log_ref(email), response.status_code)
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
    """1. Intranet (staff uniquement) -> cree/maj le user (superadmin). 2. Fallback local."""
    email = email.lower().strip()  # les emails sont stockes en minuscules
    # Seuls les emails du domaine staff passent par l'intranet : on ne relaie
    # JAMAIS le mot de passe en clair d'un client vers un service externe.
    if settings.INTRANET_AUTH_ENABLED and _is_staff_email(email):
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
        user.last_login = utcnow()
        await db.commit()
        return user

    raise AuthenticationError("Email ou mot de passe incorrect")


async def _get_or_create_intranet_user(db: AsyncSession, info: dict, password: str) -> User:
    # Garde-fou : jamais d'elevation superadmin ni d'ecrasement de mot de passe
    # pour un email hors domaine staff, meme si l'intranet le validait.
    if not _is_staff_email(info["email"]):
        raise AuthenticationError("Email ou mot de passe incorrect")
    result = await db.execute(select(User).where(User.email == info["email"]))
    user = result.scalar_one_or_none()
    if user:
        user.auth_source = "intranet"
        user.is_superadmin = True
        user.email_verified = True  # adresse corporate validée par l'intranet
        user.last_login = utcnow()
        user.hashed_password = hash_password(password)  # fallback local si intranet down
    else:
        user = User(
            email=info["email"],
            name=info["name"],
            hashed_password=hash_password(password),
            auth_source="intranet",
            is_superadmin=True,
            email_verified=True,  # adresse corporate validée par l'intranet
            last_login=utcnow(),
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
        email_verified=True,
    ))
    await db.commit()
    logger.warning("Compte admin dev créé : %s (AUTO_LOGIN_ADMIN_DEV)", settings.ADMIN_EMAIL)
