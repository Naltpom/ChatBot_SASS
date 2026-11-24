"""Client IMAP / SMTP des boîtes d'emails.chapote.fr (fonctions SYNCHRONES).

imaplib et smtplib sont bloquants : ces fonctions tournent dans un thread
(`run_blocking`, anyio.to_thread) pour ne jamais bloquer la boucle async, avec un délai
réseau par socket (EMAILS_IMAP_TIMEOUT) et un plafond global par opération. Une connexion
par appel (ouverte, utilisée, fermée) : aucun état entre requêtes, donc compatible avec
plusieurs workers uvicorn.

Sécurité :
- le mot de passe n'apparaît que dans `MailboxConfig.password` (exclu du repr) et dans
  l'appel LOGIN ; aucun message d'erreur ne le contient (les erreurs serveur sont réduites
  à une catégorie et à un texte rédigé ici) ;
- TLS vérifié (contexte par défaut : certificat et nom d'hôte) ;
- lecture sans marquer comme lu (BODY.PEEK), tailles plafonnées (messages, pièces jointes,
  textes renvoyés à Claude), en-têtes construits par EmailMessage (refuse CR/LF).

Identifiants : un message = (dossier, UID). Les noms de dossiers sont présentés décodés
(UTF-7 modifié IMAP -> Unicode) et réencodés à l'envoi.
"""
from __future__ import annotations

import base64
import email
import imaplib
import io
import logging
import re
import smtplib
import socket
import ssl
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from email import policy
from email.message import EmailMessage, Message
from email.utils import formataddr, formatdate, getaddresses, make_msgid, parseaddr, parsedate_to_datetime
from typing import Any, Callable, Iterator, Optional

import anyio

from src.core.config import settings

logger = logging.getLogger(__name__)

