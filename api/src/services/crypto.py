"""Chiffrement des secrets clients (cles BYOK, secret reCAPTCHA) en base.

Fernet symetrique avec ENCRYPTION_KEY de l'env. Les secrets ne sortent JAMAIS
de l'API : ni dans les reponses dashboard (masques), ni cote widget.
"""
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings

logger = logging.getLogger(__name__)

if settings.ENCRYPTION_KEY:
    _fernet = Fernet(settings.ENCRYPTION_KEY.encode())
else:
    # Dev uniquement : cle ephemere -> les secrets stockes sont perdus au restart
    logger.warning("ENCRYPTION_KEY absente : cle ephemere generee (dev seulement)")
    _fernet = Fernet(Fernet.generate_key())


def encrypt_secret(plain: Optional[str]) -> Optional[str]:
    if not plain:
        return None
    return _fernet.encrypt(plain.encode()).decode()


def decrypt_secret(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        logger.error("Secret indéchiffrable (ENCRYPTION_KEY changée ?)")
        return None
