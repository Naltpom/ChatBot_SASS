"""cm : lien d'invitation à un groupe de comptes, à envoyer par message (WhatsApp, SMS…), plutôt que de
taper une adresse e-mail. Ajouts seulement : le partage par e-mail (cm_team) reste tel quel.

- `POST /api/cm/groups/{id}/invite-link {role}` (admin du groupe) : nouveau lien valable 7 jours.
- `DELETE /api/cm/groups/{id}/invite-link` : désactive les liens du groupe.
- `GET /api/cm/invite-links/{token}` (connecté) : aperçu (groupe, propriétaire, rôle, nombre de comptes).
- `POST /api/cm/invite-links/{token}/accept` (connecté) : rejoint le groupe avec ce rôle (comme une invitation acceptée).
- `GET /api/cm/join?t=…` : page web du lien, qui ouvre l'app (ou explique comment).
"""
import hashlib
import html
import secrets
from datetime import timedelta
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.time import utcnow
from src.i18n import browser_lang, tr, trf
from src.models.cm import CmGroup, CmGroupShare
from src.models.cm_mobile import CmGroupInviteLink
from src.models.user import User
from src.routers.cm import get_cm_user
from src.routers import cm_team
from src.services import cm_access
from src.services.rate_limit import RateLimiter

router = APIRouter(prefix="/api/cm", tags=["cm-invite-links"])

LINK_TTL = timedelta(days=7)
link_limiter = RateLimiter("rl:cminvitelink:", 30, 3600)
join_limiter = RateLimiter("rl:cminvitejoin:", 60, 3600)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public_base() -> str:
    return (settings.CM_URL or "https://cm.chapote.fr").rstrip("/")


class LinkIn(BaseModel):
    role: Literal["admin", "editor", "viewer"] = "viewer"