# --- Limites (tailles renvoyées à Claude et lues sur le serveur) ---
MAX_LIMIT = 50                      # résultats par recherche
MAX_UIDS = 100                      # messages par mark / move / trash
MAX_FETCH_BYTES = 20 * 1024 * 1024  # un message lu au-delà est tronqué
MAX_BODY_CHARS = 20_000             # corps renvoyé par get_message (défaut)
MAX_BODY_CHARS_HARD = 100_000
THREAD_MAX_MESSAGES = 30
THREAD_BODY_CHARS = 4_000
MAX_ATTACHMENT_TEXT = 50_000
MAX_ATTACHMENT_B64_BYTES = 2 * 1024 * 1024   # au-delà : pas de base64 (texte extrait seulement)
MAX_RECIPIENTS = 50
MAX_OUTGOING_BODY = 200_000
MAX_QUERY_CHARS = 300

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_EMAIL_RE = re.compile(r"^[^@\s<>\"',;]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# Repli par nom quand le serveur n'annonce pas SPECIAL-USE (RFC 6154). Comparé au dernier
# segment du nom, sans casse. OVH Email Pro (Exchange) nomme ses dossiers en français.
_SPECIAL_NAMES = {
    "sent": ("sent", "sent items", "sent messages", "sent mail", "envoyés", "éléments envoyés", "messages envoyés"),
    "drafts": ("drafts", "draft", "brouillons"),
    "trash": ("trash", "deleted items", "deleted messages", "corbeille", "éléments supprimés", "bin"),
    "junk": ("junk", "spam", "junk e-mail", "courrier indésirable", "pourriel"),
    "all": ("all mail", "tous les messages"),
    "archive": ("archive", "archives"),
}
_SPECIAL_FLAGS = {"\\sent": "sent", "\\drafts": "drafts", "\\trash": "trash", "\\junk": "junk",
                  "\\all": "all", "\\archive": "archive", "\\flagged": "flagged"}


class MailError(Exception):
    """Erreur présentable à Claude et à l'interface : `message` rédigé ici (jamais une
    réponse brute du serveur ni un secret), `code` = catégorie pour le journal d'audit."""

    def __init__(self, message: str, code: str = "server"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class MailboxConfig:
    """Copie détachée de l'ORM (utilisable dans un thread). Mot de passe déchiffré, exclu du repr."""
    slug: str
    address: str
    label: Optional[str]
    imap_host: str
    imap_port: int
    imap_tls: str
    smtp_host: str
    smtp_port: int
    smtp_tls: str
    username: str
    password: str = field(repr=False)
    save_sent: bool = True


# --------------------------------------------------------------------------
# Exécution hors de la boucle async
# --------------------------------------------------------------------------

async def run_blocking(fn: Callable[..., Any], *args: Any, budget: Optional[float] = None) -> Any:
    """Exécute `fn` dans un thread, avec un plafond global (plusieurs allers-retours réseau
    peuvent s'enchaîner : le délai par socket ne suffit pas)."""
    limit = budget or settings.EMAILS_IMAP_TIMEOUT * 4
    try:
        with anyio.fail_after(limit):
            return await anyio.to_thread.run_sync(lambda: fn(*args), abandon_on_cancel=True)
    except TimeoutError:
        raise MailError("Le serveur de messagerie met trop de temps à répondre. Réessayez.", "timeout")


# --------------------------------------------------------------------------
# UTF-7 modifié (noms de dossiers IMAP, RFC 3501 §5.1.3)
# --------------------------------------------------------------------------

def decode_folder(name: str) -> str:
    out, i = [], 0
    while i < len(name):
        c = name[i]
        if c == "&":
            j = name.find("-", i)
            if j == -1:
                out.append(name[i:])
                break
            chunk = name[i + 1:j]
            if not chunk:
                out.append("&")
            else:
                b64 = chunk.replace(",", "/")
                b64 += "=" * (-len(b64) % 4)
                try:
                    out.append(base64.b64decode(b64).decode("utf-16-be"))
                except Exception:
                    out.append(name[i:j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def encode_folder(name: str) -> str:
    out, buf = [], []

    def flush():
        if buf:
            raw = "".join(buf).encode("utf-16-be")
            out.append("&" + base64.b64encode(raw).decode().rstrip("=").replace("/", ",") + "-")
            buf.clear()

    for c in name:
        if 0x20 <= ord(c) <= 0x7E:
            flush()
            out.append("&-" if c == "&" else c)
        else:
            buf.append(c)
    flush()
    return "".join(out)


def _q(value: str) -> str:
    """Chaîne IMAP entre guillemets (ASCII seulement)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _qf(folder: str) -> str:
    return _q(encode_folder(folder))


# --------------------------------------------------------------------------
# Connexion IMAP
# --------------------------------------------------------------------------

def _tls_context() -> ssl.SSLContext:
    return ssl.create_default_context()


@contextmanager
def imap_session(cfg: MailboxConfig) -> Iterator[imaplib.IMAP4]:
    timeout = settings.EMAILS_IMAP_TIMEOUT
    conn: Optional[imaplib.IMAP4] = None
    try:
        if cfg.imap_tls == "ssl":
            conn = imaplib.IMAP4_SSL(cfg.imap_host, cfg.imap_port, ssl_context=_tls_context(), timeout=timeout)
        else:
            conn = imaplib.IMAP4(cfg.imap_host, cfg.imap_port, timeout=timeout)
            if cfg.imap_tls == "starttls":
                conn.starttls(ssl_context=_tls_context())
        conn.debug = 0
    except (socket.timeout, TimeoutError):
        raise MailError(f"Serveur IMAP {cfg.imap_host} injoignable (délai dépassé).", "timeout")
    except ssl.SSLError:
        raise MailError(f"Échec TLS avec {cfg.imap_host}:{cfg.imap_port} (port ou mode TLS ?).", "tls")
    except (OSError, imaplib.IMAP4.error):
        raise MailError(f"Serveur IMAP {cfg.imap_host}:{cfg.imap_port} injoignable.", "network")
    try:
        try:
            conn.login(cfg.username, cfg.password)
        except imaplib.IMAP4.error:
            raise MailError(
                "Connexion IMAP refusée : identifiant ou mot de passe incorrect "
                "(Gmail : mot de passe d'application requis, IMAP activé).", "auth_imap")
        conn._chapote_caps = _capabilities(conn)  # type: ignore[attr-defined]
        try:
            yield conn
        except (socket.timeout, TimeoutError):
            raise MailError("Le serveur IMAP ne répond plus (délai dépassé).", "timeout")
        except imaplib.IMAP4.abort:
            raise MailError("Connexion IMAP interrompue par le serveur. Réessayez.", "network")
        except imaplib.IMAP4.error:
            raise MailError("Le serveur IMAP a refusé la commande.", "server")
        except (ssl.SSLError, OSError):
            raise MailError("Connexion IMAP perdue.", "network")
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _capabilities(conn: imaplib.IMAP4) -> set[str]:
    try:
        typ, data = conn.capability()
        if typ == "OK" and data and data[0]:
            return {c.upper() for c in data[0].decode(errors="replace").split()}
    except Exception:
        pass
    return {str(c).upper() for c in getattr(conn, "capabilities", ())}


def _caps(conn: imaplib.IMAP4) -> set[str]:
    return getattr(conn, "_chapote_caps", set())


def _is_gmail(conn: imaplib.IMAP4) -> bool:
    return "X-GM-EXT-1" in _caps(conn)


def _ok(typ: str, data: Any, message: str, code: str = "server") -> Any:
    if typ != "OK":
        raise MailError(message, code)
    return data


# --------------------------------------------------------------------------
# Dossiers
# --------------------------------------------------------------------------

_LIST_RE = re.compile(r'^\((?P<flags>[^)]*)\)\s+(?P<delim>"(?:[^"\\]|\\.)*"|NIL)\s+(?P<name>.+)$', re.I)


def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return re.sub(r'\\(.)', r'\1', s[1:-1])
    return s


def list_folders_raw(conn: imaplib.IMAP4) -> list[dict]:
    typ, data = conn.list()
    _ok(typ, data, "Impossible de lister les dossiers.")
    folders = []
    for item in data or []:
        if item is None:
            continue
        if isinstance(item, tuple):          # nom envoyé en littéral : {n}\r\n<nom>
            head = item[0].decode(errors="replace")
            name_raw = item[1].decode(errors="replace")
            m = _LIST_RE.match(re.sub(r"\{\d+\}$", '""', head))
            if not m:
                continue
        else:
            line = item.decode(errors="replace")
            m = _LIST_RE.match(line)
            if not m:
                continue
            name_raw = _unquote(m.group("name"))
        flags = [f.lower() for f in m.group("flags").split()]
        if "\\noselect" in flags or "\\nonexistent" in flags:
            continue
        delim = _unquote(m.group("delim")) if m.group("delim").upper() != "NIL" else ""
        name = decode_folder(name_raw)
        special = next((_SPECIAL_FLAGS[f] for f in flags if f in _SPECIAL_FLAGS), None)
        if name.upper() == "INBOX":
            special = "inbox"
        folders.append({"name": name, "special": special, "delimiter": delim})
    # Repli par nom pour les dossiers sans attribut SPECIAL-USE.
    taken = {f["special"] for f in folders if f["special"]}
    for f in folders:
        if f["special"]:
            continue
        leaf = f["name"].split(f["delimiter"])[-1].lower() if f["delimiter"] else f["name"].lower()
        for kind, names in _SPECIAL_NAMES.items():
            if kind not in taken and leaf in names:
                f["special"] = kind
                taken.add(kind)
                break
    return folders


def _special_folder(conn: imaplib.IMAP4, kind: str, folders: Optional[list[dict]] = None) -> Optional[str]:
    for f in folders if folders is not None else list_folders_raw(conn):
        if f["special"] == kind:
            return f["name"]
    return None


def _check_folder(folders: list[dict], name: str) -> str:
    for f in folders:
        if f["name"] == name:
            return name
    for f in folders:                       # tolérance de casse (« inbox »)
        if f["name"].lower() == name.lower():
            return f["name"]
    names = ", ".join(f["name"] for f in folders[:30])
    raise MailError(f"Dossier « {name} » introuvable. Dossiers disponibles : {names}", "folder")


def _select(conn: imaplib.IMAP4, folder: str, readonly: bool = True) -> int:
    typ, data = conn.select(_qf(folder), readonly=readonly)
    if typ != "OK":
        raise MailError(f"Dossier « {folder} » introuvable ou inaccessible (list_folders donne les noms exacts).", "folder")
    try:
        return int(data[0])
    except Exception:
        return 0


# --------------------------------------------------------------------------
# Recherche et résumés
# --------------------------------------------------------------------------

def _imap_date(d: date) -> str:
    return f"{d.day:02d}-{_MONTHS[d.month - 1]}-{d.year}"


def parse_day(value: Optional[str], field_name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        raise MailError(f"{field_name} : date attendue au format AAAA-MM-JJ.", "invalid")


def _uid_search(conn: imaplib.IMAP4, criteria: list[tuple[str, Optional[str]]]) -> list[int]:
    """UID SEARCH. Valeurs ASCII entre guillemets ; une valeur accentuée part en littéral
    UTF-8 (imaplib n'accepte qu'un littéral, en fin de commande)."""
    parts: list[str] = []
    wide: list[tuple[str, str]] = []
    for key, val in criteria:
        if val is None:
            parts.append(key)
        elif val.isascii():
            parts += [key, _q(val)]
        else:
            wide.append((key, val))
    if len(wide) > 1:
        raise MailError("Un seul critère avec accents ou caractères spéciaux à la fois : "
                        "simplifiez un des champs.", "invalid")
    args: list[str] = []
    if wide:
        args += ["CHARSET", "UTF-8"]
    args += parts
    if wide:
        key, val = wide[0]
        args.append(key)
        conn.literal = val.encode("utf-8")
    if not args:
        args = ["ALL"]
    typ, data = conn.uid("SEARCH", *args)
    if typ != "OK":
        raise MailError("Recherche refusée par le serveur (critères non pris en charge ?).", "search")
    raw = b" ".join(d for d in data if d) if data else b""
    return sorted(int(x) for x in raw.split() if x.isdigit())


def _fetch_items(data: list) -> list[tuple[str, bytes]]:
    """Réponse FETCH -> [(métadonnées, littéral)]. Certaines métadonnées (FLAGS) peuvent
    suivre le littéral : elles sont recollées."""
    items: list[list] = []
    for part in data or []:
        if isinstance(part, tuple):
            items.append([part[0].decode(errors="replace"), part[1] or b""])
        elif isinstance(part, bytes) and items:
            items[-1][0] += " " + part.decode(errors="replace")
        elif isinstance(part, bytes):
            items.append([part.decode(errors="replace"), b""])
    return [(m, lit) for m, lit in items]


def _meta_int(meta: str, key: str) -> Optional[int]:
    m = re.search(rf"\b{key} (\d+)", meta)
    return int(m.group(1)) if m else None


def _meta_flags(meta: str) -> list[str]:
    m = re.search(r"FLAGS \(([^)]*)\)", meta)
    return m.group(1).split() if m else []


def _addr_list(value: Optional[str]) -> list[str]:
    if not value:
        return []
    out = []
    for name, addr in getaddresses([str(value)]):
        if addr:
            out.append(formataddr((name, addr)) if name else addr)
    return out


def _iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return parsedate_to_datetime(str(value)).isoformat()
    except Exception:
        return None


_SUMMARY_FIELDS = "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])"


def _summaries(conn: imaplib.IMAP4, uids: list[int], folder: str) -> list[dict]:
    if not uids:
        return []
    typ, data = conn.uid("FETCH", ",".join(str(u) for u in uids), _SUMMARY_FIELDS)
    _ok(typ, data, "Lecture des messages refusée par le serveur.")
    out = []
    for meta, lit in _fetch_items(data):
        uid = _meta_int(meta, "UID")
        if uid is None:
            continue
        h = email.message_from_bytes(lit, policy=policy.default)
        flags = _meta_flags(meta)
        out.append({
            "folder": folder,
            "uid": uid,
            "date": _iso(h.get("Date")),
            "from": _addr_list(h.get("From")),
            "to": _addr_list(h.get("To")),
            "cc": _addr_list(h.get("Cc")),
            "subject": str(h.get("Subject") or ""),
            "message_id": str(h.get("Message-ID") or "").strip() or None,
            "unread": "\\Seen" not in flags,
            "flagged": "\\Flagged" in flags,
            "size": _meta_int(meta, "RFC822.SIZE"),
        })
    out.sort(key=lambda m: m["uid"], reverse=True)
    return out


def search(cfg: MailboxConfig, *, folder: str = "INBOX", query: Optional[str] = None,
           from_: Optional[str] = None, to: Optional[str] = None, subject: Optional[str] = None,
           since: Optional[date] = None, before: Optional[date] = None, unseen: bool = False,
           limit: int = 20) -> dict:
    limit = max(1, min(int(limit or 20), MAX_LIMIT))
    for label, v in (("query", query), ("from", from_), ("to", to), ("subject", subject)):
        if v and len(v) > MAX_QUERY_CHARS:
            raise MailError(f"{label} : {MAX_QUERY_CHARS} caractères au plus.", "invalid")
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        folder = _check_folder(folders, folder)
        _select(conn, folder)
        criteria: list[tuple[str, Optional[str]]] = []
        if unseen:
            criteria.append(("UNSEEN", None))
        if since:
            criteria.append(("SINCE", _imap_date(since)))
        if before:
            criteria.append(("BEFORE", _imap_date(before)))
        if from_:
            criteria.append(("FROM", from_))
        if to:
            criteria.append(("TO", to))
        if subject:
            criteria.append(("SUBJECT", subject))
        if query:
            # Gmail : syntaxe de recherche Gmail (from:, has:attachment, older_than:…).
            criteria.append(("X-GM-RAW" if _is_gmail(conn) else "TEXT", query))
        uids = _uid_search(conn, criteria)
        page = uids[-limit:]
        return {"account": cfg.slug, "folder": folder, "total": len(uids),
                "messages": _summaries(conn, page, folder)}


def search_everywhere(cfg: MailboxConfig, query: str, since: Optional[date], limit: int) -> dict:
    """Recherche dans le dossier « Tous les messages » (Gmail) ou la boîte de réception."""
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        folder = _special_folder(conn, "all", folders) or _check_folder(folders, "INBOX")
        _select(conn, folder)
        criteria: list[tuple[str, Optional[str]]] = []
        if since:
            criteria.append(("SINCE", _imap_date(since)))
        criteria.append(("X-GM-RAW" if _is_gmail(conn) else "TEXT", query))
        uids = _uid_search(conn, criteria)
        return {"account": cfg.slug, "folder": folder, "total": len(uids),
                "messages": _summaries(conn, uids[-limit:], folder)}


# --------------------------------------------------------------------------
# Lecture d'un message
# --------------------------------------------------------------------------

def _fetch_raw(conn: imaplib.IMAP4, uid: int) -> tuple[bytes, list[str], bool]:
    typ, data = conn.uid("FETCH", str(uid), "(UID FLAGS RFC822.SIZE)")
    _ok(typ, data, "Lecture refusée par le serveur.")
    items = _fetch_items(data)
    if not items or _meta_int(items[0][0], "UID") is None:
        raise MailError(f"Message UID {uid} introuvable dans ce dossier.", "not_found")
    meta = items[0][0]
    size = _meta_int(meta, "RFC822.SIZE") or 0
    truncated = size > MAX_FETCH_BYTES
    section = f"BODY.PEEK[]<0.{MAX_FETCH_BYTES}>" if truncated else "BODY.PEEK[]"
    typ, data = conn.uid("FETCH", str(uid), f"(UID {section})")
    _ok(typ, data, "Lecture refusée par le serveur.")
    raw = next((lit for _m, lit in _fetch_items(data) if lit), b"")
    if not raw:
        raise MailError(f"Message UID {uid} introuvable dans ce dossier.", "not_found")
    return raw, _meta_flags(meta), truncated


def html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "head"]):
        tag.decompose()
    for br in soup.find_all("br"):
        br.replace_with("\n")
    text = soup.get_text("\n")
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _body_text(msg: Message) -> str:
    part = msg.get_body(preferencelist=("plain", "html")) if hasattr(msg, "get_body") else None
    if part is None:
        return ""
    try:
        content = part.get_content()
    except Exception:
        payload = part.get_payload(decode=True) or b""
        content = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    if part.get_content_subtype() == "html":
        return html_to_text(content)
    return content.strip()


def attachment_parts(msg: Message) -> list[Message]:
    """Pièces jointes (feuilles non textuelles ou marquées attachment / avec un nom), dans
    l'ordre du message : l'index sert à get_attachment."""
    body = msg.get_body(preferencelist=("plain", "html")) if hasattr(msg, "get_body") else None
    out = []
    for part in msg.walk():
        if part.is_multipart() or part is body:
            continue
        disp = (part.get_content_disposition() or "").lower()
        if disp == "attachment" or part.get_filename() or (
                disp != "inline" and part.get_content_maintype() not in ("text", "multipart")):
            out.append(part)
    return out


def _attachment_info(i: int, part: Message) -> dict:
    payload = part.get_payload(decode=True) or b""
    return {"index": i, "filename": part.get_filename() or f"piece-{i}", "content_type": part.get_content_type(),
            "size": len(payload)}


def _clip(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars] + "\n[… tronqué]", True


def get_message(cfg: MailboxConfig, folder: str, uid: int, max_chars: int = MAX_BODY_CHARS) -> dict:
    max_chars = max(500, min(int(max_chars or MAX_BODY_CHARS), MAX_BODY_CHARS_HARD))
    with imap_session(cfg) as conn:
        folder = _check_folder(list_folders_raw(conn), folder)
        _select(conn, folder)
        raw, flags, cut = _fetch_raw(conn, uid)
    msg = email.message_from_bytes(raw, policy=policy.default)
    body, clipped = _clip(_body_text(msg), max_chars)
    return {
        "account": cfg.slug, "folder": folder, "uid": uid,
        "date": _iso(msg.get("Date")),
        "from": _addr_list(msg.get("From")), "to": _addr_list(msg.get("To")),
        "cc": _addr_list(msg.get("Cc")), "reply_to": _addr_list(msg.get("Reply-To")),
        "subject": str(msg.get("Subject") or ""),
        "message_id": str(msg.get("Message-ID") or "").strip() or None,
        "in_reply_to": str(msg.get("In-Reply-To") or "").strip() or None,
        "unread": "\\Seen" not in flags, "flagged": "\\Flagged" in flags,
        "body": body, "body_truncated": clipped or cut,
        "attachments": [_attachment_info(i, p) for i, p in enumerate(attachment_parts(msg))],
    }


_MSGID_RE = re.compile(r"<[^<>\s]+>")


def get_thread(cfg: MailboxConfig, folder: str, uid: int) -> dict:
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        folder = _check_folder(folders, folder)
        _select(conn, folder)
        found: dict[tuple[str, int], None] = {}
        if _is_gmail(conn):
            typ, data = conn.uid("FETCH", str(uid), "(X-GM-THRID)")
            _ok(typ, data, "Lecture refusée par le serveur.")
            m = re.search(r"X-GM-THRID (\d+)", " ".join(
                (d.decode(errors="replace") if isinstance(d, bytes) else d[0].decode(errors="replace"))
                for d in data if d))
            if not m:
                raise MailError(f"Message UID {uid} introuvable dans ce dossier.", "not_found")
            where = _special_folder(conn, "all", folders) or folder
            _select(conn, where)
            typ, data = conn.uid("SEARCH", "X-GM-THRID", m.group(1))
            _ok(typ, data, "Recherche refusée par le serveur.", "search")
            for u in (b" ".join(d for d in data if d)).split():
                found[(where, int(u))] = None
        else:
            raw_h = _header_fields(conn, uid, "MESSAGE-ID REFERENCES IN-REPLY-TO")
            ids = []
            for key in ("References", "In-Reply-To", "Message-ID"):
                ids += _MSGID_RE.findall(str(raw_h.get(key) or ""))
            ids = list(dict.fromkeys(ids))[-20:]
            root = ids[0] if ids else None
            places = [folder] + [f for f in (_special_folder(conn, "sent", folders), "INBOX")
                                 if f and f != folder and any(x["name"] == f for x in folders)]
            for where in places:
                _select(conn, where)
                for mid in ids:
                    for u in _uid_search(conn, [("HEADER", None), ("Message-ID", mid)]):
                        found[(where, u)] = None
                if root:
                    for u in _uid_search(conn, [("HEADER", None), ("References", root)]):
                        found[(where, u)] = None
            found.setdefault((folder, uid), None)
        messages = []
        by_folder: dict[str, list[int]] = {}
        for where, u in found:
            by_folder.setdefault(where, []).append(u)
        for where, uids in by_folder.items():
            _select(conn, where)
            for u in sorted(uids)[-THREAD_MAX_MESSAGES:]:
                try:
                    raw, flags, _cut = _fetch_raw(conn, u)
                except MailError:
                    continue
                msg = email.message_from_bytes(raw, policy=policy.default)
                body, clipped = _clip(_body_text(msg), THREAD_BODY_CHARS)
                messages.append({
                    "folder": where, "uid": u, "date": _iso(msg.get("Date")),
                    "from": _addr_list(msg.get("From")), "to": _addr_list(msg.get("To")),
                    "subject": str(msg.get("Subject") or ""),
                    "message_id": str(msg.get("Message-ID") or "").strip() or None,
                    "unread": "\\Seen" not in flags, "body": body, "body_truncated": clipped,
                    "attachments": len(attachment_parts(msg)),
                })
    # Doublons (même Message-ID dans deux dossiers, ex. Gmail) puis ordre chronologique.
    seen, unique = set(), []
    for m in messages:
        key = m["message_id"] or (m["folder"], m["uid"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(m)
    unique.sort(key=lambda m: m["date"] or "")
    return {"account": cfg.slug, "count": len(unique), "messages": unique[-THREAD_MAX_MESSAGES:]}


def _header_fields(conn: imaplib.IMAP4, uid: int, fields: str) -> Message:
    typ, data = conn.uid("FETCH", str(uid), f"(UID BODY.PEEK[HEADER.FIELDS ({fields})])")
    _ok(typ, data, "Lecture refusée par le serveur.")
    items = _fetch_items(data)
    if not items or _meta_int(items[0][0], "UID") is None:
        raise MailError(f"Message UID {uid} introuvable dans ce dossier.", "not_found")
    return email.message_from_bytes(items[0][1], policy=policy.default)


def _pdf_text(payload: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(payload))
    chunks = []
    for page in reader.pages[:60]:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            continue
        if sum(len(c) for c in chunks) > MAX_ATTACHMENT_TEXT:
            break
    return "\n".join(chunks).strip()


_TEXTUAL = ("application/json", "application/xml", "application/csv", "application/x-yaml",
            "application/javascript", "message/rfc822")


def get_attachment(cfg: MailboxConfig, folder: str, uid: int, index: int) -> dict:
    with imap_session(cfg) as conn:
        folder = _check_folder(list_folders_raw(conn), folder)
        _select(conn, folder)
        raw, _flags, cut = _fetch_raw(conn, uid)
    msg = email.message_from_bytes(raw, policy=policy.default)
    parts = attachment_parts(msg)
    if not 0 <= index < len(parts):
        raise MailError(f"Pièce jointe n° {index} introuvable ({len(parts)} pièce(s) jointe(s), index à partir de 0).",
                        "not_found")
    part = parts[index]
    info = _attachment_info(index, part)
    payload = part.get_payload(decode=True) or b""
    ctype = info["content_type"]
    text: Optional[str] = None
    try:
        if ctype.startswith("text/") or ctype in _TEXTUAL or info["filename"].lower().endswith((".txt", ".csv", ".md", ".json", ".xml", ".ics")):
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            if ctype == "text/html":
                text = html_to_text(text)
        elif ctype == "application/pdf" or info["filename"].lower().endswith(".pdf"):
            text = _pdf_text(payload)
    except Exception:
        text = None
    out = {**info, "account": cfg.slug, "folder": folder, "uid": uid, "message_truncated": cut}
    if text:
        out["text"], out["text_truncated"] = _clip(text, MAX_ATTACHMENT_TEXT)
        return out
    if len(payload) > MAX_ATTACHMENT_B64_BYTES:
        raise MailError(
            f"Pièce jointe trop lourde pour être transmise ({len(payload) // 1024} Ko, "
            f"limite {MAX_ATTACHMENT_B64_BYTES // 1024} Ko) et texte non extractible.", "too_large")
    out["base64"] = base64.b64encode(payload).decode()
    return out


# --------------------------------------------------------------------------
# Rédaction et envoi
# --------------------------------------------------------------------------

def _clean_recipients(values: Optional[list[str]], label: str) -> list[str]:
    out = []
    for v in values or []:
        v = (v or "").strip()
        if not v:
            continue
        if "\n" in v or "\r" in v:
            raise MailError(f"{label} : adresse invalide.", "invalid")
        name, addr = parseaddr(v)
        if not _EMAIL_RE.match(addr or ""):
            raise MailError(f"{label} : adresse invalide « {v[:80]} ».", "invalid")
        out.append(formataddr((name, addr)) if name else addr)
    return out


@dataclass
class Draft:
    to: list[str]
    subject: str
    body: str
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)
    html: Optional[str] = None
    reply_folder: Optional[str] = None
    reply_uid: Optional[int] = None


def _build_message(conn: Optional[imaplib.IMAP4], cfg: MailboxConfig, d: Draft, folders: list[dict]) -> EmailMessage:
    to = _clean_recipients(d.to, "to")
    cc = _clean_recipients(d.cc, "cc")
    bcc = _clean_recipients(d.bcc, "bcc")
    subject = (d.subject or "").replace("\r", " ").replace("\n", " ").strip()[:500]
    if len(d.body or "") > MAX_OUTGOING_BODY or len(d.html or "") > MAX_OUTGOING_BODY:
        raise MailError(f"Corps trop long ({MAX_OUTGOING_BODY} caractères au plus).", "invalid")
    msg = EmailMessage(policy=policy.SMTP)
    if d.reply_uid is not None and conn is not None:
        rf = _check_folder(folders, d.reply_folder or "INBOX")
        _select(conn, rf)
        orig = _header_fields(conn, d.reply_uid, "MESSAGE-ID REFERENCES SUBJECT FROM REPLY-TO")
        mid = str(orig.get("Message-ID") or "").strip()
        if mid:
            refs = " ".join(_MSGID_RE.findall(str(orig.get("References") or "")) + [mid])
            msg["In-Reply-To"] = mid
            msg["References"] = refs[-2000:]
        if not to:
            to = _addr_list(orig.get("Reply-To")) or _addr_list(orig.get("From"))
        if not subject:
            subject = str(orig.get("Subject") or "")
        if subject and not re.match(r"^(re|ré|aw|sv)\s*:", subject, re.I):
            subject = f"Re: {subject}"
    if not to and not cc and not bcc:
        raise MailError("Au moins un destinataire est requis (to, cc ou bcc).", "invalid")
    if len(to) + len(cc) + len(bcc) > MAX_RECIPIENTS:
        raise MailError(f"{MAX_RECIPIENTS} destinataires au plus.", "invalid")
    msg["From"] = formataddr((cfg.label, cfg.address)) if cfg.label else cfg.address
    if to:
        msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if bcc:
        msg["Bcc"] = ", ".join(bcc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=cfg.address.rsplit("@", 1)[-1])
    msg.set_content(d.body or "")
    if d.html:
        msg.add_alternative(d.html, subtype="html")
    return msg


def _append(conn: imaplib.IMAP4, folder: str, msg: EmailMessage, flags: str) -> Optional[int]:
    typ, data = conn.append(_qf(folder), flags, imaplib.Time2Internaldate(time.time()), msg.as_bytes())
    _ok(typ, data, f"Enregistrement dans « {folder} » refusé par le serveur.", "append")
    m = re.search(rb"APPENDUID \d+ (\d+)", b" ".join(x for x in data if isinstance(x, bytes)))
    return int(m.group(1)) if m else None


def create_draft(cfg: MailboxConfig, d: Draft) -> dict:
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        drafts = _special_folder(conn, "drafts", folders)
        if not drafts:
            raise MailError("Aucun dossier Brouillons trouvé sur cette boîte.", "folder")
        msg = _build_message(conn, cfg, d, folders)
        uid = _append(conn, drafts, msg, "(\\Draft \\Seen)")
    return {"account": cfg.slug, "folder": drafts, "uid": uid, "message_id": msg["Message-ID"],
            "to": _addr_list(msg.get("To")), "subject": str(msg["Subject"])}


def envelope_recipients(msg: EmailMessage) -> list[str]:
    """Destinataires de l'enveloppe SMTP (To + Cc + Bcc). Jamais d'en-tête vide passé à
    getaddresses : en mode strict (Python ≥ 3.11.10, CVE-2023-27043), une liste contenant des
    chaînes vides peut être jugée incohérente et réduite à [('', '')], soit aucun destinataire."""
    headers = [str(msg[h]) for h in ("To", "Cc", "Bcc") if msg.get(h)]
    return list(dict.fromkeys(a for _n, a in getaddresses(headers) if a))


_ADDR_IN_TEXT = re.compile(r"[^\s<>\"',;:]+@[^\s<>\"',;:]+")


def _smtp_text(raw: Any) -> str:
    """Réponse du serveur SMTP pour le journal : décodée, tronquée, adresses masquées."""
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw or "")
    return _ADDR_IN_TEXT.sub("***", " ".join(text.split()))[:200]


def _log_refusal(cfg: MailboxConfig, stage: str, replies: list[tuple[Any, Any]]) -> list[str]:
    codes = sorted({str(c) for c, _t in replies})
    logger.warning("emails smtp : refus %s sur %s (%s) %s", stage, cfg.smtp_host, ", ".join(codes),
                   " | ".join(_smtp_text(t) for _c, t in replies[:5]))
    return codes


def _smtp_send(cfg: MailboxConfig, msg: EmailMessage) -> dict[str, tuple[int, bytes]]:
    """Envoie ; renvoie les destinataires refusés quand une partie seulement l'est (le message
    est alors PARTI pour les autres : ce n'est pas une erreur, l'appelant le signale)."""
    timeout = settings.EMAILS_IMAP_TIMEOUT
    rcpts = envelope_recipients(msg)
    if not rcpts:
        raise MailError("Aucun destinataire valide.", "invalid")
    server: Optional[smtplib.SMTP] = None
    try:
        if cfg.smtp_tls == "ssl":
            server = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=timeout, context=_tls_context())
        else:
            server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=timeout)
            server.ehlo()
            if cfg.smtp_tls == "starttls":
                server.starttls(context=_tls_context())
                server.ehlo()
        server.set_debuglevel(0)
        try:
            server.login(cfg.username, cfg.password)
        except smtplib.SMTPAuthenticationError:
            raise MailError("Connexion SMTP refusée : identifiant ou mot de passe incorrect.", "auth_smtp")
        refused = server.send_message(msg, from_addr=cfg.address, to_addrs=rcpts) or {}
        if refused:
            _log_refusal(cfg, "partiel RCPT", list(refused.values()))
        return refused
    except MailError:
        raise
    except smtplib.SMTPRecipientsRefused as e:
        codes = _log_refusal(cfg, "RCPT", list(e.recipients.values()))
        raise MailError(f"Tous les destinataires ont été refusés par le serveur SMTP (code {', '.join(codes)}).",
                        "smtp_refused")
    except smtplib.SMTPSenderRefused as e:
        codes = _log_refusal(cfg, "MAIL FROM", [(e.smtp_code, e.smtp_error)])
        raise MailError(f"Adresse d'expédition {cfg.address} refusée par le serveur SMTP (code {codes[0]}).",
                        "smtp_refused")
    except smtplib.SMTPDataError as e:
        codes = _log_refusal(cfg, "DATA", [(e.smtp_code, e.smtp_error)])
        raise MailError(f"Message refusé par le serveur SMTP après envoi du contenu (code {codes[0]}).",
                        "smtp_refused")
    except (socket.timeout, TimeoutError):
        raise MailError(f"Serveur SMTP {cfg.smtp_host} : délai dépassé.", "timeout")
    except ssl.SSLError:
        raise MailError(f"Échec TLS avec {cfg.smtp_host}:{cfg.smtp_port} (port ou mode TLS ?).", "tls")
    except smtplib.SMTPResponseException as e:
        codes = _log_refusal(cfg, "réponse", [(e.smtp_code, e.smtp_error)])
        raise MailError(f"Envoi impossible via {cfg.smtp_host}:{cfg.smtp_port} (code {codes[0]}).", "smtp")
    except (smtplib.SMTPException, OSError) as e:
        logger.warning("emails smtp : échec sur %s (%s)", cfg.smtp_host, type(e).__name__)
        raise MailError(f"Envoi impossible via {cfg.smtp_host}:{cfg.smtp_port}.", "smtp")
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass


def send(cfg: MailboxConfig, d: Draft) -> dict:
    """Envoi SMTP puis, si `save_sent`, copie dans « Envoyés » (APPEND). La copie est faite
    après l'envoi : un échec d'APPEND est signalé sans faire croire que l'envoi a échoué."""
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        msg = _build_message(conn, cfg, d, folders)
        sent_folder = _special_folder(conn, "sent", folders)
        refused = _smtp_send(cfg, msg)
        copied, warning = None, None
        if cfg.save_sent:
            if not sent_folder:
                warning = "Message envoyé, mais aucun dossier Envoyés trouvé pour la copie."
            else:
                try:
                    copied = _append(conn, sent_folder, msg, "(\\Seen)")
                except MailError:
                    warning = "Message envoyé, mais la copie dans Envoyés a échoué."
    out = {"account": cfg.slug, "sent": True, "message_id": msg["Message-ID"],
           "to": _addr_list(msg.get("To")), "subject": str(msg["Subject"]),
           "sent_folder": sent_folder, "sent_copy_uid": copied}
    if refused:
        out["refused"] = [{"address": a, "code": c} for a, (c, _t) in refused.items()]
        part = f"Envoyé, sauf à {len(refused)} destinataire(s) refusé(s) par le serveur : ne pas renvoyer aux autres."
        warning = f"{part} {warning}" if warning else part
    if warning:
        out["warning"] = warning
    return out


# --------------------------------------------------------------------------
# Indicateurs, déplacement, corbeille
# --------------------------------------------------------------------------

def _uid_set(uids: list[int]) -> str:
    clean = sorted({int(u) for u in uids or [] if int(u) > 0})
    if not clean:
        raise MailError("Aucun UID valide.", "invalid")
    if len(clean) > MAX_UIDS:
        raise MailError(f"{MAX_UIDS} messages au plus par appel.", "invalid")
    return ",".join(str(u) for u in clean)


def mark(cfg: MailboxConfig, folder: str, uids: list[int], read: Optional[bool], flagged: Optional[bool]) -> dict:
    if read is None and flagged is None:
        raise MailError("Indiquez read et/ou flagged.", "invalid")
    uset = _uid_set(uids)
    with imap_session(cfg) as conn:
        folder = _check_folder(list_folders_raw(conn), folder)
        _select(conn, folder, readonly=False)
        for flag, on in (("\\Seen", read), ("\\Flagged", flagged)):
            if on is None:
                continue
            typ, data = conn.uid("STORE", uset, "+FLAGS.SILENT" if on else "-FLAGS.SILENT", f"({flag})")
            _ok(typ, data, "Modification refusée par le serveur.")
    return {"account": cfg.slug, "folder": folder, "uids": [int(u) for u in uset.split(",")],
            "read": read, "flagged": flagged}


def _move(conn: imaplib.IMAP4, uset: str, dest: str) -> None:
    if "MOVE" in _caps(conn):
        typ, data = conn.uid("MOVE", uset, _qf(dest))
        _ok(typ, data, f"Déplacement vers « {dest} » refusé par le serveur.")
        return
    typ, data = conn.uid("COPY", uset, _qf(dest))
    _ok(typ, data, f"Copie vers « {dest} » refusée par le serveur.")
    typ, data = conn.uid("STORE", uset, "+FLAGS.SILENT", "(\\Deleted)")
    _ok(typ, data, "Suppression de l'original refusée par le serveur.")
    if "UIDPLUS" in _caps(conn):
        conn.uid("EXPUNGE", uset)
    else:
        conn.expunge()


def move(cfg: MailboxConfig, folder: str, uids: list[int], destination: str, *, allow_delete: bool) -> dict:
    uset = _uid_set(uids)
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        folder = _check_folder(folders, folder)
        dest = _check_folder(folders, destination)
        if dest == folder:
            raise MailError("Le dossier de destination est le dossier d'origine.", "invalid")
        if not allow_delete and dest == _special_folder(conn, "trash", folders):
            raise MailError("La corbeille n'est pas autorisée pour cette boîte (droit « suppression » désactivé).",
                            "forbidden")
        _select(conn, folder, readonly=False)
        _move(conn, uset, dest)
    return {"account": cfg.slug, "from_folder": folder, "to_folder": dest,
            "uids": [int(u) for u in uset.split(",")]}


def trash(cfg: MailboxConfig, folder: str, uids: list[int]) -> dict:
    """Déplace dans la corbeille (jamais de suppression définitive)."""
    uset = _uid_set(uids)
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        folder = _check_folder(folders, folder)
        dest = _special_folder(conn, "trash", folders)
        if not dest:
            raise MailError("Aucune corbeille trouvée sur cette boîte.", "folder")
        if dest == folder:
            raise MailError("Ces messages sont déjà dans la corbeille ; la suppression définitive n'est pas proposée.",
                            "forbidden")
        _select(conn, folder, readonly=False)
        _move(conn, uset, dest)
    return {"account": cfg.slug, "from_folder": folder, "to_folder": dest,
            "uids": [int(u) for u in uset.split(",")]}


def list_folders(cfg: MailboxConfig) -> dict:
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
    return {"account": cfg.slug,
            "folders": [{"name": f["name"], "special": f["special"]} for f in folders]}


def check_connection(cfg: MailboxConfig, smtp: bool = True) -> dict:
    """Test de l'interface : connexion IMAP (et nombre de dossiers), puis SMTP (EHLO + LOGIN)."""
    with imap_session(cfg) as conn:
        folders = list_folders_raw(conn)
        caps = _caps(conn)
    out: dict[str, Any] = {"imap": True, "folders": len(folders),
                           "special": {k: _special_from(folders, k) for k in ("sent", "drafts", "trash")},
                           "gmail": "X-GM-EXT-1" in caps}
    if smtp:
        timeout = settings.EMAILS_IMAP_TIMEOUT
        server: Optional[smtplib.SMTP] = None
        try:
            if cfg.smtp_tls == "ssl":
                server = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=timeout, context=_tls_context())
            else:
                server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=timeout)
                server.ehlo()
                if cfg.smtp_tls == "starttls":
                    server.starttls(context=_tls_context())
                    server.ehlo()
            server.login(cfg.username, cfg.password)
        except smtplib.SMTPAuthenticationError:
            raise MailError("IMAP OK, mais connexion SMTP refusée (identifiant ou mot de passe).", "auth_smtp")
        except (socket.timeout, TimeoutError):
            raise MailError(f"IMAP OK, mais serveur SMTP {cfg.smtp_host} : délai dépassé.", "timeout")
        except ssl.SSLError:
            raise MailError(f"IMAP OK, mais échec TLS avec {cfg.smtp_host}:{cfg.smtp_port}.", "tls")
        except (smtplib.SMTPException, OSError):
            raise MailError(f"IMAP OK, mais serveur SMTP {cfg.smtp_host}:{cfg.smtp_port} injoignable.", "smtp")
        finally:
            if server is not None:
                try:
                    server.quit()
                except Exception:
                    pass
        out["smtp"] = True
    return out


def _special_from(folders: list[dict], kind: str) -> Optional[str]:
    return next((f["name"] for f in folders if f["special"] == kind), None)
