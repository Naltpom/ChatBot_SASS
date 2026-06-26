"""Endpoints PUBLICS consommes par le widget embarque (<script>).

Archi : widget JS -> cette API (origin + captcha + JWT + rate limit)
-> provider IA avec cle serveur. Le widget ne touche jamais une cle IA.
Application 100% gratuite : pas de plafond d'usage ; les gardes sont
purement anti-abus (origine, captcha, rate limits).

Flux :
1. GET  /api/widget/bootstrap?key=pk_xxx  -> design + provider captcha (public)
2. POST /api/widget/session               -> verif origin + captcha -> JWT 30 min
3. POST /api/widget/message (Bearer JWT)  -> tree ou IA, rate-limite

Live chat (handoff conseiller) — pas de WebSocket, polling DB (robuste
multi-worker) :
4. POST /api/widget/handoff               -> conversation en attente d'un conseiller
5. GET  /api/widget/poll?after=<id>       -> nouveaux messages staff/system + statut
"""
import asyncio
import logging
import random
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.billing_keys import billing_customer_for_bot
from src.core.constants import (
    METER_EVENT_NAME,
    MODULE_AB,
    MODULE_ACTIONS,
    MODULE_INBOX,
    MODULE_MCP,
    MODULE_RAG,
    MODULE_WHITELABEL,
)
from src.core.database import get_db
from src.core.security import create_widget_token, get_widget_session
from src.core.time import utcnow
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.kb import KbChunk
from src.models.lead import Lead
from src.routers.widget_helpers import (
    _active_tree,
    _assert_message_len,
    _bot_collects_leads,
    _bot_has_handoff,
    _check_ip_flood,
    _check_origin,
    _client_ip,
    _get_active_bot,
    _maybe_refresh,
    _record_tree_event,
    _sanitize_design,
    _sanitize_journey,
    _sanitize_triggers,
    _session_active_bot,
)
from src.services import tree_engine
from src.services.ai_service import AIServiceError, generate_reply
from src.services.captcha import verify_captcha
from src.services.entitlement_service import (
    ai_quota_for,
    has_module,
    overage_active,
    resolve,
)
from src.services.quota_service import (
    ai_overage_consume,
    ai_overage_precheck,
    ai_quota_consume,
    ai_quota_precheck,
)
from src.services.email_service import (
    build_handoff_email,
    build_lead_email,
    lead_notification_recipients,
    send_email,
)
from src.services.rate_limit import (
    feedback_limiter,
    handoff_limiter,
    human_msg_limiter,
    lead_limiter,
    poll_ip_limiter,
    poll_limiter,
    session_limiter,
)
from src.services.safe_fetch import FetchError, safe_post_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/widget", tags=["widget"])

# --- Live chat (handoff conseiller) ---
# Messages serveur (role=assistant, source=system) : exclus de l'historique IA
# et des stats par convention de source (source != ai/tree).
HANDOFF_WAIT_MESSAGE = (
    "Votre demande a été transmise. Un conseiller va vous répondre ici dès que possible."
)
HANDOFF_TIMEOUT_MESSAGE = (
    "Aucun conseiller n'est disponible pour le moment, veuillez nous excuser. "
    "Je reste à votre disposition pour continuer."
)
HANDOFF_CLOSED_MESSAGE = (
    "Le conseiller a clôturé la conversation. "
    "Je reste disponible si vous avez d'autres questions."
)
# human_requested sans prise en charge staff au-dela de ce delai -> retour ai
# (evalue paresseusement au prochain /poll ou /message, jamais de cron)
HANDOFF_TIMEOUT_MINUTES = 15

# --- Facturation modulaire : quota IA epuise (spec §3.3 / F2) ---
# Mode `block`, quota mensuel atteint : message DEDIE distinct (configurable
# client via design_json.quotaExhaustedMessage), JAMAIS le AIServiceError
# « souci technique » (mensonger, brouille le monitoring). Le flag interne
# reason=quota_exhausted sert les logs/analytics ; la structure de reponse au
# visiteur reste celle d'une reponse IA normale (200, source 'ai', options []).
QUOTA_EXHAUSTED_MESSAGE = (
    "Le service de réponses automatiques a atteint sa limite pour ce mois-ci. "
    "Vous pouvez naviguer dans le menu ou revenir un peu plus tard."
)

