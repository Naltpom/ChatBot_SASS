"""Compteurs d'usage : reponses IA du jour par bot, statistiques hebdomadaires.

Il n'y a PLUS de cap IA ni de quota mensuel ni de notion de plan : l'application
est entierement ouverte. `count_ai_messages_today` n'est plus un garde-fou
cash-flow mais un simple COMPTEUR D'AFFICHAGE (ai_replies_today) montre dans le
dashboard ; aucune logique ne bloque sur cette valeur.
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import VISITOR_SOURCES
from src.core.time import utcnow
from src.models.bot import Bot
from src.models.conversation import Message


def _today_start() -> datetime:
    # Minuit UTC du jour courant, en datetime NAÏF (comme les colonnes DateTime
    # sans timezone) : utcnow() est naïf UTC -> mêmes year/month/day qu'avant.
    now = utcnow()
    return datetime(now.year, now.month, now.day)


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


async def bots_week_stats(db: AsyncSession, org_id: int) -> dict[int, dict]:
    """Par bot de l'org : messages utilisateur et visiteurs uniques sur 7 jours
    (pour les cards de la liste)."""
    ids = (await db.execute(
        select(Bot.id).where(Bot.organization_id == org_id)
    )).scalars().all()
    return await bots_week_stats_for_ids(db, set(ids))


async def bots_week_stats_for_ids(db: AsyncSession, bot_ids: set[int]) -> dict[int, dict]:
    """Par bot_id (set quelconque : bots perso + bots d'equipes) : messages
    utilisateur et visiteurs uniques sur 7 jours, pour les cards de la liste
    « Mes chatbots » qui melange ownership perso et equipe."""
    from src.models.conversation import Conversation

    if not bot_ids:
        return {}
    ids = list(bot_ids)
    since = utcnow() - timedelta(days=7)
    # Whitelist source : exclut les marqueurs systeme ([lead]...) qui
    # gonfleraient les compteurs de messages visiteurs
    msg_rows = (await db.execute(
        select(Message.bot_id, func.count(Message.id))
        .where(Message.bot_id.in_(ids), Message.role == "user",
               Message.source.in_(VISITOR_SOURCES), Message.created_at >= since)
        .group_by(Message.bot_id)
    )).all()
    visitor_rows = (await db.execute(
        select(Conversation.bot_id, func.count(func.distinct(Conversation.visitor_id)))
        .where(Conversation.bot_id.in_(ids), Conversation.started_at >= since)
        .group_by(Conversation.bot_id)
    )).all()
    out: dict[int, dict] = {}
    for bot_id, n in msg_rows:
        out.setdefault(bot_id, {})["msgs_7d"] = n
    for bot_id, n in visitor_rows:
        out.setdefault(bot_id, {})["visitors_7d"] = n
    return out
