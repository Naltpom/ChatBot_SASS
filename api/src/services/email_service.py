"""Notifications email (leads, demandes de conseiller) via smtplib stdlib —
aucune dependance ajoutee.

smtplib est bloquant : l'envoi reel passe par asyncio.to_thread. SMTP_HOST
absent => fallback log. Contrat d'appel NON BLOQUANT : les destinataires sont
recuperes AVEC la session db de la requete, PUIS asyncio.create_task(
send_email(...)) — la tache de fond ne touche jamais la db.

------------------------------------------------------------------------------
REFONTE DESIGN (juin 2026) — emails « par catégorie » au lieu d'un template unique
------------------------------------------------------------------------------
Avant : un seul `render_email_html()` habillait TOUS les emails de la même coque
(logo + bouton vert « Ouvrir le lien »). Résultat : monotonie.

Maintenant : chaque email porte un `EmailTheme` (couleur de catégorie, libellé de
bouton, mise en page). Trois mises en page, toutes 100 % email-safe (tables +
styles inline, aucun <style>, aucune SVG inline — Gmail strippe les deux) :

  - "hero"   : grand bloc d'accueil coloré + emoji (moments joyeux : bienvenue,
               invitation).
  - "banner" : bandeau d'en-tête couleur pleine (onboarding / info : confirmation,
               ajout équipe, plafond IA).
  - "epure"  : sobre, pastille de catégorie + bouton coloré (sécurité / critique :
               reset, mot de passe modifié, suspension).

Le logo « chapeau » est un PNG EMBARQUÉ dans le mail en image inline (cid:) —
Gmail ne rend pas les SVG, et l'inline évite toute dépendance à un asset hébergé
(le logo s'affiche toujours, sans blocage « images distantes »). Les PNG sont
versionnés dans le package (`api/src/services/assets/icon.png` / `icon-white.png`).

Les notifications internes (lead / ticket / conseiller) restent en texte brut
(inchangé) — elles ne passent pas par ce rendu brandé.
"""
import asyncio
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache
from html import escape as _html_escape
from pathlib import Path
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
               from_addr: Optional[str] = None,
               inline_images: Optional[dict[str, bytes]] = None) -> None:
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
        # inline_images {cid: octets PNG} => attachés en multipart/related sur la
        # partie HTML, référencés par <img src="cid:..."> (logo embarqué). Le
        # Content-ID porte les chevrons <...> ; le HTML référence l'identifiant nu.
        if inline_images:
            html_part = msg.get_payload()[1]
            for cid, data in inline_images.items():
                html_part.add_related(data, "image", "png", cid=f"<{cid}>")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
        smtp.send_message(msg)


async def send_email(to: list[str], subject: str, body: str,
                     reply_to: Optional[str] = None,
                     html: Optional[str] = None,
                     from_addr: Optional[str] = None,
                     inline_images: Optional[dict[str, bytes]] = None) -> bool:
    """Envoi email. JAMAIS d'exception (appele en create_task) : SMTP non
    configure ou echec d'envoi => log + False. `reply_to` optionnel (defaut
    None). `html` optionnel : si fourni, l'email part en multipart/alternative
    (texte = fallback) ; défaut None = texte brut, comportement inchange.
    `from_addr` optionnel : surcharge l'expéditeur (défaut SMTP_FROM).
    `inline_images` optionnel : {cid: octets PNG} embarqués en multipart/related
    (ex. logo référencé par <img src="cid:...">)."""
    if not settings.SMTP_HOST:
        logger.info("SMTP non configuré — email non envoyé : %s", subject)
        return False
    if not to:
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, body, reply_to, html,
                                from_addr, inline_images)
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
    """(sujet, corps texte brut FR) — notification de suspension d'un chatbot.

    NB design : l'URL du tableau de bord est posée SEULE sur sa ligne (et non
    « tableau de bord : <url> ») pour devenir le bouton CTA themé. Le contact
    support reste en texte courant juste avant la signature."""
    lines = [
        f"Votre chatbot « {bot.name} » a été suspendu : son widget n'est plus "
        "actif sur vos pages.",
    ]
    if reason:
        lines += ["", f"Motif : {reason}"]
    lines += [
        "",
        "Rétablissez la situation depuis votre tableau de bord :",
        "",
        f"{app_url}/app",
        "",
        f"Pour comprendre la situation, écrivez à notre support : {SUPPORT_EMAIL}",
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


# ============================================================================
# Rendu HTML brandé « par catégorie » (emails compte/facturation)
# ============================================================================
# Couleurs inline, deliverability-safe : pas de <style>, pas de CSS externe, pas
# de SVG inline — Gmail/Outlook strippent feuilles de style ET SVG. Le logo est
# un PNG embarqué inline (cid:, voir plus bas). border-radius dégrade proprement
# (carré) sur les vieux Outlook. Aucune dépendance aux ombres/dégradés (non
# fiables en mail).

_BRAND_NAVY = "#1C3F5C"
_PAGE_BG = "#F0F2F5"
_TEXT_COLOR = "#1E2A32"
_MUTED_COLOR = "#8A98A6"
_HAIRLINE = "#E6EAEE"
_FONT = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
         "Arial,sans-serif")

