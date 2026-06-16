"""Organisations : equipe & permissions par bot, invitations,
conversion perso -> entreprise.

Roles : admin (tout) / member (permissions fines par bot). La gestion d'equipe
est reservee aux admins de l'org (et au staff superadmin).
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user, require_org_access, require_org_admin
from src.models.user import BOT_PERMS, Invitation, Membership, Organization, User

router = APIRouter(prefix="/api/orgs", tags=["organizations"])


class MemberAdd(BaseModel):
    email: EmailStr
    role: str = Field("member", pattern="^(admin|member)$")


class MemberPatch(BaseModel):
    role: Optional[str] = Field(None, pattern="^(admin|member)$")
    permissions: Optional[dict[str, Any]] = None


class OrgPatch(BaseModel):
    name: Optional[str] = None


class OrgCreate(BaseModel):
    name: str


def _clean_permissions(perms: dict[str, Any]) -> dict[str, list[str]]:
    return {
        str(bot_id): [p for p in plist if p in BOT_PERMS]
        for bot_id, plist in perms.items()
        if isinstance(plist, list)
    }


async def _get_org(db: AsyncSession, org_id: int) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    return org


@router.post("")
async def create_org(body: OrgCreate, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """Creation d'une organisation supplementaire, le createur en devient admin
    — meme pattern que le register."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom d'organisation requis")
    org = Organization(name=name[:120])
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role="admin", permissions={}))
    await db.commit()
    return {"id": org.id, "name": org.name, "role": "admin"}


@router.post("/{org_id}/leave")
async def leave_org(org_id: int, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Quitter une organisation (les members aussi : pas de require_org_admin).
    404 sans membership (anti-enumeration) — un superadmin non membre recoit
    donc 404, le front lui masque le bouton."""
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user.id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    if membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible de quitter l'organisation : vous en êtes le dernier admin — nommez d'abord un autre admin")
    await db.delete(membership)
    await db.commit()
    return {"left": True}


@router.patch("/{org_id}")
async def patch_org(org_id: int, body: OrgPatch, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Renommer l'org (une organisation est toujours une equipe : plus de
    notion de type ni de conversion)."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        org.name = data["name"].strip()
    await db.commit()
    return {"id": org.id, "name": org.name}


# ---------- Équipe ----------

@router.get("/{org_id}/members")
async def list_members(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_access(org_id, user, db)
    rows = (await db.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.organization_id == org_id)
        .order_by(Membership.created_at)
    )).all()
    invitations = (await db.execute(
        select(Invitation).where(Invitation.organization_id == org_id).order_by(Invitation.created_at)
    )).scalars().all()
    return {
        "members": [
            {"id": u.id, "name": u.name, "email": u.email, "role": m.role,
             "permissions": m.permissions or {}, "you": u.id == user.id}
            for u, m in rows
        ],
        "invitations": [
            {"id": i.id, "email": i.email, "role": i.role} for i in invitations
        ],
    }


@router.post("/{org_id}/members")
async def invite_member(org_id: int, body: MemberAdd, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Compte existant -> membre direct ; sinon invitation en attente,
    consommee quand la personne cree son compte avec cet email."""
    await require_org_admin(org_id, user, db)
    await _get_org(db, org_id)

    email = body.email.lower()
    target = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if target:
        existing = await db.execute(select(Membership).where(
            Membership.user_id == target.id, Membership.organization_id == org_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status.HTTP_409_CONFLICT, "Déjà membre de cette organisation")
        db.add(Membership(user_id=target.id, organization_id=org_id, role=body.role, permissions={}))
        await db.commit()
        return {"joined": True, "user_id": target.id}

    existing_inv = await db.execute(select(Invitation).where(
        Invitation.email == email, Invitation.organization_id == org_id))
    if existing_inv.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Invitation déjà envoyée à cet email")
    db.add(Invitation(organization_id=org_id, email=email, role=body.role))
    await db.commit()
    return {"joined": False, "pending": True}


@router.patch("/{org_id}/members/{user_id}")
async def update_member(org_id: int, user_id: int, body: MemberPatch,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Changer le role ou les permissions par bot d'un membre (admin only)."""
    await require_org_admin(org_id, user, db)
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user_id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")

    data = body.model_dump(exclude_unset=True)
    if data.get("role") == "member" and membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible : il faut au moins un admin dans l'organisation")
    if "role" in data and data["role"]:
        membership.role = data["role"]
    if "permissions" in data and data["permissions"] is not None:
        membership.permissions = _clean_permissions(data["permissions"])
    await db.commit()
    return {"role": membership.role, "permissions": membership.permissions}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(org_id: int, user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_admin(org_id, user, db)
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user_id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")
    if membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible de retirer le dernier admin")
    await db.delete(membership)
    await db.commit()
    return {"removed": True}


@router.delete("/{org_id}/invitations/{invitation_id}")
async def cancel_invitation(org_id: int, invitation_id: int,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_admin(org_id, user, db)
    inv = await db.get(Invitation, invitation_id)
    if inv is None or inv.organization_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation introuvable")
    await db.delete(inv)
    await db.commit()
    return {"cancelled": True}