# --- Abonnement d'essai LEGACY expiré (plus d'essai créé ; clients antérieurs) ---
# Un bot dont l'essai legacy est terminé (status='trialing' ET utcnow()>=trial_end) est
# GATÉ : l'IA ne répond plus tant que l'éditeur n'a pas souscrit. Message visiteur
# DÉDIÉ, DISTINCT de QUOTA_EXHAUSTED_MESSAGE (le quota concerne un bot souscrit qui
# a consommé son forfait du mois ; ici c'est l'essai qui est échu). Même forme de
# réponse qu'une réponse IA (200, source 'ai', options []) : pas d'erreur visiteur,
# la navigation arbre/conseiller reste possible côté gating module. billing OFF /
# bot sans entitlement => resolver ALL_UNLOCKED (trial_expired False) => jamais ce
# message (comportement identique à aujourd'hui).
TRIAL_ENDED_MESSAGE = (
    "Les réponses automatiques de cet assistant sont momentanément indisponibles. "
    "Vous pouvez naviguer dans le menu ci-dessous."
)

# --- Plafond de dépassement IA métré atteint (mode 'meter') ---
# Le bot a dépassé son quota, l'owner a armé le dépassement facturé (overage), MAIS
# le PLAFOND de sécurité (overage_cap) est atteint pour ce mois : on ne génère plus
# (pré-check, comme le quota). Message DÉDIÉ, forme d'une réponse IA (200, source
# 'ai', options []) ; AUCUN message assistant persisté (reason=overage_cap_reached).
OVERAGE_CAP_MESSAGE = (
    "Le service de réponses automatiques a atteint sa limite pour ce mois-ci. "
    "Vous pouvez naviguer dans le menu ou revenir un peu plus tard."
)


# Helpers extraits dans routers/widget_helpers.py (importes ci-dessus) :
# _client_ip, _check_ip_flood, _check_origin, _check_session_origin,
# _get_active_bot, _session_active_bot (revalidation bot+org des endpoints de
# session), _assert_message_len, _sanitize_design/_journey/_triggers,
# _active_tree, _record_tree_event, _bot_collects_leads, _bot_has_handoff,
# _maybe_refresh.
# Restent ICI : trigger_handoff, _lazy_timeout, _post_handoff_webhook et les
# messages de live chat (HANDOFF_*) — couples a la transition handoff et
# importes par inbox.py (HANDOFF_CLOSED_MESSAGE) / action_executor.py
# (trigger_handoff, import paresseux). Ne PAS les deplacer (eviterait un cycle).


# --- Schemas ---

class SessionRequest(BaseModel):
    public_key: str
    visitor_id: str = Field(min_length=8, max_length=64)
    page_url: Optional[str] = Field(None, max_length=2000)
    # En mode iframe : document.referrer de la page parente (verif whitelist)
    parent_url: Optional[str] = Field(None, max_length=2000)
    captcha_token: Optional[str] = None
    # Parcours du visiteur avant l'ouverture du chat (contexte IA optionnel).
    # Type `Any` volontaire : un payload mal forme ne doit JAMAIS provoquer de
    # 422 — il est filtre par _sanitize_journey et devient None au pire.
    journey: Optional[Any] = None


class MessageRequest(BaseModel):
    # Soit `node` (clic sur une option de l'arbre), soit `text` (message libre -> IA)
    node: Optional[str] = Field(None, max_length=100)
    text: Optional[str] = None
    page_url: Optional[str] = Field(None, max_length=2000)


class LeadRequest(BaseModel):
    # Formulaire de contact du widget (noeud d'arbre type 'lead')
    email: EmailStr
    name: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=40)
    message: Optional[str] = Field(None, max_length=2000)


class FeedbackRequest(BaseModel):
    # Retour CSAT sur une reponse assistant (pouce haut/bas du widget)
    message_id: int = Field(ge=1)
    rating: str = Field(pattern="^(up|down)$")


# --- Endpoints ---