# Logo « chapeau » en PNG (Gmail ne rend pas les SVG) EMBARQUÉ EN INLINE (cid:)
# plutôt que servi par une URL hébergée : l'image voyage DANS le mail, donc elle
# s'affiche toujours — aucune dépendance à un asset déployé ni à APP_URL, et pas
# de blocage « charger les images distantes » côté client. Les PNG sont versionnés
# dans le package API (api/src/services/assets/) pour rester self-contained.
_ASSETS_DIR = Path(__file__).parent / "assets"
LOGO_CID = "chapote-logo"          # logo navy (fond clair : hero / epure)
LOGO_WHITE_CID = "chapote-logo-w"  # logo blanc (bandeau couleur : banner)
LOGO_URL = f"cid:{LOGO_CID}"
LOGO_WHITE_URL = f"cid:{LOGO_WHITE_CID}"
# cid -> fichier PNG du logo (source unique pour l'embed inline).
_LOGO_FILES = {LOGO_CID: "icon.png", LOGO_WHITE_CID: "icon-white.png"}


@lru_cache(maxsize=2)
def _logo_bytes(filename: str) -> Optional[bytes]:
    """Octets d'un PNG logo (mémoïsé). None si introuvable (l'email part alors
    sans logo plutôt que d'échouer)."""
    try:
        return (_ASSETS_DIR / filename).read_bytes()
    except OSError as exc:
        logger.warning("Logo email introuvable (%s) : %s", filename, exc)
        return None


def _inline_logos_for(html: str) -> dict[str, bytes]:
    """{cid: octets PNG} des logos réellement référencés par `html` (on n'attache
    que ceux utilisés, pour ne pas faire apparaître d'image en pièce jointe).
    Match exact sur `src="cid:..."` — pas de collision de préfixe entre cids."""
    images: dict[str, bytes] = {}
    for cid, filename in _LOGO_FILES.items():
        if f'src="cid:{cid}"' in html and (data := _logo_bytes(filename)):
            images[cid] = data
    return images


@dataclass(frozen=True)
class EmailTheme:
    """Identité visuelle d'un email transactionnel.

    layout : 'hero' (accueil coloré + emoji), 'banner' (bandeau couleur) ou
    'epure' (sobre, pastille + bouton). accent : couleur de catégorie (bouton,
    bandeau, pastille). wash : fond clair du bloc hero / pastille. eyebrow :
    libellé de catégorie en majuscules. emoji : pictogramme (hero/banner). cta :
    libellé du bouton (remplace l'ancien « Ouvrir le lien »)."""
    accent: str
    wash: str = "#EEF2F6"
    eyebrow: str = ""
    eyebrow_color: str = _BRAND_NAVY
    emoji: str = ""
    cta: str = "Ouvrir le lien"
    layout: str = "epure"          # hero | banner | epure


# Thème par défaut (compat : rendu neutre proche de l'ancien si kind inconnu).
# accent/cta/layout = défauts de la dataclass.
DEFAULT_THEME = EmailTheme(accent="#2F9E79")

