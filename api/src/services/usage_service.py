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
    # Whitelist source : exclut les marqueurs systeme ([lead]...) qui
    # gonfleraient les compteurs de messages visiteurs
    msg_rows = (await db.execute(
        select(Message.bot_id, func.count(Message.id))
        .join(Bot, Bot.id == Message.bot_id)
        .where(Bot.organization_id == org_id, Message.role == "user",
               Message.source.in_(["ai", "tree"]), Message.created_at >= since)
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


async def plan_change_problems(db: AsyncSession, org_id: int, new_plan: str) -> list[str]:
    """Garde-fous de changement de plan, PARTAGES entre le self-serve
    (orgs.change_plan) et le back-office (admin.patch_organization) :
    le plan cible doit pouvoir contenir les bots EXISTANTS.

    Precondition : new_plan in PLANS (valide par l'appelant). Retourne la
    liste des blocages (vide = changement possible)."""
    new_limits = PLANS[new_plan]
    bots = (await db.execute(
        select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at)
    )).scalars().all()
    problems: list[str] = []

    # 1. Nombre de bots : le nouveau plan doit contenir tous les bots existants
    if len(bots) > new_limits["max_bots"]:
        names = ", ".join(b.name for b in bots)
        problems.append(
            f"le plan {new_plan} autorise {new_limits['max_bots']} bot(s) et "
            f"l'organisation en a {len(bots)} ({names}) — supprimez des bots d'abord")

    # 2. tree_only : aucun bot ne doit utiliser l'IA (mode ai ou hybrid)
    if new_limits.get("tree_only"):
        non_tree = [b.name for b in bots if b.mode != "tree"]
        if non_tree:
            problems.append(
                f"le plan {new_plan} est limité au mode arbre, or ces bots "
                f"utilisent l'IA : {', '.join(non_tree)} — passez-les en mode arbre d'abord")

    # 3. Taille des arbres : quota de bulles (nœuds) du nouveau plan
    max_nodes = new_limits.get("max_tree_nodes")
    if max_nodes is not None:
        oversized = []
        for b in bots:
            count = len((b.tree_json or {}).get("nodes") or {})
            if count > max_nodes:
                oversized.append(f"{b.name} ({count} bulles)")
        if oversized:
            problems.append(
                f"le plan {new_plan} est limité à {max_nodes} bulles par arbre, "
                f"dépassé par : {', '.join(oversized)} — allégez ces arbres d'abord")

    # 4. BYOK : le plan cible doit inclure l'option clé personnelle
    if not PLANS[new_plan].get("byok"):
        byok_bots = [b.name for b in bots if b.api_key_mode == "byok"]
        if byok_bots:
            problems.append(
                f"le plan {new_plan} n'inclut pas l'option BYOK, or ces bots utilisent "
                f"leur propre clé API : {', '.join(byok_bots)} — repassez-les en clé managée d'abord")

    return problems


def plan_limits(org: Organization) -> dict:
    return PLANS.get(org.plan, PLANS["free"])


async def ai_allowed(db: AsyncSession, bot: Bot, org: Organization) -> tuple[bool, str]:
    """(autorise, raison_du_refus). Verifie le plan (tree_only, BYOK hors plan)
    puis cap quotidien bot + quota mensuel org.

    Les checks plan coupent l'IA au RUNTIME, y compris pour les bots BYOK
    (jamais decomptes du quota) apres un downgrade webhook applique sans
    garde-fous : « free reste tree-only » tient sans attendre une ecriture."""
    limits = plan_limits(org)
    if limits.get("tree_only"):
        return False, "plan_tree_only"
    if bot.api_key_mode == "byok" and not limits.get("byok"):
        return False, "byok_not_in_plan"
    if await count_ai_messages_today(db, bot.id) >= bot.daily_ai_message_cap:
        return False, "daily_cap"
    if bot.api_key_mode == "managed":
        if await count_ai_messages_this_month(db, bot.organization_id) >= limits["ai_messages"]:
            return False, "plan_quota"
    return True, ""
