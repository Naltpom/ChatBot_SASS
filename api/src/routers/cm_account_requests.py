"""cm.chapote.fr — demander la reprise d'un compte relié à l'espace de quelqu'un d'autre.

Quand on connecte un compte (TikTok, YouTube, Instagram) déjà relié ailleurs, l'API répond 409 avec un
jeton de reprise (preuve que la personne contrôle le compte chez la plateforme). Plutôt que de prendre
le compte tout de suite (POST /api/cm/accounts/claim, inchangé), l'app mobile envoie une DEMANDE :

  POST   /api/cm/account-requests                 créer la demande (jeton de reprise, espace d'arrivée, mot)
  GET    /api/cm/account-requests                 reçues (comptes de mes espaces) et envoyées
  POST   /api/cm/account-requests/{id}/accept     un administrateur de l'espace actuel accepte : le compte part
  POST   /api/cm/account-requests/{id}/decline    … ou refuse
  DELETE /api/cm/account-requests/{id}            la personne qui demande annule
  POST   /api/cm/account-requests/{id}/dispute    refus ou pas de réponse après 3 jours : réclamation au support

Les administrateurs de l'espace actuel sont prévenus par e-mail ; le support reçoit les réclamations.
Le compte part avec son planning À VENIR ; l'historique reste dans l'ancien espace (comme un transfert).
"""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.time import utcnow
from src.models.cm import CmTransfer
from src.models.cm_mobile import CmAccountRequest
from src.models.user import Membership, Organization, User
from src.routers.cm import get_cm_user
from src.routers.tiktok import _tenant, _tenant_of
from src.services import cm_access
from src.services import cm_service as cm
from src.i18n import trf
from src.services.email_service import SUPPORT_EMAIL, email_languages, send_account_email
from src.services.rate_limit import RateLimiter

router = APIRouter(prefix="/api/cm", tags=["cm-account-requests"])

request_limiter = RateLimiter("rl:cmacctreq:", 10, 3600)
REQUEST_TTL = timedelta(days=7)
DISPUTE_AFTER = timedelta(days=3)
LABEL = {"tiktok": "TikTok", "youtube": "YouTube", "instagram": "Instagram"}
# Langue des e-mails : chaque destinataire reçoit sa langue de Chapote CM (cm_profiles.language = « en » : anglais,
# sinon français). La réclamation au support reste en français (équipe Chapote).


class RequestIn(BaseModel):
    claim_token: str = Field(min_length=20, max_length=8000)
    org_id: Optional[int] = None                 # espace d'arrivée (vide = perso)
    message: Optional[str] = Field(default=None, max_length=500)


class DisputeIn(BaseModel):
    message: str = Field(min_length=10, max_length=2000)


def _state(r: CmAccountRequest) -> str:
    return "expired" if r.status == "pending" and r.expires_at <= utcnow() else r.status


def _can_dispute(r: CmAccountRequest) -> bool:
    st = _state(r)
    return r.disputed_at is None and (st in ("declined", "expired") or (st == "pending" and utcnow() - r.created_at >= DISPUTE_AFTER))


def _still_there(r: CmAccountRequest, acc) -> bool:
    return acc is not None and acc.revoked_at is None and (
        (r.from_organization_id is not None and acc.organization_id == r.from_organization_id)
        or (r.from_user_id is not None and acc.owner_user_id == r.from_user_id))


async def _out(db: AsyncSession, r: CmAccountRequest, *, incoming: bool) -> dict:
    acc = await db.get(cm_access.MODELS[r.platform], r.account_id)
    d = {"id": r.id, "platform": r.platform, "account_id": r.account_id,
         "account_name": cm.account_name(r.platform, acc) if acc else None,
         "message": r.message, "status": _state(r), "disputed": r.disputed_at is not None,
         "can_dispute": (not incoming) and _can_dispute(r),
         "expires_at": r.expires_at.isoformat() + "Z", "created_at": r.created_at.isoformat() + "Z"}
    if incoming:
        u = await db.get(User, r.requester_user_id)
        d["requester"] = {"name": u.name if u else None, "email": u.email if u else None}
    return d


async def _admin_emails(db: AsyncSession, acc) -> list[str]:
    if acc.owner_user_id is not None:
        u = await db.get(User, acc.owner_user_id)
        return [u.email] if u and u.email else []
    rows = (await db.execute(select(User.email).join(Membership, Membership.user_id == User.id).where(
        Membership.organization_id == acc.organization_id, Membership.role == "admin"))).scalars().all()
    return [e for e in rows if e]


