"""Execution des actions IA configurees par bot (Bot.actions_json).

Deux types :
- capture_lead : enregistre un Lead (source=ai) + notification email aux admins
- webhook      : POST signe HMAC-SHA256 vers l'URL https du client

Securite webhook (ne PAS copier le precedent laxiste de fetch_page_text) :
https uniquement, resolution DNS UNIQUE avec rejet des IP non publiques
(anti-SSRF : prive/loopback/link-local/reserve/multicast), connexion EPINGLEE
sur l'IP validee (anti DNS-rebinding TOCTOU : httpx ne re-resout pas l'hote,
le Host HTTP et le SNI TLS — verification du certificat comprise — restent le
hostname d'origine), aucun redirect suivi, timeout 10 s, reponse tronquee a
2000 chars avant retour au modele.
"""
import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import re
import time
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

import httpx

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_ARGS_CHARS = 4000
_MAX_RESULT_CHARS = 2000


class ActionError(Exception):
    pass


async def _resolve_public_ip(url: str) -> str:
    """https:// + resolution DNS UNIQUE : TOUTES les IP resolues doivent etre
    publiques (is_global exclut prive/loopback/link-local/reserve/multicast/
    unspecified), et la connexion se fera ensuite sur l'IP retournee — jamais
    de seconde resolution (anti DNS-rebinding TOCTOU)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ActionError("URL de webhook invalide (https:// requis)")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None)
    except OSError:
        raise ActionError("Hôte du webhook introuvable")
    ips: list = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            raise ActionError("Adresse du webhook non publique (refusée)")
        if not ip.is_global:
            raise ActionError("Adresse du webhook non publique (refusée)")
        ips.append(ip)
    if not ips:
        raise ActionError("Hôte du webhook introuvable")
    # IPv4 d'abord (chemin le plus repandu), sinon la premiere IPv6 validee
    for ip in ips:
        if ip.version == 4:
            return str(ip)
    return str(ips[0])


async def execute_action(action: dict, args: dict, bot, db=None,
                         conversation_id: Optional[str] = None) -> dict:
    """Execute une action demandee par le modele. Leve ActionError (message FR
    renvoye au modele en tool_result is_error) sur toute entree/issue invalide."""
    if len(json.dumps(args or {}, ensure_ascii=False)) > _MAX_ARGS_CHARS:
        raise ActionError("Arguments d'action trop volumineux")
    atype = action.get("type")
    if atype == "capture_lead":
        return await _capture_lead(args or {}, bot, db, conversation_id)
    if atype == "webhook":
        return await _webhook(action, args or {}, bot, conversation_id)
    raise ActionError(f"Type d'action inconnu : {atype}")


async def _capture_lead(args: dict, bot, db, conversation_id: Optional[str]) -> dict:
    from src.models.lead import Lead
    from src.services.email_service import (
        build_lead_email,
        lead_notification_recipients,
        send_email,
    )

    if db is None:
        raise ActionError("Capture de lead indisponible dans ce contexte")
    email = str(args.get("email") or "").strip()
    if len(email) > 254 or not _EMAIL_RE.fullmatch(email):
        raise ActionError("Email invalide")

    def _trunc(key: str, maxlen: int) -> Optional[str]:
        value = args.get(key)
        return str(value)[:maxlen] if value else None

    lead = Lead(
        bot_id=bot.id,
        conversation_id=conversation_id,
        source="ai",
        email=email.lower(),
        name=_trunc("name", 120),
        phone=_trunc("phone", 40),
        message=_trunc("message", 2000),
    )
    db.add(lead)
    await db.commit()

    # Destinataires recuperes AVANT le create_task (la tache ne touche pas la db)
    recipients = await lead_notification_recipients(db, bot)
    subject, body = build_lead_email(bot, lead)
    asyncio.create_task(send_email(recipients, subject, body))
    return {"ok": True, "lead_id": lead.id}


async def _webhook(action: dict, args: dict, bot, conversation_id: Optional[str]) -> Any:
    from src.services.crypto import decrypt_secret

    url = action.get("url") or ""
    ip = await _resolve_public_ip(url)

    # Connexion EPINGLEE sur l'IP validee (anti DNS-rebinding) : l'hote de
    # l'URL est remplace par l'IP, le Host HTTP et le SNI TLS (qui porte la
    # verification du certificat) restent le hostname d'origine.
    parsed = urlparse(url)
    hostname = parsed.hostname
    host_header = hostname if parsed.port in (None, 443) else f"{hostname}:{parsed.port}"
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    pinned_url = urlunparse(parsed._replace(netloc=netloc))

    # Corps canonique (cles triees, separateurs compacts) : c'est CE corps
    # exact que le destinataire doit verifier avec son secret HMAC.
    payload = json.dumps(
        {
            "action": action.get("name"),
            "bot_id": bot.id,
            "conversation_id": conversation_id,
            "args": args,
            "ts": int(time.time()),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()

    headers = {"Content-Type": "application/json", "Host": host_header}
    secret_encrypted = action.get("secret_encrypted")
    secret = decrypt_secret(secret_encrypted)
    if secret_encrypted and not secret:
        # Secret configure mais indechiffrable (ENCRYPTION_KEY changee ?) :
        # refuser explicitement plutot que d'envoyer NON signe en silence
        logger.error("Webhook %s : secret indéchiffrable, envoi refusé", action.get("name"))
        raise ActionError("Secret du webhook indéchiffrable — reconfigurez-le dans le dashboard")
    if secret:
        signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        headers["X-Kertios-Signature"] = f"sha256={signature}"

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            resp = await client.post(pinned_url, content=payload, headers=headers,
                                     extensions={"sni_hostname": hostname})
    except httpx.HTTPError as exc:
        logger.error("Webhook %s injoignable : %s", action.get("name"), exc)
        raise ActionError("Webhook injoignable")

    if 300 <= resp.status_code < 400:
        raise ActionError("Redirection refusée par sécurité")
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        logger.error("Webhook %s erreur %s : %s",
                     action.get("name"), resp.status_code, resp.text[:200])
        raise ActionError(f"Le webhook a renvoyé une erreur {resp.status_code}")

    # JSON parse si possible, sinon corps brut — toujours tronque avant retour
    # au modele (la reponse du webhook est une donnee non fiable).
    try:
        result = resp.json()
        if len(json.dumps(result, ensure_ascii=False)) <= _MAX_RESULT_CHARS:
            return result
    except ValueError:
        pass
    return {"status": resp.status_code, "body": resp.text[:_MAX_RESULT_CHARS]}
