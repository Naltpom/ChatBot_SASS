"""Services Chapote utilisés par un compte (chapote.fr, music.chapote.fr, outils à venir).

Un seul compte et une seule session (cookie partagé par les sous-domaines). On garde
le service par lequel le compte a été créé (`users.signup_app`) et, dans `user_apps`,
chaque service utilisé avec sa première et sa dernière utilisation.

Le front indique son service par l'en-tête `X-Chapote-App` (défaut : chapote).
"""
from typing import Optional

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.time import utcnow
from src.models.user import User, UserApp

APPS = ("chapote", "music")
DEFAULT_APP = "chapote"


def app_from_request(request: Optional[Request]) -> str:
    raw = (request.headers.get("x-chapote-app") if request is not None else None) or DEFAULT_APP
    raw = raw.strip().lower()
    return raw if raw in APPS else DEFAULT_APP


async def record_app(db: AsyncSession, user: User, app: str, *, signup: bool = False) -> None:
    """Note l'utilisation d'un service (et le service d'inscription si `signup`). Pas de commit."""
    if app not in APPS:
        app = DEFAULT_APP
    if signup and not user.signup_app:
        user.signup_app = app
    row = (await db.execute(select(UserApp).where(UserApp.user_id == user.id, UserApp.app == app))).scalar_one_or_none()
    now = utcnow()
    if row is None:
        db.add(UserApp(user_id=user.id, app=app, first_seen_at=now, last_seen_at=now))
    else:
        row.last_seen_at = now
    await db.flush()


async def apps_of(db: AsyncSession, user_id: int) -> list[dict]:
    rows = (await db.execute(select(UserApp).where(UserApp.user_id == user_id).order_by(UserApp.first_seen_at))).scalars()
    return [{"app": r.app, "first_seen_at": r.first_seen_at.isoformat() + "Z",
             "last_seen_at": r.last_seen_at.isoformat() + "Z"} for r in rows]