@router.get("/bootstrap")
async def bootstrap(key: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Config publique du widget : design + captcha. Aucun secret ici."""
    await _check_ip_flood(request)
    bot = await _get_active_bot(db, key)
    _check_origin(request, bot, allow_api_origin=True)

    captcha_site_key = None
    if bot.captcha_provider == "turnstile":
        captcha_site_key = settings.TURNSTILE_SITE_KEY
    elif bot.captcha_provider == "recaptcha_v3":
        captcha_site_key = bot.captcha_site_key

    design = dict(bot.design_json or {})
    design.setdefault("title", None)
    if not design.get("title"):
        design["title"] = bot.name
    # Facturation modulaire (spec §3.3 white-label) : sans le module White-label,
    # la mention « Powered by » est FORCEE (poweredBy=True), peu importe le
    # design stocke. billing OFF / bot sans entitlement => has_module True
    # (ALL_UNLOCKED) => le client garde la main sur poweredBy (comportement
    # identique a aujourd'hui).
    ent = await resolve(db, bot)
    if not has_module(ent, MODULE_WHITELABEL):
        design["poweredBy"] = True
    design = _sanitize_design(design)
    return {
        "design": design,
        "mode": bot.mode,
        "captcha": {"provider": bot.captcha_provider, "site_key": captcha_site_key},
        # Cle additive : triggers proactifs (sanitises, evalues cote client)
        "triggers": _sanitize_triggers(bot.triggers_json or []),
    }


@router.post("/session")
async def create_session(body: SessionRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Handshake : captcha verifie ICI (une fois), puis le JWT couvre la session."""
    await _check_ip_flood(request)
    bot = await _get_active_bot(db, body.public_key)
    domain = _check_origin(request, bot, parent_url=body.parent_url or body.page_url)

    if not await verify_captcha(bot, body.captcha_token, _client_ip(request)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vérification anti-bot échouée")

    # Affectation A/B : tiree AVANT la construction de la conversation, sticky
    # pour toute sa duree (tree_engine sert la variante aux conversations 'b').
    # JAMAIS renvoyee au widget : aucune fuite du variant au visiteur.
    # Facturation modulaire (spec §3.3) : sans le module A/B, tous les visiteurs
    # voient la variante A (variant=None) — degradation silencieuse, jamais
    # d'erreur au visiteur. billing OFF / bot sans entitlement => has_module True
    # (resolver ALL_UNLOCKED) => comportement identique a aujourd'hui.
    variant = None
    if bot.tree_variant_json and (bot.ab_split_pct or 0) > 0:
        ent = await resolve(db, bot)
        if has_module(ent, MODULE_AB):
            variant = "b" if random.random() * 100 < bot.ab_split_pct else "a"

    conversation = Conversation(
        bot_id=bot.id,
        visitor_id=body.visitor_id,
        domain=domain or "unknown",
        page_url=body.page_url,
        journey=_sanitize_journey(body.journey),
        variant=variant,
    )
    db.add(conversation)
    await db.commit()

    token = create_widget_token(bot.id, conversation.id, domain or "unknown")

    # Premier message : noeud de depart de l'arbre (tree/hybrid) ou accueil design
    if bot.mode in ("tree", "hybrid"):
        node_id, node = tree_engine.get_node(_active_tree(bot, conversation))
        first = tree_engine.format_node_response(node_id, node)
        # Funnel : le premier noeud servi compte comme un passage (l'accueil
        # du mode ai n'est pas un noeud d'arbre -> pas d'evenement)
        _record_tree_event(db, bot, conversation, node_id)
    else:
        welcome = (bot.design_json or {}).get("welcomeMessage") or "Bonjour ! Posez-moi votre question."
        first = {"source": "tree", "node_id": None, "message": welcome, "options": []}

    msg = Message(
        conversation_id=conversation.id, bot_id=bot.id,
        role="assistant", source="tree", content=first["message"],
    )
    db.add(msg)
    await db.commit()

    # message_id : cle additive CSAT (le widget peut noter l'accueil) ;
    # status : cle additive live chat (nouvelle conversation = toujours ai)
    first["message_id"] = msg.id
    return {"token": token, "conversation_id": conversation.id, "first": first, "status": "ai"}


async def _lazy_timeout(conversation: Conversation, db: AsyncSession) -> bool:
    """Timeout paresseux (pas de cron) : une demande de conseiller restee sans
    prise en charge depuis HANDOFF_TIMEOUT_MINUTES repasse en mode ai avec un
    message d'excuse. Appele en tete de /poll ET /message. True si bascule.
    Reference : human_requested_at (jamais last_activity_at).

    Transition GARDEE (UPDATE ... WHERE status='human_requested') : /poll et
    /message du meme visiteur s'executent en parallele (multi-worker) au
    franchissement du cutoff — sans garde, double message d'excuse, et un
    /take ou /reply staff concurrent serait silencieusement ecrase."""
    if conversation.status != "human_requested":
        return False
    cutoff = utcnow() - timedelta(minutes=HANDOFF_TIMEOUT_MINUTES)
    # human_requested_at None = etat incoherent : on debloque aussi (anti-zombie)
    if conversation.human_requested_at is not None and conversation.human_requested_at >= cutoff:
        return False
    result = await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id,
               Conversation.status == "human_requested")
        .values(status="ai", last_activity_at=utcnow())
    )
    if result.rowcount != 1:
        # Course perdue (autre poll/message, ou staff entre-temps) : no-op,
        # on recharge l'etat courant (expire_on_commit=False -> refresh requis)
        await db.rollback()
        await db.refresh(conversation)
        return False
    db.add(Message(conversation_id=conversation.id, bot_id=conversation.bot_id,
                   role="assistant", source="system", content=HANDOFF_TIMEOUT_MESSAGE))
    await db.commit()
    await db.refresh(conversation)
    return True


