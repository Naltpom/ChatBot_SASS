"""Verification captcha au handshake /widget/session (jamais a chaque message).

Une interface, trois implementations selon la config du bot :
- turnstile    : defaut, nos cles (env), invisible, RGPD-friendly (defaut CNIL-ok)
- recaptcha_v3 : cles du client (site key publique + secret chiffre en base)
- disabled     : intranets / environnements fermes (les rate-limiters protegent toujours)
"""
import logging

import httpx

from src.core.config import settings
from src.models.bot import Bot
from src.services.crypto import decrypt_secret

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
RECAPTCHA_MIN_SCORE = 0.5


async def verify_captcha(bot: Bot, token: str | None, remote_ip: str | None) -> bool:
    provider = bot.captcha_provider

    if provider == "disabled":
        return True

    if provider == "turnstile":
        secret = settings.TURNSTILE_SECRET_KEY
        if not secret:
            # Pas de cle configuree cote SaaS (dev) -> on laisse passer en loggant
            logger.warning("Turnstile non configuré (TURNSTILE_SECRET_KEY absente) : vérification ignorée")
            return True
        return await _verify(TURNSTILE_VERIFY_URL, secret, token, remote_ip)

    if provider == "recaptcha_v3":
        secret = decrypt_secret(bot.captcha_secret_encrypted)
        if not secret:
            logger.error("Bot %s : reCAPTCHA actif mais secret manquant", bot.id)
            return False
        return await _verify(RECAPTCHA_VERIFY_URL, secret, token, remote_ip, check_score=True)

    logger.error("Bot %s : provider captcha inconnu '%s'", bot.id, provider)
    return False


async def verify_turnstile_token(token: str | None, remote_ip: str | None) -> bool:
    """Verifie un token Turnstile avec NOTRE cle SaaS, HORS contexte bot.

    Utilise par la demo publique (page /demo) : il n'y a pas de Bot, donc on
    s'appuie sur la cle globale TURNSTILE_SECRET_KEY (env). Cle absente (dev) =>
    on laisse passer en loggant (meme politique que verify_captcha pour le widget),
    pour ne pas casser le dev/CI sans Turnstile configure.
    """
    secret = settings.TURNSTILE_SECRET_KEY
    if not secret:
        logger.warning("Turnstile non configuré (TURNSTILE_SECRET_KEY absente) : vérification ignorée")
        return True
    return await _verify(TURNSTILE_VERIFY_URL, secret, token, remote_ip)


async def _verify(url: str, secret: str, token: str | None, remote_ip: str | None, check_score: bool = False) -> bool:
    if not token:
        return False
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, data=data)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPError as e:
        logger.error("Vérification captcha injoignable : %s", e)
        return False
    if not result.get("success"):
        return False
    if check_score and result.get("score", 0) < RECAPTCHA_MIN_SCORE:
        return False
    return True
