"""Faux serveurs IMAP / SMTP pour les tests d'emails.chapote.fr.

Remplacent imaplib.IMAP4_SSL / IMAP4 et smtplib.SMTP_SSL / SMTP dans services.mail_client :
le vrai code de connexion, d'authentification, de recherche et d'analyse des réponses
tourne, seul le réseau est simulé. Réponses au format exact d'imaplib (tuples
(métadonnées, littéral) puis b')').

Chaque boîte simulée : {dossier (UTF-7 modifié) : [FakeMsg]}, mot de passe attendu,
capacités (MOVE, UIDPLUS, X-GM-EXT-1 pour Gmail). Toutes les commandes reçues sont
notées dans `FakeIMAP.log` (vérifier qu'une lecture ne pose pas \\Seen, par exemple).
"""
from __future__ import annotations

import email
import imaplib
import re
from dataclasses import dataclass, field
from email import policy
from email.message import EmailMessage
from typing import Optional


def make_raw(subject: str, sender: str = "Alice <alice@exemple.fr>", to: str = "contact@chapote.fr",
             body: str = "Bonjour", msgid: Optional[str] = None, refs: Optional[str] = None,
             attachments: Optional[list[tuple[str, str, bytes]]] = None, html: Optional[str] = None,
             date: str = "Mon, 23 Nov 2026 10:00:00 +0100") -> bytes:
    m = EmailMessage()
    m["From"] = sender
    m["To"] = to
    m["Subject"] = subject
    m["Date"] = date
    m["Message-ID"] = msgid or f"<{abs(hash(subject))}@exemple.fr>"
    if refs:
        m["References"] = refs
        m["In-Reply-To"] = refs.split()[-1]
    m.set_content(body)
    if html:
        m.add_alternative(html, subtype="html")
    for name, ctype, data in attachments or []:
        maintype, subtype = ctype.split("/")
        m.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return m.as_bytes()


@dataclass
class FakeMsg:
    uid: int
    raw: bytes
    flags: set = field(default_factory=set)
    thrid: int = 0


@dataclass
class FakeAccount:
    password: str
    folders: dict  # nom UTF-7 -> list[FakeMsg]
    specials: dict  # nom UTF-7 -> attribut (\\Sent…)
    caps: tuple = ("IMAP4rev1", "MOVE", "UIDPLUS")
    next_uid: int = 1000


ACCOUNTS: dict[str, FakeAccount] = {}     # identifiant -> boîte simulée
SMTP_SENT: list[dict] = []
# Adresses que le faux serveur refuse au RCPT TO : adresse -> (code, réponse).
SMTP_REFUSE: dict[str, tuple[int, bytes]] = {}
IMAP_LOG: list[tuple] = []


def reset() -> None:
    ACCOUNTS.clear()
    SMTP_SENT.clear()
    SMTP_REFUSE.clear()
    IMAP_LOG.clear()


def _unquote(s: str) -> str:
    s = s.strip()
    if s.startswith('"') and s.endswith('"'):
        return re.sub(r'\\(.)', r'\1', s[1:-1])
    return s


def _tokens(args: tuple) -> list[str]:
    out = []
    for a in args:
        out += re.findall(r'"(?:[^"\\]|\\.)*"|\S+', a)
    return out


def _uids(spec: str) -> set[int]:
    return {int(x) for x in spec.split(",")}