async def _post_handoff_webhook(url: str, payload: dict) -> None:
    """Webhook de notification (tache de fond) : echec logge, jamais bloquant.
    On ne logge JAMAIS l'URL complete (un webhook entrant Slack/Teams embarque
    son token secret dans le chemin) : hostname seul, comme action_executor."""
    try:
        await safe_post_json(url, payload)
    except FetchError as exc:
        logger.warning("Webhook handoff en échec (%s) : %s", urlparse(url).hostname, exc)


async def trigger_handoff(bot: Bot, conversation: Conversation, db: AsyncSession) -> Optional[int]:
    """Transition vers human_requested : statut + horodatages, trace [handoff]
    (pattern [lead]), message d'attente, notifications email/webhook.

    Source UNIQUE de la transition, partagee entre POST /widget/handoff et
    l'action IA handoff (action_executor, import paresseux). L'idempotence
    du cas courant (deja human_requested/human -> ne rien refaire) est geree
    par l'appelant, MAIS la transition reste GARDEE en SQL : deux POST quasi
    simultanes (avant le premier commit) ne doublent ni le message d'attente
    ni les notifications. Retourne l'id du message d'attente, ou None si une
    transition concurrente a gagne (conversation rechargee)."""
    now = utcnow()
    result = await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id,
               Conversation.status.notin_(("human_requested", "human")))
        .values(status="human_requested", human_requested_at=now,
                closed_at=None,  # re-demande apres cloture autorisee
                last_activity_at=now)
    )
    if result.rowcount != 1:
        await db.rollback()
        await db.refresh(conversation)
        return None
    db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                   role="user", source="system", content="[handoff]"))
    wait_msg = Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="assistant", source="system", content=HANDOFF_WAIT_MESSAGE)
    db.add(wait_msg)
    await db.commit()
    # expire_on_commit=False : resynchronise l'objet (status relu par /message)
    await db.refresh(conversation)

    # Notifications NON bloquantes : donnees collectees AVANT les create_task
    # (les taches de fond ne touchent jamais la session db). SMTP absent ->
    # fallback log (contrat email_service).
    recipients = await lead_notification_recipients(db, bot)
    subject, mail_body = build_handoff_email(bot, conversation)
    asyncio.create_task(send_email(recipients, subject, mail_body))
    if bot.handoff_webhook_url:
        payload = {"text": (
            f"Un visiteur demande un conseiller sur « {bot.name} » "
            f"(conversation {conversation.id}). "
            f"Page : {conversation.page_url or conversation.domain}"
        )}
        asyncio.create_task(_post_handoff_webhook(bot.handoff_webhook_url, payload))
    return wait_msg.id


@router.post("/lead")
async def submit_lead(
    body: LeadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    """Soumission du formulaire de contact (noeud d'arbre type 'lead').
    Empile les memes protections que /message + rate-limit dedie."""
    await _check_ip_flood(request)
    if not await lead_limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de demandes de contact, réessayez plus tard")

    bot = await _session_active_bot(db, request, session)

    if not _bot_collects_leads(bot):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ce bot ne collecte pas de demandes de contact")

    conversation = await db.get(Conversation, session["sub"])
    lead = Lead(
        bot_id=bot.id,
        conversation_id=conversation.id if conversation else None,
        source="tree",
        email=str(body.email).lower(),
        name=body.name,
        phone=body.phone,
        message=body.message,
    )
    db.add(lead)
    if conversation:
        # Trace dans le transcript ; source=system => exclu de l'historique IA
        db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="user", source="system", content=f"[lead] {body.email}"))
    await db.commit()

    # Notification email NON bloquante : destinataires recuperes avec la
    # session db de la requete, envoi en tache de fond (fallback log sans SMTP)
    recipients = await lead_notification_recipients(db, bot)
    subject, mail_body = build_lead_email(bot, lead)
    asyncio.create_task(send_email(recipients, subject, mail_body))

    return _maybe_refresh({"ok": True, "message": "Merci ! Votre demande a bien été transmise."}, bot, session)


