"""Back-office superadmin (staff) : vue sur tous les clients, leurs
bots, leurs membres ; changement de plan ; activation/desactivation.

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
from src.models.user import PLANS, Membership, Organization, User
from src.services import stripe_service
from src.services.stripe_service import StripeError
from src.services.usage_service import count_ai_messages_this_month, plan_change_problems, plan_limits

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


class OrgPatch(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None  # valide dynamiquement contre PLANS dans l'endpoint
    is_active: Optional[bool] = None


@router.get("/stats")
async def admin_stats(db: AsyncSession = Depends(get_db)):
    """Agregats du dashboard operateur : MRR (orgs actives), repartition par
    plan, conso IA du mois, inscriptions sur 6 mois. Tout en GROUP BY (jamais
    de N+1). Miroir factuel de la base : la projection est derivee cote front."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    month_start = datetime(now.year, now.month, 1)

    # Repartition par plan — toutes orgs, puis orgs ACTIVES (base du MRR)
    plan_rows = (await db.execute(
        select(Organization.plan, func.count()).group_by(Organization.plan)
    )).all()
    active_rows = (await db.execute(
        select(Organization.plan, func.count())
        .where(Organization.is_active.is_(True))
        .group_by(Organization.plan)
    )).all()
    orgs_by_plan = {p: 0 for p in PLANS}
    for plan, count in plan_rows:
        if plan in orgs_by_plan:
            orgs_by_plan[plan] = count
    active_by_plan = {p: 0 for p in PLANS}
    for plan, count in active_rows:
        if plan in active_by_plan:
            active_by_plan[plan] = count

    orgs_total = sum(count for _, count in plan_rows)
    orgs_active = sum(count for _, count in active_rows)
    mrr_by_plan = {p: active_by_plan[p] * PLANS[p]["price"] for p in PLANS}
    paying_orgs = sum(active_by_plan[p] for p in PLANS if PLANS[p]["price"] > 0)
    ai_quota_month = sum(active_by_plan[p] * PLANS[p]["ai_messages"] for p in PLANS)

    stripe_subscriptions = (await db.execute(
        select(func.count(Organization.id))
        .where(Organization.stripe_subscription_id.isnot(None))
    )).scalar() or 0
    users_total = (await db.execute(select(func.count(User.id)))).scalar() or 0
    bots_total = (await db.execute(select(func.count(Bot.id)))).scalar() or 0

    # Conso IA du mois (cles managees uniquement, comme le quota des orgs)
    ai_messages_month = (await db.execute(
        select(func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Bot.api_key_mode == "managed", Message.source == "ai",
               Message.role == "assistant", Message.created_at >= month_start)
    )).scalar() or 0

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
        "mrr": sum(mrr_by_plan.values()),
        "mrr_by_plan": mrr_by_plan,
        "orgs_total": orgs_total,
        "orgs_active": orgs_active,
        "orgs_suspended": orgs_total - orgs_active,
        "orgs_by_plan": orgs_by_plan,
        "paying_orgs": paying_orgs,
        "stripe_subscriptions": stripe_subscriptions,
        "users_total": users_total,
        "bots_total": bots_total,
        "msgs_7d": msgs_7d,
        "ai_messages_month": ai_messages_month,
        "ai_quota_month": ai_quota_month,
        "signups_by_month": signups_by_month,
    }


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
    # Fetch verrouille : serialise les changements de plan concurrents de la
    # meme org (les garde-fous comptent les bots existants)
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id).with_for_update()
    )).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    if body.plan is not None:
        if body.plan not in PLANS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Plan inconnu : {body.plan}")
        if body.plan != org.plan:
            # Abonnement Stripe actif : le plan est pilote par l'abonnement —
            # un patch local desynchroniserait la facturation et serait ecrase
            # par le prochain webhook customer.subscription.updated
            if stripe_service.billing_enabled() and org.stripe_subscription_id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    "Abonnement Stripe actif : le plan est piloté par l'abonnement. "
                                    "Passez par le portail client ou résiliez l'abonnement d'abord.")
            # Memes garde-fous que le self-serve : un downgrade force laisserait
            # des bots hors plan (dont l'IA BYOK, non coupee par le quota a 0)
            problems = await plan_change_problems(db, org_id, body.plan)
            if problems:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    "Changement de plan impossible : " + " ; ".join(problems))
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(org, field, value)
    await db.commit()
    return {"id": org.id, "name": org.name, "plan": org.plan, "is_active": org.is_active}


@router.get("/invoices")
async def admin_invoices(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Factures Stripe agregees (tout le compte), enrichies du nom d'org via
    le lookup stripe_customer_id. Lues a la demande, pas de table locale."""
    if not stripe_service.billing_enabled():
        return {"billing_enabled": False, "invoices": []}
    try:
        invoices = await stripe_service.list_invoices(limit=min(max(limit, 1), 100))
    except StripeError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Le service de paiement est momentanément indisponible, réessayez")
    orgs = (await db.execute(
        select(Organization).where(Organization.stripe_customer_id.isnot(None))
    )).scalars().all()
    by_customer = {o.stripe_customer_id: o for o in orgs}
    for inv in invoices:
        org = by_customer.get(inv.get("customer"))
        inv["org_id"] = org.id if org else None
        inv["org_name"] = org.name if org else None
    return {"billing_enabled": True, "invoices": invoices}


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