async def _answerable(db: AsyncSession, user: User, request_id: int):
    """Demande en attente sur un compte que l'utilisateur administre (sinon 404)."""
    r = (await db.execute(select(CmAccountRequest).where(CmAccountRequest.id == request_id).with_for_update())).scalar_one_or_none()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable")
    acc = await db.get(cm_access.MODELS[r.platform], r.account_id)
    tenant = await _tenant_of(db, user, acc) if _still_there(r, acc) else None
    if tenant is None or not cm_access.account_allowed(tenant, r.platform, acc.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable")
    cm_access.require(tenant, "admin")
    if _state(r) != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette demande n'est plus en attente.")
    return r, acc


@router.post("/account-requests")
async def create_request(body: RequestIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    if not await request_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de demandes : réessayez dans une heure.")
    platform, account_id, _tokens = await cm_access.read_claim_token(body.claim_token, user.id)
    dest = await _tenant(db, user, body.org_id)
    cm_access.require(dest, "admin")
    acc = await db.get(cm_access.MODELS[platform], account_id)
    if acc is None or acc.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce compte n'est plus connecté ailleurs : connectez-le simplement.")
    if (dest.org_id is not None and acc.organization_id == dest.org_id) or (dest.org_id is None and acc.owner_user_id == user.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le compte est déjà dans cet espace.")
    now = utcnow()
    same = (await db.execute(select(CmAccountRequest).where(
        CmAccountRequest.platform == platform, CmAccountRequest.account_id == acc.id,
        CmAccountRequest.requester_user_id == user.id, CmAccountRequest.status == "pending",
        CmAccountRequest.expires_at > now))).scalars().all()
    for p in same:                                  # une seule demande en cours par personne et par compte
        p.status, p.resolved_at, p.resolved_by_user_id = "cancelled", now, user.id
    r = CmAccountRequest(platform=platform, account_id=acc.id, requester_user_id=user.id, dest_organization_id=dest.org_id,
                         from_organization_id=acc.organization_id, from_user_id=acc.owner_user_id,
                         message=(body.message or "").strip() or None, status="pending", expires_at=now + REQUEST_TTL)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    name = cm.account_name(platform, acc) or LABEL[platform]
    who = f"{user.name} ({user.email})" if user.name else user.email
    admins = await _admin_emails(db, acc)
    langs = await email_languages(db, admins)
    for lang in {langs.get(e.lower()) for e in admins}:
        text = (trf("{} demande à reprendre le compte {} « {} », relié à votre espace Chapote CM.", lang, who, LABEL[platform], name)
                + "\n\n" + trf("Cette personne vient de se connecter au compte chez {}.", lang, LABEL[platform]) + "\n"
                + (trf("Son message : « {} »", lang, r.message) + "\n" if r.message else "")
                + "\n" + trf("Acceptez ou refusez dans Chapote CM, onglet Comptes (sous 7 jours) :", lang)
                + f"\n{settings.CM_URL.rstrip('/')}/accounts\n\n"
                + trf("Sans réponse, ou en cas de refus, elle pourra s'adresser au support de Chapote, qui tranchera.", lang))
        send_account_email([e for e in admins if langs.get(e.lower()) == lang],
                           trf("Demande de reprise du compte {}", lang, name), text,
                           error_label="cm account request", lang=lang)
    return {"request": await _out(db, r, incoming=False),
            "message": "Demande envoyée : l'espace actuel du compte a 7 jours pour répondre. Vous serez prévenu ici."}


@router.get("/account-requests")
async def list_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    now = utcnow()
    mine = (await db.execute(select(CmAccountRequest).where(
        CmAccountRequest.requester_user_id == user.id, CmAccountRequest.status != "cancelled",
        CmAccountRequest.created_at > now - timedelta(days=30)).order_by(CmAccountRequest.id.desc()))).scalars().all()
    orgs = (await db.execute(select(Membership.organization_id).where(Membership.user_id == user.id))).scalars().all()
    cand = (await db.execute(select(CmAccountRequest).where(
        CmAccountRequest.status == "pending", CmAccountRequest.expires_at > now,
        or_(CmAccountRequest.from_user_id == user.id, CmAccountRequest.from_organization_id.in_(orgs or [-1])))
        .order_by(CmAccountRequest.id))).scalars().all()
    incoming = []
    for r in cand:
        acc = await db.get(cm_access.MODELS[r.platform], r.account_id)
        tenant = await _tenant_of(db, user, acc) if _still_there(r, acc) else None
        if tenant is None or not cm_access.account_allowed(tenant, r.platform, acc.id):
            continue
        try:
            cm_access.require(tenant, "admin")
        except HTTPException:
            continue
        incoming.append(await _out(db, r, incoming=True))
    return {"incoming": incoming, "outgoing": [await _out(db, r, incoming=False) for r in mine]}


@router.post("/account-requests/{request_id}/accept")
async def accept_request(request_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    r, acc = await _answerable(db, user, request_id)
    requester = await db.get(User, r.requester_user_id)
    try:
        dest = await _tenant(db, requester, r.dest_organization_id) if requester else None
        if dest is not None:
            cm_access.require(dest, "admin")
    except HTTPException:
        dest = None
    if dest is None:
        r.status, r.resolved_at, r.resolved_by_user_id = "cancelled", utcnow(), user.id
        await db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "La personne n'a plus accès à l'espace d'arrivée : demande annulée.")
    now = utcnow()
    r.status, r.resolved_at, r.resolved_by_user_id = "accepted", now, user.id
    for t in (await db.execute(select(CmTransfer).where(CmTransfer.platform == r.platform, CmTransfer.account_id == acc.id,
                                                        CmTransfer.status == "pending"))).scalars():
        t.status, t.resolved_at, t.resolved_by_user_id = "cancelled", now, user.id
    others = (await db.execute(select(CmAccountRequest).where(
        CmAccountRequest.platform == r.platform, CmAccountRequest.account_id == acc.id,
        CmAccountRequest.status == "pending", CmAccountRequest.id != r.id))).scalars().all()
    for o in others:
        o.status, o.resolved_at, o.resolved_by_user_id = "cancelled", now, user.id
    result = await cm_access.move_account(db, r.platform, acc, dest, requester.id)
    if requester and requester.email:
        name = cm.account_name(r.platform, acc) or LABEL[r.platform]
        lang = (await email_languages(db, [requester.email])).get(requester.email.lower())
        send_account_email([requester.email], trf("Compte {} : demande acceptée", lang, name),
                           trf("Votre demande a été acceptée : le compte {} « {} » est maintenant dans votre espace Chapote CM, "
                               "avec ses publications à venir.", lang, LABEL[r.platform], name),
                           error_label="cm account request accepted", lang=lang)
    return {"moved": True, **result}


@router.post("/account-requests/{request_id}/decline")
async def decline_request(request_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    r, acc = await _answerable(db, user, request_id)
    r.status, r.resolved_at, r.resolved_by_user_id = "declined", utcnow(), user.id
    await db.commit()
    requester = await db.get(User, r.requester_user_id)
    if requester and requester.email:
        name = cm.account_name(r.platform, acc) or LABEL[r.platform]
        lang = (await email_languages(db, [requester.email])).get(requester.email.lower())
        send_account_email([requester.email], trf("Compte {} : demande refusée", lang, name),
                           trf("L'espace qui gère le compte {} « {} » a refusé votre demande de reprise.", lang, LABEL[r.platform], name)
                           + "\n\n" + trf("Si ce compte vous appartient, vous pouvez faire une réclamation au support depuis Chapote CM (Comptes).", lang),
                           error_label="cm account request declined", lang=lang)
    return {"ok": True}


@router.delete("/account-requests/{request_id}")
async def cancel_request(request_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    r = await db.get(CmAccountRequest, request_id)
    if r is None or r.requester_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable")
    if r.status == "pending":
        r.status, r.resolved_at, r.resolved_by_user_id = "cancelled", utcnow(), user.id
        await db.commit()
    return {"ok": True}


@router.post("/account-requests/{request_id}/dispute")
async def dispute_request(request_id: int, body: DisputeIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    r = await db.get(CmAccountRequest, request_id)
    if r is None or r.requester_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable")
    if r.disputed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Réclamation déjà envoyée : le support vous répond par e-mail.")
    if not _can_dispute(r):
        raise HTTPException(status.HTTP_409_CONFLICT, "Réclamation possible après un refus, ou sans réponse au bout de 3 jours.")
    r.disputed_at, r.dispute_message = utcnow(), body.message.strip()
    await db.commit()
    acc = await db.get(cm_access.MODELS[r.platform], r.account_id)
    org = await db.get(Organization, r.from_organization_id) if r.from_organization_id else None
    owner = await db.get(User, r.from_user_id) if r.from_user_id else None
    text = (f"Réclamation sur la reprise d'un compte (demande n° {r.id}).\n\n"
            f"Demandeur : {user.name or ''} <{user.email}> (utilisateur {user.id})\n"
            f"Compte : {LABEL[r.platform]} « {cm.account_name(r.platform, acc) if acc else '?'} » (id {r.account_id})\n"
            f"Espace actuel : {('équipe « ' + org.name + ' » (' + str(org.id) + ')') if org else ''}"
            f"{('espace perso de ' + (owner.email or str(owner.id))) if owner else ''}\n"
            f"État de la demande : {_state(r)}\n\nMessage :\n{r.dispute_message}")
    send_account_email([SUPPORT_EMAIL], f"Réclamation compte {LABEL[r.platform]} (demande {r.id})", text,
                       error_label="cm account dispute", reply_to=user.email or SUPPORT_EMAIL)
    return {"ok": True, "message": "Réclamation envoyée au support de Chapote : réponse par e-mail sous 5 jours ouvrés."}