class FakeIMAP:
    # Le client attrape imaplib.IMAP4.error / .abort : la classe remplaçante doit les porter.
    error = imaplib.IMAP4.error
    abort = imaplib.IMAP4.abort
    readonly = imaplib.IMAP4.readonly

    def __init__(self, host, port=993, ssl_context=None, timeout=None):
        if host == "down.example":
            raise OSError("connexion refusée")
        self.host = host
        self.literal = None
        self.debug = 0
        self.account: Optional[FakeAccount] = None
        self.selected: Optional[str] = None
        self.capabilities = ("IMAP4REV1",)

    def starttls(self, ssl_context=None):
        return "OK", [b"Begin TLS"]

    def login(self, user, password):
        IMAP_LOG.append(("LOGIN", user))
        acc = ACCOUNTS.get(user)
        if acc is None or acc.password != password:
            raise imaplib.IMAP4.error(b"[AUTHENTICATIONFAILED] Invalid credentials (Failure)")
        self.account = acc
        return "OK", [b"LOGIN completed"]

    def capability(self):
        return "OK", [" ".join(self.account.caps).encode()]

    def logout(self):
        return "BYE", [b"bye"]

    def list(self):
        out = []
        for name in self.account.folders:
            attr = self.account.specials.get(name, "")
            out.append(f'(\\HasNoChildren{(" " + attr) if attr else ""}) "/" "{name}"'.encode())
        return "OK", out

    def select(self, mailbox, readonly=False):
        name = _unquote(mailbox)
        IMAP_LOG.append(("SELECT", name, readonly))
        if name not in self.account.folders:
            return "NO", [b"Mailbox does not exist"]
        self.selected = name
        return "OK", [str(len(self.account.folders[name])).encode()]

    def _msgs(self) -> list[FakeMsg]:
        return self.account.folders[self.selected]

    # --- UID … ---
    def uid(self, command, *args):
        command = command.upper()
        IMAP_LOG.append(("UID", command) + args)
        return getattr(self, "_uid_" + command.lower())(*args)

    def _uid_search(self, *args):
        toks = _tokens(args)
        lit = self.literal
        self.literal = None
        if lit is not None:
            toks.append('"' + lit.decode() + '"')
        msgs = list(self._msgs())
        i = 0
        while i < len(toks):
            t = toks[i].upper()
            if t == "CHARSET":
                i += 2
                continue
            if t in ("ALL",):
                i += 1
                continue
            if t == "UNSEEN":
                msgs = [m for m in msgs if "\\Seen" not in m.flags]
                i += 1
                continue
            if t in ("SINCE", "BEFORE"):
                i += 2
                continue
            if t == "HEADER":
                hname, val = toks[i + 1], _unquote(toks[i + 2]).lower()
                msgs = [m for m in msgs if val in str(email.message_from_bytes(m.raw).get(hname, "")).lower()]
                i += 3
                continue
            if t == "X-GM-THRID":
                msgs = [m for m in msgs if m.thrid == int(toks[i + 1])]
                i += 2
                continue
            val = _unquote(toks[i + 1]).lower()
            def field_of(m, key=t):
                msg = email.message_from_bytes(m.raw, policy=policy.default)
                if key == "FROM":
                    return str(msg.get("From", ""))
                if key == "TO":
                    return str(msg.get("To", ""))
                if key == "SUBJECT":
                    return str(msg.get("Subject", ""))
                return m.raw.decode("utf-8", "replace") + str(msg.get("Subject", ""))
            msgs = [m for m in msgs if val in field_of(m).lower()]
            i += 2
        return "OK", [" ".join(str(m.uid) for m in msgs).encode()]

    def _uid_fetch(self, uidset, items):
        wanted = _uids(uidset)
        out = []
        for seq, m in enumerate(self._msgs(), start=1):
            if m.uid not in wanted:
                continue
            flags = " ".join(sorted(m.flags))
            if "X-GM-THRID" in items:
                out.append(f"{seq} (X-GM-THRID {m.thrid} UID {m.uid})".encode())
            elif "HEADER.FIELDS" in items:
                head = m.raw.split(b"\n\n", 1)[0].split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n"
                meta = f"{seq} (UID {m.uid} FLAGS ({flags}) RFC822.SIZE {len(m.raw)} BODY[HEADER.FIELDS (X)] {{{len(head)}}}"
                out += [(meta.encode(), head), b")"]
            elif "BODY.PEEK[]" in items:
                out += [(f"{seq} (UID {m.uid} BODY[] {{{len(m.raw)}}}".encode(), m.raw), b")"]
            else:
                out.append(f"{seq} (UID {m.uid} FLAGS ({flags}) RFC822.SIZE {len(m.raw)})".encode())
        return "OK", out or [None]

    def _uid_store(self, uidset, op, flags):
        names = flags.strip("()").split()
        for m in self._msgs():
            if m.uid in _uids(uidset):
                if op.startswith("+"):
                    m.flags |= set(names)
                else:
                    m.flags -= set(names)
        return "OK", [b"STORE completed"]

    def _uid_move(self, uidset, dest):
        dest = _unquote(dest)
        if dest not in self.account.folders:
            return "NO", [b"no such folder"]
        moving = [m for m in self._msgs() if m.uid in _uids(uidset)]
        self.account.folders[self.selected] = [m for m in self._msgs() if m not in moving]
        for m in moving:
            self.account.next_uid += 1
            self.account.folders[dest].append(FakeMsg(self.account.next_uid, m.raw, set(m.flags), m.thrid))
        return "OK", [b"MOVE completed"]

    def _uid_copy(self, uidset, dest):
        dest = _unquote(dest)
        for m in self._msgs():
            if m.uid in _uids(uidset):
                self.account.next_uid += 1
                self.account.folders[dest].append(FakeMsg(self.account.next_uid, m.raw, set(m.flags)))
        return "OK", [b"COPY completed"]

    def _uid_expunge(self, uidset):
        self.account.folders[self.selected] = [m for m in self._msgs() if "\\Deleted" not in m.flags]
        return "OK", [b"EXPUNGE completed"]

    def expunge(self):
        return self._uid_expunge("")

    def append(self, mailbox, flags, date_time, message):
        name = _unquote(mailbox)
        IMAP_LOG.append(("APPEND", name, flags))
        if name not in self.account.folders:
            return "NO", [b"no such folder"]
        self.account.next_uid += 1
        self.account.folders[name].append(FakeMsg(self.account.next_uid, message, set(flags.strip("()").split())))
        return "OK", [f"[APPENDUID 1 {self.account.next_uid}] APPEND completed".encode()]


