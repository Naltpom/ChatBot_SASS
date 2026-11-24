"""Notifications de l'application mobile (Expo Push), envoyées une fois par minute.

Lit ce qui vient de se passer (15 dernières minutes) sans toucher au code de publication :
- cible passée `PUBLISHED` → « Vidéo publiée » ; `FAILED` → « Échec de publication » ;
  `INBOX` → « Brouillon TikTok à publier » ;
- commentaires `new` arrivés → « N nouveaux commentaires » (un message par téléphone).
Chaque événement est réservé dans `cm_push_events` (clé unique) avant l'envoi : jamais deux fois.
Destinataires : les personnes qui voient le compte (espace perso : son propriétaire ; équipe : ses
membres, selon leur périmètre cm), sur chaque téléphone qui a accepté ce type de notification.
"""
import asyncio
import logging
import time
from datetime import timedelta
from typing import Callable, Iterable, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.time import utcnow
from src.models.cm import T_FAILED, T_INBOX, T_PUBLISHED, CmComment, CmDriveLink, CmPost, CmTarget
from src.models.cm_mobile import CmMobileDevice, CmPushEvent
from src.models.user import Membership, User
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
WINDOW = timedelta(minutes=15)
TICK_SECONDS = 60
PLATFORM_LABEL = {"tiktok": "TikTok", "youtube": "YouTube", "instagram": "Instagram"}
KIND_OF_STATUS = {T_PUBLISHED: "published", T_FAILED: "failed", T_INBOX: "draft"}

_tick_lock = SingleUseTokens("rl:cmpushtick:", TICK_SECONDS - 5)
_task: Optional[asyncio.Task] = None
# Transport httpx injectable (tests : httpx.MockTransport).
_transport: Optional[httpx.AsyncBaseTransport] = None


