"""Back-office superadmin (staff Kertios) : vue sur tous les clients, leurs
bots, leurs membres ; changement de plan ; activation/desactivation.

Pour CONFIGURER un bot client, l'admin utilise les memes endpoints /api/bots/*
que les clients (require_org_access laisse passer les superadmins) — le
frontend ouvre simplement la page bot normale.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_superadmin
from src.models.bot import Bot, BotOut
from src.models.conversation import Message
from src.models.user import PLANS, Membership, Organization, User
from src.services.usage_service import count_ai_messages_this_month, plan_limits

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


class OrgPatch(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = Field(None, pattern="^(free|starter|pro|agence)$")
    is_active: Optional[bool] = None


@router.get("/organizations")
async def list_organizations(db: AsyncSession = Depends(get_db)):
    """Tous les clients avec compteurs : membres, bots, conso IA, msgs 7j, MRR."""
    from datetime import datetime, timedelta, timezone

    from src.models.conversation import Message

    orgs = (await db.execute(select(Organization).order_by(Organization.created_at))).scalars().all()

    member_counts = dict((await db.execute(
        select(Membership.organization_id, func.count(Membership.id))
        .group_by(Membership.organization_id)
    )).all())
    bot_counts = dict((await db.execute(
        select(Bot.organization_id, func.count(Bot.id)).group_by(Bot.organization_id)
    )).all())
    byok_counts = dict((await db.execute(
        select(Bot.organization_id, func.count(Bot.id))
        .where(Bot.api_key_mode == "byok")
        .group_by(Bot.organization_id)
    )).all())
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    msgs7 = dict((await db.execute(
        select(Bot.organization_id, func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Message.role == "user", Message.created_at >= since)
        .group_by(Bot.organization_id)
    )).all())
    # Email du premier admin de l'org (contact du client) — roles admin|member
    owners = {}
    for org_id, email in (await db.execute(
        select(Membership.organization_id, User.email)
        .join(User, User.id == Membership.user_id)
        .where(Membership.role == "admin")
        .order_by(Membership.created_at)
    )).all():
        owners.setdefault(org_id, email)

    out = []
    for org in orgs:
        limits = plan_limits(org)
        out.append({
            "id": org.id,
            "name": org.name,
            "type": org.type,
            "plan": org.plan,
            "plan_price": limits["price"],
            "is_active": org.is_active,
            "created_at": org.created_at.isoformat(),
            "contact": owners.get(org.id),
            "members": member_counts.get(org.id, 0),
            "bots": bot_counts.get(org.id, 0),
            "bots_quota": limits["max_bots"],
            "byok": byok_counts.get(org.id, 0) > 0,
            "msgs_7d": msgs7.get(org.id, 0),
            "ai_messages_used": await count_ai_messages_this_month(db, org.id),
            "ai_messages_quota": limits["ai_messages"],
        })
    return out


@router.patch("/organizations/{org_id}")
async def patch_organization(org_id: int, body: OrgPatch, db: AsyncSession = Depends(get_db)):
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    if body.plan is not None:
        # Garde-fou downgrade : le nouveau plan doit pouvoir contenir les bots
        # existants. On ne bloque PAS sur tree_only/bulles : l'IA des bots
        # existants sera coupée naturellement par le quota à 0.
        max_bots = PLANS[body.plan]["max_bots"]
        bot_count = (await db.execute(
            select(func.count(Bot.id)).where(Bot.organization_id == org_id)
        )).scalar_one()
        if bot_count > max_bots:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Le client a {bot_count} bots, le plan {body.plan} en autorise "
                f"{max_bots} — supprimez des bots d'abord")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(org, field, value)
    await db.commit()
    return {"id": org.id, "name": org.name, "plan": org.plan, "is_active": org.is_active}


@router.get("/organizations/{org_id}/bots", response_model=list[BotOut])
async def org_bots(org_id: int, db: AsyncSession = Depends(get_db)):
    from src.services.usage_service import bots_week_stats

    result = await db.execute(select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at))
    week = await bots_week_stats(db, org_id)
    out = []
    for b in result.scalars().all():
        bo = BotOut.from_bot(b)
        bo.msgs_7d = week.get(b.id, {}).get("msgs_7d", 0)
        bo.visitors_7d = week.get(b.id, {}).get("visitors_7d", 0)
        out.append(bo)
    return out


@router.get("/organizations/{org_id}/members")
async def org_members(org_id: int, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.organization_id == org_id)
        .order_by(User.name)
    )).all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": role,
             "auth_source": u.auth_source, "is_active": u.is_active} for u, role in rows]


@router.get("/users")
async def list_users(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.created_at))).scalars().all()
    return [{
        "id": u.id, "name": u.name, "email": u.email,
        "auth_source": u.auth_source, "is_superadmin": u.is_superadmin,
        "is_active": u.is_active,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    } for u in users]