class FakeSMTP:
    def __init__(self, host, port=0, timeout=None, context=None):
        self.host = host
        self.user = None

    def ehlo(self):
        return 250, b"ok"

    def starttls(self, context=None):
        return 220, b"ok"

    def set_debuglevel(self, level):
        pass

    def login(self, user, password):
        import smtplib
        acc = ACCOUNTS.get(user)
        if acc is None or acc.password != password:
            raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
        self.user = user

    def send_message(self, msg, from_addr=None, to_addrs=None):
        """Comme smtplib.sendmail : un RCPT TO par adresse ; aucune acceptée (liste vide
        comprise : MAIL FROM puis RSET) -> SMTPRecipientsRefused ; refus partiel -> dict."""
        import smtplib
        to_addrs = list(to_addrs or [])
        refused = {a: SMTP_REFUSE[a] for a in to_addrs if a in SMTP_REFUSE}
        if len(refused) == len(to_addrs):
            raise smtplib.SMTPRecipientsRefused(refused)
        SMTP_SENT.append({"from": from_addr, "to": [a for a in to_addrs if a not in refused], "msg": msg,
                          "bcc_header": msg.get("Bcc")})
        return refused

    def quit(self):
        pass


def install(monkeypatch) -> None:
    from src.services import mail_client as mc
    reset()
    monkeypatch.setattr(mc.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setattr(mc.imaplib, "IMAP4", FakeIMAP)
    monkeypatch.setattr(mc.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(mc.smtplib, "SMTP", FakeSMTP)


def ovh_account(user: str = "contact@chapote.fr", password: str = "mdp-ovh-123") -> FakeAccount:
    """Boîte façon Email Pro OVH : dossiers en français, sans SPECIAL-USE (repli par nom)."""
    acc = FakeAccount(password=password, folders={
        "INBOX": [], "&AMk-l&AOk-ments envoy&AOk-s": [], "Brouillons": [], "&AMk-l&AOk-ments supprim&AOk-s": [],
        "Archives": [],
    }, specials={})
    ACCOUNTS[user] = acc
    return acc


def gmail_account(user: str = "moi@gmail.com", password: str = "abcdabcdabcdabcd") -> FakeAccount:
    acc = FakeAccount(password=password, folders={
        "INBOX": [], "[Gmail]/Tous les messages": [], "[Gmail]/Messages envoy&AOk-s": [],
        "[Gmail]/Brouillons": [], "[Gmail]/Corbeille": [],
    }, specials={"[Gmail]/Tous les messages": "\\All", "[Gmail]/Messages envoy&AOk-s": "\\Sent",
                 "[Gmail]/Brouillons": "\\Drafts", "[Gmail]/Corbeille": "\\Trash"},
        caps=("IMAP4rev1", "MOVE", "UIDPLUS", "X-GM-EXT-1"))
    ACCOUNTS[user] = acc
    return acc


def add(acc: FakeAccount, folder: str, raw: bytes, flags: Optional[set] = None, thrid: int = 0) -> int:
    acc.next_uid += 1
    acc.folders[folder].append(FakeMsg(acc.next_uid, raw, set(flags or ()), thrid))
    return acc.next_uid
