"""Interface d'administration d'emails.chapote.fr (/api/emails/*), relayée par son nginx.

Réservé au superadmin avec une session 2FA validée (services/emails_access), sauf
/public-config (bouton Google) et /access (l'interface y lit la raison d'un refus).

- Boîtes : liste, ajout (préréglages ovh-email-pro / gmail), modification, suppression,
  test de connexion IMAP + SMTP, droits (envoi, corbeille). Le mot de passe est écrit
  chiffré et jamais relu par l'interface (`has_password` seulement).
- Accès Claude : clients OAuth inscrits et jetons actifs (par famille), révocation.
- Journal d'audit des appels MCP (pages par curseur, du plus récent au plus ancien).
- Consentement OAuth : lecture de la demande signée par /oauth/authorize, puis accord ou
  refus (le code d'autorisation naît ici).
"""
from typing import Optional
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import decode_token, get_current_user, user_has_2fa
from src.core.time import utcnow
from src.models.emails import Mailbox, McpAuditLog, McpOAuthClient, McpOAuthToken
from src.models.user import User
from src.services import emails_oauth as eo
from src.services import mail_client as mc
from src.services.emails_access import MESSAGES, access_problem, require_emails_admin, require_enabled
from src.services.mail_client import MailboxConfig, MailError
from src.services.mailbox_crypto import encrypt_password
from src.services.mailboxes import HOST_RE, PRESETS, SLUG_RE, config_of, mailbox_out

router = APIRouter(prefix="/api/emails", tags=["emails"], dependencies=[Depends(require_enabled)])


def _dt(v) -> Optional[str]:
    return v.isoformat() + "Z" if v else None


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------

@router.get("/public-config")
async def public_config():
    return {"google_client_id": settings.GOOGLE_CLIENT_ID or None, "app_url": settings.APP_URL,
            "mcp_url": settings.emails_resource}


@router.get("/access")
async def access(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    problem = await access_problem(db, user, request)
    return {"allowed": problem is None, "reason": problem, "message": MESSAGES.get(problem or ""),
            "twofa_enabled": await user_has_2fa(db, user), "mcp_url": settings.emails_resource}


# --------------------------------------------------------------------------
# Boîtes
# --------------------------------------------------------------------------

class MailboxIn(BaseModel):
    slug: Optional[str] = Field(None, max_length=40)
    address: Optional[str] = Field(None, max_length=255)
    label: Optional[str] = Field(None, max_length=120)
    preset: Optional[str] = Field(None, max_length=30)
    imap_host: Optional[str] = Field(None, max_length=255)
    imap_port: Optional[int] = Field(None, ge=1, le=65535)
    imap_tls: Optional[str] = None
    smtp_host: Optional[str] = Field(None, max_length=255)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_tls: Optional[str] = None
    username: Optional[str] = Field(None, max_length=255)
    password: Optional[str] = Field(None, max_length=500)
    allow_send: Optional[bool] = None
    allow_delete: Optional[bool] = None
    save_sent: Optional[bool] = None
    is_active: Optional[bool] = None


def _bad(msg: str):
    raise HTTPException(422, msg)


def _clean_password(password: str, preset: Optional[str]) -> str:
    """Gmail affiche le mot de passe d'application par groupes de 4 (« abcd efgh … ») : espaces retirés."""
    return "".join(password.split()) if preset == "gmail" else password


def _apply(mb: Mailbox, body: MailboxIn, creating: bool) -> None:
    data = body.model_dump(exclude_unset=True)
    preset = data.get("preset")
    if preset:
        if preset not in PRESETS:
            _bad("Préréglage inconnu.")
        p = PRESETS[preset]
        for k in ("imap_host", "imap_port", "imap_tls", "smtp_host", "smtp_port", "smtp_tls", "save_sent"):
            data.setdefault(k, p[k])
        mb.preset = preset
    if "slug" in data:
        slug = (data["slug"] or "").strip().lower()
        if not SLUG_RE.match(slug):
            _bad("Identifiant : lettres minuscules, chiffres et tirets (40 caractères au plus).")
        mb.slug = slug
    if "address" in data:
        addr = (data["address"] or "").strip()
        if not mc._EMAIL_RE.match(addr):
            _bad("Adresse e-mail invalide.")
        mb.address = addr
    if "label" in data:
        mb.label = (data["label"] or "").strip() or None
    for k in ("imap_host", "smtp_host"):
        if k in data:
            v = (data[k] or "").strip()
            if not HOST_RE.match(v):
                _bad("Hôte invalide.")
            setattr(mb, k, v)
    for k in ("imap_port", "smtp_port"):
        if k in data and data[k] is not None:
            setattr(mb, k, data[k])
    for k in ("imap_tls", "smtp_tls"):
        if k in data:
            if data[k] not in ("ssl", "starttls", "none"):
                _bad("Mode TLS : ssl, starttls ou none.")
            if data[k] == "none" and settings.is_production:
                _bad("Connexion sans chiffrement refusée en production.")
            setattr(mb, k, data[k])
    if "username" in data:
        mb.username = (data["username"] or "").strip()
    if data.get("password"):
        mb.password_encrypted = encrypt_password(_clean_password(data["password"], mb.preset))
    for k in ("allow_send", "allow_delete", "save_sent", "is_active"):
        if k in data and data[k] is not None:
            setattr(mb, k, bool(data[k]))
    if creating:
        missing = [k for k in ("slug", "address", "imap_host", "smtp_host") if not getattr(mb, k, None)]
        if not mb.username:
            mb.username = mb.address or ""
        if not mb.password_encrypted:
            missing.append("password")
        if missing:
            _bad(f"Champs requis : {', '.join(missing)}.")
        for k, default in (("imap_port", 993), ("imap_tls", "ssl"), ("smtp_port", 465), ("smtp_tls", "ssl")):
            if getattr(mb, k, None) is None:
                setattr(mb, k, default)


async def _get(db: AsyncSession, mailbox_id: int) -> Mailbox:
    mb = await db.get(Mailbox, mailbox_id)
    if mb is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Boîte introuvable")
    return mb


@router.get("/presets")
async def presets(_: User = Depends(require_emails_admin)):
    return [{"id": k, **v} for k, v in PRESETS.items()]


@router.get("/mailboxes")
async def list_mailboxes(_: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Mailbox).order_by(Mailbox.slug))).scalars().all()
    return [mailbox_out(m) for m in rows]