@router.post("/feedback")
async def submit_feedback(
    body: FeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    """Retour CSAT du widget (pouce haut/bas) sur une reponse assistant
    source ai|tree. Idempotent/ecrasable : re-noter remplace la note.
    Empile les memes protections que /lead + rate-limit dedie."""
    await _check_ip_flood(request)
    if not await feedback_limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de retours envoyés, réessayez plus tard")

    bot = await _session_active_bot(db, request, session)

    # UN SEUL message d'erreur quel que soit le cas (introuvable, autre
    # conversation, role/source non notables) : pas de fuite d'information
    # sur l'existence des messages des autres conversations.
    msg = await db.get(Message, body.message_id)
    if (msg is None or msg.conversation_id != session["sub"]
            or msg.role != "assistant" or msg.source not in ("ai", "tree")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message introuvable")

    msg.rating = 1 if body.rating == "up" else -1
    await db.commit()
    return _maybe_refresh({"ok": True}, bot, session)


@router.post("/handoff")
async def request_handoff(
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    """Demande de mise en relation avec un conseiller (noeud d'arbre 'handoff'
    enchaine par le widget, ou re-demande apres cloture). Memes protections
    empilees que /lead + rate-limit dedie."""
    await _check_ip_flood(request)
    if not await handoff_limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de demandes de mise en relation, réessayez plus tard")

    bot = await _session_active_bot(db, request, session)

    # Facturation modulaire (spec §3.3 live chat) : la mise en relation conseiller
    # exige le module Inbox. Check booleen AMONT de trigger_handoff (jamais
    # d'exception dans la transition SQL) : sans le module, le handoff est refuse
    # proprement (404, comme un bot qui ne propose pas de conseiller — pas de
    # bascule partielle de la conversation). billing OFF / bot sans entitlement
    # => has_module True (ALL_UNLOCKED) => comportement identique a aujourd'hui.
    ent = await resolve(db, bot)
    if not _bot_has_handoff(bot) or not has_module(ent, MODULE_INBOX):
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Ce bot ne propose pas de mise en relation avec un conseiller")

    conversation = await db.get(Conversation, session["sub"])
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation introuvable")

    if conversation.status in ("human_requested", "human"):
        # Idempotent : etat courant renvoye SANS re-notifier. last_message_id
        # null = le widget conserve son curseur de polling (jamais de retour
        # en arriere -> pas de doublons).
        return _maybe_refresh({
            "ok": True, "status": conversation.status,
            "message": HANDOFF_WAIT_MESSAGE, "last_message_id": None,
        }, bot, session)

    last_message_id = await trigger_handoff(bot, conversation, db)
    if last_message_id is None:
        # Course perdue (double POST quasi simultane) : reponse idempotente,
        # curseur de polling conserve (last_message_id null)
        return _maybe_refresh({
            "ok": True, "status": conversation.status,
            "message": HANDOFF_WAIT_MESSAGE, "last_message_id": None,
        }, bot, session)
    return _maybe_refresh({
        "ok": True, "status": "human_requested",
        "message": HANDOFF_WAIT_MESSAGE, "last_message_id": last_message_id,
    }, bot, session)


@router.get("/poll")
async def poll_messages(
    request: Request,
    after: int = 0,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    """Polling du live chat (widget, 2,5 s panneau ouvert) : nouveaux messages
    staff/system + statut courant. UNIQUEMENT source human/system : les
    reponses ai/tree sont deja rendues en synchrone par le widget, jamais
    re-poussees. Le _maybe_refresh est CRITIQUE ici (session glissante pendant
    l'attente passive, sinon mort du JWT a 30 min).

    Budget IP DEDIE (poll_ip_limiter, jamais _check_ip_flood) : a 24 req/min
    par visiteur, le limiteur IP partage 100/min serait epuise par ~4 visiteurs
    en attente derriere un meme NAT -> 429 sur TOUT le widget de l'IP."""
    if not await poll_ip_limiter.check(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes")
    if not await poll_limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes")

    bot = await _session_active_bot(db, request, session)

    conversation = await db.get(Conversation, session["sub"])
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation introuvable")

    await _lazy_timeout(conversation, db)

    # Message.id : Integer autoincrement global -> curseur fiable
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.id > max(0, after),
            Message.role == "assistant",
            Message.source.in_(["human", "system"]),
        )
        .order_by(Message.id.asc())
        .limit(50)
    )
    messages = [
        {"id": m.id, "content": m.content, "source": m.source, "created_at": m.created_at}
        for m in result.scalars().all()
    ]
    return _maybe_refresh({"status": conversation.status, "messages": messages}, bot, session)


async def _handle_human_message(
    body: MessageRequest, bot: Bot, conversation: Conversation, db: AsyncSession, session: dict,
) -> dict:
    """Mode conseiller (live chat) : persiste le message visiteur, JAMAIS d'IA.
    Comportement inchange (extrait de post_message)."""
    if body.node:
        # UI desynchronisee (defensif) : pas de navigation d'arbre pendant
        # un echange avec un conseiller
        raise HTTPException(status.HTTP_409_CONFLICT, "Conversation en cours avec un conseiller")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
    _assert_message_len(text)
    msg = Message(conversation_id=conversation.id, bot_id=bot.id,
                  role="user", source="human", content=text)
    db.add(msg)
    conversation.last_activity_at = utcnow()
    await db.commit()
    # message null = simple accuse (le widget n'affiche rien, la reponse
    # du conseiller arrivera par /poll)
    return _maybe_refresh({
        "source": "human", "status": conversation.status,
        "message": None, "options": [], "last_message_id": msg.id,
    }, bot, session)


async def _handle_tree_node(
    body: MessageRequest, bot: Bot, conversation: Conversation, db: AsyncSession, session: dict,
) -> dict:
    """Navigation dans l'arbre (clic option) : gratuit, illimite.
    Comportement inchange (extrait de post_message)."""
    node_id, node = tree_engine.get_node(_active_tree(bot, conversation), body.node)
    response = tree_engine.format_node_response(node_id, node)
    db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                   role="user", source="tree", content=f"[option] {body.node}"))
    msg = Message(conversation_id=conversation.id, bot_id=bot.id,
                  role="assistant", source="tree", content=response["message"])
    db.add(msg)
    _record_tree_event(db, bot, conversation, node_id)
    await db.commit()
    response["status"] = conversation.status
    # message_id : cle additive CSAT (reponse tree notables par le widget)
    response["message_id"] = msg.id
    return _maybe_refresh(response, bot, session)


async def _build_ai_history(conversation: Conversation, text: str, db: AsyncSession) -> list[dict]:
    """Historique tronque (limite de payload vers le modele), normalise pour les
    APIs (alternance commencant par 'user'). Comportement inchange (extrait de
    post_message)."""
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id, Message.source.in_(["ai", "tree"]))
        .order_by(Message.created_at.desc())
        .limit(settings.MAX_HISTORY_MESSAGES)
    )
    rows = list(reversed(result.scalars().all()))
    history = [{"role": m.role, "content": m.content} for m in rows if m.role in ("user", "assistant")]
    # Les APIs exigent une alternance commencant par "user"
    while history and history[0]["role"] != "user":
        history.pop(0)
    if not history:
        history = [{"role": "user", "content": text}]
    return history


