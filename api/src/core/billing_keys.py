"""Clé canonique de scope de facturation (spec §2.5).

`_bot_limiter_key` était dans `routers/bots.py` (clé de rate-limit IA
treegen/insights : `org:{id}` pour un bot d'équipe, `user:{owner_user_id}` pour
un bot perso). Il est déplacé ici car le scope sert aussi au billing
(regroupement des subscriptions, résolution du payeur). `bots.py` l'importe
depuis ce module.

`billing_owner_user_id(scope_key, db)` traduit une clé de scope vers l'id du
User PAYEUR :
- `user:{id}`  -> ce User (bot perso : le propriétaire paie).
- `org:{id}`   -> `Organization.owner_user_id` (l'owner de l'org paie ; un admin
                  non-owner ne paie pas). None si l'org n'a pas d'owner (legacy)
                  ou n'existe pas -> bot non facturable (resolver RÈGLE 2).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.bot import Bot
from src.models.user import Organization, User


def _bot_limiter_key(bot: Bot) -> str:
    """Cle de rate-limit IA (treegen/insights) ET de scope billing : par
    organisation pour un bot d'equipe, par utilisateur proprietaire pour un bot
    perso. Format : ``org:{id}`` | ``user:{owner_user_id}``."""
    return f"org:{bot.organization_id}" if bot.organization_id else f"user:{bot.owner_user_id}"


async def billing_owner_user_id(scope_key: str, db: AsyncSession) -> int | None:
    """Resout une cle de scope (`_bot_limiter_key`) vers l'id du User payeur.

    - ``user:{id}``  -> ``id`` (bot perso : le proprietaire paie).
    - ``org:{id}``   -> ``Organization.owner_user_id`` (owner de l'org). None si
      l'org est introuvable ou sans owner (legacy) -> bot non facturable.
    Toute autre forme renvoie None (defensif).
    """
    kind, _, raw = scope_key.partition(":")
    if not raw or not raw.isdigit():
        return None
    ident = int(raw)
    if kind == "user":
        return ident
    if kind == "org":
        return await db.scalar(
            select(Organization.owner_user_id).where(Organization.id == ident)
        )
    return None


async def billing_customer_for_bot(db: AsyncSession, bot: Bot) -> str | None:
    """Customer Stripe (cus_...) du PAYEUR d'un bot, ou None.

    Sert au report de dépassement IA métré (le Meter mappe l'usage au customer
    payeur, pas au bot). On résout le scope (`_bot_limiter_key`) -> id du User
    payeur (`billing_owner_user_id`) -> son `stripe_customer_id`. None si pas de
    payeur résolu (org sans owner) ou payeur sans customer (jamais souscrit) :
    l'appelant n'émet alors aucun meter event."""
    scope = _bot_limiter_key(bot)
    uid = await billing_owner_user_id(scope, db)
    if uid is None:
        return None
    return await db.scalar(
        select(User.stripe_customer_id).where(User.id == uid)
    )
