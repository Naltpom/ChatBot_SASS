"""Endpoints PUBLICS consommes par le widget embarque (<script>).

Archi : widget JS -> cette API (origin + captcha + JWT + rate limit + caps)
-> provider IA avec cle serveur. Le widget ne touche jamais une cle IA.

Flux :
1. GET  /api/widget/bootstrap?key=pk_xxx  -> design + provider captcha (public)
2. POST /api/widget/session               -> verif origin + captcha -> JWT 30 min
3. POST /api/widget/message (Bearer JWT)  -> tree ou IA, rate-limite, cape
"""
import asyncio
import logging
import re
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import create_widget_token, get_widget_session, widget_token_needs_refresh
from src.models.bot import Bot
from src.models.conversation import Conversation, Message
from src.models.lead import Lead
from src.models.user import Organization
from src.services import tree_engine
from src.services.ai_service import AIServiceError, generate_reply
from src.services.captcha import verify_captcha
from src.services.email_service import build_lead_email, lead_notification_recipients, send_email
from src.services.rate_limit import ip_limiter, lead_limiter, session_limiter
from src.services.usage_service import ai_allowed

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/widget", tags=["widget"])

DEGRADED_MESSAGE = (
    "Le mode IA est momentanément indisponible. "
    "Vous pouvez continuer avec les options proposées."
)

# Bot IA pur (pas d'arbre de repli) : on explique au visiteur au lieu de bloquer
DEGRADED_AI_ONLY_MESSAGE = (
    "Notre assistant est momentanément indisponible. "
    "Merci de réessayer un peu plus tard ou de nous contacter directement."
)


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
    }


@router.post("/session")
async def create_session(body: SessionRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Handshake : captcha verifie ICI (une fois), puis le JWT couvre la session."""
    await _check_ip_flood(request)
    bot = await _get_active_bot(db, body.public_key)
    domain = _check_origin(request, bot, parent_url=body.parent_url or body.page_url)

    if not await verify_captcha(bot, body.captcha_token, _client_ip(request)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vérification anti-bot échouée")

    conversation = Conversation(
        bot_id=bot.id,
        visitor_id=body.visitor_id,
        domain=domain or "unknown",
        page_url=body.page_url,
        journey=_sanitize_journey(body.journey),
    )
    db.add(conversation)
    await db.commit()

    token = create_widget_token(bot.id, conversation.id, domain or "unknown")

    # Premier message : noeud de depart de l'arbre (tree/hybrid) ou accueil design
    if bot.mode in ("tree", "hybrid"):
        node_id, node = tree_engine.get_node(bot.tree_json)
        first = tree_engine.format_node_response(node_id, node)
    else:
        welcome = (bot.design_json or {}).get("welcomeMessage") or "Bonjour ! Posez-moi votre question."
        first = {"source": "tree", "node_id": None, "message": welcome, "options": []}

    db.add(Message(
        conversation_id=conversation.id, bot_id=bot.id,
        role="assistant", source="tree", content=first["message"],
    ))
    await db.commit()

    return {"token": token, "conversation_id": conversation.id, "first": first}


def _bot_collects_leads(bot: Bot) -> bool:
    """Garde anti-abus : l'endpoint lead n'est servi que si le bot collecte
    effectivement des contacts (noeud 'lead' dans l'arbre OU action capture_lead)."""
    nodes = (bot.tree_json or {}).get("nodes", {})
    if any(isinstance(n, dict) and n.get("type") == "lead" for n in nodes.values()):
        return True
    return any(a.get("type") == "capture_lead" for a in (bot.actions_json or []))


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


@router.post("/message")
async def post_message(
    body: MessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(get_widget_session),
):
    await _check_ip_flood(request)
    if not await session_limiter.check(session["sub"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Limite de messages atteinte, réessayez dans quelques minutes")

    bot = await db.get(Bot, session["bot_id"])
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget désactivé")
    _check_session_origin(request, session)

    conversation = await db.get(Conversation, session["sub"])
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation introuvable")

    # --- Navigation dans l'arbre (clic option) : gratuit, illimite ---
    if body.node:
        node_id, node = tree_engine.get_node(bot.tree_json, body.node)
        response = tree_engine.format_node_response(node_id, node)
        db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="user", source="tree", content=f"[option] {body.node}"))
        db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="assistant", source="tree", content=response["message"]))
        await db.commit()
        return _maybe_refresh(response, bot, session)

    # --- Message libre -> IA ---
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message vide")
    if len(text) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Message trop long (max {settings.MAX_MESSAGE_CHARS} caractères)")
    if bot.mode == "tree":
        node_id, node = tree_engine.get_node(bot.tree_json)
        db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                       role="user", source="tree", content=text))
        await db.commit()
        return _maybe_refresh({
            "source": "tree", "node_id": node_id,
            "message": "Merci ! Choisissez une option ci-dessous.",
            "options": tree_engine.format_node_response(node_id, node)["options"],
        }, bot, session)

    db.add(Message(conversation_id=conversation.id, bot_id=bot.id,
                   role="user", source="ai", content=text))
    await db.commit()

    # Caps budget : cap quotidien bot + quota mensuel du plan de l'org -> mode degrade tree-only
    org = await db.get(Organization, bot.organization_id)
    allowed, reason = await ai_allowed(db, bot, org)
    if not allowed:
        logger.warning("Bot %s en mode dégradé (%s)", bot.id, reason)
        if bot.mode == "ai":
            # IA pure : pas d'arbre de repli, on explique au lieu de bloquer
            return _maybe_refresh({
                "source": "tree", "node_id": None, "degraded": True,
                "message": DEGRADED_AI_ONLY_MESSAGE, "options": [],
            }, bot, session)
        node_id, node = tree_engine.get_node(bot.tree_json)
        return _maybe_refresh({
            "source": "tree", "node_id": node_id, "degraded": True,
            "message": DEGRADED_MESSAGE,
            "options": tree_engine.format_node_response(node_id, node)["options"] if bot.mode == "hybrid" else [],
        }, bot, session)

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
    try:
        # journey : contexte IA uniquement (le mode arbre n'en a pas besoin),
        # deja valide/tronque au handshake par _sanitize_journey.
        # db + conversation_id : necessaires aux actions IA (capture_lead).
        ai = await generate_reply(bot, history, page_url, journey=conversation.journey,
                                  db=db, conversation_id=conversation.id)
    except AIServiceError:
        return _maybe_refresh({"source": "ai", "message": "Désolé, je rencontre un souci technique. Réessayez dans un instant.", "options": []}, bot, session)

    db.add(Message(
        conversation_id=conversation.id, bot_id=bot.id,
        role="assistant", source="ai", content=ai.content,
        tokens_in=ai.tokens_in, tokens_out=ai.tokens_out,
    ))
    conversation.last_activity_at = datetime.utcnow()
    await db.commit()

    return _maybe_refresh({"source": "ai", "message": ai.content, "options": []}, bot, session)