async def _handle_ai_message(
    body: MessageRequest, bot: Bot, conversation: Conversation, db: AsyncSession, session: dict, text: str,
) -> dict:
    """Message libre : mode tree (réponse de redirection) ou IA. Comportement
    EXACT inchange (extrait de post_message — le chemin IA n'est pas couvert par
    e2e, logique preservee a l'octet pres)."""
    if bot.mode == "tree":
        node_id, node = tree_engine.get_node(_active_tree(bot, conversation))
        db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="user", source="tree", content=text))
        # Pas de message assistant persiste -> pas de message_id (pas de CSAT)
        _record_tree_event(db, bot, conversation, node_id)
        await db.commit()
        return _maybe_refresh({
            "source": "tree", "node_id": node_id,
            "message": "Merci ! Choisissez une option ci-dessous.",
            "options": tree_engine.format_node_response(node_id, node)["options"],
            "status": conversation.status,
        }, bot, session)

    db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                   role="user", source="ai", content=text))
    await db.commit()

    # --- Facturation modulaire (spec §3.3 / §3.4) : entitlement du bot ---
    # billing OFF / bot sans entitlement => ALL_UNLOCKED (modules tous presents,
    # quota illimite) => comportement strictement identique a aujourd'hui.
    ent = await resolve(db, bot)

    # Fin du gratuit a vie (point 4/5) : essai de 7 jours EXPIRE => l'IA ne repond
    # plus (gate), message visiteur DEDIE distinct du quota. On NE persiste AUCUN
    # message assistant (comme la branche quota/AIServiceError : ne pas gonfler la
    # source durable du compteur, source='ai' role='assistant'). Le message
    # visiteur deja persiste reste l'historique. billing OFF / pas d'entitlement
    # => trial_expired False => jamais ce chemin (comportement actuel preserve).
    if ent.trial_expired:
        logger.info("billing.trial: bot %s essai expire (reason=trial_ended)", bot.id)
        return _maybe_refresh({"source": "ai", "message": TRIAL_ENDED_MESSAGE,
                               "options": [], "status": conversation.status},
                              bot, session)

    # Pre-check QUOTA IA (mode block) JUSTE AVANT l'effet couteux (generate_reply).
    # LECTURE SEULE : on NE consomme PAS de credit ici. ai_quota_for(ent) is None
    # => illimite (BYOK ou billing OFF / pas de quota) => on n'appelle PAS le
    # compteur. Sinon : quota deja epuise => message DEDIE (reason=quota_exhausted),
    # 200, source 'ai', PAS d'AIServiceError. On ne gate JAMAIS la navigation
    # arbre/conseiller. Le credit n'est INCREMENTE (ai_quota_consume) qu'APRES un
    # generate_reply reussi ET la persistance du message assistant : une panne
    # provider (AIServiceError) ne brule donc aucune reponse du mois et Redis ne
    # derive jamais au-dessus du COUNT SQL durable.
    # Dépassement IA métré (mode 'meter', toggle owner) : armé une fois ent résolu.
    # billing OFF / pas de plan IA managé / BYOK / overage_mode='block' => False
    # => comportement strictement identique a aujourd'hui (blocage au quota).
    overage_on = overage_active(ent)
    # in_overage : la reponse en cours est servie AU-DELA du quota (a facturer).
    # Decide dans la branche quota epuise ci-dessous ; consomme apres generate_reply.
    in_overage = False

    quota = ai_quota_for(ent)
    if quota is not None and not await ai_quota_precheck(db, bot.id, quota):
        # Quota epuise. Deux issues selon le mode dépassement (choix owner) :
        if overage_on:
            # Mode 'meter' : on SERT au-dela du quota TANT QUE le plafond de
            # securite (overage_cap) n'est pas atteint (pre-check LECTURE SEULE,
            # comme le quota : on ne genere jamais au-dela du plafond).
            cap = ent.overage_cap
            if await ai_overage_precheck(db, bot.id, cap):
                # Sous le plafond : on NE return PAS, on genere puis on rapporte
                # le dépassement (ai_overage_consume) apres generate_reply.
                in_overage = True
                logger.info(
                    "billing.overage: bot %s quota epuise -> dépassement servi "
                    "(mode=meter, reason=overage_served)", bot.id)
            else:
                # Plafond de dépassement atteint : message DEDIE (distinct du quota),
                # AUCUN message assistant persiste (reason=overage_cap_reached).
                logger.info(
                    "billing.overage: bot %s plafond de dépassement atteint "
                    "(reason=overage_cap_reached)", bot.id)
                return _maybe_refresh(
                    {"source": "ai", "message": OVERAGE_CAP_MESSAGE,
                     "options": [], "status": conversation.status}, bot, session)
        else:
            # Mode 'block' (defaut) : comportement actuel (quota epuise, message dedie).
            logger.info("billing.quota: bot %s quota IA epuise (reason=quota_exhausted)", bot.id)
            # Comme la branche AIServiceError : AUCUN message assistant persiste.
            # Un message source='ai' gonflerait la source durable du compteur
            # (usage_service.count_ai_messages_month filtre source='ai',
            # role='assistant') alors qu'aucune reponse IA n'a ete generee. Le
            # message visiteur (source='ai') deja persiste reste l'historique. La
            # reponse au visiteur garde la forme d'une reponse IA (200, source 'ai').
            return _maybe_refresh({"source": "ai", "message": QUOTA_EXHAUSTED_MESSAGE,
                                   "options": [], "status": conversation.status},
                                  bot, session)

    history = await _build_ai_history(conversation, text, db)

    page_url = body.page_url or conversation.page_url
    # Base de connaissances : le tool search_docs n'est expose au modele que
    # si le bot a au moins un extrait indexe ET que le module RAG est actif
    # (sans le module, has_kb force a False => search_docs non expose).
    has_kb = (await db.execute(
        select(KbChunk.id).where(KbChunk.bot_id == bot.id).limit(1)
    )).first() is not None
    if has_kb and not has_module(ent, MODULE_RAG):
        has_kb = False
    # Actions exposees au modele uniquement si le module Actions est actif ;
    # serveurs MCP exposes uniquement si le module MCP est actif (separation).
    allow_actions = has_module(ent, MODULE_ACTIONS)
    allow_mcp = has_module(ent, MODULE_MCP)
    try:
        # journey : contexte IA uniquement (le mode arbre n'en a pas besoin),
        # deja valide/tronque au handshake par _sanitize_journey.
        # db + conversation_id : necessaires aux actions IA (capture_lead).
        # locale : 'auto' ajoute la consigne de langue au system prompt.
        ai = await generate_reply(bot, history, page_url, journey=conversation.journey,
                                  db=db, conversation_id=conversation.id, has_kb=has_kb,
                                  locale=(bot.design_json or {}).get("locale"),
                                  allow_actions=allow_actions, allow_mcp=allow_mcp)
    except AIServiceError:
        # Panne provider : AUCUN credit consomme (ai_quota_consume n'est appele
        # qu'apres ce point). Le compteur Redis ne derive donc pas au-dessus du
        # COUNT SQL durable, et la reponse du mois n'est pas brulee.
        return _maybe_refresh({"source": "ai", "message": "Désolé, je rencontre un souci technique. Réessayez dans un instant.",
                               "options": [], "status": conversation.status}, bot, session)

    # generate_reply a reussi : on comptabilise UNE reponse AVANT de persister le
    # message assistant. Deux cas exclusifs :
    # - DÉPASSEMENT (in_overage) : la reponse est servie au-dela du quota. On NE
    #   touche PAS le quota (deja epuise) ; on INCRÉMENTE TOUJOURS reported_overage
    #   (le plafond reste enforce) et on rapporte le meter event Stripe (best-effort)
    #   UNIQUEMENT si un customer payeur est resolu — sans customer (org sans payeur
    #   Stripe / jamais souscrit) on compte quand meme (sinon le plafond ne bornerait
    #   plus rien => depassement illimite). Le message reste un Message source='ai'
    #   normal (historique + conso durable).
    # - NORMAL : on comptabilise UNE reponse IA dans le quota (ai_quota_consume).
    #   Le reseed lit le COUNT SQL durable qui n'inclut PAS encore cette reponse,
    #   l'INCR l'ajoute exactement une fois (pas de double comptage). Le retour
    #   False (course concurrente du dernier credit) est ignore : la reponse est
    #   deja generee. BYOK / billing OFF => quota is None => pas de comptage.
    if in_overage:
        customer_id = await billing_customer_for_bot(db, bot)
        await ai_overage_consume(
            db, bot.id, customer_id, METER_EVENT_NAME, ent.overage_cap)
    elif quota is not None:
        await ai_quota_consume(db, bot.id, quota)

    msg = Message(
        conversation_id=conversation.id, bot_id=bot.id,
        role="assistant", source="ai", content=ai.content,
        tokens_in=ai.tokens_in, tokens_out=ai.tokens_out,
    )
    db.add(msg)
    conversation.last_activity_at = utcnow()
    await db.commit()

    # status relu APRES generate_reply : l'action IA handoff a pu le muter via
    # la meme session (la reponse declenche alors le polling cote widget).
    # message_id : cle additive CSAT.
    return _maybe_refresh({"source": "ai", "message": ai.content, "options": [],
                           "status": conversation.status, "message_id": msg.id}, bot, session)


