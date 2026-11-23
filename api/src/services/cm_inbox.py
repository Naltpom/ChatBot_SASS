"""Boîte de réception centralisée : commentaires de toutes les vidéos, réponses, masquage,
réponses privées, et messages privés Instagram.

D'où viennent les commentaires :
- Instagram connecté officiellement : API (permission `instagram_business_manage_comments`, demandée
  seulement quand INSTAGRAM_EXTRA_SCOPES la liste, après la revue Meta) ;
- Instagram géré par la routine : la routine remonte les commentaires (`POST /routine/comments`) et
  exécute les actions demandées dans cm (`GET /routine/actions`) avec ses propres accès ;
- YouTube : lecture avec `youtube.readonly` (déjà accordé) ; répondre / masquer : `youtube.force-ssl` ;
- TikTok : pas d'API de commentaires pour cette application.

Sans la permission, rien n'est inventé : l'action renvoie « permission en attente ».
Qui a aimé un commentaire : aucune API ne le donne (seulement le nombre).
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import IG_MODE_API, IG_MODE_ROUTINE, CmComment, CmVideo, InstagramAccount
from src.models.youtube import YouTubeAccount
from src.services import cm_service as cm
from src.services import instagram_service as ig
from src.services import youtube_service as yt
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

SYNC_EVERY = timedelta(minutes=15)
VIDEO_WINDOW = timedelta(days=30)
VIDEOS_PER_ACCOUNT = 15
PRIVATE_REPLY_DAYS = 7
DM_WINDOW = timedelta(hours=24)
sync_lock = SingleUseTokens("rl:cminbox:", int(SYNC_EVERY.total_seconds()))

PENDING = {
    "comments_ig": "Permission en attente de validation par Meta (gérer les commentaires Instagram). "
                   "Les commentaires de ce compte s'afficheront dès qu'elle sera accordée et le compte reconnecté.",
    "messages_ig": "Permission en attente de validation par Meta (messages Instagram). "
                   "Les messages s'afficheront dès qu'elle sera accordée et le compte reconnecté.",
    "reply_yt": "Permission en attente de validation par Google (répondre et modérer sur YouTube). "
                "Vous pouvez répondre depuis YouTube Studio en attendant.",
    "read_yt": "Commentaires YouTube : activés après la vérification Google en cours. "
               "Répondez depuis YouTube Studio en attendant.",
    "tiktok": "TikTok ne donne pas accès aux commentaires aux applications comme Chapote : répondez dans l'appli TikTok.",
    "routine_dm": "Les messages de ce compte (géré par la routine) se lisent dans Instagram.",
}


def pending(code: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, {"code": "permission_pending", "message": PENDING[code]})


def capabilities(platform: str, acc) -> dict:
    """Ce que cm peut faire pour ce compte, et pourquoi pas sinon."""
    if platform == "tiktok":
        return {"read": False, "reply": False, "hide": False, "private_reply": False, "messages": False,
                "source": None, "notice": PENDING["tiktok"]}
    if platform == "youtube":
        r = bool(settings.YOUTUBE_COMMENTS_ENABLED)
        w = r and yt.has_scope(acc, yt.SCOPE_FORCE_SSL)
        return {"read": r, "reply": w, "hide": w, "private_reply": False, "messages": False,
                "source": "api", "notice": None if w else PENDING["read_yt" if not r else "reply_yt"]}
    if acc.mode == IG_MODE_ROUTINE:
        return {"read": True, "reply": True, "hide": True, "private_reply": True, "messages": False,
                "source": "routine", "notice": None}
    c, m = ig.has_scope(acc, ig.SCOPE_COMMENTS), ig.has_scope(acc, ig.SCOPE_MESSAGES)
    return {"read": c, "reply": c, "hide": c, "private_reply": m, "messages": m, "source": "api",
            "notice": None if c and m else PENDING["comments_ig" if not c else "messages_ig"]}


def comment_out(c: CmComment, names: dict) -> dict:
    return {"id": c.id, "platform": c.platform, "account_id": c.account_id,
            "account_name": names.get((c.platform, c.account_id)), "media_id": c.media_id,
            "video_title": c.video_title, "video_url": c.video_url, "external_id": c.external_id,
            "parent_id": c.parent_external_id, "author": c.author, "text": c.text, "like_count": c.like_count,
            "published_at": cm.iso(c.published_at), "status": c.status, "reply_text": c.reply_text,
            "replied_at": cm.iso(c.replied_at), "private_replied_at": cm.iso(c.private_replied_at),
            "pending": (c.pending_action or {}).get("type"), "error": c.action_error,
            "profile_url": (f"https://www.instagram.com/{c.author}/" if c.platform == "instagram" and c.author else None),
            "dm_url": (f"https://ig.me/m/{c.author}" if c.platform == "instagram" and c.author else None)}


# --------------------------------------------------------------------------
# Enregistrement (API ou routine)
# --------------------------------------------------------------------------

async def upsert(db: AsyncSession, acc, platform: str, item: dict, *, media_id: Optional[str], title: Optional[str],
                 url: Optional[str], parent: Optional[str] = None) -> Optional[CmComment]:
    ext = str(item.get("id") or "")[:100]
    if not ext:
        return None
    row = (await db.execute(select(CmComment).where(CmComment.platform == platform, CmComment.account_id == acc.id,
                                                    CmComment.external_id == ext))).scalar_one_or_none()
    if row is None:
        row = CmComment(organization_id=acc.organization_id, owner_user_id=acc.owner_user_id, platform=platform,
                        account_id=acc.id, external_id=ext, status="new")
        db.add(row)
    frm = item.get("from") or {}
    row.media_id = (media_id or row.media_id or "")[:100] or None
    row.video_title = (title or row.video_title or "")[:300] or None
    row.video_url = url or row.video_url
    row.parent_external_id = (parent or item.get("parent_id") or row.parent_external_id)
    row.author = (item.get("username") or frm.get("username") or row.author or "")[:150] or None
    row.author_id = (str(frm.get("id") or item.get("user_id") or "") or row.author_id or "")[:100] or None
    row.text = (item.get("text") if item.get("text") is not None else row.text)
    row.like_count = cm._num(item.get("like_count")) if item.get("like_count") is not None else row.like_count
    row.published_at = cm._parse_time(item.get("timestamp")) or row.published_at
    return row


async def _video_title(db: AsyncSession, platform: str, acc_id: int, media_id: str) -> tuple[Optional[str], Optional[str]]:
    v = (await db.execute(select(CmVideo).where(CmVideo.platform == platform, CmVideo.account_id == acc_id,
                                                CmVideo.external_id == media_id))).scalar_one_or_none()
    return (v.title, v.url) if v else (None, None)


async def ingest_routine(db: AsyncSession, acc: InstagramAccount, items: list[dict]) -> int:
    n = 0
    for it in items[:1000]:
        media = str(it.get("media_id") or "")
        title, url = it.get("video_title"), it.get("video_url")
        if not title:
            title, url = await _video_title(db, "instagram", acc.id, media)
        if await upsert(db, acc, "instagram", it, media_id=media, title=title, url=url,
                        parent=it.get("parent_id")):
            n += 1
    await db.commit()
    return n


async def sync_account(db: AsyncSession, platform: str, acc) -> int:
    """Commentaires des vidéos récentes, par l'API (si la permission le permet)."""
    caps = capabilities(platform, acc)
    if not caps["read"] or caps["source"] != "api":
        return 0
    since = utcnow() - VIDEO_WINDOW
    videos = (await db.execute(select(CmVideo).where(CmVideo.platform == platform, CmVideo.account_id == acc.id,
                                                     CmVideo.published_at >= since)
                               .order_by(CmVideo.published_at.desc()).limit(VIDEOS_PER_ACCOUNT))).scalars().all()
    n = 0
    if platform == "instagram":
        token = await ig.valid_token(db, acc)
        for v in videos:
            for c in await ig.media_comments(token, v.external_id):
                if await upsert(db, acc, platform, c, media_id=v.external_id, title=v.title, url=v.url):
                    n += 1
                for r in ((c.get("replies") or {}).get("data") or []):
                    if await upsert(db, acc, platform, r, media_id=v.external_id, title=v.title, url=v.url, parent=c.get("id")):
                        n += 1
    else:
        token = await yt.valid_access_token(db, acc)
        for v in videos:
            for th in await yt.comment_threads(token, v.external_id):
                top = (th.get("snippet") or {}).get("topLevelComment") or {}
                sn = top.get("snippet") or {}
                item = {"id": top.get("id"), "text": sn.get("textDisplay") or sn.get("textOriginal"),
                        "username": sn.get("authorDisplayName"), "user_id": (sn.get("authorChannelId") or {}).get("value"),
                        "like_count": sn.get("likeCount"), "timestamp": sn.get("publishedAt")}
                if await upsert(db, acc, platform, item, media_id=v.external_id, title=v.title, url=v.url):
                    n += 1
    await db.commit()
    return n