def _short(text: Optional[str], n: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


async def _reserve(db: AsyncSession, kind: str, ref_id: int) -> bool:
    res = await db.execute(pg_insert(CmPushEvent).values(kind=kind, ref_id=ref_id, created_at=utcnow())
                           .on_conflict_do_nothing(index_elements=["kind", "ref_id"]).returning(CmPushEvent.id))
    return res.scalar_one_or_none() is not None


class _Audience:
    """Qui voit quel compte : calculé une fois par passage."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._tenants: dict = {}
        self._members: dict = {}

    async def _tenant(self, user: User, org_id: Optional[int]):
        key = (user.id, org_id)
        if key not in self._tenants:
            from src.routers.tiktok import _tenant
            try:
                self._tenants[key] = await _tenant(self.db, user, org_id)
            except Exception:
                self._tenants[key] = None
        return self._tenants[key]

    async def users(self, row, platform: str, account_id: int, devices_by_user: dict) -> list[int]:
        from src.services import cm_access
        if row.organization_id is None:
            candidates = [row.owner_user_id]
        else:
            if row.organization_id not in self._members:
                self._members[row.organization_id] = list((await self.db.execute(select(Membership.user_id).where(
                    Membership.organization_id == row.organization_id))).scalars())
            candidates = self._members[row.organization_id]
        out = []
        for uid in candidates:
            if uid not in devices_by_user:
                continue
            user = await self.db.get(User, uid)
            if user is None or not user.is_active:
                continue
            tenant = await self._tenant(user, row.organization_id)
            if tenant is not None and cm_access.account_allowed(tenant, platform, account_id):
                out.append(uid)
        return out


async def collect(db: AsyncSession) -> list[dict]:
    """Messages à envoyer (et événements réservés). Ne fait aucun appel réseau."""
    devices = (await db.execute(select(CmMobileDevice).where(
        CmMobileDevice.push_token.is_not(None), CmMobileDevice.revoked_at.is_(None)))).scalars().all()
    if not devices:
        return []
    by_user: dict[int, list[CmMobileDevice]] = {}
    for d in devices:
        by_user.setdefault(d.user_id, []).append(d)
    audience = _Audience(db)
    since = utcnow() - WINDOW
    messages: list[dict] = []

    def _send(uids: Iterable[int], pref: str, title: str, body: str, data: dict):
        for uid in uids:
            for d in by_user.get(uid, []):
                if (d.push_prefs or {}).get(pref, True):
                    messages.append({"to": d.push_token, "title": title, "body": body, "data": data,
                                     "sound": "default", "_device": d.id})

    rows = (await db.execute(select(CmTarget, CmPost).join(CmPost, CmPost.id == CmTarget.post_id).where(
        CmTarget.status.in_(list(KIND_OF_STATUS)), CmTarget.updated_at >= since).order_by(CmTarget.id))).all()
    for t, post in rows:
        kind = KIND_OF_STATUS[t.status]
        if not await _reserve(db, kind, t.id):
            continue
        uids = await audience.users(post, t.platform, t.account_id, by_user)
        label = PLATFORM_LABEL.get(t.platform, t.platform)
        title = _short(post.title, 80)
        data = {"type": kind, "post_id": post.id, "target_id": t.id}
        if kind == "published" and post.rights in ("protected", "unknown"):
            # Œuvre protégée (ou droits inconnus) : publiée, mais à surveiller (réclamations de droits d'auteur).
            _send(uids, "published", "⚠️ Œuvre protégée publiée",
                  f"{title} · {label} : surveillez les réclamations de droits d'auteur (son coupé, vidéo bloquée).",
                  {**data, "url": t.url, "rights": post.rights})
        elif kind == "published":
            _send(uids, "published", "Vidéo publiée", f"{title} · {label}", {**data, "url": t.url})
        elif kind == "failed":
            _send(uids, "failed", f"Échec sur {label}", f"{title} : {_short(t.error_message, 120) or 'voir le planning'}", data)
        else:
            _send(uids, "draft", "Brouillon TikTok à publier", f"{title} : copiez la légende et publiez dans TikTok.", data)

    # Stockage Drive de l'espace : passage à 90 % puis à 100 % (une fois par passage, noté par cm_storage.alerts).
    links = (await db.execute(select(CmDriveLink).where(CmDriveLink.revoked_at.is_(None),
                                                        CmDriveLink.storage_alert.is_not(None),
                                                        CmDriveLink.storage_alert_at >= since))).scalars().all()
    for link in links:
        if not await _reserve(db, f"storage_{link.storage_alert}", link.id * 10000 + (link.storage_alert_seq or 0) % 10000):
            continue
        if link.organization_id is None:
            uids = [link.owner_user_id]
        else:
            uids = list((await db.execute(select(Membership.user_id).where(
                Membership.organization_id == link.organization_id))).scalars())
        data = {"type": "storage", "state": link.storage_alert, "org_id": link.organization_id}
        if link.storage_alert == "full":
            _send(uids, "storage", "Stockage Drive plein",
                  "Les nouvelles publications sont bloquées : libérez de la place ou changez la conservation.", data)
        else:
            _send(uids, "storage", "Stockage Drive presque plein",
                  "Plus de 90 % utilisés : pensez à libérer de la place ou à changer la conservation.", data)

    comments = (await db.execute(select(CmComment).where(
        CmComment.status == "new", CmComment.created_at >= since).order_by(CmComment.id))).scalars().all()
    per_device: dict[int, list[CmComment]] = {}
    for c in comments:
        if not await _reserve(db, "comment", c.id):
            continue
        for uid in await audience.users(c, c.platform, c.account_id, by_user):
            for d in by_user.get(uid, []):
                if (d.push_prefs or {}).get("comments", True):
                    per_device.setdefault(d.id, []).append(c)
    dev_by_id = {d.id: d for d in devices}
    for dev_id, items in per_device.items():
        n = len(items)
        first = items[0]
        title = "Nouveau commentaire" if n == 1 else f"{n} nouveaux commentaires"
        body = f"{first.author or 'Quelqu’un'} : {_short(first.text, 110)}" if n == 1 else \
            f"{first.author or 'Quelqu’un'} : {_short(first.text, 70)} (et {n - 1} autre{'s' if n > 2 else ''})"
        messages.append({"to": dev_by_id[dev_id].push_token, "title": title, "body": body,
                         "data": {"type": "comment", "comment_id": first.id}, "sound": "default", "_device": dev_id})
    await db.commit()
    return messages


async def send(db: AsyncSession, messages: list[dict]) -> int:
    """Envoie par paquets de 100 ; un téléphone désinstallé (DeviceNotRegistered) perd son jeton."""
    sent = 0
    dead: set[int] = set()
    async with httpx.AsyncClient(timeout=20, transport=_transport) as client:
        for i in range(0, len(messages), 100):
            chunk = messages[i:i + 100]
            payload = [{k: v for k, v in m.items() if not k.startswith("_")} for m in chunk]
            try:
                r = await client.post(EXPO_PUSH_URL, json=payload, headers={"Accept": "application/json"})
                tickets = (r.json() or {}).get("data") or []
            except Exception as exc:
                logger.warning("cm push : envoi en échec (%s)", type(exc).__name__)
                continue
            for m, ticket in zip(chunk, tickets):
                if ticket.get("status") == "ok":
                    sent += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.add(m["_device"])
    if dead:
        for d in (await db.execute(select(CmMobileDevice).where(CmMobileDevice.id.in_(dead)))).scalars():
            d.push_token = None
        await db.commit()
    return sent


async def tick(db: AsyncSession) -> int:
    messages = await collect(db)
    return await send(db, messages) if messages else 0


async def _loop(session_factory: Callable = AsyncSessionLocal) -> None:
    while True:
        try:
            if await _tick_lock.claim(str(int(time.time() // TICK_SECONDS))):
                async with session_factory() as db:
                    await tick(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cm push : passage en échec")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _task
    if _task is None:
        _task = asyncio.create_task(_loop())


async def stop_scheduler() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
