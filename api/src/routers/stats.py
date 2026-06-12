"""Stats conversations par bot : messages/jour, visiteurs uniques (UUID widget,
pas IP), repartition tree vs IA, conso du quota. C'est ce qui justifie
l'abonnement cote client."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user, require_org_access
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.user import User
from src.services.usage_service import count_ai_messages_today

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/bots/{bot_id}")
async def bot_stats(
    bot_id: int,
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_org_access(bot.organization_id, user, db)

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    # Totaux
    totals = (await db.execute(
        select(
            func.count(func.distinct(Conversation.id)),
            func.count(func.distinct(Conversation.visitor_id)),
        ).where(Conversation.bot_id == bot_id, Conversation.started_at >= since)
    )).one()

    # Messages visiteurs : whitelist source (exclut les marqueurs systeme
    # [lead]... qui gonfleraient les compteurs)
    msg_totals = (await db.execute(
        select(
            func.count(Message.id).filter(Message.role == "user", Message.source.in_(["ai", "tree"])),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "ai"),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "tree"),
            func.coalesce(func.sum(Message.tokens_in), 0),
            func.coalesce(func.sum(Message.tokens_out), 0),
        ).where(Message.bot_id == bot_id, Message.created_at >= since)
    )).one()

    # Serie journaliere
    day = func.date_trunc("day", Message.created_at)
    daily_rows = (await db.execute(
        select(
            day.label("day"),
            func.count(Message.id).filter(Message.role == "user", Message.source.in_(["ai", "tree"])).label("user_messages"),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "ai").label("ai_replies"),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "tree").label("tree_replies"),
        )
        .where(Message.bot_id == bot_id, Message.created_at >= since)
        .group_by(day)
        .order_by(day)
    )).all()

    # Pages d'ouverture du widget les plus frequentes
    top_pages = (await db.execute(
        select(Conversation.page_url, func.count(Conversation.id).label("n"))
        .where(Conversation.bot_id == bot_id, Conversation.started_at >= since, Conversation.page_url.isnot(None))
        .group_by(Conversation.page_url)
        .order_by(func.count(Conversation.id).desc())
        .limit(10)
    )).all()

    return {
        "days": days,
        "conversations": totals[0],
        "unique_visitors": totals[1],
        "user_messages": msg_totals[0],
        "ai_replies": msg_totals[1],
        "tree_replies": msg_totals[2],
        "tokens_in": msg_totals[3],
        "tokens_out": msg_totals[4],
        "ai_replies_today": await count_ai_messages_today(db, bot_id),
        "daily_ai_message_cap": bot.daily_ai_message_cap,
        "daily": [
            {
                "day": r.day.date().isoformat(),
                "user_messages": r.user_messages,
                "ai_replies": r.ai_replies,
                "tree_replies": r.tree_replies,
            }
            for r in daily_rows
        ],
        "top_pages": [{"page": r.page_url, "conversations": r.n} for r in top_pages],
    }


@router.get("/bots/{bot_id}/conversations")
async def bot_conversations(
    bot_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Dernieres conversations (lecture des echanges pour ameliorer l'arbre)."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_org_access(bot.organization_id, user, db)

    convs = (await db.execute(
        select(Conversation)
        .where(Conversation.bot_id == bot_id)
        .order_by(Conversation.started_at.desc())
        .limit(limit)
    )).scalars().all()

    # Une seule requete pour tous les messages (pas de N+1), regroupes en Python
    msgs_by_conv: dict[str, list[Message]] = {c.id: [] for c in convs}
    if msgs_by_conv:
        msgs = (await db.execute(
            select(Message)
            .where(Message.conversation_id.in_(list(msgs_by_conv)))
            .order_by(Message.created_at)
        )).scalars().all()
        for m in msgs:
            msgs_by_conv[m.conversation_id].append(m)

    return [
        {
            "id": c.id,
            "visitor_id": c.visitor_id,
            "page_url": c.page_url,
            "started_at": c.started_at.isoformat(),
            "messages": [
                {"role": m.role, "source": m.source, "content": m.content, "at": m.created_at.isoformat()}
                for m in msgs_by_conv[c.id]
            ],
        }
        for c in convs
    ]
