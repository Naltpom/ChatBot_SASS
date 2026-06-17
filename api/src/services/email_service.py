"""Notifications email (leads, demandes de conseiller) via smtplib stdlib —
aucune dependance ajoutee.

smtplib est bloquant : l'envoi reel passe par asyncio.to_thread. SMTP_HOST
absent => fallback log. Contrat d'appel NON BLOQUANT : les destinataires sont
recuperes AVEC la session db de la requete, PUIS asyncio.create_task(
send_email(...)) — la tache de fond ne touche jamais la db.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import TYPE_CHECKING, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow

if TYPE_CHECKING:  # imports type-only (pas de cout/cycle a l'import runtime)
    from src.models.bot import Bot
    from src.models.conversation import Conversation
    from src.models.lead import Lead

logger = logging.getLogger(__name__)


def _send_sync(to: list[str], subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = ", ".join(to)
    # Defensif : un CR/LF dans un en-tete fait lever EmailMessage (ValueError)
    # et l'envoi serait perdu en silence (send_email avale l'exception) —
    # bot.name, non contraint, alimente les sujets des builders
    msg["Subject"] = " ".join(subject.split())
    msg.set_content(body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
        smtp.send_message(msg)


async def send_email(to: list[str], subject: str, body: str) -> bool:
    """Envoi texte brut. JAMAIS d'exception (appele en create_task) :
    SMTP non configure ou echec d'envoi => log + False."""
    if not settings.SMTP_HOST:
        logger.info("SMTP non configuré — email non envoyé : %s", subject)
        return False
    if not to:
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
        return True
    except Exception as exc:
        logger.error("Envoi email échoué (%s) : %s", subject, exc)
        return False


async def lead_notification_recipients(db: AsyncSession, bot: "Bot") -> list[str]:
    """Destinataires des notifications (leads, handoff, tickets) du bot, max 5.

    - Bot d'EQUIPE (organization_id) : emails des admins de l'org.
    - Bot PERSO (owner_user_id, pas d'org) : l'email du proprietaire.

    A appeler AVANT le create_task : la tache de fond ne doit jamais toucher la
    session db."""
    from src.models.user import Membership, User

    if bot.owner_user_id is not None:
        owner = await db.get(User, bot.owner_user_id)
        return [owner.email] if owner else []

    result = await db.execute(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.organization_id == bot.organization_id,
            Membership.role == "admin",
        )
        .limit(5)
    )
    return [row[0] for row in result.all()]


def build_lead_email(bot: "Bot", lead: "Lead") -> tuple[str, str]:
    """(sujet, corps texte brut FR) de la notification d'un nouveau lead."""
    lines = [
        f"Un visiteur a laissé ses coordonnées via le chatbot « {bot.name} ».",
        "",
        f"Email : {lead.email}",
    ]
    if lead.name:
        lines.append(f"Nom : {lead.name}")
    if lead.phone:
        lines.append(f"Téléphone : {lead.phone}")
    if lead.message:
        lines.append(f"Message : {lead.message}")
    lines.append(f"Source : {'formulaire du chat (arbre)' if lead.source == 'tree' else 'assistant IA'}")
    lines.append(f"Date : {lead.created_at:%d/%m/%Y %H:%M} UTC")
    return (f"Nouveau contact via votre chatbot {bot.name}", "\n".join(lines))


def build_ticket_email(bot: "Bot", ref: str, subject: str, summary: str,
                       email: Optional[str], name: Optional[str],
                       phone: Optional[str],
                       conversation_id: Optional[int]) -> tuple[str, str]:
    """(sujet, corps texte brut FR) d'un ticket ouvert par l'IA
    (action create_ticket). Destinataires : to_email de l'action ou
    lead_notification_recipients."""
    lines = [
        f"Un visiteur a ouvert un ticket via le chatbot « {bot.name} ».",
        "",
        f"Référence : {ref}",
        f"Sujet : {subject}",
        f"Résumé : {summary}",
    ]
    if email:
        lines.append(f"Email : {email}")
    if name:
        lines.append(f"Nom : {name}")
    if phone:
        lines.append(f"Téléphone : {phone}")
    if conversation_id:
        lines.append(f"Conversation : {conversation_id}")
    lines.append(f"Date : {utcnow():%d/%m/%Y %H:%M} UTC")
    return (f"Nouveau ticket via votre chatbot {bot.name} — {subject}", "\n".join(lines))


def build_handoff_email(bot: "Bot", conversation: "Conversation") -> tuple[str, str]:
    """(sujet, corps texte brut FR) quand un visiteur demande un conseiller
    (live chat). Memes destinataires que les leads : lead_notification_recipients."""
    when = conversation.human_requested_at or utcnow()
    lines = [
        f"Un visiteur demande à parler à un conseiller via le chatbot « {bot.name} ».",
        "",
        f"Conversation : {conversation.id}",
        f"Domaine : {conversation.domain}",
    ]
    if conversation.page_url:
        lines.append(f"Page : {conversation.page_url}")
    lines.append(f"Date : {when:%d/%m/%Y %H:%M} UTC")
    lines.append("")
    lines.append(f"Répondre depuis le dashboard : {settings.APP_URL}/app/bots/{bot.id}")
    return (f"Un visiteur demande un conseiller — {bot.name}", "\n".join(lines))
