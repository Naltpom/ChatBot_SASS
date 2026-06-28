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
from html import escape as _html_escape
from typing import TYPE_CHECKING, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.services.background import spawn_background

if TYPE_CHECKING:  # imports type-only (pas de cout/cycle a l'import runtime)
    from src.models.bot import Bot
    from src.models.conversation import Conversation
    from src.models.lead import Lead
    from src.models.user import User

logger = logging.getLogger(__name__)

# Reply-To des emails transactionnels de compte (confirmation / réinitialisation) :
# une réponse de l'utilisateur arrive sur le support plutôt que sur l'expéditeur
# technique (SMTP_FROM, souvent no-reply).
SUPPORT_EMAIL = "support@chapote.fr"
# Boîte commerciale (prospection sortante + Reply-To des cold emails) ET
# expéditeur des emails RELATIONNELS (bienvenue, invitation) : une adresse
# « humaine » tombe en onglet Principale de Gmail là où no-reply va en
# Notifications. Le système pur (confirmation, reset, facturation) reste sur
# SMTP_FROM (no-reply).
HELLO_EMAIL = "hello@chapote.fr"
HELLO_FROM = f"Chapote <{HELLO_EMAIL}>"
# Signature commune des emails compte/facturation FR.
EMAIL_SIGNATURE = "— L'équipe Chapote"


def _greeting(name: str) -> str:
    """Formule d'accueil FR commune aux emails personnalisés."""
    return f"Bonjour {name},"


def _role_fr(role: str) -> str:
    """Libellé FR d'un rôle d'équipe (admin -> administrateur·rice, sinon membre)."""
    return "administrateur·rice" if role == "admin" else "membre"


def _send_sync(to: list[str], subject: str, body: str,
               reply_to: Optional[str] = None,
               html: Optional[str] = None,
               from_addr: Optional[str] = None) -> None:
    msg = EmailMessage()
    # from_addr permet de surcharger l'expéditeur (ex. hello@ pour les emails
    # relationnels) ; défaut = SMTP_FROM (no-reply). L'auth SMTP reste SMTP_USER.
    msg["From"] = from_addr or settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = ", ".join(to)
    if reply_to:
        msg["Reply-To"] = reply_to
    # Defensif : un CR/LF dans un en-tete fait lever EmailMessage (ValueError)
    # et l'envoi serait perdu en silence (send_email avale l'exception) —
    # bot.name, non contraint, alimente les sujets des builders
    msg["Subject"] = " ".join(subject.split())
    # html fourni => multipart/alternative (texte = fallback, html = version riche).
    # Défaut None => texte brut, comportement inchangé.
    msg.set_content(body)
    if html is not None:
        msg.add_alternative(html, subtype="html")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
        smtp.send_message(msg)


async def send_email(to: list[str], subject: str, body: str,
                     reply_to: Optional[str] = None,
                     html: Optional[str] = None,
                     from_addr: Optional[str] = None) -> bool:
    """Envoi email. JAMAIS d'exception (appele en create_task) : SMTP non
    configure ou echec d'envoi => log + False. `reply_to` optionnel (defaut
    None). `html` optionnel : si fourni, l'email part en multipart/alternative
    (texte = fallback) ; défaut None = texte brut, comportement inchange.
    `from_addr` optionnel : surcharge l'expéditeur (défaut SMTP_FROM)."""
    if not settings.SMTP_HOST:
        logger.info("SMTP non configuré — email non envoyé : %s", subject)
        return False
    if not to:
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, body, reply_to, html, from_addr)
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


async def bot_owner_email(db: AsyncSession, bot: "Bot") -> Optional[str]:
    """Email du proprietaire (payeur) du bot, pour les notifications compte/
    facturation (suspension, plafond IA).

    - Bot PERSO (owner_user_id) : l'email de ce user.
    - Bot d'EQUIPE (organization_id) : l'email de l'owner de l'organisation.

    A appeler AVANT le spawn_background : la tache de fond ne touche pas la db."""
    from src.models.user import Organization, User

    if bot.owner_user_id is not None:
        owner = await db.get(User, bot.owner_user_id)
        return owner.email if owner else None
    if bot.organization_id is not None:
        org = await db.get(Organization, bot.organization_id)
        if org and org.owner_user_id is not None:
            owner = await db.get(User, org.owner_user_id)
            return owner.email if owner else None
    return None


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


def build_verify_email(user: "User", link: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) du mail de confirmation d'adresse email."""
    lines = [
        _greeting(user.name),
        "",
        "Merci d'avoir créé votre compte Chapote. Confirmez votre adresse email "
        "en ouvrant le lien ci-dessous :",
        "",
        link,
        "",
        "Ce lien est valable 48 heures. Si vous n'êtes pas à l'origine de cette "
        "inscription, vous pouvez ignorer ce message.",
        "",
        EMAIL_SIGNATURE,
    ]
    return ("Confirmez votre adresse email", "\n".join(lines))


