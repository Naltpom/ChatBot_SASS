"""Chiffrement des mots de passe des boîtes mail (emails.chapote.fr).

Fernet avec une clé DÉDIÉE, MAILBOX_ENCRYPTION_KEY, jamais ENCRYPTION_KEY (secrets BYOK,
jetons TikTok…) : la fuite d'une clé n'ouvre pas l'autre coffre. Le mot de passe en clair
ne quitte jamais l'API : ni réponse JSON, ni journal, ni message d'erreur ; il n'existe en
mémoire que le temps d'une connexion IMAP / SMTP.
"""
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings

logger = logging.getLogger(__name__)

if settings.MAILBOX_ENCRYPTION_KEY:
    _fernet = Fernet(settings.MAILBOX_ENCRYPTION_KEY.encode())
else:
    # Dev uniquement (validate_production refuse de démarrer sans clé en prod si le module
    # est actif) : clé éphémère, les mots de passe enregistrés sont perdus au redémarrage.
    if settings.EMAILS_ENABLED:
        logger.warning("MAILBOX_ENCRYPTION_KEY absente : clé éphémère (dev seulement)")
    _fernet = Fernet(Fernet.generate_key())


def encrypt_password(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def decrypt_password(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        logger.error("Mot de passe de boîte indéchiffrable (MAILBOX_ENCRYPTION_KEY changée ?)")
        return None
