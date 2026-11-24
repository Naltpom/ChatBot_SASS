"""Boîtes mail d'emails.chapote.fr : préréglages, validation, sérialisation.

Préréglages (vérifiés auprès des fournisseurs) :
- « ovh-email-pro » : Email Pro OVH (contact@chapote.fr, voir docs/EMAILS.md),
  pro2.mail.ovh.net, IMAP 993 SSL, SMTP 587 STARTTLS. Copie des envois dans « Éléments
  envoyés » par APPEND (l'envoi SMTP ne la fait pas).
- « gmail » : imap.gmail.com:993 SSL, smtp.gmail.com:465 SSL, identifiant = adresse Gmail,
  mot de passe d'application (validation en 2 étapes requise). Gmail range lui-même les
  envois SMTP dans « Messages envoyés » : pas d'APPEND (sinon doublon).
"""
import re
from typing import Optional

from src.models.emails import Mailbox
from src.services.mail_client import MailboxConfig, MailError
from src.services.mailbox_crypto import decrypt_password

PRESETS: dict[str, dict] = {
    "ovh-email-pro": {
        "label": "Email Pro OVH",
        "imap_host": "pro2.mail.ovh.net", "imap_port": 993, "imap_tls": "ssl",
        "smtp_host": "pro2.mail.ovh.net", "smtp_port": 587, "smtp_tls": "starttls",
        "save_sent": True,
        "help": "Identifiant = adresse complète (ex. contact@chapote.fr), mot de passe de la boîte Email Pro.",
    },
    "gmail": {
        "label": "Gmail",
        "imap_host": "imap.gmail.com", "imap_port": 993, "imap_tls": "ssl",
        "smtp_host": "smtp.gmail.com", "smtp_port": 465, "smtp_tls": "ssl",
        "save_sent": False,
        "help": "Identifiant = adresse Gmail, mot de passe d'application (16 lettres, "
                "myaccount.google.com/apppasswords, validation en 2 étapes requise).",
    },
}

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$")
HOST_RE = re.compile(r"^[A-Za-z0-9.-]{1,253}$")


def config_of(mb: Mailbox) -> MailboxConfig:
    password = decrypt_password(mb.password_encrypted)
    if password is None:
        raise MailError("Mot de passe de la boîte illisible (clé de chiffrement changée ?) : "
                        "ressaisissez-le dans emails.chapote.fr.", "decrypt")
    return MailboxConfig(
        slug=mb.slug, address=mb.address, label=mb.label,
        imap_host=mb.imap_host, imap_port=mb.imap_port, imap_tls=mb.imap_tls,
        smtp_host=mb.smtp_host, smtp_port=mb.smtp_port, smtp_tls=mb.smtp_tls,
        username=mb.username, password=password, save_sent=mb.save_sent,
    )


def _dt(v) -> Optional[str]:
    return v.isoformat() + "Z" if v else None


def mailbox_out(mb: Mailbox) -> dict:
    """Jamais le mot de passe (ni chiffré) : seulement le fait qu'il existe."""
    return {
        "id": mb.id, "slug": mb.slug, "address": mb.address, "label": mb.label, "preset": mb.preset,
        "imap_host": mb.imap_host, "imap_port": mb.imap_port, "imap_tls": mb.imap_tls,
        "smtp_host": mb.smtp_host, "smtp_port": mb.smtp_port, "smtp_tls": mb.smtp_tls,
        "username": mb.username, "has_password": bool(mb.password_encrypted),
        "allow_send": mb.allow_send, "allow_delete": mb.allow_delete, "save_sent": mb.save_sent,
        "is_active": mb.is_active,
        "last_check_at": _dt(mb.last_check_at), "last_check_ok": mb.last_check_ok,
        "last_check_error": mb.last_check_error,
        "created_at": _dt(mb.created_at), "updated_at": _dt(mb.updated_at),
    }