@router.post("/message")
async def post_message(
    body: MessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    await _check_ip_flood(request)

    # Revalidation bot+org (CHANTIER A) : alignee sur lead/feedback/handoff/poll
    # via _session_active_bot. Corrige la faille ou /message acceptait encore les
    # bots d'une org suspendue (et consommait l'IA). Message d'erreur aligne.
    bot = await _session_active_bot(db, request, session)

    conversation = await db.get(Conversation, session["sub"])
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation introuvable")

    # Timeout paresseux du live chat AVANT le choix du limiteur (une demande
    # expiree redevient un message ai normal)
    await _lazy_timeout(conversation, db)

    # Choix du limiteur : cadence plus fluide en mode conseiller, limiteur
    # historique sinon. NB documente : le limiteur passe APRES le fetch bot/
    # conversation (cout db sur requete limitee, acceptable).
    in_human = conversation.status in ("human_requested", "human")
    limiter = human_msg_limiter if in_human else session_limiter
    if not await limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Limite de messages atteinte, réessayez dans quelques minutes")

    # --- Mode conseiller (live chat) : persiste, JAMAIS d'IA ---
    if in_human:
        return await _handle_human_message(body, bot, conversation, db, session)

    # Conversation cloturee + nouveau message texte -> bascule paresseuse en
    # flux normal (closed_at conserve pour l'historique, seul status change)
    if conversation.status == "closed" and not body.node and (body.text or "").strip():
        conversation.status = "ai"

    # --- Navigation dans l'arbre (clic option) : gratuit, illimite ---
    if body.node:
        return await _handle_tree_node(body, bot, conversation, db, session)

    # --- Message libre -> tree (redirection) ou IA ---
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
    _assert_message_len(text)
    return await _handle_ai_message(body, bot, conversation, db, session, text)