async def sync_due(db: AsyncSession, batch: int = 10) -> None:
    """Tâche planifiée : relit les commentaires des comptes qui le permettent (toutes les 15 min)."""
    done = 0
    for platform, model in (("instagram", InstagramAccount), ("youtube", YouTubeAccount)):
        rows = (await db.execute(select(model).where(model.revoked_at.is_(None)))).scalars().all()
        for acc in rows:
            if done >= batch:
                return
            if not capabilities(platform, acc)["read"] or capabilities(platform, acc)["source"] != "api":
                continue
            if not await sync_lock.claim(f"{platform}:{acc.id}:{int(utcnow().timestamp() // SYNC_EVERY.total_seconds())}"):
                continue
            try:
                await sync_account(db, platform, acc)
            except Exception as e:                 # une erreur de compte n'arrête pas les autres
                logger.info("cm : commentaires %s %s non relus (%s)", platform, acc.id, type(e).__name__)
                await db.rollback()
            done += 1


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------

async def act(db: AsyncSession, c: CmComment, acc, kind: str, text: Optional[str], user_id: int) -> CmComment:
    """kind : reply | hide | private_reply. Par l'API, ou mis en file pour la routine."""
    caps = capabilities(c.platform, acc)
    if c.platform == "tiktok":
        raise pending("tiktok")
    if kind == "private_reply" and c.platform != "instagram":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Réponse privée : Instagram seulement.")
    # Instagram officiel sans la permission : un commentaire présent ici a été remonté par la
    # routine, qui a les accès -> l'action lui est confiée (comme pour un compte « routine »).
    if c.platform == "instagram" and caps["source"] == "api" and not caps["reply" if kind != "private_reply" else "private_reply"]:
        caps = {**caps, "source": "routine", "reply": True, "hide": True, "private_reply": True}
    if not caps["reply" if kind == "reply" else "hide" if kind == "hide" else "private_reply"]:
        raise pending("reply_yt" if c.platform == "youtube" else ("messages_ig" if kind == "private_reply" else "comments_ig"))
    if kind == "private_reply" and c.published_at and utcnow() - c.published_at > timedelta(days=PRIVATE_REPLY_DAYS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Instagram n'autorise la réponse privée que 7 jours après le commentaire : écrivez-lui depuis Instagram.")
    if kind == "private_reply" and c.private_replied_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Une réponse privée a déjà été envoyée pour ce commentaire.")
    now = utcnow()
    if caps["source"] == "routine":
        c.pending_action = {"type": kind, "text": text, "by": user_id, "at": now.isoformat()}
        c.action_error = None
        await db.commit()
        return c
    try:
        if c.platform == "instagram":
            token = await ig.valid_token(db, acc)
            if kind == "reply":
                await ig.reply_comment(token, c.external_id, text or "")
            elif kind == "hide":
                await ig.hide_comment(token, c.external_id, True)
            else:
                await ig.private_reply(token, acc.ig_user_id, c.external_id, text or "")
        else:
            token = await yt.valid_access_token(db, acc)
            if kind == "reply":
                await yt.reply_comment(token, c.parent_external_id or c.external_id, text or "")
            else:
                await yt.hold_comment(token, c.external_id)
    except (ig.InstagramError, yt.YouTubeError) as e:
        code = getattr(e, "code", "")
        if code in ("scope_missing", "insufficientPermissions", "forbidden", "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
                    "PERMISSION_DENIED"):
            raise pending("reply_yt" if c.platform == "youtube" else "comments_ig")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, e.describe() if hasattr(e, "describe") else str(e))
    done(c, kind, text, user_id, now)
    await db.commit()
    return c


def done(c: CmComment, kind: str, text: Optional[str], user_id: Optional[int], when: datetime) -> None:
    if kind == "reply":
        c.status, c.reply_text, c.replied_at, c.replied_by_user_id = "replied", text, when, user_id
    elif kind == "hide":
        c.status = "hidden"
    else:
        c.private_replied_at = when
        if c.status == "new":
            c.status = "contacted"
    c.pending_action = None
    c.action_error = None


async def account_of(db: AsyncSession, platform: str, account_id: int):
    model = {"instagram": InstagramAccount, "youtube": YouTubeAccount}.get(platform)
    return await db.get(model, account_id) if model else None


def dm_window_open(messages: list[dict], me: str) -> bool:
    """Instagram : on ne peut écrire que dans les 24 h qui suivent le dernier message de la personne."""
    for m in messages:
        if str((m.get("from") or {}).get("id")) != str(me):
            t = cm._parse_time(m.get("created_time"))
            return bool(t and utcnow() - t < DM_WINDOW)
    return False


__all__ = ["capabilities", "comment_out", "ingest_routine", "sync_due", "act", "done", "pending", "IG_MODE_API"]
