"""Stats conversations par bot : messages/jour, visiteurs uniques (UUID widget,
pas IP), repartition tree vs IA, volume de reponses IA servies.

Acces : DIVERGENCE ASSUMEE avec routers/bots.py et routers/inbox.py — ici on
n'utilise PAS _get_accessible_bot / _check_bot_perm mais require_bot_access
(accès volontairement simplifié : lecture/usage globale du bot, pas de
permission fine par onglet). Même choix que documenté dans inbox.py:3-6.

Les routes ne font qu'authentifier puis déléguer les agrégations LOURDES à
services/stats_service.py.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user, require_bot_access
from src.models.bot import Bot
from src.models.user import User
from src.services.stats_service import (
    compute_bot_funnel,
    compute_bot_stats,
    list_bot_conversations,
)

router = APIRouter(prefix="/api/stats", tags=["stats"])


async def _accessible_bot(db: AsyncSession, bot_id: int, user: User) -> Bot:
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_bot_access(bot, user, db)
    return bot


@router.get("/bots/{bot_id}")
async def bot_stats(
    bot_id: int,
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _accessible_bot(db, bot_id, user)
    return await compute_bot_stats(db, bot_id, days)


@router.get("/bots/{bot_id}/conversations")
async def bot_conversations(
    bot_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Dernieres conversations (lecture des echanges pour ameliorer l'arbre)."""
    await _accessible_bot(db, bot_id, user)
    return await list_bot_conversations(db, bot_id, limit)


@router.get("/bots/{bot_id}/funnel")
async def bot_funnel(
    bot_id: int,
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Funnel de l'arbre : passages par noeud SERVI (tree_events) + abandons,
    splittes par variante A/B."""
    await _accessible_bot(db, bot_id, user)
    return await compute_bot_funnel(db, bot_id, days)
