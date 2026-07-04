"""Logique metier des organisations partagee par les routers :
- la garde « dernier admin » (`orgs.py` : leave/update_member/remove_member) ;
- la consommation des invitations en attente a l'inscription (`auth.py`).
"""
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import Invitation, Membership, User


async def count_admins(db: AsyncSession, org_id: int) -> int:
    """Nombre de memberships `role="admin"` de l'organisation."""
    return (await db.execute(
        select(func.count(Membership.id)).where(
            Membership.organization_id == org_id, Membership.role == "admin")
    )).scalar() or 0


async def ensure_not_last_admin(db: AsyncSession, org_id: int, detail: str) -> None:
    """Garde « dernier admin » : leve 422 si l'org n'a plus qu'un seul admin.

    A appeler AVANT de retirer/retrograder un admin (leave, retrogradation
    role->member, suppression de membre). `detail` = message d'erreur (les
    libelles different selon le contexte d'appel)."""
    if (await count_admins(db, org_id)) <= 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)


async def consume_invitations(db: AsyncSession, user: User) -> None:
    """A l'inscription : les invitations en attente pour cet email deviennent
    des memberships. N'effectue PAS de commit (l'appelant commit)."""
    invitations = (await db.execute(
        select(Invitation).where(Invitation.email == user.email)
    )).scalars().all()
    for inv in invitations:
        db.add(Membership(user_id=user.id, organization_id=inv.organization_id,
                          role=inv.role, permissions={}))
        await db.delete(inv)