# Une entrée par email transactionnel. La clé = `kind` passé à send_account_email.
THEMES: dict[str, EmailTheme] = {
    # — Moments joyeux : hero + emoji —
    "welcome": EmailTheme(
        accent="#2F9E79", wash="#E7F4EF", eyebrow="BIENVENUE",
        eyebrow_color="#22825E", emoji="🎉", cta="Créer mon chatbot",
        layout="hero"),
    "invite": EmailTheme(
        accent="#5667C9", wash="#ECEEFB", eyebrow="INVITATION",
        eyebrow_color="#4453B0", emoji="👋", cta="Rejoindre l'équipe",
        layout="hero"),
    # — Onboarding / info : bandeau couleur —
    "verify": EmailTheme(
        accent="#2F9E79", wash="#E7F4EF", eyebrow="CONFIRMATION",
        eyebrow_color="#22825E", emoji="✉️", cta="Confirmer mon email",
        layout="banner"),
    "added": EmailTheme(
        accent="#5667C9", wash="#ECEEFB", eyebrow="ÉQUIPE",
        eyebrow_color="#4453B0", emoji="👥", cta="Ouvrir le tableau de bord",
        layout="banner"),
    "overage": EmailTheme(
        accent="#E0992F", wash="#FBF0DD", eyebrow="FACTURATION",
        eyebrow_color="#B5781D", emoji="📊", cta="Ajuster mon plafond",
        layout="banner"),
    # — Sécurité / critique : épuré —
    "reset": EmailTheme(
        accent="#2C6CA8", wash="#E7F0F8", eyebrow="SÉCURITÉ",
        eyebrow_color="#235A8E", cta="Choisir un nouveau mot de passe",
        layout="epure"),
    "password_changed": EmailTheme(
        accent="#2C6CA8", wash="#E7F0F8", eyebrow="SÉCURITÉ",
        eyebrow_color="#235A8E", cta="Sécuriser mon compte",
        layout="epure"),
    "suspended": EmailTheme(
        accent="#E25549", wash="#FCEAE8", eyebrow="ACTION REQUISE",
        eyebrow_color="#C0392B", cta="Ouvrir mon tableau de bord",
        layout="epure"),
}


def _is_bare_url(line: str) -> bool:
    """Un paragraphe = une URL nue (rendu en bouton CTA) s'il ne contient qu'un
    lien http(s) sur une seule ligne."""
    return (
        "\n" not in line
        and (line.startswith("http://") or line.startswith("https://"))
        and " " not in line.strip()
    )


def _button(url: str, label: str, color: str, *, pill: bool = False) -> str:
    """Bouton CTA « bulletproof » (table + bgcolor), email-safe."""
    radius = "999px" if pill else "10px"
    safe_url = _html_escape(url, quote=True)
    safe_label = _html_escape(label)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:20px auto 4px auto;"><tr>'
        f'<td bgcolor="{color}" style="border-radius:{radius};background:{color};">'
        f'<a href="{safe_url}" target="_blank" style="display:inline-block;'
        f'padding:13px 28px;color:#ffffff;font-weight:bold;font-size:15px;'
        f'text-decoration:none;border-radius:{radius};font-family:{_FONT};">'
        f'{safe_label}</a></td></tr></table>'
    )


def _render_blocks(text_body: str, theme: EmailTheme, *, center: bool,
                   pill_button: bool) -> str:
    """Paragraphes -> HTML. Une URL nue seule sur sa ligne => bouton CTA themé
    (libellé = theme.cta). Sauts de ligne simples => <br>."""
    align = "center" if center else "left"
    blocks: list[str] = []
    for para in text_body.split("\n\n"):
        stripped = para.strip()
        if not stripped:
            continue
        if _is_bare_url(stripped):
            blocks.append(_button(stripped, theme.cta, theme.accent,
                                  pill=pill_button))
        else:
            html_para = _html_escape(para).replace("\n", "<br>")
            blocks.append(
                f'<p style="margin:0 0 16px 0;line-height:1.6;color:{_TEXT_COLOR};'
                f'font-size:15px;text-align:{align};font-family:{_FONT};">'
                f'{html_para}</p>'
            )
    return "\n".join(blocks)


