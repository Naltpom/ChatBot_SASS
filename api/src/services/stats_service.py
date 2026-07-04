"""Agrégations de statistiques par bot.

Fonctions pures qui prennent une session `db` + des paramètres déjà validés et
renvoient les structures sérialisables consommées par le dashboard (StatsPanel) ;
les routes de `routers/stats.py` ne font que l'authentification puis délèguent ici.

Périmètre : seules les agrégations venant de `stats.py` vivent ici. L'appel
`count_ai_messages_today` reste dans `usage_service` (importé, non déplacé).
"""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import VISITOR_SOURCES
from src.core.time import utcnow
from src.models.analytics import TreeEvent
from src.models.conversation import Conversation, Message
from src.services.usage_service import count_ai_messages_today


async def compute_bot_stats(db: AsyncSession, bot_id: int, days: int) -> dict:
    """Stats agrégées d'un bot sur `days` jours (cf. GET /api/stats/bots/{id})."""
    since = utcnow() - timedelta(days=days)

    totals = (await db.execute(
        select(
            func.count(func.distinct(Conversation.id)),
            func.count(func.distinct(Conversation.visitor_id)),
        ).where(Conversation.bot_id == bot_id, Conversation.started_at >= since)
    )).one()

    # Messages visiteurs : whitelist source (exclut les marqueurs systeme
    # [lead]... qui gonfleraient les compteurs). Le rating CSAT ne vit que sur
    # role=assistant source ai|tree par construction (POST /widget/feedback).
    msg_totals = (await db.execute(
        select(
            func.count(Message.id).filter(Message.role == "user", Message.source.in_(VISITOR_SOURCES)),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "ai"),
            func.count(Message.id).filter(Message.role == "assistant", Message.source == "tree"),
            func.count(Message.id).filter(Message.rating == 1),
            func.count(Message.id).filter(Message.rating == -1),
        ).where(Message.bot_id == bot_id, Message.created_at >= since)
    )).one()

    # A/B : conversations + satisfaction par variant (toujours present dans la
    # reponse, zeros si A/B inactif)
    conv_by_variant = dict((await db.execute(
        select(Conversation.variant, func.count(Conversation.id))
        .where(Conversation.bot_id == bot_id, Conversation.started_at >= since,
               Conversation.variant.isnot(None))
        .group_by(Conversation.variant)
    )).all())
    sat_by_variant = {
        r[0]: (r[1], r[2])
        for r in (await db.execute(
            select(
                Conversation.variant,
                func.count(Message.id).filter(Message.rating == 1),
                func.count(Message.id).filter(Message.rating == -1),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(Message.bot_id == bot_id, Message.created_at >= since,
                   Conversation.variant.isnot(None))
            .group_by(Conversation.variant)
        )).all()
    }

    def _variant_block(v: str) -> dict:
        up, down = sat_by_variant.get(v, (0, 0))
        return {"conversations": conv_by_variant.get(v, 0),
                "satisfaction": {"up": up, "down": down, "total": up + down}}

    day = func.date_trunc("day", Message.created_at)
    daily_rows = (await db.execute(
        select(
            day.label("day"),
            func.count(Message.id).filter(Message.role == "user", Message.source.in_(VISITOR_SOURCES)).label("user_messages"),
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
        "ai_replies_today": await count_ai_messages_today(db, bot_id),
        "satisfaction": {"up": msg_totals[3], "down": msg_totals[4],
                         "total": msg_totals[3] + msg_totals[4]},
        "variants": {"a": _variant_block("a"), "b": _variant_block("b")},
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


async def list_bot_conversations(db: AsyncSession, bot_id: int, limit: int) -> list[dict]:
    """Dernieres conversations + transcript (cf. GET /api/stats/bots/{id}/conversations)."""
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
                {"role": m.role, "source": m.source, "content": m.content,
                 "rating": m.rating, "at": m.created_at.isoformat()}
                for m in msgs_by_conv[c.id]
            ],
        }
        for c in convs
    ]


async def compute_bot_funnel(db: AsyncSession, bot_id: int, days: int) -> dict:
    """Funnel de l'arbre par noeud servi + abandons, split A/B (cf. GET /funnel).

    Abandon = dernier noeud servi de la conversation (sous-requete max(id)
    par conversation sur la fenetre). Les evenements orphelins (conversation
    purgee, FK SET NULL) restent comptes dans `count` mais sont EXCLUS du
    calcul des exits — on ne sait plus les rattacher a une conversation. Les
    evenements sans variante (A/B inactif) alimentent count/exits mais ni
    `variants` ni `variant_totals`.
    """
    since = utcnow() - timedelta(days=days)

    count_rows = (await db.execute(
        select(TreeEvent.node_key, TreeEvent.variant, func.count())
        .where(TreeEvent.bot_id == bot_id, TreeEvent.created_at >= since)
        .group_by(TreeEvent.node_key, TreeEvent.variant)
    )).all()

    # Dernier evenement de chaque conversation de la fenetre = noeud d'abandon
    last_event_ids = (
        select(func.max(TreeEvent.id))
        .where(TreeEvent.bot_id == bot_id, TreeEvent.created_at >= since,
               TreeEvent.conversation_id.isnot(None))
        .group_by(TreeEvent.conversation_id)
    )
    exit_rows = (await db.execute(
        select(TreeEvent.node_key, TreeEvent.variant, func.count())
        .where(TreeEvent.id.in_(last_event_ids))
        .group_by(TreeEvent.node_key, TreeEvent.variant)
    )).all()

    nodes: dict[str, dict] = {}
    variant_totals = {"a": 0, "b": 0}
    total_events = 0
    for node_key, variant, n in count_rows:
        entry = nodes.setdefault(node_key, {
            "node_key": node_key, "count": 0, "exits": 0,
            "variants": {"a": {"count": 0, "exits": 0}, "b": {"count": 0, "exits": 0}},
        })
        entry["count"] += n
        total_events += n
        if variant in ("a", "b"):
            entry["variants"][variant]["count"] += n
            variant_totals[variant] += n
    for node_key, variant, n in exit_rows:
        entry = nodes.get(node_key)
        if entry is None:
            continue
        entry["exits"] += n
        if variant in ("a", "b"):
            entry["variants"][variant]["exits"] += n

    out_nodes = sorted(nodes.values(), key=lambda e: e["count"], reverse=True)
    for entry in out_nodes:
        entry["exit_rate"] = round(entry["exits"] / entry["count"], 3) if entry["count"] else 0

    return {"days": days, "total_events": total_events, "nodes": out_nodes,
            "variant_totals": variant_totals}