def build_reset_email(user: "User", link: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) du mail de réinitialisation de mot de passe."""
    lines = [
        _greeting(user.name),
        "",
        "Vous avez demandé à réinitialiser le mot de passe de votre compte "
        "Chapote. Choisissez un nouveau mot de passe via le lien ci-dessous :",
        "",
        link,
        "",
        "Ce lien est valable 1 heure et ne fonctionne qu'une seule fois. Si vous "
        "n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot "
        "de passe actuel reste inchangé.",
        "",
        EMAIL_SIGNATURE,
    ]
    return ("Réinitialisation de votre mot de passe", "\n".join(lines))


def build_welcome_email(user: "User", app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) de bienvenue, envoyé après confirmation
    de l'adresse email."""
    lines = [
        _greeting(user.name),
        "",
        "Votre adresse email est confirmée : bienvenue chez Chapote !",
        "",
        "Vous pouvez dès maintenant créer votre premier chatbot et le mettre en "
        "ligne en quelques minutes :",
        "",
        f"{app_url}/app",
        "",
        "Une question ? Écrivez-nous, nous sommes là pour vous aider.",
        "",
        EMAIL_SIGNATURE,
    ]
    return ("Bienvenue chez Chapote", "\n".join(lines))


def build_invite_email(org_name: str, role: str, app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) d'une invitation à rejoindre une équipe.
    Pas de token : l'invitation se consomme par correspondance d'email à
    l'inscription."""
    role_fr = _role_fr(role)
    lines = [
        f"Vous êtes invité·e à rejoindre l'équipe « {org_name} » sur Chapote "
        f"en tant que {role_fr}.",
        "",
        "Pour accepter, créez votre compte avec cette même adresse email — vous "
        "rejoindrez automatiquement l'équipe :",
        "",
        f"{app_url}/register",
        "",
        "Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message.",
        "",
        EMAIL_SIGNATURE,
    ]
    return (f"Vous êtes invité·e à rejoindre {org_name} sur Chapote", "\n".join(lines))


def build_added_to_org_email(org_name: str, role: str, app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) pour un utilisateur EXISTANT ajouté
    directement comme membre d'une équipe."""
    role_fr = _role_fr(role)
    lines = [
        f"Vous avez été ajouté·e à l'équipe « {org_name} » sur Chapote "
        f"en tant que {role_fr}.",
        "",
        "Retrouvez l'équipe et ses chatbots depuis votre tableau de bord :",
        "",
        f"{app_url}/app",
        "",
        EMAIL_SIGNATURE,
    ]
    return (f"Vous avez été ajouté·e à {org_name}", "\n".join(lines))


def build_password_changed_email(user: "User", app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) — notification de sécurité après un
    changement de mot de passe."""
    lines = [
        _greeting(user.name),
        "",
        "Le mot de passe de votre compte Chapote vient d'être modifié.",
        "",
        "Si vous êtes à l'origine de ce changement, aucune action n'est requise.",
        "",
        "Dans le cas contraire, réinitialisez immédiatement votre mot de passe "
        "et contactez le support :",
        "",
        f"{app_url}/forgot-password",
        "",
        EMAIL_SIGNATURE,
    ]
    return ("Votre mot de passe a été modifié", "\n".join(lines))


def build_bot_suspended_email(bot: "Bot", reason: Optional[str],
                              app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) — notification de suspension d'un chatbot."""
    lines = [
        f"Votre chatbot « {bot.name} » a été suspendu : son widget n'est plus "
        "actif sur vos pages.",
    ]
    if reason:
        lines += ["", f"Motif : {reason}"]
    lines += [
        "",
        "Pour comprendre la situation et rétablir votre chatbot, contactez notre "
        f"support : {SUPPORT_EMAIL}",
        "",
        f"Votre tableau de bord : {app_url}/app",
        "",
        EMAIL_SIGNATURE,
    ]
    return (f"Votre chatbot « {bot.name} » a été suspendu", "\n".join(lines))


def build_overage_cap_email(bot: "Bot", app_url: str) -> tuple[str, str]:
    """(sujet, corps texte brut FR) — le bot a atteint son plafond de réponses
    IA facturables du mois (overage_cap)."""
    lines = [
        f"Votre chatbot « {bot.name} » a atteint son plafond de réponses IA "
        "pour ce mois-ci.",
        "",
        "En attendant le renouvellement mensuel, il ne génère plus de nouvelles "
        "réponses IA. Pour le réactiver immédiatement, ajustez votre plafond de "
        "facturation depuis votre tableau de bord :",
        "",
        f"{app_url}/app",
        "",
        f"Une question sur votre facturation ? Écrivez à {SUPPORT_EMAIL}.",
        "",
        EMAIL_SIGNATURE,
    ]
    return (f"Votre chatbot « {bot.name} » a atteint son plafond de réponses IA ce mois-ci",
            "\n".join(lines))


# --- Rendu HTML brandé (emails compte/facturation) --------------------------
# Couleurs de marque (inline, deliverability-safe : pas de <style>, pas de CSS
# externe — Gmail/Outlook strippent les feuilles de style).
_BRAND_NAVY = "#1C3F5C"
_BRAND_MINT = "#2F9E79"
_PAGE_BG = "#F0F2F5"
_TEXT_COLOR = "#1E2A32"
_MUTED_COLOR = "#8A98A6"
_CTA_LABEL = "Ouvrir le lien"


