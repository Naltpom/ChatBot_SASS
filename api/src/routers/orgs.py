"""Organisations : usage du plan, equipe & permissions par bot, invitations,
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
from src.models.bot import Bot
from src.models.user import BOT_PERMS, PLANS, Invitation, Membership, Organization, User
from src.services.usage_service import count_ai_messages_this_month, count_bots, plan_limits

router = APIRouter(prefix="/api/orgs", tags=["organizations"])


class MemberAdd(BaseModel):
    email: EmailStr
    role: str = Field("member", pattern="^(admin|member)$")


class MemberPatch(BaseModel):
    role: Optional[str] = Field(None, pattern="^(admin|member)$")
    permissions: Optional[dict[str, Any]] = None


class OrgPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = Field(None, pattern="^(perso|entreprise)$")


class PlanChange(BaseModel):
    plan: str  # validé dans l'endpoint pour renvoyer un detail FR exploitable


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


@router.get("/{org_id}/usage")
async def org_usage(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_access(org_id, user, db)
    org = await _get_org(db, org_id)
    limits = plan_limits(org)
    return {
        "plan": org.plan,
        "plan_price": limits["price"],
        "type": org.type,
        "ai_messages_used": await count_ai_messages_this_month(db, org_id),
        "ai_messages_quota": limits["ai_messages"],
        "bots_used": await count_bots(db, org_id),
        "bots_quota": limits["max_bots"],
        "tree_only": limits.get("tree_only", False),
        "max_tree_nodes": limits.get("max_tree_nodes"),
    }


@router.patch("/{org_id}")
async def patch_org(org_id: int, body: OrgPatch, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Renommer l'org, ou convertir perso -> entreprise (jamais l'inverse :
    une entreprise peut avoir plusieurs membres)."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("type") == "perso" and org.type == "entreprise":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Une entreprise ne peut pas repasser en compte personnel")
    if "name" in data and data["name"]:
        org.name = data["name"].strip()
    if "type" in data and data["type"]:
        org.type = data["type"]
    await db.commit()
    return {"id": org.id, "name": org.name, "type": org.type}


# ---------- Facturation / plan ----------

@router.post("/{org_id}/plan")
async def change_plan(org_id: int, body: PlanChange,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Changement de plan self-serve par un admin de l'organisation
    (superadmin passe). Miroir client du PATCH superadmin de admin.py, avec
    des garde-fous de downgrade plus stricts : le nouveau plan doit pouvoir
    contenir les bots EXISTANTS (nombre, mode, taille d'arbre).

    TODO Stripe — brancher ici le checkout (upgrade) et le portail client
    (downgrade / moyens de paiement). Pour l'instant : changement immédiat,
    sans paiement.
    """
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)

    if body.plan not in PLANS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Plan inconnu : {body.plan}")
    if body.plan == org.plan:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"L'organisation est déjà sur le plan {org.plan}")

    new_limits = PLANS[body.plan]
    bots = (await db.execute(
        select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at)
    )).scalars().all()
    problems: list[str] = []

    # 1. Nombre de bots : le nouveau plan doit contenir tous les bots existants
    if len(bots) > new_limits["max_bots"]:
        names = ", ".join(b.name for b in bots)
        problems.append(
            f"le plan {body.plan} autorise {new_limits['max_bots']} bot(s) et "
            f"l'organisation en a {len(bots)} ({names}) — supprimez des bots d'abord")

    # 2. tree_only : aucun bot ne doit utiliser l'IA (mode ai ou hybrid)
    if new_limits.get("tree_only"):
        non_tree = [b.name for b in bots if b.mode != "tree"]
        if non_tree:
            problems.append(
                f"le plan {body.plan} est limité au mode arbre, or ces bots "
                f"utilisent l'IA : {', '.join(non_tree)} — passez-les en mode arbre d'abord")

    # 3. Taille des arbres : quota de bulles (nœuds) du nouveau plan
    max_nodes = new_limits.get("max_tree_nodes")
    if max_nodes is not None:
        oversized = []
        for b in bots:
            count = len((b.tree_json or {}).get("nodes") or {})
            if count > max_nodes:
                oversized.append(f"{b.name} ({count} bulles)")
        if oversized:
            problems.append(
                f"le plan {body.plan} est limité à {max_nodes} bulles par arbre, "
                f"dépassé par : {', '.join(oversized)} — allégez ces arbres d'abord")

    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Changement de plan impossible : " + " ; ".join(problems))

    org.plan = body.plan
    await db.commit()
    return {"id": org.id, "name": org.name, "type": org.type, "plan": org.plan}


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
    org = await _get_org(db, org_id)
    if org.type == "perso":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Compte personnel : convertissez l'espace en entreprise pour inviter")

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