def _logo_header(theme: EmailTheme) -> str:
    """En-tête logo. Bandeau couleur (layout='banner') => logo blanc + wordmark
    blanc + emoji sur fond accent. Sinon => logo navy + wordmark navy sur blanc."""
    if theme.layout == "banner":
        emoji = (f'<td align="right" style="font-size:26px;line-height:1;">'
                 f'{theme.emoji}</td>') if theme.emoji else ''
        return (
            f'<tr><td bgcolor="{theme.accent}" '
            f'style="background:{theme.accent};padding:22px 32px;">'
            '<table role="presentation" width="100%" cellpadding="0" '
            'cellspacing="0" border="0"><tr>'
            f'<td><img src="{LOGO_WHITE_URL}" width="30" height="30" alt="" '
            'style="vertical-align:middle;border:0;display:inline-block;">'
            f'<span style="color:#ffffff;font-size:19px;font-weight:bold;'
            f'font-family:{_FONT};vertical-align:middle;padding-left:10px;">'
            f'Chapote</span></td>{emoji}</tr></table></td></tr>'
        )
    return (
        '<tr><td style="padding:24px 32px 4px 32px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
        f'<tr><td><img src="{LOGO_URL}" width="34" height="34" alt="" '
        'style="border-radius:8px;border:0;display:block;"></td>'
        f'<td style="padding-left:10px;color:{_BRAND_NAVY};font-size:20px;'
        f'font-weight:bold;font-family:{_FONT};">Chapote</td>'
        '</tr></table></td></tr>'
    )


def _eyebrow_line(theme: EmailTheme, *, spacing: str, upper: bool = False) -> str:
    """Eyebrow texte (hero/banner) : libellé catégorie coloré au-dessus du corps.
    `spacing` = letter-spacing ; `upper` ajoute text-transform:uppercase (banner)."""
    if not theme.eyebrow:
        return ''
    transform = "text-transform:uppercase;" if upper else ""
    return (
        f'<div style="color:{theme.eyebrow_color};font-size:11.5px;'
        f'font-weight:bold;letter-spacing:{spacing};margin:0 0 10px 0;'
        f'{transform}font-family:{_FONT};">{_html_escape(theme.eyebrow)}</div>'
    )


def _eyebrow_badge(theme: EmailTheme) -> str:
    """Pastille de catégorie (layout='epure')."""
    if not theme.eyebrow:
        return ''
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:0 0 14px 0;"><tr>'
        f'<td bgcolor="{theme.wash}" style="background:{theme.wash};'
        f'border-radius:999px;padding:6px 13px;color:{theme.eyebrow_color};'
        f'font-size:11.5px;font-weight:bold;letter-spacing:.06em;'
        f'white-space:nowrap;font-family:{_FONT};">{_html_escape(theme.eyebrow)}</td>'
        '</tr></table>'
    )


def _footer() -> str:
    return (
        '<tr><td style="padding:6px 32px 28px 32px;">'
        f'<div style="border-top:1px solid {_HAIRLINE};margin-bottom:14px;"></div>'
        f'<div style="color:{_MUTED_COLOR};font-size:12.5px;line-height:1.6;'
        f'font-family:{_FONT};">Chapote · https://chapote.fr<br>'
        'Une question ? support@chapote.fr</div></td></tr>'
    )


def _shell(inner: str) -> str:
    """Coque HTML commune (fond page + carte 560px centrée)."""
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '</head>'
        f'<body style="margin:0;padding:0;background:{_PAGE_BG};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="background:{_PAGE_BG};padding:24px 0;"><tr>'
        '<td align="center">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        'border="0" style="width:560px;max-width:560px;background:#ffffff;'
        f'border-radius:14px;overflow:hidden;font-family:{_FONT};">'
        f'{inner}'
        '</table></td></tr></table></body></html>'
    )