def _is_bare_url(line: str) -> bool:
    """Un paragraphe = une URL nue (rendu en bouton CTA) s'il ne contient qu'un
    lien http(s) sur une seule ligne."""
    return (
        "\n" not in line
        and (line.startswith("http://") or line.startswith("https://"))
        and " " not in line.strip()
    )


def render_email_html(text_body: str) -> str:
    """Transforme un corps texte brut en email HTML brandé (tables + styles
    inline, robuste Gmail/Outlook). Le texte est HTML-échappé (noms/bots peuvent
    contenir < ou &). Paragraphes séparés par lignes vides ; sauts de ligne
    simples => <br> ; un paragraphe réduit à une URL nue => bouton CTA mint."""
    paragraphs = [p for p in text_body.split("\n\n")]
    blocks: list[str] = []
    for para in paragraphs:
        stripped = para.strip()
        if not stripped:
            continue
        if _is_bare_url(stripped):
            url = _html_escape(stripped, quote=True)
            blocks.append(
                '<table role="presentation" cellpadding="0" cellspacing="0" '
                'border="0" style="margin:18px auto;"><tr><td '
                f'style="border-radius:10px;background:{_BRAND_MINT};">'
                f'<a href="{url}" target="_blank" '
                f'style="display:inline-block;padding:12px 22px;color:#ffffff;'
                f'font-weight:bold;font-size:15px;text-decoration:none;'
                f'border-radius:10px;">{_CTA_LABEL}</a></td></tr></table>'
            )
        else:
            html_para = _html_escape(para).replace("\n", "<br>")
            blocks.append(
                f'<p style="margin:0 0 16px 0;line-height:1.6;color:{_TEXT_COLOR};'
                f'font-size:15px;">{html_para}</p>'
            )
    body_html = "\n".join(blocks)
    font = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
            "Arial,sans-serif")
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '</head>'
        f'<body style="margin:0;padding:0;background:{_PAGE_BG};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="background:{_PAGE_BG};padding:24px 0;">'
        '<tr><td align="center">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        'border="0" style="width:560px;max-width:560px;background:#ffffff;'
        'border-radius:14px;overflow:hidden;'
        f'font-family:{font};">'
        # Header (wordmark)
        '<tr><td style="padding:24px 32px 8px 32px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td style="background:{_BRAND_NAVY};border-radius:8px;width:34px;'
        'height:34px;text-align:center;vertical-align:middle;color:#ffffff;'
        'font-size:18px;font-weight:bold;font-family:' + font + '">C</td>'
        f'<td style="padding-left:10px;color:{_BRAND_NAVY};font-size:20px;'
        f'font-weight:bold;font-family:{font};">Chapote</td>'
        '</tr></table></td></tr>'
        # Body
        f'<tr><td style="padding:8px 32px 8px 32px;">{body_html}</td></tr>'
        # Footer
        '<tr><td style="padding:8px 32px 28px 32px;">'
        f'<div style="border-top:1px solid #E6EAEE;margin-bottom:14px;"></div>'
        f'<div style="color:{_MUTED_COLOR};font-size:12.5px;line-height:1.6;'
        f'font-family:{font};">Chapote · https://chapote.fr<br>'
        'Une question ? support@chapote.fr</div>'
        '</td></tr>'
        '</table></td></tr></table></body></html>'
    )


def send_account_email(recipients: list[str], subject: str, text: str, *,
                       error_label: str, reply_to: str = SUPPORT_EMAIL,
                       from_addr: Optional[str] = None) -> None:
    """Envoi BRANDÉ (multipart/alternative) d'un email compte/facturation :
    construit la version HTML à partir du texte et planifie l'envoi en tâche de
    fond (fire-and-forget, ne bloque jamais l'endpoint). `reply_to` défaut
    support ; `from_addr` défaut None (= SMTP_FROM no-reply). Les emails
    RELATIONNELS (bienvenue, invitation) passent from_addr=HELLO_FROM +
    reply_to=HELLO_EMAIL pour mieux tomber en boîte Principale."""
    html = render_email_html(text)
    spawn_background(
        send_email(recipients, subject, text, reply_to=reply_to, html=html,
                   from_addr=from_addr),
        error_label=error_label)


def send_org_member_email(email: str, org_name: str, role: str, *,
                          existing: bool, app_url: str) -> None:
    """Notifie une personne ajoutée (compte existant) ou invitée (compte
    inexistant) à une équipe. Email BRANDÉ, fire-and-forget. Partagé entre
    l'inscription (auth.register) et l'invitation (orgs.invite_member)."""
    if existing:
        subject, body = build_added_to_org_email(org_name, role, app_url)
    else:
        subject, body = build_invite_email(org_name, role, app_url)
    # Email relationnel -> expéditeur hello@ (au lieu de no-reply) : meilleur
    # placement Gmail (Principale) et une réponse arrive sur une boîte suivie.
    send_account_email([email], subject, body, from_addr=HELLO_FROM,
                       reply_to=HELLO_EMAIL,
                       error_label="Envoi e-mail invitation échoué")