async def _slug_free(db: AsyncSession, slug: str, but: Optional[int] = None) -> None:
    q = select(Mailbox.id).where(Mailbox.slug == slug)
    if but is not None:
        q = q.where(Mailbox.id != but)
    if (await db.execute(q)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cet identifiant est déjà utilisé.")


@router.post("/mailboxes")
async def create_mailbox(body: MailboxIn, _: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    mb = Mailbox(allow_send=False, allow_delete=False, save_sent=True, is_active=True)
    _apply(mb, body, creating=True)
    await _slug_free(db, mb.slug)
    db.add(mb)
    await db.commit()
    await db.refresh(mb)
    return mailbox_out(mb)


@router.patch("/mailboxes/{mailbox_id}")
async def update_mailbox(mailbox_id: int, body: MailboxIn, _: User = Depends(require_emails_admin),
                         db: AsyncSession = Depends(get_db)):
    mb = await _get(db, mailbox_id)
    _apply(mb, body, creating=False)
    await _slug_free(db, mb.slug, but=mb.id)
    mb.updated_at = utcnow()
    await db.commit()
    await db.refresh(mb)
    return mailbox_out(mb)


@router.delete("/mailboxes/{mailbox_id}")
async def delete_mailbox(mailbox_id: int, _: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    mb = await _get(db, mailbox_id)
    await db.delete(mb)
    await db.commit()
    return {"ok": True}


async def _check(cfg: MailboxConfig) -> dict:
    try:
        r = await mc.run_blocking(mc.check_connection, cfg)
        return {"ok": True, **r}
    except MailError as e:
        return {"ok": False, "error": e.message, "code": e.code}


@router.post("/mailboxes/{mailbox_id}/test")
async def test_mailbox(mailbox_id: int, _: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    mb = await _get(db, mailbox_id)
    try:
        result = await _check(config_of(mb))
    except MailError as e:
        result = {"ok": False, "error": e.message, "code": e.code}
    mb.last_check_at = utcnow()
    mb.last_check_ok = result["ok"]
    mb.last_check_error = None if result["ok"] else result["error"][:300]
    await db.commit()
    return result


@router.post("/mailboxes/test")
async def test_unsaved(body: MailboxIn, _: User = Depends(require_emails_admin)):
    """Teste une configuration avant de l'enregistrer (formulaire d'ajout)."""
    mb = Mailbox()
    if not body.slug:
        body.slug = "essai"
    _apply(mb, body, creating=True)
    cfg = MailboxConfig(slug=mb.slug, address=mb.address, label=mb.label, imap_host=mb.imap_host,
                        imap_port=mb.imap_port, imap_tls=mb.imap_tls, smtp_host=mb.smtp_host,
                        smtp_port=mb.smtp_port, smtp_tls=mb.smtp_tls, username=mb.username,
                        password=_clean_password(body.password or "", mb.preset))
    return await _check(cfg)


# --------------------------------------------------------------------------
# Accès Claude : clients et jetons
# --------------------------------------------------------------------------

@router.get("/clients")
async def list_clients(_: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    now = utcnow()
    clients = (await db.execute(select(McpOAuthClient).order_by(McpOAuthClient.created_at.desc()))).scalars().all()
    counts = dict((await db.execute(
        select(McpOAuthToken.client_pk, func.count(func.distinct(McpOAuthToken.family_id)))
        .where(McpOAuthToken.revoked_at.is_(None), McpOAuthToken.refresh_expires_at > now)
        .group_by(McpOAuthToken.client_pk))).all())
    return [{"id": c.id, "client_id": c.client_id, "client_name": c.client_name,
             "redirect_hosts": sorted({urlparse(u).hostname or "" for u in c.redirect_uris or []}),
             "created_at": _dt(c.created_at), "last_used_at": _dt(c.last_used_at), "revoked_at": _dt(c.revoked_at),
             "active_tokens": counts.get(c.id, 0)} for c in clients]


@router.get("/tokens")
async def list_tokens(_: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    """Une ligne par connexion vivante (famille de jetons) : la plus récente rotation."""
    now = utcnow()
    rows = (await db.execute(
        select(McpOAuthToken, McpOAuthClient, User.email)
        .join(McpOAuthClient, McpOAuthClient.id == McpOAuthToken.client_pk)
        .join(User, User.id == McpOAuthToken.user_id)
        .where(McpOAuthToken.revoked_at.is_(None), McpOAuthToken.refresh_expires_at > now,
               McpOAuthClient.revoked_at.is_(None))
        .order_by(McpOAuthToken.created_at.desc()))).all()
    firsts = dict((await db.execute(select(McpOAuthToken.family_id, func.min(McpOAuthToken.created_at))
                                    .group_by(McpOAuthToken.family_id))).all())
    out = []
    for tok, client, email in rows:
        out.append({"id": tok.id, "family_id": tok.family_id, "client_name": client.client_name,
                    "client_id": client.client_id, "user_email": email,
                    "connected_at": _dt(firsts.get(tok.family_id)), "last_used_at": _dt(tok.last_used_at),
                    "access_expires_at": _dt(tok.access_expires_at), "refresh_expires_at": _dt(tok.refresh_expires_at)})
    return out


@router.post("/tokens/{token_id}/revoke")
async def revoke_token(token_id: int, user: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    tok = await db.get(McpOAuthToken, token_id)
    if tok is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Jeton introuvable")
    n = await eo.revoke_family(db, tok.family_id)
    db.add(McpAuditLog(client_pk=tok.client_pk, user_id=user.id, tool="admin.revoke_token", status="ok", items=n))
    await db.commit()
    return {"ok": True, "revoked": n}


@router.post("/clients/{client_pk}/revoke")
async def revoke_client(client_pk: int, user: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    client = await db.get(McpOAuthClient, client_pk)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client introuvable")
    n = await eo.revoke_client(db, client)
    db.add(McpAuditLog(client_pk=client.id, user_id=user.id, tool="admin.revoke_client", status="ok", items=n))
    await db.commit()
    return {"ok": True, "revoked": n}


@router.post("/tokens/revoke-all")
async def revoke_all(user: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import update
    res = await db.execute(update(McpOAuthToken).where(McpOAuthToken.revoked_at.is_(None)).values(revoked_at=utcnow()))
    db.add(McpAuditLog(user_id=user.id, tool="admin.revoke_all", status="ok", items=res.rowcount or 0))
    await db.commit()
    return {"ok": True, "revoked": res.rowcount or 0}


# --------------------------------------------------------------------------
# Journal d'audit
# --------------------------------------------------------------------------

@router.get("/audit")
async def audit(_: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db),
                limit: int = 50, cursor: Optional[int] = None, tool: Optional[str] = None,
                mailbox: Optional[str] = None, status_: Optional[str] = Query(None, alias="status")):
    limit = max(1, min(limit, 200))
    q = (select(McpAuditLog, McpOAuthClient.client_name)
         .outerjoin(McpOAuthClient, McpOAuthClient.id == McpAuditLog.client_pk)
         .order_by(McpAuditLog.id.desc()).limit(limit + 1))
    if cursor:
        q = q.where(McpAuditLog.id < cursor)
    if tool:
        q = q.where(McpAuditLog.tool == tool)
    if mailbox:
        q = q.where(McpAuditLog.mailbox_slug == mailbox)
    if status_:
        q = q.where(McpAuditLog.status == status_)
    rows = (await db.execute(q)).all()
    items = [{"id": a.id, "at": _dt(a.created_at), "client": name, "tool": a.tool, "mailbox": a.mailbox_slug,
              "status": a.status, "error_code": a.error_code, "duration_ms": a.duration_ms, "items": a.items}
             for a, name in rows[:limit]]
    return {"items": items, "next_cursor": items[-1]["id"] if len(rows) > limit else None}


# --------------------------------------------------------------------------
# Consentement OAuth
# --------------------------------------------------------------------------

async def _authz_request(db: AsyncSession, req: str, user: User) -> tuple[dict, McpOAuthClient]:
    try:
        claims = decode_token(req, expected_scope="emails_authz")
    except HTTPException:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Demande expirée : relancez la connexion depuis Claude.")
    if claims.get("sub") != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Demande ouverte par un autre compte.")
    client = await eo.active_client(db, claims.get("cid"))
    if client is None or claims.get("ru") not in (client.redirect_uris or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Client inconnu ou révoqué.")
    return claims, client


@router.get("/oauth/request")
async def consent_request(req: str, user: User = Depends(require_emails_admin), db: AsyncSession = Depends(get_db)):
    claims, client = await _authz_request(db, req, user)
    boxes = (await db.execute(select(Mailbox.slug, Mailbox.address, Mailbox.allow_send, Mailbox.allow_delete)
                              .where(Mailbox.is_active.is_(True)).order_by(Mailbox.slug))).all()
    return {"client_name": client.client_name or "Client sans nom", "client_id": client.client_id,
            "redirect_host": urlparse(claims["ru"]).hostname, "scope": claims.get("sc") or eo.SCOPE,
            "user_email": user.email,
            "mailboxes": [{"slug": s, "address": a, "allow_send": snd, "allow_delete": dl} for s, a, snd, dl in boxes]}


class ConsentIn(BaseModel):
    req: str
    approve: bool


@router.post("/oauth/consent")
async def consent(body: ConsentIn, request: Request, user: User = Depends(require_emails_admin),
                  db: AsyncSession = Depends(get_db)):
    # Défense CSRF en plus du cookie SameSite=Lax : en-tête propre à l'interface (une page
    # tierce ne peut pas l'ajouter sans pré-vol CORS, refusé).
    if (request.headers.get("x-chapote-app") or "").lower() != "emails":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requête refusée.")
    claims, client = await _authz_request(db, body.req, user)
    params: dict = {"state": claims.get("st")}
    if body.approve:
        params["code"] = await eo.create_code(db, client, user.id, claims["ru"], claims["cc"],
                                              claims.get("sc") or eo.SCOPE, claims.get("rs"))
        db.add(McpAuditLog(client_pk=client.id, user_id=user.id, tool="oauth.consent", status="ok"))
    else:
        params = {"error": "access_denied", "state": claims.get("st")}
        db.add(McpAuditLog(client_pk=client.id, user_id=user.id, tool="oauth.consent", status="denied"))
    await db.commit()
    uri = claims["ru"]
    sep = "&" if "?" in uri else "?"
    return {"redirect": uri + sep + urlencode({k: v for k, v in params.items() if v is not None})}
