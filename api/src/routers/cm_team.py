"""cm.chapote.fr — équipe (membres, rôles cm, groupes autorisés) et transferts de comptes.

Équipe (une organisation Chapote) :
  GET    /api/cm/team?org_id=                     membres, invitations, mon rôle
  POST   /api/cm/team                             créer une équipe (on en devient admin)
  POST   /api/cm/team/{org}/members               inviter (compte existant : membre direct ; sinon invitation)
  PATCH  /api/cm/team/{org}/members/{email}       rôle cm (admin | editor | viewer) et groupes autorisés
  DELETE /api/cm/team/{org}/members/{user_id}     retirer de l'équipe
  DELETE /api/cm/team/{org}/invitations/{id}      annuler une invitation
Inviter / retirer : administrateur de l'équipe chapote.fr. Rôles cm : admin cm ou de l'équipe.

Comptes (un compte = un seul espace Chapote) :
  POST   /api/cm/accounts/{platform}/{id}/transfer  vers un de mes espaces (immédiat) ou une personne (à accepter)
  GET    /api/cm/transfers                          reçus (à accepter) et envoyés (en attente)
  POST   /api/cm/transfers/{id}/accept|decline ; DELETE /api/cm/transfers/{id} (annuler)
  POST   /api/cm/accounts/claim                     reprise par preuve (jeton reçu en connectant le compte
                                                    chez la plateforme alors qu'il était relié ailleurs)
Le compte part avec son planning À VENIR ; l'historique reste dans l'ancien espace.
"""
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.time import utcnow
from src.models.cm import IG_MODE_API, CmGroup, CmMemberRole, CmTransfer
from src.models.user import Invitation, Membership, Organization, User
from src.routers.cm import get_cm_user
from src.routers.tiktok import Tenant, _tenant
from src.services import cm_access
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import tiktok_service as tt
from src.services import youtube_service as yt
from src.services.email_service import send_org_member_email
from src.services.org_service import ensure_not_last_admin
from src.services.rate_limit import RateLimiter

router = APIRouter(prefix="/api/cm", tags=["cm-team"])

invite_limiter = RateLimiter("rl:cminvite:", 40, 3600)
transfer_limiter = RateLimiter("rl:cmtransfer:", 20, 3600)
TRANSFER_TTL = timedelta(days=14)


# --------------------------------------------------------------------------
# Équipe
# --------------------------------------------------------------------------

async def _org_admin(db: AsyncSession, user: User, org_id: int) -> Membership:
    m = (await db.execute(select(Membership).where(Membership.user_id == user.id,
                                                   Membership.organization_id == org_id))).scalar_one_or_none()
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Équipe introuvable")
    if m.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Seul un administrateur de l'équipe peut gérer ses membres.")
    return m


