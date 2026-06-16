"""Endpoints PUBLICS consommes par le widget embarque (<script>).

Archi : widget JS -> cette API (origin + captcha + JWT + rate limit + caps)
-> provider IA avec cle serveur. Le widget ne touche jamais une cle IA.

Flux :
1. GET  /api/widget/bootstrap?key=pk_xxx  -> design + provider captcha (public)
2. POST /api/widget/session               -> verif origin + captcha -> JWT 30 min
3. POST /api/widget/message (Bearer JWT)  -> tree ou IA, rate-limite, cape

Live chat (handoff conseiller) — pas de WebSocket, polling DB (robuste
multi-worker) :
4. POST /api/widget/handoff               -> conversation en attente d'un conseiller
5. GET  /api/widget/poll?after=<id>       -> nouveaux messages staff/system + statut
"""
import asyncio
import logging
import random
import re
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import create_widget_token, get_widget_session, widget_token_needs_refresh
from src.models.analytics import TreeEvent
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.kb import KbChunk
from src.models.lead import Lead
from src.models.user import Organization
from src.services import tree_engine
from src.services.ai_service import AIServiceError, generate_reply
from src.services.captcha import verify_captcha
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
    ip_limiter,
    lead_limiter,
    poll_ip_limiter,
    poll_limiter,
    session_limiter,
)
from src.services.safe_fetch import FetchError, safe_post_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/widget", tags=["widget"])

# --- Live chat (handoff conseiller) ---
# Messages serveur (role=assistant, source=system) : exclus de l'historique IA,
# des quotas et des stats par convention de source.
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


# --- Helpers ---

def _client_ip(request: Request) -> str:
    # --proxy-headers est actif : request.client.host reflete X-Forwarded-For
    return request.client.host if request.client else "unknown"


def _origin_host(request: Request) -> Optional[str]:
    origin = request.headers.get("origin") or request.headers.get("referer")
    if not origin:
        return None
    return urlparse(origin).hostname


def _domain_allowed(host: Optional[str], allowed: list[str]) -> bool:
    """Whitelist par bot. Les navigateurs ne laissent pas forger l'Origin :
    ca bloque l'embed sauvage sur d'autres sites. (Un script serveur peut le
    spoofer -> c'est pour ca qu'on empile captcha + rate limits + caps.)"""
    if not host:
        return False
    host = host.lower()
    for entry in allowed:
        entry = entry.lower().strip()
        if not entry:
            continue
        if entry.startswith("*."):
            if host == entry[2:] or host.endswith(entry[1:]):
                return True
        elif host == entry:
            return True
    return False


async def _get_active_bot(db: AsyncSession, public_key: str) -> Bot:
    result = await db.execute(select(Bot).where(Bot.public_key == public_key))
    bot = result.scalar_one_or_none()
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    # Organisation suspendue (impayé, abus...) -> tous ses widgets coupés
    org = await db.get(Organization, bot.organization_id)
    if org is None or not org.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    return bot


def _api_host() -> Optional[str]:
    return urlparse(settings.API_URL).hostname


