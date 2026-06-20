"""Compteurs d'usage : reponses IA (jour / mois) par bot, stats hebdomadaires.

`count_ai_messages_today` reste un simple COMPTEUR D'AFFICHAGE (ai_replies_today)
montre dans le dashboard ; aucune logique ne bloque dessus.

`count_ai_messages_month` est la SOURCE DURABLE du quota IA mensuel (spec D7) :
la table `Message` (source='ai', role='assistant') fait foi, Redis n'etant qu'un
accelerateur (cf. quota_service). Frontiere de periode = mois CALENDAIRE **UTC**
(spec D8/F1) : `period = utcnow().strftime("%Y-%m")`, identique des deux cotes
(SQL ici, INCR Redis dans quota_service) pour eviter toute divergence au
changement de mois. Quand le billing est OFF ou qu'un bot n'a pas d'entitlement,
aucun appelant n'invoque ce compteur (resolver -> illimite) : il reste neutre.
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


def _month_start(period: str | None = None) -> datetime:
    """Minuit UTC du 1er jour du mois, en datetime NAÏF (colonnes sans tz).

    `period` = "YYYY-MM" UTC (spec D8). None => mois courant via utcnow().
    """
    if period:
        year, month = period.split("-")
        return datetime(int(year), int(month), 1)
    now = utcnow()
    return datetime(now.year, now.month, 1)


async def count_ai_messages_month(
    db: AsyncSession, bot_id: int, period: str | None = None
) -> int:
    """Reponses IA d'un bot sur le mois CALENDAIRE `period` ("YYYY-MM" UTC).

    Source DURABLE du quota mensuel (spec §3.4 / D7) : on compte les Message
    source='ai', role='assistant' depuis le 1er du mois UTC. `period=None` =
    mois courant. Memes filtres que `count_ai_messages_today` (whitelist source
    IA, reponses assistant uniquement) ; seule la borne temporelle change.
    """
    result = await db.execute(
        select(func.count(Message.id)).where(
            Message.bot_id == bot_id,
            Message.source == "ai",
            Message.role == "assistant",
            Message.created_at >= _month_start(period),
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
