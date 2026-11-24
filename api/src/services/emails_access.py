"""Contrôle d'accès d'emails.chapote.fr : superadmin, 2FA obligatoire.

Réutilise TWOFA_ENFORCE_ADMIN (même règle que /api/admin/*, appliquée en production), en
plus strict : pour l'interface et le consentement OAuth, avoir une 2FA configurée ne
suffit pas, la session elle-même doit avoir franchi le 2nd facteur (claim `mfa` du cookie,
posé par /api/auth/2fa/login/*). Une session ouverte avant l'enrôlement, ou par un chemin
sans 2nd facteur, est refusée (`twofa_session_required` : se reconnecter).
"""
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user, session_has_mfa, user_has_2fa
from src.models.user import User


def twofa_enforced() -> bool:
    """2FA exigée ? Production + TWOFA_ENFORCE_ADMIN (dev : auto-login admin conservé)."""
    return settings.is_production and settings.TWOFA_ENFORCE_ADMIN


async def access_problem(db: AsyncSession, user: Optional[User], request: Optional[Request]) -> Optional[str]:
    """Code de refus, ou None si l'accès est accordé. `request` None = pas de session
    navigateur à contrôler (jetons OAuth : la session a été contrôlée au consentement)."""
    if user is None or not user.is_active:
        return "auth_required"
    if not user.is_superadmin:
        return "superadmin_required"
    if twofa_enforced():
        if not await user_has_2fa(db, user):
            return "twofa_setup_required"
        if request is not None and not session_has_mfa(request):
            return "twofa_session_required"
    return None


MESSAGES = {
    "auth_required": "Connexion requise.",
    "superadmin_required": "Réservé au superadmin.",
    "twofa_setup_required": "Activez la double authentification sur chapote.fr (Profil → Sécurité).",
    "twofa_session_required": "Reconnectez-vous en validant la double authentification.",
}


def require_enabled() -> None:
    if not settings.EMAILS_ENABLED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


async def require_emails_admin(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dépendance des routes /api/emails/* (sauf /config et /access)."""
    require_enabled()
    problem = await access_problem(db, user, request)
    if problem:
        raise HTTPException(status.HTTP_403_FORBIDDEN, problem)
    return user