@router.post("/groups/{group_id}/invite-link")
async def create_link(group_id: int, body: LinkIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    g, tenant = await cm_team._group_admin(db, user, group_id)
    if not await link_limiter.check(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de liens créés : réessayez dans une heure.")
    if not tenant.org_id:            # groupe de l'espace perso : même passage en équipe invisible que le partage par e-mail
        await cm_team.ensure_shareable(db, user, tenant)
        g = await db.get(CmGroup, group_id)
    token = secrets.token_urlsafe(24)
    link = CmGroupInviteLink(group_id=g.id, token_hash=_hash(token), role=body.role, created_by_user_id=user.id,
                             created_at=utcnow(), expires_at=utcnow() + LINK_TTL)
    db.add(link)
    await db.commit()
    return {"token": token, "url": f"{_public_base()}/api/cm/join?t={quote(token)}", "role": body.role,
            "role_label": cm_team.SHARE_ROLE_LABEL[body.role], "expires_at": link.expires_at.isoformat(), "group_name": g.name}


@router.delete("/groups/{group_id}/invite-link")
async def revoke_links(group_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    g, _ = await cm_team._group_admin(db, user, group_id)
    await db.execute(update(CmGroupInviteLink).where(CmGroupInviteLink.group_id == g.id, CmGroupInviteLink.revoked_at.is_(None))
                     .values(revoked_at=utcnow()))
    await db.commit()
    return {"ok": True}


async def _valid(db: AsyncSession, token: str) -> tuple[CmGroupInviteLink, CmGroup]:
    missing = HTTPException(status.HTTP_404_NOT_FOUND, "Lien d'invitation invalide ou expiré : demandez-en un nouveau.")
    if not token or len(token) > 100:
        raise missing
    link = (await db.execute(select(CmGroupInviteLink).where(CmGroupInviteLink.token_hash == _hash(token)))).scalar_one_or_none()
    if link is None or link.revoked_at is not None or link.expires_at < utcnow():
        raise missing
    g = await db.get(CmGroup, link.group_id)
    if g is None:
        raise missing
    return link, g


@router.get("/invite-links/{token}")
async def preview(token: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    link, g = await _valid(db, token)
    by = await db.get(User, link.created_by_user_id) if link.created_by_user_id else None
    return {"group_name": g.name, "group_color": g.color, "role": link.role, "role_label": cm_team.SHARE_ROLE_LABEL[link.role],
            "accounts": len(await cm_access._group_accounts(db, g.id)),
            "owner": await cm_team._owner_name(db, g.organization_id, g.owner_user_id),
            "invited_by": (by.name or by.email) if by else None, "expires_at": link.expires_at.isoformat()}


@router.post("/invite-links/{token}/accept")
async def accept(token: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    if not await join_limiter.check(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez plus tard.")
    link, g = await _valid(db, token)
    email = (user.email or "").lower()
    s = (await db.execute(select(CmGroupShare).where(CmGroupShare.group_id == g.id, CmGroupShare.email == email))).scalar_one_or_none()
    if s is None:
        s = CmGroupShare(group_id=g.id, email=email, role=link.role, status="accepted", user_id=user.id,
                         invited_by_user_id=link.created_by_user_id, created_at=utcnow(), responded_at=utcnow())
        db.add(s)
    elif s.status != "accepted":
        s.role, s.status, s.user_id, s.responded_at = link.role, "accepted", user.id, utcnow()
    link.uses = (link.uses or 0) + 1
    await db.flush()
    await cm_access.recompute_member(db, g.organization_id, email)
    await db.commit()
    return {"ok": True, "group_id": g.id, "group_name": g.name, "org_id": g.organization_id, "role": s.role}


_JOIN = """<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>
:root{{color-scheme:light dark;--bg:#f5f5f7;--fg:#1d1d1f;--mute:#6e6e73;--card:#fff;--line:#e8e8ed;--accent:#0071e3}}
@media (prefers-color-scheme:dark){{:root{{--bg:#000;--fg:#f5f5f7;--mute:#a1a1a6;--card:#1c1c1e;--line:#2c2c2e;--accent:#0a84ff}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}}
main{{max-width:440px;margin:0 auto;padding:48px 20px;display:flex;flex-direction:column;gap:16px}}
h1{{font-size:26px;line-height:1.2;margin:0}} p{{margin:0;color:var(--mute)}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px}}
.btn{{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:14px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none}}
code{{word-break:break-all;font-size:13px}}</style></head><body><main>{body}</main></body></html>"""


def _join_html(body: str, lang: str) -> str:
    return _JOIN.format(body=body, lang=lang, title=html.escape(tr("Invitation Chapote CM", lang)))


@router.get("/join", response_class=HTMLResponse)
async def join_page(request: Request, t: str = "", db: AsyncSession = Depends(get_db)):
    """Page du lien ; langue : `?lang=` ou Accept-Language du navigateur (src.i18n.browser_lang)."""
    headers = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
               "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"}
    lang = browser_lang(request)

    def tx(text: str) -> str:
        return html.escape(tr(text, lang), quote=False)

    try:
        _, g = await _valid(db, t)
    except HTTPException:
        return HTMLResponse(_join_html("<h1>" + tx("Lien expiré") + "</h1><p>"
                                       + tx("Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à la personne qui vous l'a envoyé.")
                                       + "</p>", lang),
                            status_code=404, headers=headers)
    app_link = f"chapotecm://join?t={quote(t)}"
    body = ("<h1>" + html.escape(trf("Rejoindre « {} »", lang, g.name), quote=False) + "</h1>"
            "<p>" + tx("On vous invite à suivre ce groupe de comptes TikTok, YouTube et Instagram dans Chapote CM.") + "</p>"
            f'<a class="btn" href="{html.escape(app_link)}">' + tx("Ouvrir dans l'app Chapote CM") + "</a>"
            '<div class="card"><strong>' + tx("L'app ne s'ouvre pas ?") + "</strong>"
            "<p>" + tx("Installez Chapote CM, connectez-vous, puis sur l'écran « Vos comptes » touchez « J'ai un lien d'invitation » et collez ce lien :") + "</p>"
            f"<code>{html.escape(_public_base())}/api/cm/join?t={html.escape(t)}</code></div>")
    return HTMLResponse(_join_html(body, lang), headers=headers)
