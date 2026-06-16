"""Back-office superadmin (staff) : vue sur tous les clients, leurs
bots, leurs membres ; activation/desactivation.

Pour CONFIGURER un bot client, l'admin utilise les memes endpoints /api/bots/*
que les clients (require_org_access laisse passer les superadmins) — le
frontend ouvre simplement la page bot normale.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_superadmin
from src.models.bot import Bot, BotOut
from src.models.conversation import Message
from src.models.user import Membership, Organization, User

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


class OrgPatch(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/stats")
async def admin_stats(db: AsyncSession = Depends(get_db)):
    """Agregats du dashboard operateur : orgs/users/bots, messages 7 jours,
    abonnements Stripe (dormant), inscriptions sur 6 mois. Tout en GROUP BY
    (jamais de N+1). Miroir factuel de la base."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    orgs_total = (await db.execute(select(func.count(Organization.id)))).scalar() or 0
    orgs_active = (await db.execute(
        select(func.count(Organization.id)).where(Organization.is_active.is_(True))
    )).scalar() or 0

    stripe_subscriptions = (await db.execute(
        select(func.count(Organization.id))
        .where(Organization.stripe_subscription_id.isnot(None))
    )).scalar() or 0
    users_total = (await db.execute(select(func.count(User.id)))).scalar() or 0
    bots_total = (await db.execute(select(func.count(Bot.id)))).scalar() or 0

    # Messages visiteurs 7 jours (whitelist source : exclut les marqueurs [lead])
    since = now - timedelta(days=7)
    msgs_7d = (await db.execute(
        select(func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Message.role == "user", Message.source.in_(["ai", "tree"]),
               Message.created_at >= since)
    )).scalar() or 0

    # Inscriptions par mois calendaire — 6 mois glissants, mois courant inclus
    months: list[tuple[int, int]] = []
    y, m = now.year, now.month
    for _ in range(6):
        months.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    six_start = datetime(months[0][0], months[0][1], 1)

    async def _by_month(model) -> dict[str, int]:
        month_expr = func.date_trunc("month", model.created_at)
        rows = (await db.execute(
            select(month_expr, func.count())
            .where(model.created_at >= six_start)
            .group_by(month_expr)
        )).all()
        return {d.strftime("%Y-%m"): count for d, count in rows}

    org_signups = await _by_month(Organization)
    user_signups = await _by_month(User)
    signups_by_month = [
        {"month": f"{y:04d}-{m:02d}",
         "orgs": org_signups.get(f"{y:04d}-{m:02d}", 0),
         "users": user_signups.get(f"{y:04d}-{m:02d}", 0)}
        for y, m in months
    ]

    return {
        "orgs_total": orgs_total,
        "orgs_active": orgs_active,
        "orgs_suspended": orgs_total - orgs_active,
        "stripe_subscriptions": stripe_subscriptions,
        "users_total": users_total,
        "bots_total": bots_total,
        "msgs_7d": msgs_7d,
        "signups_by_month": signups_by_month,
    }


@router.get("/organizations")
async def list_organizations(db: AsyncSession = Depends(get_db)):
    """Tous les clients avec compteurs : membres, bots, msgs 7j."""
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
    # Whitelist source : exclut les marqueurs systeme ([lead]...) des compteurs
    msgs7 = dict((await db.execute(
        select(Bot.organization_id, func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Message.role == "user", Message.source.in_(["ai", "tree"]),
               Message.created_at >= since)
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
        out.append({
            "id": org.id,
            "name": org.name,
            "type": org.type,
            "is_active": org.is_active,
            "created_at": org.created_at.isoformat(),
            "contact": owners.get(org.id),
            "members": member_counts.get(org.id, 0),
            "bots": bot_counts.get(org.id, 0),
            "byok": byok_counts.get(org.id, 0) > 0,
            "msgs_7d": msgs7.get(org.id, 0),
        })
    return out


@router.patch("/organizations/{org_id}")
async def patch_organization(org_id: int, body: OrgPatch, db: AsyncSession = Depends(get_db)):
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(org, field, value)
    await db.commit()
    return {"id": org.id, "name": org.name, "is_active": org.is_active}


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