def _check_origin(request: Request, bot: Bot, parent_url: Optional[str] = None,
                  allow_api_origin: bool = False) -> str:
    host = _origin_host(request)
    if settings.ENV == "dev" and host in ("localhost", "127.0.0.1"):
        return host
    # Mode iframe (/widget-frame) : l'Origin est celui de l'API elle-meme.
    # On verifie alors le domaine de la PAGE PARENTE (document.referrer envoye
    # par le widget en parent_url) pour ne pas contourner la whitelist.
    if host == _api_host():
        parent_host = urlparse(parent_url).hostname if parent_url else None
        if settings.ENV == "dev" and parent_host in ("localhost", "127.0.0.1"):
            return parent_host
        if parent_host and _domain_allowed(parent_host, bot.allowed_domains or []):
            return parent_host
        if allow_api_origin:
            # bootstrap GET depuis l'iframe : pas de parent connu, on ne sert
            # que le design (public). La session, elle, exige le parent.
            return host
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Domaine parent non autorisé pour ce widget")
    if not _domain_allowed(host, bot.allowed_domains or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Domaine non autorisé pour ce widget")
    return host


async def _check_ip_flood(request: Request) -> None:
    if not await ip_limiter.check(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes")


def _check_session_origin(request: Request, session: dict) -> None:
    """Coherence avec la session : le domaine a deja ete valide au handshake
    (whitelist) et signe dans le JWT. On ne re-parse PAS body.page_url
    (controle client). En iframe, l'Origin reste celui de l'API : le parent
    a ete verifie a la creation de session."""
    host = _origin_host(request)
    if not (
        (settings.ENV == "dev" and host in ("localhost", "127.0.0.1"))
        or host == session["domain"]
        or host == _api_host()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origine incohérente avec la session")


_HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}")


def _sanitize_design(design: dict) -> dict:
    """design_json est saisi par les membres de l'org et injecte dans le
    <style> du widget cote client : on ne renvoie que des valeurs sures
    (anti injection CSS/URL). Les textes sont bornes par precaution meme si
    le widget les insere en textContent.

    TOUTE nouvelle cle design doit etre ajoutee ICI (whitelist/borne) : seul
    le bootstrap sanitise, le PATCH dashboard stocke tel quel (volontaire,
    l'export/import config.json reste fidele)."""
    out = dict(design)

    def _hex(value, default):
        return value if isinstance(value, str) and _HEX_COLOR_RE.fullmatch(value) else default

    out["primaryColor"] = _hex(out.get("primaryColor"), "#0d9488")
    out["secondaryColor"] = _hex(out.get("secondaryColor"), None)

    try:
        out["borderRadius"] = max(0, min(40, int(out.get("borderRadius", 16))))
    except (TypeError, ValueError):
        out["borderRadius"] = 16
    if out.get("size") not in ("sm", "md", "lg"):
        out["size"] = "md"
    if out.get("position") not in ("left", "right"):
        out["position"] = "right"
    if out.get("icon") not in ("chat", "spark", "help", "image"):
        out["icon"] = "chat"
    if out.get("loadingAnimation") not in ("dots", "wave", "pulse"):
        out["loadingAnimation"] = "dots"

    # Personnalisation étendue (lot apparence) : memes patterns (whitelist
    # stricte, bool strict, entiers bornes) — defauts = rendu historique.
    if out.get("font") not in ("system", "serif", "mono"):
        out["font"] = "system"
    if out.get("headerStyle") not in ("solid", "soft"):
        out["headerStyle"] = "solid"
    if out.get("bubbleStyle") not in ("rounded", "square"):
        out["bubbleStyle"] = "rounded"
    if out.get("density") not in ("cozy", "compact"):
        out["density"] = "cozy"
    out["darkMode"] = out.get("darkMode") is True  # bool strict (pas de truthy)
    lt = out.get("launcherText")
    out["launcherText"] = str(lt)[:40] if isinstance(lt, str) and lt.strip() else ""
    for f in ("offsetX", "offsetY"):
        try:
            out[f] = max(0, min(120, int(out.get(f, 18))))
        except (TypeError, ValueError):
            out[f] = 18

    # Langue de l'UI du widget (dictionnaire FR/EN cote widget.js ; 'auto' =
    # langue du navigateur + consigne IA dans build_system_prompt)
    if out.get("locale") not in ("auto", "fr", "en"):
        out["locale"] = "fr"

    # Seules nos images uploadees sont acceptables comme avatar
    avatar = out.get("avatarImage")
    if not (isinstance(avatar, str) and avatar.startswith(settings.API_URL + "/uploads/")):
        out["avatarImage"] = ""

    for field, maxlen in (("title", 100), ("placeholder", 100), ("welcomeMessage", 500)):
        value = out.get(field)
        if value is not None:
            out[field] = str(value)[:maxlen]
    return out


# Bornes de plausibilite du timestamp d'une entree de parcours (epoch secondes) :
# entre 2020 et 2100 — au-dela c'est du bruit client, on ignore l'entree.
_JOURNEY_T_MIN = 1577836800
_JOURNEY_T_MAX = 4102444800
_JOURNEY_MAX_ENTRIES = 10


def _sanitize_journey(journey: Any) -> Optional[list[dict]]:
    """Parcours du visiteur envoye par le widget (contexte IA, pas analytics).

    Donnee 100% controlee par le client -> validation stricte mais SILENCIEUSE :
    toute entree invalide est ignoree, les paths sont tronques, jamais de 4xx.
    Format attendu : [{"p": "/tarifs", "t": 1750000000}, ...] (10 max).
    """
    if not isinstance(journey, list):
        return None
    out: list[dict] = []
    # On ne regarde que la fin de la liste (les plus recentes) : borne le cout
    # face a une liste enorme forgee, tout en gardant assez de marge pour
    # retrouver 10 entrees valides parmi du bruit.
    for entry in journey[-50:]:
        if not isinstance(entry, dict):
            continue
        p, t = entry.get("p"), entry.get("t")
        if not isinstance(p, str) or not p.startswith("/"):
            continue
        # bool est une sous-classe d'int : on l'exclut explicitement
        if isinstance(t, bool) or not isinstance(t, int):
            continue
        if not (_JOURNEY_T_MIN <= t <= _JOURNEY_T_MAX):
            continue
        out.append({"p": p[:200], "t": t})
    return out[-_JOURNEY_MAX_ENTRIES:] or None


def _active_tree(bot: Bot, conversation: Optional[Conversation]) -> dict:
    """Arbre servi : variante B si la conversation y est affectee ET que la
    variante existe encore (sinon retour silencieux a l'arbre principal —
    retro-compat stricte : variant null = comportement actuel)."""
    if conversation is not None and conversation.variant == "b" and bot.tree_variant_json:
        return bot.tree_variant_json
    return bot.tree_json


def _record_tree_event(db: AsyncSession, bot: Bot, conversation: Optional[Conversation],
                       node_id: Any) -> None:
    """Funnel : enregistre un noeud SERVI, en best-effort — ajoute au MEME
    commit que le flux principal (FK garanties valides) ; toute erreur de
    construction est avalee, jamais bloquante pour le visiteur."""
    try:
        db.add(TreeEvent(
            bot_id=bot.id,
            conversation_id=conversation.id if conversation else None,
            node_key=str(node_id)[:80],
            variant=conversation.variant if conversation else None,
        ))
    except Exception:
        logger.debug("tree_event ignoré", exc_info=True)


# Triggers proactifs servis au bootstrap : bornes (miroir de _check_triggers
# dans routers/bots.py, mais SILENCIEUX — pattern _sanitize_journey)
_TRIGGER_TYPES = ("time_on_page", "scroll_depth", "exit_intent", "url_pattern")
_MAX_TRIGGERS = 5


def _sanitize_triggers(triggers: Any) -> list[dict]:
    """Triggers proactifs du bootstrap widget : validation stricte mais
    SILENCIEUSE (jamais de 4xx — une entree invalide est ignoree), re-projection
    sur les seules cles {type, value, message, once_per_session} (value omise
    pour exit_intent). Evalues 100% cote client, aucun appel serveur au tir."""
    if not isinstance(triggers, list):
        return []
    out: list[dict] = []
    for entry in triggers:
        if len(out) >= _MAX_TRIGGERS:
            break
        if not isinstance(entry, dict):
            continue
        ttype = entry.get("type")
        if ttype not in _TRIGGER_TYPES:
            continue
        value = entry.get("value")
        # bool est une sous-classe d'int : exclu explicitement des bornes int
        if ttype == "time_on_page":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 600:
                continue
        elif ttype == "scroll_depth":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100:
                continue
        elif ttype == "url_pattern":
            if not isinstance(value, str) or not 1 <= len(value) <= 200:
                continue
        message = entry.get("message")
        if not isinstance(message, str) or not message.strip():
            continue
        clean = {
            "type": ttype,
            "message": message[:300],
            # bool strict, defaut True (tout autre type retombe sur le defaut)
            "once_per_session": entry.get("once_per_session") is not False,
        }
        if ttype != "exit_intent":
            clean["value"] = value
        out.append(clean)
    return out


def _maybe_refresh(response: dict, bot: Bot, session: dict) -> dict:
    """Contrat de session glissante : si le JWT widget expire dans <10 min,
    la reponse contient `refresh_token` (meme conversation_id + domaine).
    Le widget remplace alors son token courant — la conversation et son
    contexte serveur sont conserves au-dela des 30 min initiales."""
    if widget_token_needs_refresh(session):
        response["refresh_token"] = create_widget_token(bot.id, session["sub"], session["domain"])
    return response


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
    variant = None
    if bot.tree_variant_json and (bot.ab_split_pct or 0) > 0:
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


def _tree_has_node_type(bot: Bot, node_type: str) -> bool:
    """True si l'arbre principal OU la variante A/B contient un noeud du type
    donne. Les DEUX arbres sont scannes : un noeud teste uniquement dans la
    variante B est servi aux conversations 'b' (_active_tree) — la garde doit
    le couvrir, sans discriminer par conversation (anti-abus, pas un controle
    d'acces fin, et aucune fuite du variant au visiteur)."""
    for tree in (bot.tree_json, bot.tree_variant_json):
        nodes = (tree or {}).get("nodes", {})
        if any(isinstance(n, dict) and n.get("type") == node_type for n in nodes.values()):
            return True
    return False


def _bot_collects_leads(bot: Bot) -> bool:
    """Garde anti-abus : l'endpoint lead n'est servi que si le bot collecte
    effectivement des contacts (noeud 'lead' dans un des arbres OU action
    capture_lead — les actions sont communes aux deux variantes)."""
    if _tree_has_node_type(bot, "lead"):
        return True
    return any(a.get("type") == "capture_lead" for a in (bot.actions_json or []))


def _bot_has_handoff(bot: Bot) -> bool:
    """Garde anti-abus (meme pattern que _bot_collects_leads) : l'endpoint
    handoff n'est servi que si le bot propose effectivement la mise en
    relation (noeud 'handoff' dans un des arbres OU action IA handoff)."""
    if _tree_has_node_type(bot, "handoff"):
        return True
    return any(a.get("type") == "handoff" for a in (bot.actions_json or []))


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
    cutoff = datetime.utcnow() - timedelta(minutes=HANDOFF_TIMEOUT_MINUTES)
    # human_requested_at None = etat incoherent : on debloque aussi (anti-zombie)
    if conversation.human_requested_at is not None and conversation.human_requested_at >= cutoff:
        return False
    result = await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id,
               Conversation.status == "human_requested")
        .values(status="ai", last_activity_at=datetime.utcnow())
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
    now = datetime.utcnow()
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

    # Memes checks actifs que _get_active_bot (bot + org), via l'id de session
    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    org = await db.get(Organization, bot.organization_id)
    if org is None or not org.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    _check_session_origin(request, session)

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

    # Memes checks actifs que _get_active_bot (bot + org), via l'id de session
    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    org = await db.get(Organization, bot.organization_id)
    if org is None or not org.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    _check_session_origin(request, session)

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

    # Memes checks actifs que _get_active_bot (bot + org), via l'id de session
    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    org = await db.get(Organization, bot.organization_id)
    if org is None or not org.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    _check_session_origin(request, session)

    if not _bot_has_handoff(bot):
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

    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    org = await db.get(Organization, bot.organization_id)
    if org is None or not org.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    _check_session_origin(request, session)

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


@router.post("/message")
async def post_message(
    body: MessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    await _check_ip_flood(request)

    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget désactivé")
    _check_session_origin(request, session)

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
        if body.node:
            # UI desynchronisee (defensif) : pas de navigation d'arbre pendant
            # un echange avec un conseiller
            raise HTTPException(status.HTTP_409_CONFLICT, "Conversation en cours avec un conseiller")
        text = (body.text or "").strip()
        if not text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
        if len(text) > settings.MAX_MESSAGE_CHARS:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                f"Message trop long (max {settings.MAX_MESSAGE_CHARS} caractères)")
        msg = Message(conversation_id=conversation.id, bot_id=bot.id,
                      role="user", source="human", content=text)
        db.add(msg)
        conversation.last_activity_at = datetime.utcnow()
        await db.commit()
        # message null = simple accuse (le widget n'affiche rien, la reponse
        # du conseiller arrivera par /poll)
        return _maybe_refresh({
            "source": "human", "status": conversation.status,
            "message": None, "options": [], "last_message_id": msg.id,
        }, bot, session)

    # Conversation cloturee + nouveau message texte -> bascule paresseuse en
    # flux normal (closed_at conserve pour l'historique, seul status change)
    if conversation.status == "closed" and not body.node and (body.text or "").strip():
        conversation.status = "ai"

    # --- Navigation dans l'arbre (clic option) : gratuit, illimite ---
    if body.node:
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

    # --- Message libre -> IA ---
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
    if len(text) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Message trop long (max {settings.MAX_MESSAGE_CHARS} caractères)")
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

    # Historique tronque (limite de payload vers le modele)
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

    page_url = body.page_url or conversation.page_url
    # Base de connaissances : le tool search_docs n'est expose au modele que
    # si le bot a au moins un extrait indexe.
    has_kb = (await db.execute(
        select(KbChunk.id).where(KbChunk.bot_id == bot.id).limit(1)
    )).first() is not None
    try:
        # journey : contexte IA uniquement (le mode arbre n'en a pas besoin),
        # deja valide/tronque au handshake par _sanitize_journey.
        # db + conversation_id : necessaires aux actions IA (capture_lead).
        # locale : 'auto' ajoute la consigne de langue au system prompt.
        ai = await generate_reply(bot, history, page_url, journey=conversation.journey,
                                  db=db, conversation_id=conversation.id, has_kb=has_kb,
                                  locale=(bot.design_json or {}).get("locale"))
    except AIServiceError:
        return _maybe_refresh({"source": "ai", "message": "Désolé, je rencontre un souci technique. Réessayez dans un instant.",
                               "options": [], "status": conversation.status}, bot, session)

    msg = Message(
        conversation_id=conversation.id, bot_id=bot.id,
        role="assistant", source="ai", content=ai.content,
        tokens_in=ai.tokens_in, tokens_out=ai.tokens_out,
    )
    db.add(msg)
    conversation.last_activity_at = datetime.utcnow()
    await db.commit()

    # status relu APRES generate_reply : l'action IA handoff a pu le muter via
    # la meme session (la reponse declenche alors le polling cote widget).
    # message_id : cle additive CSAT.
    return _maybe_refresh({"source": "ai", "message": ai.content, "options": [],
                           "status": conversation.status, "message_id": msg.id}, bot, session)
