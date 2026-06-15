"""Execution des actions IA configurees par bot (Bot.actions_json).

Cinq types :
- capture_lead   : enregistre un Lead (source=ai) + notification email aux admins
- webhook        : POST signe HMAC-SHA256 vers l'URL https du client
- handoff        : passe la conversation en attente d'un conseiller (live chat)
- create_ticket  : ouvre un ticket -> email structure (fallback log) aux admins
                   de l'org ou a l'adresse to_email de l'action
- calendar_slots : disponibilites Cal.com des 7 prochains jours (hote FIXE
                   https://api.cal.com, pas de SSRF dynamique, cle Fernet)

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
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo

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
    if atype == "handoff":
        return await _handoff(bot, db, conversation_id)
    if atype == "create_ticket":
        return await _create_ticket(action, args or {}, bot, db, conversation_id)
    if atype == "calendar_slots":
        return await _calendar_slots(action, bot)
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


async def _handoff(bot, db, conversation_id: Optional[str]) -> dict:
    """Action IA handoff : la conversation passe en attente d'un conseiller.

    La transition + notifications vivent dans routers/widget.py
    (trigger_handoff, source unique partagee avec POST /widget/handoff) —
    import paresseux : ce module n'importe jamais widget au chargement (pas
    de cycle, widget -> ai_service -> action_executor). Meme session db que
    le router : l'objet Conversation du router voit la mutation, et la
    reponse /message portera status='human_requested' (polling widget).
    """
    if db is None or conversation_id is None:
        raise ActionError("Mise en relation indisponible dans ce contexte")
    from src.models.conversation import Conversation
    from src.routers.widget import trigger_handoff

    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise ActionError("Mise en relation indisponible dans ce contexte")
    if conversation.status in ("human_requested", "human"):
        # Idempotent : deja en attente/en cours -> pas de re-notification
        return {"ok": True, "status": conversation.status}
    # trigger_handoff est garde en SQL : None = transition concurrente deja
    # faite (pas de re-notification) ; conversation rechargee dans les 2 cas
    await trigger_handoff(bot, conversation, db)
    return {"ok": True, "status": conversation.status}


async def _create_ticket(action: dict, args: dict, bot, db,
                         conversation_id: Optional[str]) -> dict:
    """Ticket support v1 : email structure (fallback log) aux admins de l'org
    ou a l'adresse to_email configuree sur l'action. Trace dans le transcript
    (source=system, pattern [lead]/[handoff]) + ack au modele."""
    from src.services.email_service import (
        build_ticket_email,
        lead_notification_recipients,
        send_email,
    )

    if db is None:
        raise ActionError("Ouverture de ticket indisponible dans ce contexte")
    # Blancs normalises (CR/LF compris) : le sujet vient du MODELE (donc
    # influençable par le visiteur) et part dans l'en-tete Subject — un saut
    # de ligne ferait lever EmailMessage et perdrait l'email en silence
    subject = " ".join(str(args.get("subject") or "").split())[:200]
    if not subject:
        raise ActionError("Le sujet du ticket est obligatoire")
    summary = str(args.get("summary") or "").strip()[:2000]
    if not summary:
        raise ActionError("Le résumé du ticket est obligatoire")
    email = str(args.get("email") or "").strip()
    if email and (len(email) > 254 or not _EMAIL_RE.fullmatch(email)):
        raise ActionError("Email invalide")

    def _trunc(key: str, maxlen: int) -> Optional[str]:
        value = args.get(key)
        return str(value)[:maxlen] if value else None

    name = _trunc("name", 120)
    phone = _trunc("phone", 40)
    ref = "TK-" + uuid.uuid4().hex[:8].upper()

    # Trace transcript (source=system : exclue de l'historique IA, des quotas
    # et des stats par convention). Import paresseux : pas de cycle.
    if conversation_id:
        from src.models.conversation import Message
        db.add(Message(conversation_id=conversation_id, bot_id=bot.id,
                       role="user", source="system",
                       content=f"[ticket] {ref} — {subject[:120]}"))
        await db.commit()

    # Destinataires recuperes AVANT le create_task (la tache ne touche pas la db)
    to = [action["to_email"]] if action.get("to_email") else \
        await lead_notification_recipients(db, bot)
    subject_mail, body = build_ticket_email(bot, ref, subject, summary,
                                            email or None, name, phone, conversation_id)
    asyncio.create_task(send_email(to, subject_mail, body))
    return {"ok": True, "ticket_ref": ref}


def _compact_slots(data: dict, tz: str) -> dict:
    """Compacte la reponse Cal.com en liste de creneaux pour le modele.
    Fonction PURE (testable sans reseau), parsing TOLERANT : v2
    {"data": {date: [{"start": iso}, ...]}}, v1 {"slots": {...}}, entrees
    dict ("start"/"time") ou chaines ISO nues ; entree illisible ignoree."""
    raw = data.get("data")
    if not isinstance(raw, dict):
        raw = data.get("slots")
    if not isinstance(raw, dict):
        raw = {}
    try:
        zone = ZoneInfo(tz)
    except Exception:
        zone = ZoneInfo("Europe/Paris")
    days: dict[str, list[str]] = {}
    total = 0
    for _, entries in sorted(raw.items()):
        if total >= 40:
            break
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if total >= 40:
                break
            if isinstance(entry, dict):
                value = entry.get("start") or entry.get("time")
            else:
                value = entry
            if not isinstance(value, str):
                continue
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dt.tzinfo is not None:
                dt = dt.astimezone(zone)
            day_key = dt.strftime("%Y-%m-%d")
            days.setdefault(day_key, []).append(dt.strftime("%H:%M"))
            total += 1
    if not days:
        return {"timezone": tz, "days": [],
                "message": "Aucun créneau disponible sur les 7 prochains jours"}
    return {"timezone": tz,
            "days": [{"date": d, "slots": slots} for d, slots in sorted(days.items())]}


async def _calendar_slots(action: dict, bot) -> dict:
    """Disponibilites Cal.com (~7 prochains jours). Hote FIXE https://api.cal.com
    (decision : pas de SSRF dynamique -> httpx direct autorise), cle en header
    uniquement (JAMAIS dans l'URL ni les logs), timeout 10 s, no redirect."""
    from src.services.crypto import decrypt_secret

    if not action.get("api_key_encrypted"):
        raise ActionError("Aucune clé API Cal.com configurée pour cette action "
                          "— ajoutez-la dans le dashboard")
    api_key = decrypt_secret(action.get("api_key_encrypted"))
    if not api_key:
        logger.error("Action %s : clé Cal.com indéchiffrable", action.get("name"))
        raise ActionError("Clé API Cal.com indéchiffrable — reconfigurez-la dans le dashboard")

    tz = action.get("timezone") or "Europe/Paris"
    start = datetime.now(timezone.utc)
    end = start + timedelta(days=7)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            resp = await client.get(
                "https://api.cal.com/v2/slots",
                params={
                    "eventTypeId": action.get("event_type_id"),
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "timeZone": tz,
                },
                headers={"Authorization": f"Bearer {api_key}",
                         "cal-api-version": "2024-09-04"},
            )
    except httpx.HTTPError as exc:
        # Jamais l'URL ni la cle dans le log : nom de l'action + classe d'erreur
        logger.error("Action %s : Cal.com injoignable (%s)",
                     action.get("name"), type(exc).__name__)
        raise ActionError("Cal.com injoignable")
    if resp.status_code in (401, 403):
        raise ActionError("La clé API Cal.com est invalide ou expirée")
    if resp.status_code != 200:
        raise ActionError(f"Cal.com a renvoyé une erreur {resp.status_code}")
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return _compact_slots(payload, tz)


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
        headers["X-Chapote-Signature"] = f"sha256={signature}"

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