async def _valid_groups(db: AsyncSession, org_id: int, ids: Optional[list[int]]) -> Optional[list[int]]:
    if not ids:
        return None
    rows = list((await db.execute(select(CmGroup.id).where(CmGroup.id.in_(ids), CmGroup.organization_id == org_id))).scalars())
    if len(rows) != len(set(ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Groupe inconnu dans cette équipe.")
    return sorted(rows)


async def _set_role(db: AsyncSession, org_id: int, email: str, role: str, group_ids: Optional[list[int]]) -> None:
    row = (await db.execute(select(CmMemberRole).where(CmMemberRole.organization_id == org_id,
                                                       CmMemberRole.email == email))).scalar_one_or_none()
    if row is None:
        row = CmMemberRole(organization_id=org_id, email=email)
        db.add(row)
    row.role = role
    row.group_ids = None if role == "admin" else group_ids


@router.get("/team")
async def get_team(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    org = await db.get(Organization, org_id)
    roles = {r.email: r for r in (await db.execute(select(CmMemberRole).where(CmMemberRole.organization_id == org_id))).scalars()}
    rows = (await db.execute(select(User, Membership).join(Membership, Membership.user_id == User.id)
                             .where(Membership.organization_id == org_id).order_by(Membership.created_at))).all()
    members = []
    for u, m in rows:
        r = roles.get((u.email or "").lower())
        cm_role = "admin" if m.role == "admin" else (r.role if r else "editor")
        members.append({"user_id": u.id, "name": u.name, "email": u.email, "org_role": m.role, "cm_role": cm_role,
                        "group_ids": None if cm_role == "admin" else (r.group_ids if r else None),
                        "is_owner": org.owner_user_id == u.id, "you": u.id == user.id})
    invites = []
    for i in (await db.execute(select(Invitation).where(Invitation.organization_id == org_id))).scalars():
        r = roles.get(i.email.lower())
        invites.append({"id": i.id, "email": i.email, "org_role": i.role,
                        "cm_role": "admin" if i.role == "admin" else (r.role if r else "editor"),
                        "group_ids": r.group_ids if r else None})
    return {"org_id": org_id, "name": org.name, "my_role": tenant.cm_role, "my_group_ids": tenant.group_ids,
            "can_manage_members": tenant.role == "admin", "can_manage_roles": tenant.cm_role == "admin",
            "members": members, "invitations": invites}


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.post("/team")
async def create_team(body: TeamIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Donnez un nom à l'équipe.")
    count = (await db.execute(select(func.count()).select_from(Organization).where(Organization.owner_user_id == user.id))).scalar() or 0
    if count >= 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "10 équipes au plus par compte.")
    org = Organization(name=name[:120], owner_user_id=user.id)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role="admin", permissions={}))
    await db.commit()
    return {"org_id": org.id, "name": org.name}


class MemberIn(BaseModel):
    email: EmailStr
    role: Literal["admin", "editor", "viewer"] = "editor"
    group_ids: Optional[list[int]] = None


@router.post("/team/{org_id}/members")
async def invite(org_id: int, body: MemberIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    await _org_admin(db, user, org_id)
    if not await invite_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'invitations : réessayez dans une heure.")
    org = await db.get(Organization, org_id)
    email = body.email.lower()
    groups = await _valid_groups(db, org_id, body.group_ids)
    org_role = "admin" if body.role == "admin" else "member"
    target = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if target:
        exists = (await db.execute(select(Membership).where(Membership.user_id == target.id,
                                                            Membership.organization_id == org_id))).scalar_one_or_none()
        if exists:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cette personne fait déjà partie de l'équipe.")
        db.add(Membership(user_id=target.id, organization_id=org_id, role=org_role, permissions={}))
    else:
        exists = (await db.execute(select(Invitation).where(Invitation.email == email,
                                                            Invitation.organization_id == org_id))).scalar_one_or_none()
        if exists:
            raise HTTPException(status.HTTP_409_CONFLICT, "Une invitation est déjà en attente pour cette adresse.")
        db.add(Invitation(organization_id=org_id, email=email, role=org_role))
    await _set_role(db, org_id, email, body.role, groups)
    await db.commit()
    send_org_member_email(email, org.name, org_role, existing=target is not None,
                          app_url=settings.CM_URL or settings.APP_URL)
    return {"joined": target is not None}


class RoleIn(BaseModel):
    role: Literal["admin", "editor", "viewer"]
    group_ids: Optional[list[int]] = None


@router.patch("/team/{org_id}/members/{email}")
async def set_role(org_id: int, email: str, body: RoleIn, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "admin")
    email = email.lower()
    member = (await db.execute(select(Membership).join(User, User.id == Membership.user_id).where(
        Membership.organization_id == org_id, func.lower(User.email) == email))).scalar_one_or_none()
    pending = (await db.execute(select(Invitation).where(Invitation.organization_id == org_id,
                                                         Invitation.email == email))).scalar_one_or_none()
    if member is None and pending is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")
    if (member and member.role == "admin") or (pending and pending.role == "admin"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Un administrateur de l'équipe est toujours administrateur dans cm : changez son rôle d'équipe d'abord.")
    if member and member.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vous ne pouvez pas changer votre propre rôle.")
    await _set_role(db, org_id, email, body.role, await _valid_groups(db, org_id, body.group_ids))
    await db.commit()
    return {"ok": True}


@router.delete("/team/{org_id}/members/{user_id}")
async def remove_member(org_id: int, user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    await _org_admin(db, user, org_id)
    m = (await db.execute(select(Membership).where(Membership.user_id == user_id,
                                                   Membership.organization_id == org_id))).scalar_one_or_none()
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")
    if m.role == "admin":
        await ensure_not_last_admin(db, org_id, "Impossible de retirer le dernier administrateur de l'équipe.")
    target = await db.get(User, user_id)
    await db.delete(m)
    if target:
        row = (await db.execute(select(CmMemberRole).where(CmMemberRole.organization_id == org_id,
                                                           CmMemberRole.email == (target.email or "").lower()))).scalar_one_or_none()
        if row:
            await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.delete("/team/{org_id}/invitations/{invitation_id}")
async def cancel_invitation(org_id: int, invitation_id: int, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_cm_user)):
    await _org_admin(db, user, org_id)
    inv = await db.get(Invitation, invitation_id)
    if inv is None or inv.organization_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation introuvable")
    row = (await db.execute(select(CmMemberRole).where(CmMemberRole.organization_id == org_id,
                                                       CmMemberRole.email == inv.email.lower()))).scalar_one_or_none()
    await db.delete(inv)
    if row:
        await db.delete(row)
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# Transferts de comptes
# --------------------------------------------------------------------------

class TransferIn(BaseModel):
    org_id: Optional[int] = None              # espace actuel du compte
    to_org_id: Optional[int] = None           # vers une de mes équipes…
    to_perso: bool = False                    # … ou mon espace perso
    to_email: Optional[EmailStr] = None       # … ou une autre personne (elle doit accepter)


async def _dest(db: AsyncSession, user: User, org_id: Optional[int]) -> Tenant:
    dest = await _tenant(db, user, org_id)
    cm_access.require(dest, "admin")
    return dest


def _transfer_out(t: CmTransfer, acc, names: dict) -> dict:
    return {"id": t.id, "platform": t.platform, "account_id": t.account_id,
            "account_name": cm.account_name(t.platform, acc) if acc else None,
            "to_email": t.to_email, "from": names.get(t.id), "status": t.status,
            "expires_at": t.expires_at.isoformat() + "Z", "created_at": t.created_at.isoformat() + "Z"}


@router.post("/accounts/{platform}/{account_id}/transfer")
async def transfer(platform: Literal["tiktok", "youtube", "instagram"], account_id: int, body: TransferIn,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, body.org_id)
    acc = await cm.get_account(db, tenant, platform, account_id)
    cm_access.require(tenant, "admin")
    if not await transfer_limiter.check(f"{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de transferts : réessayez dans une heure.")
    if body.to_email:
        email = body.to_email.lower()
        if email == (user.email or "").lower():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pour l'envoyer vers un de vos espaces, choisissez-le dans la liste.")
        pending = (await db.execute(select(CmTransfer).where(CmTransfer.platform == platform, CmTransfer.account_id == acc.id,
                                                             CmTransfer.status == "pending"))).scalars().all()
        for p in pending:
            p.status, p.resolved_at, p.resolved_by_user_id = "cancelled", utcnow(), user.id
        db.add(CmTransfer(platform=platform, account_id=acc.id, from_organization_id=tenant.org_id,
                          from_user_id=tenant.owner_user_id, created_by_user_id=user.id, to_email=email,
                          status="pending", expires_at=utcnow() + TRANSFER_TTL))
        await db.commit()
        return {"pending": True, "message": f"Transfert proposé à {email} : il sera fait quand cette personne l'acceptera dans cm."}
    if not body.to_perso and body.to_org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choisissez la destination du compte.")
    dest = await _dest(db, user, None if body.to_perso else body.to_org_id)
    if dest.key == tenant.key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le compte est déjà dans cet espace.")
    result = await cm_access.move_account(db, platform, acc, dest, user.id)
    return {"moved": True, **result}


@router.get("/transfers")
async def list_transfers(db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    now = utcnow()
    incoming = (await db.execute(select(CmTransfer).where(CmTransfer.to_email == (user.email or "").lower(),
                                                          CmTransfer.status == "pending", CmTransfer.expires_at > now))).scalars().all()
    outgoing = (await db.execute(select(CmTransfer).where(CmTransfer.created_by_user_id == user.id,
                                                          CmTransfer.status == "pending", CmTransfer.expires_at > now))).scalars().all()
    names: dict[int, str] = {}
    for t in incoming:
        sender = await db.get(User, t.created_by_user_id) if t.created_by_user_id else None
        names[t.id] = (sender.name or sender.email) if sender else None
    out = {"incoming": [], "outgoing": []}
    for key, rows in (("incoming", incoming), ("outgoing", outgoing)):
        for t in rows:
            acc = await db.get(cm_access.MODELS[t.platform], t.account_id)
            out[key].append(_transfer_out(t, acc, names))
    return out


class AcceptIn(BaseModel):
    org_id: Optional[int] = None              # espace d'arrivée (vide = perso)


async def _incoming(db: AsyncSession, user: User, transfer_id: int) -> CmTransfer:
    t = (await db.execute(select(CmTransfer).where(CmTransfer.id == transfer_id).with_for_update())).scalar_one_or_none()
    if t is None or t.to_email != (user.email or "").lower():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfert introuvable")
    if t.status != "pending" or t.expires_at <= utcnow():
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce transfert n'est plus en attente.")
    return t


@router.post("/transfers/{transfer_id}/accept")
async def accept_transfer(transfer_id: int, body: AcceptIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_cm_user)):
    t = await _incoming(db, user, transfer_id)
    acc = await db.get(cm_access.MODELS[t.platform], t.account_id)
    still = acc is not None and acc.revoked_at is None and (
        (t.from_organization_id and acc.organization_id == t.from_organization_id)
        or (t.from_user_id and acc.owner_user_id == t.from_user_id))
    if not still:
        t.status, t.resolved_at = "cancelled", utcnow()
        await db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce compte n'est plus dans l'espace qui l'a proposé : transfert annulé.")
    dest = await _dest(db, user, body.org_id)
    t.status, t.resolved_at, t.resolved_by_user_id = "accepted", utcnow(), user.id
    result = await cm_access.move_account(db, t.platform, acc, dest, user.id)
    return {"moved": True, **result}


@router.post("/transfers/{transfer_id}/decline")
async def decline_transfer(transfer_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    t = await _incoming(db, user, transfer_id)
    t.status, t.resolved_at, t.resolved_by_user_id = "declined", utcnow(), user.id
    await db.commit()
    return {"ok": True}


@router.delete("/transfers/{transfer_id}")
async def cancel_transfer(transfer_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    t = await db.get(CmTransfer, transfer_id)
    if t is None or t.created_by_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfert introuvable")
    if t.status == "pending":
        t.status, t.resolved_at, t.resolved_by_user_id = "cancelled", utcnow(), user.id
        await db.commit()
    return {"ok": True}


class ClaimIn(BaseModel):
    claim_token: str = Field(min_length=20, max_length=8000)
    org_id: Optional[int] = None


@router.post("/accounts/claim")
async def claim(body: ClaimIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Reprise d'un compte relié ailleurs : la personne vient de s'y connecter chez la plateforme
    (preuve qu'elle le contrôle). Le compte arrive ici avec son planning à venir et les nouveaux jetons."""
    platform, account_id, tok = await cm_access.read_claim_token(body.claim_token, user.id)
    dest = await _dest(db, user, body.org_id)
    acc = await db.get(cm_access.MODELS[platform], account_id)
    if acc is None or acc.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce compte n'est plus connecté ailleurs : connectez-le simplement.")
    if platform == "tiktok":
        tt.apply_tokens(acc, tok)
    elif platform == "youtube":
        yt.apply_tokens(acc, tok)
    else:
        prof = tok.get("_profile") or {}
        ig.apply_long_token(acc, tok)
        acc.mode, acc.ig_user_id = IG_MODE_API, tok.get("_ig_id") or acc.ig_user_id
        acc.username = prof.get("username") or acc.username
        acc.scopes = tok.get("_scopes") or acc.scopes
    acc.needs_reconnect = False
    for p in (await db.execute(select(CmTransfer).where(CmTransfer.platform == platform, CmTransfer.account_id == acc.id,
                                                        CmTransfer.status == "pending"))).scalars():
        p.status, p.resolved_at, p.resolved_by_user_id = "cancelled", utcnow(), user.id
    result = await cm_access.move_account(db, platform, acc, dest, user.id)
    return {"moved": True, **result}

