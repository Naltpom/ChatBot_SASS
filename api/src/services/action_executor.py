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
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.bot import Bot
from src.services.background import spawn_background
from src.services.safe_fetch import FetchError, pin_url, resolve_public_ip

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MAX_ARGS_CHARS = 4000
_MAX_RESULT_CHARS = 2000
# Nombre max de créneaux Cal.com retenus lors du compactage (_compact_slots) :
# borne le contexte renvoyé au modèle.
SLOT_COMPACT_THRESHOLD = 40

# Notifications email envoyees en fire-and-forget (la reponse au modele ne doit
# pas attendre l'email).
def _spawn_email(coro) -> None:
    spawn_background(coro, error_label="Notification email en échec (tâche de fond)")


class ActionError(Exception):
    pass


def _trunc(args: dict, key: str, maxlen: int) -> Optional[str]:
    """Champ optionnel des args du modele, borne a maxlen ; None si absent/vide."""
    value = args.get(key)
    return str(value)[:maxlen] if value else None


async def _resolve_public_ip(url: str) -> str:
    """Resolution + validation anti-SSRF via safe_fetch.resolve_public_ip
    (logique UNIQUE : https://, resolution DNS unique, rejet des IP non
    publiques via is_global, IPv4 d'abord). Seule la couche de message change
    ici : la FetchError de safe_fetch est retraduite en ActionError avec le
    libelle « webhook » (contrat d'erreur renvoye au modele en tool_result
    is_error)."""
    try:
        return await resolve_public_ip(url)
    except FetchError as exc:
        msg = str(exc)
        if "https://" in msg:
            raise ActionError("URL de webhook invalide (https:// requis)")
        if "introuvable" in msg:
            raise ActionError("Hôte du webhook introuvable")
        raise ActionError("Adresse du webhook non publique (refusée)")


async def execute_action(action: dict, args: dict, bot: Bot,
                         db: Optional[AsyncSession] = None,
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


async def _capture_lead(args: dict, bot: Bot, db: Optional[AsyncSession],
                        conversation_id: Optional[str]) -> dict:
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

    lead = Lead(
        bot_id=bot.id,
        conversation_id=conversation_id,
        source="ai",
        email=email.lower(),
        name=_trunc(args, "name", 120),
        phone=_trunc(args, "phone", 40),
        message=_trunc(args, "message", 2000),
    )
    db.add(lead)
    await db.commit()

    # Destinataires recuperes AVANT le create_task (la tache ne touche pas la db)
    recipients = await lead_notification_recipients(db, bot)
    subject, body = build_lead_email(bot, lead)
    # Reply-To = email du visiteur : répondre au lead atterrit chez lui.
    _spawn_email(send_email(recipients, subject, body, reply_to=lead.email or None))
    return {"ok": True, "lead_id": lead.id}


async def _handoff(bot: Bot, db: Optional[AsyncSession],
                   conversation_id: Optional[str]) -> dict:
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

    # Module Live chat / Inbox requis pour declencher un handoff (spec §3.3,
    # runtime visiteur) : check BOOLEEN AMONT de trigger_handoff (jamais
    # d'exception dans la transition SQL). Sans le module, le handoff est refuse
    # proprement -> le modele recoit un tool_result neutre (pas un is_error :
    # le visiteur ne voit pas d'incident technique). Billing OFF / bot sans
    # entitlement -> ALL_UNLOCKED -> has_module True (invariant D0, comportement
    # actuel preserve). Import paresseux (coherent avec le reste du module).
    from src.services.entitlement_service import has_module, resolve
    from src.core.constants import MODULE_INBOX

    if not has_module(await resolve(db, bot), MODULE_INBOX):
        logger.info("billing: handoff refuse (module inbox absent) bot=%s", bot.id)
        return {"ok": False, "status": "unavailable",
                "message": "La mise en relation avec un conseiller n'est pas disponible."}

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


async def _create_ticket(action: dict, args: dict, bot: Bot,
                         db: Optional[AsyncSession],
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

    name = _trunc(args, "name", 120)
    phone = _trunc(args, "phone", 40)
    ref = "TK-" + uuid.uuid4().hex[:8].upper()

    # Trace transcript (source=system : par convention exclue de l'historique
    # IA et du comptage des questions visiteur — seules les sources de
    # VISITOR_SOURCES, "ai"/"tree", y entrent). Import paresseux : pas de cycle.
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
    # Reply-To = email du visiteur s'il l'a laissé (sinon None).
    _spawn_email(send_email(to, subject_mail, body, reply_to=email or None))
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
    except (ZoneInfoNotFoundError, ValueError) as exc:
        # timezone mal configurée (clé IANA inconnue, ou caractères invalides
        # type path-traversal) -> repli Europe/Paris, non bloquant
        logger.warning("Timezone Cal.com invalide (%r) : repli Europe/Paris (%s)", tz, exc)
        zone = ZoneInfo("Europe/Paris")
    days: dict[str, list[str]] = {}
    total = 0
    for _, entries in sorted(raw.items()):
        if total >= SLOT_COMPACT_THRESHOLD:
            break
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if total >= SLOT_COMPACT_THRESHOLD:
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


async def _calendar_slots(action: dict, bot: Bot) -> dict:
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


async def _webhook(action: dict, args: dict, bot: Bot,
                   conversation_id: Optional[str]) -> Any:
    from src.services.crypto import decrypt_secret

    url = action.get("url") or ""
    ip = await _resolve_public_ip(url)

    # Connexion EPINGLEE sur l'IP validee (anti DNS-rebinding) : helper PARTAGE
    # safe_fetch.pin_url — l'hote de l'URL est remplace par l'IP, le Host HTTP
    # et le SNI TLS (qui porte la verification du certificat) restent le
    # hostname d'origine.
    pinned_url, host_header, hostname = pin_url(url, ip)

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
