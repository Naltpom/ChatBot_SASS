"""Inbox live chat : conversations d'un bot cote staff (permission 'inbox').

Acces : meme gabarit que routers/bots.py (_get_accessible_bot + _check_bot_perm,
superadmins / admins d'org / membership None passent toujours). stats.py reste
INTOUCHE (quasi-doublon assume : ici la permission est plus fine et la surface
ajoute la prise en charge take/reply/close).

Anonymat du staff : la reponse est un Message(role='assistant', source='human')
SANS auteur — le widget affiche le label constant « Conseiller », jamais le
nom/email du conseiller.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.time import utcnow
from src.core.security import get_current_user
from src.models.bot import Bot
from src.models.conversation import (
    CONVERSATION_STATUSES,
    Conversation,
    ConversationOut,
    Message,
    MessageOut,
)
from src.models.user import User
from src.routers.bots_helpers import _check_bot_perm, _get_accessible_bot
from src.routers.widget import HANDOFF_CLOSED_MESSAGE
from src.core.constants import MODULE_INBOX
from src.services.entitlement_service import gate, resolve

router = APIRouter(prefix="/api", tags=["inbox"])

NOT_IN_HUMAN_MODE = "Cette conversation n'est pas en mode conseiller"


class ReplyRequest(BaseModel):
    content: str


async def _get_inbox_conversation(db: AsyncSession, bot: Bot, user: User,
                                  membership, cid: str) -> Conversation:
    """Conversation du bot, sous permission 'inbox'."""
    _check_bot_perm(user, membership, bot, "inbox")
    conversation = await db.get(Conversation, cid)
    # Conversations « mes données » (Assistant Chapote CM) : jamais dans la boîte de réception.
    if conversation is None or conversation.bot_id != bot.id or conversation.data_mode:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Conversation introuvable")
    return conversation


async def _guarded_transition(db: AsyncSession, conversation: Conversation,
                              from_statuses: tuple[str, ...], **values) -> bool:
    """Transition de statut GARDEE en SQL (anti-écrasement concurrent).

    UPDATE conditionnel sur (id, status IN from_statuses) avec `values`. Si une
    autre requête (timeout paresseux /poll, autre conseiller) a déjà fait bouger
    le statut, le WHERE ne matche pas : rowcount != 1.

    Retour :
      - True  : la transition a eu lieu (rowcount == 1). PAS de commit ici —
        l'appelant commit après ses propres écritures (message, etc.).
      - False : transition ratée. On a déjà fait `rollback` + `refresh` pour
        que l'appelant ré-inspecte `conversation.status` (re-check idempotent)
        et décide (retour idempotent vs HTTPException).
    """
    result = await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id,
               Conversation.status.in_(from_statuses))
        .values(**values)
    )
    if result.rowcount != 1:
        await db.rollback()
        await db.refresh(conversation)
        return False
    return True


@router.get("/bots/{bot_id}/conversations")
async def list_conversations(
    bot_id: int,
    status: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Liste des conversations du bot (inbox), triees par derniere activite.
    `unread` (simple) = messages visiteur en mode conseiller posterieurs a la
    derniere reponse staff (tous s'il n'y en a aucune)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "inbox")
    if status is not None and status not in CONVERSATION_STATUSES:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Statut inconnu : {status}")
    limit = max(1, min(200, limit))

    where = [Conversation.bot_id == bot.id, Conversation.data_mode.is_(False)]
    if status:
        where.append(Conversation.status == status)

    total = (await db.execute(
        select(func.count(Conversation.id)).where(*where)
    )).scalar_one()

    # Sous-requete correlee : id de la derniere reponse staff de la conversation
    last_staff_id = (
        select(func.max(Message.id))
        .where(
            Message.conversation_id == Conversation.id,
            Message.role == "assistant",
            Message.source == "human",
        )
        .correlate(Conversation)
        .scalar_subquery()
    )
    unread_sq = (
        select(func.count(Message.id))
        .where(
            Message.conversation_id == Conversation.id,
            Message.role == "user",
            Message.source == "human",
            Message.id > func.coalesce(last_staff_id, 0),
        )
        .correlate(Conversation)
        .scalar_subquery()
    )
    rows = (await db.execute(
        select(Conversation, unread_sq.label("unread"))
        .where(*where)
        .order_by(Conversation.last_activity_at.desc())
        .limit(limit)
    )).all()

    # Dernier message par conversation : une seule requete (fenetre row_number)
    conv_ids = [c.id for c, _ in rows]
    last_messages: dict[str, dict] = {}
    if conv_ids:
        rn = func.row_number().over(
            partition_by=Message.conversation_id,
            order_by=Message.id.desc(),
        ).label("rn")
        sub = (
            select(Message.conversation_id, Message.role, Message.source,
                   Message.content, Message.created_at, rn)
            .where(Message.conversation_id.in_(conv_ids))
            .subquery()
        )
        for r in (await db.execute(select(sub).where(sub.c.rn == 1))).all():
            last_messages[r.conversation_id] = {
                "role": r.role, "source": r.source,
                "content": r.content[:160], "created_at": r.created_at,
            }

    return {
        "total": total,
        "conversations": [
            {
                **ConversationOut.model_validate(conv).model_dump(),
                "last_message": last_messages.get(conv.id),
                "unread": unread or 0,
            }
            for conv, unread in rows
        ],
    }


@router.get("/bots/{bot_id}/conversations/{cid}")
async def get_conversation(
    bot_id: int,
    cid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Transcript complet (tous les messages, traces systeme incluses —
    coherent avec stats.py)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    conversation = await _get_inbox_conversation(db, bot, user, membership, cid)
    messages = (await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.id.asc())
    )).scalars().all()
    return {
        "conversation": ConversationOut.model_validate(conversation),
        "messages": [MessageOut.model_validate(m) for m in messages],
    }


@router.post("/bots/{bot_id}/conversations/{cid}/take")
async def take_conversation(
    bot_id: int,
    cid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Prise en charge : human_requested -> human. Transition GARDEE en SQL
    (un timeout paresseux /poll concurrent ne doit pas etre ecrase, ni la
    prise en charge d'un autre conseiller)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    conversation = await _get_inbox_conversation(db, bot, user, membership, cid)
    # Module Live chat / Inbox requis cote staff (spec §3.3) : 402 en mode
    # enforce. Billing OFF / bot sans entitlement -> ALL_UNLOCKED -> no-op (D0).
    gate(await resolve(db, bot), MODULE_INBOX)
    if conversation.status == "human":
        return {"ok": True, "status": "human"}  # idempotent
    if conversation.status != "human_requested":
        raise HTTPException(http_status.HTTP_409_CONFLICT,
                            "Cette conversation n'est pas en attente d'un conseiller")
    if not await _guarded_transition(db, conversation, ("human_requested",),
                                     status="human", human_taken_at=utcnow()):
        if conversation.status == "human":
            return {"ok": True, "status": "human"}  # pris par un collegue
        raise HTTPException(http_status.HTTP_409_CONFLICT,
                            "Cette conversation n'est pas en attente d'un conseiller")
    await db.commit()
    await db.refresh(conversation)
    return {"ok": True, "status": "human"}


@router.post("/bots/{bot_id}/conversations/{cid}/reply")
async def reply_conversation(
    bot_id: int,
    cid: str,
    body: ReplyRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reponse du conseiller. human_requested -> take implicite (premier
    repondant). Le message part vers le visiteur via son /poll."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    conversation = await _get_inbox_conversation(db, bot, user, membership, cid)
    # Module Live chat / Inbox requis pour repondre (spec §3.3) — meme garde que take.
    gate(await resolve(db, bot), MODULE_INBOX)

    content = (body.content or "").strip()
    if not content:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
    if len(content) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Message trop long (max {settings.MAX_MESSAGE_CHARS} caractères)")
    if conversation.status in ("ai", "closed"):
        raise HTTPException(http_status.HTTP_409_CONFLICT, NOT_IN_HUMAN_MODE)

    if conversation.status == "human_requested":
        # Take implicite GARDE : si un timeout paresseux concurrent a repasse
        # la conversation en ai, la reponse part en 409 (pas de message fantome)
        if not await _guarded_transition(db, conversation, ("human_requested",),
                                         status="human", human_taken_at=utcnow()):
            if conversation.status != "human":  # repassee en ai/closed entre-temps
                raise HTTPException(http_status.HTTP_409_CONFLICT, NOT_IN_HUMAN_MODE)
    msg = Message(conversation_id=conversation.id, bot_id=bot.id,
                  role="assistant", source="human", content=content)
    db.add(msg)
    conversation.last_activity_at = utcnow()
    await db.commit()
    await db.refresh(conversation)
    return {"ok": True, "status": "human",
            "message": {"id": msg.id, "content": msg.content, "created_at": msg.created_at}}


@router.post("/bots/{bot_id}/conversations/{cid}/close")
async def close_conversation(
    bot_id: int,
    cid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cloture : human_requested|human -> closed + message de clôture côté
    visiteur. Permet aussi de purger les human_requested zombies (visiteur
    parti sans poll)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    conversation = await _get_inbox_conversation(db, bot, user, membership, cid)
    if conversation.status == "closed":
        return {"ok": True, "status": "closed"}  # idempotent
    if conversation.status == "ai":
        raise HTTPException(http_status.HTTP_409_CONFLICT, NOT_IN_HUMAN_MODE)
    # Transition GARDEE : double close concurrent = un seul message de cloture
    now = utcnow()
    if not await _guarded_transition(db, conversation, ("human_requested", "human"),
                                     status="closed", closed_at=now, last_activity_at=now):
        if conversation.status == "closed":
            return {"ok": True, "status": "closed"}  # clos par un collegue
        raise HTTPException(http_status.HTTP_409_CONFLICT, NOT_IN_HUMAN_MODE)
    db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                   role="assistant", source="system", content=HANDOFF_CLOSED_MESSAGE))
    await db.commit()
    await db.refresh(conversation)
    return {"ok": True, "status": "closed"}
