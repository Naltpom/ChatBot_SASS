"""cm.chapote.fr — boîte de réception : commentaires de toutes les vidéos, réponses, masquage,
réponses privées, messages privés Instagram, et « mot-clé » (ex. les commentaires SHEET) pour
contacter les gens à la main quand l'API ne le permet pas.

  GET  /api/cm/inbox/accounts                 ce que cm peut faire pour chaque compte (permissions)
  GET  /api/cm/inbox/comments                 commentaires (q, status, sort, order, cursor ; périmètre)
  POST /api/cm/inbox/sync                     relire maintenant (comptes par API)
  POST /api/cm/comments/{id}/reply|hide|private-reply|ignore|contacted|reopen
  GET  /api/cm/inbox/keyword?word=SHEET       qui a écrit ce mot (une ligne par personne)
  GET  /api/cm/inbox/conversations?platform=instagram&account_id=   messages privés (API)
  GET  /api/cm/inbox/conversations/{id}?account_id=   ; POST …/send {text}
Routine (jeton de service) : POST /api/cm/routine/comments, GET /api/cm/routine/actions,
POST /api/cm/routine/actions/{id}/done.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.time import utcnow
from src.models.cm import IG_MODE_ROUTINE, CmComment, InstagramAccount
from src.models.user import User
from src.routers.cm import _account_filter, _capture_account_scope, _tenant_index, get_cm_user, get_routine_user
from src.routers.tiktok import Tenant, _tenant
from src.services import cm_access
from src.services import cm_inbox as inbox
from src.services import cm_paging as paging
from src.services import instagram_service as ig
from src.services.rate_limit import RateLimiter

router = APIRouter(prefix="/api/cm", tags=["cm-inbox"], dependencies=[Depends(_capture_account_scope)])
reply_limiter = RateLimiter("rl:cmreply:", 300, 3600)
sync_limiter = RateLimiter("rl:cminboxsync:", 12, 3600)


@router.get("/inbox/accounts")
async def inbox_accounts(org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    out = []
    for p, a in accounts:
        caps = inbox.capabilities(p, a)
        n = (await db.execute(select(func.count()).select_from(CmComment).where(
            CmComment.platform == p, CmComment.account_id == a.id, CmComment.status == "new"))).scalar() or 0
        out.append({"platform": p, "id": a.id, "name": names.get((p, a.id)), "new": n, **caps})
    return out


@router.get("/inbox/comments")
async def list_comments(response: Response, org_id: Optional[int] = Query(None), group_id: Optional[int] = Query(None),
                        q: Optional[str] = Query(None, max_length=100),
                        status_: Literal["todo", "new", "replied", "hidden", "ignored", "contacted", "all"] = Query("todo", alias="status"),
                        sort: Literal["recent", "likes"] = "recent", order: Literal["asc", "desc"] = "desc",
                        limit: int = Query(30, ge=1, le=100), cursor: Optional[str] = Query(None, max_length=300),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """« todo » = nouveaux + réponses en attente (routine) ; le reste par statut. En SQL, pages keyset."""
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    conds = [_account_filter(CmComment, accounts)]
    if status_ == "todo":
        conds.append(CmComment.status == "new")
    elif status_ != "all":
        conds.append(CmComment.status == status_)
    pattern = paging.like(q)
    if pattern:
        from sqlalchemy import or_
        conds.append(or_(CmComment.text.ilike(pattern, escape="\\"), CmComment.author.ilike(pattern, escape="\\"),
                         CmComment.video_title.ilike(pattern, escape="\\")))
    kind = "dt" if sort == "recent" else "int"
    col = CmComment.published_at if sort == "recent" else CmComment.like_count
    key = paging.nulls_last(col, kind, order).label("_k")
    stmt = paging.apply(select(CmComment, key).where(*conds), key, kind, CmComment.id, order, cursor, limit)
    rows = paging.page(response, list((await db.execute(stmt)).all()), limit, lambda r: r[1], lambda r: r[0].id, cursor)
    return [inbox.comment_out(c, names) for c, _ in rows]


@router.post("/inbox/sync")
async def sync_now(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    if not await sync_limiter.check(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Relecture déjà demandée récemment : réessayez dans quelques minutes.")
    accounts, _ = await _tenant_index(db, tenant)
    total, notices = 0, set()
    for p, a in accounts:
        caps = inbox.capabilities(p, a)
        if caps["notice"] and not caps["read"]:
            notices.add(caps["notice"])
        if caps["read"] and caps["source"] == "api":
            try:
                total += await inbox.sync_account(db, p, a)
            except Exception:
                await db.rollback()
    return {"comments": total, "notices": sorted(notices)}


async def _comment(db: AsyncSession, user: User, comment_id: int, org_id: Optional[int]) -> tuple[CmComment, Tenant, object]:
    tenant = await _tenant(db, user, org_id)
    c = await db.get(CmComment, comment_id)
    same = c is not None and ((tenant.org_id and c.organization_id == tenant.org_id)
                              or (not tenant.org_id and c.owner_user_id == tenant.owner_user_id))
    if not same or not cm_access.account_allowed(tenant, c.platform, c.account_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Commentaire introuvable")
    acc = await inbox.account_of(db, c.platform, c.account_id)
    return c, tenant, acc


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=2200)


@router.post("/comments/{comment_id}/{action}")
async def comment_action(comment_id: int, action: Literal["reply", "hide", "private-reply", "ignore", "contacted", "reopen"],
                         body: Optional[TextIn] = None, org_id: Optional[int] = Query(None),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    c, tenant, acc = await _comment(db, user, comment_id, org_id)
    cm_access.require(tenant, "edit")
    names = (await _tenant_index(db, tenant))[1]
    if action in ("ignore", "contacted", "reopen"):
        c.status = {"ignore": "ignored", "contacted": "contacted", "reopen": "new"}[action]
        if action == "contacted" and (c.author_id or c.author):
            # La personne est contactée : ses autres commentaires sur ce compte aussi.
            from sqlalchemy import update
            who = CmComment.author_id == c.author_id if c.author_id else CmComment.author == c.author
            await db.execute(update(CmComment).where(CmComment.platform == c.platform, CmComment.account_id == c.account_id,
                                                     who, CmComment.status == "new").values(status="contacted"))
        await db.commit()
        return inbox.comment_out(c, names)
    if action in ("reply", "private-reply") and not (body and body.text.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Écrivez la réponse.")
    if acc is None:
        raise inbox.pending("tiktok")
    if not await reply_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Beaucoup de réponses d'un coup : réessayez dans un moment.")
    kind = {"reply": "reply", "hide": "hide", "private-reply": "private_reply"}[action]
    c = await inbox.act(db, c, acc, kind, body.text.strip() if body else None, user.id)
    return inbox.comment_out(c, names)


@router.get("/inbox/keyword")
async def keyword(word: str = Query("SHEET", min_length=2, max_length=40), org_id: Optional[int] = Query(None),
                  group_id: Optional[int] = Query(None), include_done: bool = False,
                  limit: int = Query(200, ge=1, le=500),
                  db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    """Une ligne par personne qui a écrit ce mot (le plus récent d'abord), pour la contacter :
    réponse privée si possible, sinon lien vers son profil et message prêt à copier."""
    tenant = await _tenant(db, user, org_id)
    accounts, names = await _tenant_index(db, tenant, group_id)
    conds = [_account_filter(CmComment, accounts), CmComment.text.ilike(paging.like(word), escape="\\"),
             CmComment.parent_external_id.is_(None)]
    if not include_done:
        conds.append(CmComment.status.not_in(("contacted", "ignored", "hidden")))
        conds.append(CmComment.private_replied_at.is_(None))
    rows = (await db.execute(select(CmComment).where(*conds).order_by(CmComment.published_at.desc().nulls_last())
                             .limit(limit * 3))).scalars().all()
    people: dict = {}
    for c in rows:
        k = (c.platform, c.author_id or c.author)
        if k in people:
            people[k]["count"] += 1
            continue
        caps = inbox.capabilities(c.platform, await inbox.account_of(db, c.platform, c.account_id)) if c.platform != "tiktok" else {}
        within = c.published_at is not None and (utcnow() - c.published_at).days < inbox.PRIVATE_REPLY_DAYS
        people[k] = {**inbox.comment_out(c, names), "count": 1,
                     "can_private_reply": bool(caps.get("private_reply")) and within and not c.private_replied_at}
        if len(people) >= limit:
            break
    return list(people.values())


# --------------------------------------------------------------------------
# Messages privés Instagram (permission manage_messages)
# --------------------------------------------------------------------------

async def _ig_account(db: AsyncSession, tenant: Tenant, account_id: int) -> InstagramAccount:
    acc = await db.get(InstagramAccount, account_id)
    if acc is None or acc.revoked_at is not None or not cm_access._same_tenant(acc, tenant) \
            or not cm_access.account_allowed(tenant, "instagram", acc.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte introuvable")
    if acc.mode == IG_MODE_ROUTINE:
        raise inbox.pending("routine_dm")
    if not ig.has_scope(acc, ig.SCOPE_MESSAGES):
        raise inbox.pending("messages_ig")
    return acc


@router.get("/inbox/conversations")
async def conversations(account_id: int, org_id: Optional[int] = Query(None),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    acc = await _ig_account(db, tenant, account_id)
    token = await ig.valid_token(db, acc)
    try:
        convs = await ig.conversations(token, acc.ig_user_id)
    except ig.InstagramError as e:
        if e.code == "scope_missing":
            raise inbox.pending("messages_ig")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, e.describe())
    out = []
    for cv in convs:
        others = [p for p in ((cv.get("participants") or {}).get("data") or []) if str(p.get("id")) != str(acc.ig_user_id)]
        last = ((cv.get("messages") or {}).get("data") or [{}])[0]
        out.append({"id": cv.get("id"), "with": (others[0] if others else {}).get("username"),
                    "with_id": (others[0] if others else {}).get("id"), "updated_at": cv.get("updated_time"),
                    "last": last.get("message"), "last_from_me": str((last.get("from") or {}).get("id")) == str(acc.ig_user_id)})
    return out


@router.get("/inbox/conversations/{conversation_id}")
async def conversation(conversation_id: str, account_id: int, org_id: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    acc = await _ig_account(db, tenant, account_id)
    token = await ig.valid_token(db, acc)
    msgs = await ig.conversation_messages(token, conversation_id)
    return {"messages": [{"id": m.get("id"), "text": m.get("message"), "at": m.get("created_time"),
                          "from_me": str((m.get("from") or {}).get("id")) == str(acc.ig_user_id),
                          "from": (m.get("from") or {}).get("username")} for m in msgs],
            "can_write": inbox.dm_window_open(msgs, acc.ig_user_id)}


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    recipient_id: str = Field(min_length=1, max_length=100)


@router.post("/inbox/conversations/{conversation_id}/send")
async def send(conversation_id: str, body: SendIn, account_id: int, org_id: Optional[int] = Query(None),
               db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    tenant = await _tenant(db, user, org_id)
    cm_access.require(tenant, "edit")
    acc = await _ig_account(db, tenant, account_id)
    if not await reply_limiter.check(tenant.key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Beaucoup de messages d'un coup : réessayez dans un moment.")
    token = await ig.valid_token(db, acc)
    msgs = await ig.conversation_messages(token, conversation_id)
    if not inbox.dm_window_open(msgs, acc.ig_user_id):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Instagram n'autorise une réponse que dans les 24 h qui suivent le dernier message de la personne.")
    try:
        mid = await ig.send_message(token, acc.ig_user_id, body.recipient_id, body.text.strip())
    except ig.InstagramError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, e.describe())
    return {"ok": True, "message_id": mid}


# --------------------------------------------------------------------------
# Routine : remonter les commentaires, exécuter les actions demandées dans cm
# --------------------------------------------------------------------------

class RoutineComments(BaseModel):
    org_id: Optional[int] = None
    username: str = Field(min_length=1, max_length=60)
    items: list[dict] = Field(default_factory=list, max_length=1000)


@router.post("/routine/comments")
async def routine_comments(body: RoutineComments, db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    """Commentaires lus par la routine (un compte Instagram, n'importe quel mode) :
    [{id, media_id, parent_id?, username, user_id?, text, like_count, timestamp, video_title?, video_url?}]."""
    tenant = await _tenant(db, user, body.org_id)
    acc = (await db.execute(select(InstagramAccount).where(
        tenant.where(InstagramAccount), InstagramAccount.revoked_at.is_(None),
        func.lower(InstagramAccount.username) == body.username.strip().lstrip("@").lower()))).scalars().first()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte Instagram inconnu dans cet espace.")
    return {"saved": await inbox.ingest_routine(db, acc, body.items)}


@router.get("/routine/actions")
async def routine_actions(org_id: Optional[int] = Query(None), db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_routine_user)):
    """Réponses / masquages / réponses privées demandés dans cm pour les comptes gérés par la routine."""
    tenant = await _tenant(db, user, org_id)
    rows = (await db.execute(select(CmComment, InstagramAccount).join(
        InstagramAccount, InstagramAccount.id == CmComment.account_id).where(
        CmComment.platform == "instagram", tenant.where(CmComment), CmComment.pending_action.is_not(None),
        InstagramAccount.mode == IG_MODE_ROUTINE).order_by(CmComment.updated_at).limit(100))).all()
    return [{"id": c.id, "username": a.username, "comment_id": c.external_id, "media_id": c.media_id,
             "author": c.author, "type": (c.pending_action or {}).get("type"), "text": (c.pending_action or {}).get("text")}
            for c, a in rows]


class ActionDone(BaseModel):
    ok: bool = True
    error: Optional[str] = Field(None, max_length=500)


@router.post("/routine/actions/{comment_id}/done")
async def routine_action_done(comment_id: int, body: ActionDone, org_id: Optional[int] = Query(None),
                              db: AsyncSession = Depends(get_db), user: User = Depends(get_routine_user)):
    tenant = await _tenant(db, user, org_id)
    c = await db.get(CmComment, comment_id)
    if c is None or not ((tenant.org_id and c.organization_id == tenant.org_id)
                         or (not tenant.org_id and c.owner_user_id == tenant.owner_user_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Commentaire introuvable")
    act = c.pending_action or {}
    if not act:
        return {"ok": True}
    if body.ok:
        inbox.done(c, act.get("type"), act.get("text"), act.get("by"), utcnow())
    else:
        c.action_error = (body.error or "Échec côté routine")[:500]
        c.pending_action = None
    await db.commit()
    return {"ok": True}

