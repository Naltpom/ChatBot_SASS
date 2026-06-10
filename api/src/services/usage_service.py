"""Compteurs d'usage : cap IA quotidien par bot, quota mensuel du plan de l'ORG.

Les reponses TREE sont illimitees. Seules les reponses IA comptent :
- cap quotidien par bot (protection cash-flow) -> mode degrade tree-only
- quota mensuel du plan de l'organisation si api_key_mode=managed (BYOK : pas
  de decompte)
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.bot import Bot
from src.models.conversation import Message
from src.models.user import PLANS, Organization


def _today_start() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day)


def _month_start() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1)


async def count_ai_messages_today(db: AsyncSession, bot_id: int) -> int:
    result = await db.execute(
        select(func.count(Message.id)).where(
            Message.bot_id == bot_id,
            Message.source == "ai",
            Message.role == "assistant",
            Message.created_at >= _today_start(),
        )
    )
    return result.scalar() or 0


async def count_ai_messages_this_month(db: AsyncSession, org_id: int) -> int:
    result = await db.execute(
        select(func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(
            Bot.organization_id == org_id,
            Bot.api_key_mode == "managed",
            Message.source == "ai",
            Message.role == "assistant",
            Message.created_at >= _month_start(),
        )
    )
    return result.scalar() or 0


async def bots_week_stats(db: AsyncSession, org_id: int) -> dict[int, dict]:
    """Par bot de l'org : messages utilisateur et visiteurs uniques sur 7 jours
    (pour les cards de la liste)."""
    from src.models.conversation import Conversation

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    msg_rows = (await db.execute(
        select(Message.bot_id, func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Bot.organization_id == org_id, Message.role == "user", Message.created_at >= since)
        .group_by(Message.bot_id)
    )).all()
    visitor_rows = (await db.execute(
        select(Conversation.bot_id, func.count(func.distinct(Conversation.visitor_id)))
        .join(Bot, Bot.id == Conversation.bot_id)
        .where(Bot.organization_id == org_id, Conversation.started_at >= since)
        .group_by(Conversation.bot_id)
    )).all()
    out: dict[int, dict] = {}
    for bot_id, n in msg_rows:
        out.setdefault(bot_id, {})["msgs_7d"] = n
    for bot_id, n in visitor_rows:
        out.setdefault(bot_id, {})["visitors_7d"] = n
    return out


async def count_bots(db: AsyncSession, org_id: int) -> int:
    result = await db.execute(
        select(func.count(Bot.id)).where(Bot.organization_id == org_id)
    )
    return result.scalar() or 0


def plan_limits(org: Organization) -> dict:
    return PLANS.get(org.plan, PLANS["free"])


async def ai_allowed(db: AsyncSession, bot: Bot, org: Organization) -> tuple[bool, str]:
    """(autorise, raison_du_refus). Verifie cap quotidien bot + quota mensuel org."""
    if await count_ai_messages_today(db, bot.id) >= bot.daily_ai_message_cap:
        return False, "daily_cap"
    if bot.api_key_mode == "managed":
        if await count_ai_messages_this_month(db, bot.organization_id) >= plan_limits(org)["ai_messages"]:
            return False, "plan_quota"
    return True, ""