def render_email_html(text_body: str, *, theme: Optional[EmailTheme] = None) -> str:
    """Transforme un corps texte brut en email HTML brandé selon `theme`.

    Compat : `render_email_html(text)` sans thème => rendu neutre (DEFAULT_THEME),
    proche de l'ancien. Tables + styles inline, robuste Gmail/Outlook. Le texte
    est HTML-échappé. Une URL nue seule sur sa ligne => bouton CTA (libellé =
    theme.cta). Trois mises en page : hero / banner / epure (voir EmailTheme)."""
    th = theme or DEFAULT_THEME
    header = _logo_header(th)

    if th.layout == "hero":
        # Bloc d'accueil coloré : emoji + contenu centré sur fond wash.
        body = _render_blocks(text_body, th, center=True, pill_button=True)
        emoji = (f'<div style="font-size:46px;line-height:1;margin:0 0 10px 0;">'
                 f'{th.emoji}</div>') if th.emoji else ''
        eyebrow = _eyebrow_line(th, spacing=".08em")
        hero = (
            f'<tr><td bgcolor="{th.wash}" '
            f'style="background:{th.wash};padding:30px 36px 34px 36px;'
            'text-align:center;">'
            f'{emoji}{eyebrow}{body}</td></tr>'
        )
        inner = header + hero + _footer()
        return _shell(inner)

    if th.layout == "banner":
        body = _render_blocks(text_body, th, center=False, pill_button=False)
        eyebrow = _eyebrow_line(th, spacing=".06em", upper=True)
        block = (f'<tr><td style="padding:26px 32px 6px 32px;">'
                 f'{eyebrow}{body}</td></tr>')
        inner = header + block + _footer()
        return _shell(inner)

    # epure (défaut)
    body = _render_blocks(text_body, th, center=False, pill_button=False)
    block = (f'<tr><td style="padding:14px 32px 6px 32px;">'
             f'{_eyebrow_badge(th)}{body}</td></tr>')
    inner = header + block + _footer()
    return _shell(inner)


def _theme_for(kind: str) -> EmailTheme:
    """Thème d'un `kind`. Inconnu (hors `"default"`) => DEFAULT_THEME + warning :
    un kind mal orthographié à un call-site dégrade au rendu neutre sans planter,
    mais le warning rend la dérive observable au lieu d'invisible."""
    if kind not in THEMES and kind != "default":
        logger.warning("kind email inconnu '%s' — rendu neutre (DEFAULT_THEME)", kind)
    return THEMES.get(kind, DEFAULT_THEME)


def send_account_email(recipients: list[str], subject: str, text: str, *,
                       error_label: str, kind: str = "default",
                       reply_to: str = SUPPORT_EMAIL,
                       from_addr: Optional[str] = None) -> None:
    """Envoi BRANDÉ (multipart/alternative) d'un email compte/facturation.

    `kind` (NOUVEAU) sélectionne le thème dans THEMES (welcome, reset, verify,
    suspended, …). Inconnu/omis => DEFAULT_THEME (rendu neutre, compat). Le reste
    inchangé : `reply_to` défaut support ; `from_addr` défaut None (no-reply) ;
    fire-and-forget (ne bloque jamais l'endpoint)."""
    html = render_email_html(text, theme=_theme_for(kind))
    spawn_background(
        send_email(recipients, subject, text, reply_to=reply_to, html=html,
                   from_addr=from_addr, inline_images=_inline_logos_for(html)),
        error_label=error_label)


def send_org_member_email(email: str, org_name: str, role: str, *,
                          existing: bool, app_url: str) -> None:
    """Notifie une personne ajoutée (compte existant) ou invitée (compte
    inexistant) à une équipe. Email BRANDÉ, fire-and-forget. Partagé entre
    l'inscription (auth.register) et l'invitation (orgs.invite_member)."""
    if existing:
        subject, body = build_added_to_org_email(org_name, role, app_url)
        kind = "added"
    else:
        subject, body = build_invite_email(org_name, role, app_url)
        kind = "invite"
    # Email relationnel -> expéditeur hello@ (au lieu de no-reply) : meilleur
    # placement Gmail (Principale) et une réponse arrive sur une boîte suivie.
    send_account_email([email], subject, body, kind=kind, from_addr=HELLO_FROM,
                       reply_to=HELLO_EMAIL,
                       error_label="Envoi e-mail invitation échoué")
