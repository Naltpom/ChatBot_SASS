"""Helpers PURS / utilitaires non-endpoint du widget public.

Extraits de routers/widget.py pour l'alleger : sanitisation des entrees
client (design / journey / triggers, toutes SILENCIEUSES), verifications
d'origine & de session, gardes anti-abus par bot, helpers A/B & funnel.

Ce module ne doit JAMAIS importer routers/widget.py (cycle) : tout helper qui
a besoin de `trigger_handoff` ou des messages de live chat reste dans widget.py.
"""
import logging
import re
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.security import create_widget_token, widget_token_needs_refresh
from src.core.triggers import _MAX_TRIGGERS, _TRIGGER_TYPES, _trigger_value_valid
from src.models.analytics import TreeEvent
from src.models.bot import Bot
from src.models.conversation import Conversation
from src.models.user import Organization
from src.services.rate_limit import ip_limiter

# Application 100% gratuite : aucun plafond d'usage n'est appliqué. Les gardes
# ci-dessous (origine, captcha, rate limits) sont purement anti-abus ;
# ai_replies_today reste un simple compteur d'affichage informatif (dashboard).

logger = logging.getLogger(__name__)


# --- Origine / IP / session ---

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
    spoofer -> c'est pour ca qu'on empile captcha + rate limits anti-abus.)"""
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


async def _assert_bot_servable(db: AsyncSession, bot: Optional[Bot]) -> Bot:
    """Garde commune : le bot existe, est actif, et — s'il est d'équipe — son
    organisation est active. Sinon 404 (anti-enumeration). Source UNIQUE de la
    garde de servabilité, appelée après résolution du bot (bootstrap via
    public_key dans _get_active_bot, session via id signé dans _session_active_bot).

    Bot d'équipe : organisation suspendue (impayé, abus...) -> widgets coupés.
    Bot perso (organization_id null) : pas de suspension d'org applicable."""
    if bot is None or not bot.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    if bot.organization_id is not None:
        org = await db.get(Organization, bot.organization_id)
        if org is None or not org.is_active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget inconnu ou désactivé")
    return bot


async def _get_active_bot(db: AsyncSession, public_key: str) -> Bot:
    result = await db.execute(select(Bot).where(Bot.public_key == public_key))
    return await _assert_bot_servable(db, result.scalar_one_or_none())


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


async def _session_active_bot(db: AsyncSession, request: Request, session: dict) -> Bot:
    """Revalidation post-handshake commune aux endpoints de session (lead,
    feedback, handoff, poll, message) : recharge le bot via l'id signe dans le
    JWT et verifie qu'il est toujours servable, PUIS controle l'origine.

    Memes checks actifs que _get_active_bot (la porte d'entree bootstrap/session)
    mais a partir de l'id de session :
    - bot existe + actif ;
    - bot d'equipe (organization_id non null) : organisation toujours active
      (suspension impayé/abus -> widgets coupés) ;
    - bot perso (organization_id null) : aucune suspension d'org applicable.

    Source UNIQUE de cette garde : elle etait copiee-collee a l'identique dans
    chaque endpoint, SAUF /message qui omettait le check org (faille : un bot
    d'equipe dont l'org est suspendue continuait d'accepter /message et de
    consommer l'IA). Le message d'erreur est aligne sur les autres endpoints."""
    bot = await _assert_bot_servable(db, await db.get(Bot, session["bot_id"]))
    _check_session_origin(request, session)
    return bot


def _assert_message_len(text: str) -> None:
    """Borne la longueur d'un message texte (413 si depassement). Factorise les
    deux occurrences de /message (mode conseiller + mode IA). MAX_MESSAGE_CHARS
    est partage avec inbox.py (HORS ZONE -> signale en issues)."""
    if len(text) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Message trop long (max {settings.MAX_MESSAGE_CHARS} caractères)")


# --- Sanitisation des entrees client (toutes SILENCIEUSES) ---

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
    if out.get("icon") not in ("chat", "spark", "help", "image", "bot", "message", "headset", "smile", "zap"):
        out["icon"] = "chat"
    if out.get("loadingAnimation") not in ("dots", "wave", "pulse", "bars", "ring", "typing"):
        out["loadingAnimation"] = "dots"

    # Personnalisation étendue (lot apparence) : memes patterns (whitelist
    # stricte, bool strict, entiers bornes) — defauts = rendu historique.
    if out.get("font") not in ("system", "serif", "mono"):
        out["font"] = "system"
    if out.get("headerStyle") not in ("solid", "soft", "gradient"):
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

    # --- Apparence v2 (lot redesign). Memes patterns ; defauts = rendu actuel
    # (la largeur 338 px reproduit le panneau historiquement codé en dur). ---
    # LANCEUR
    if out.get("launcherShape") not in ("round", "pill", "square"):
        out["launcherShape"] = "round"
    if out.get("launcherAnimation") not in ("none", "float", "pulse"):
        out["launcherAnimation"] = "none"
    out["greeting"] = out.get("greeting") is True  # bool strict, defaut False
    gt = out.get("greetingText")
    out["greetingText"] = str(gt)[:80] if isinstance(gt, str) and gt.strip() else ""
    # FENETRE
    try:
        out["windowWidth"] = max(300, min(560, int(out.get("windowWidth", 338))))
    except (TypeError, ValueError):
        out["windowWidth"] = 338
    # windowHeight : null = auto (hauteur selon densité côté widget). Sinon borné.
    try:
        wh = out.get("windowHeight")
        out["windowHeight"] = max(360, min(720, int(wh))) if wh is not None else None
    except (TypeError, ValueError):
        out["windowHeight"] = None
    out["headerAvatar"] = out.get("headerAvatar") is not False  # bool strict, defaut True
    out["headerStatus"] = out.get("headerStatus") is True       # bool strict, defaut False
    sl = out.get("statusLabel")
    out["statusLabel"] = str(sl)[:60] if isinstance(sl, str) and sl.strip() else ""
    if out.get("textScale") not in ("sm", "md", "lg"):
        out["textScale"] = "md"
    out["timestamps"] = out.get("timestamps") is True  # bool strict, defaut False
    if out.get("openAnimation") not in ("zoom", "fade", "slide", "pop", "flip"):
        out["openAnimation"] = "zoom"
    out["bubbleTail"] = out.get("bubbleTail") is not False  # bool strict, defaut True
    out["bordered"] = out.get("bordered") is True  # bool strict, defaut False (etait en passthrough)
    # THEME
    if out.get("chatBg") not in ("plain", "soft", "pattern"):
        out["chatBg"] = "plain"
    out["accentColor"] = _hex(out.get("accentColor"), None)  # null = couleur de marque
    try:
        out["shadow"] = max(0, min(3, int(out.get("shadow", 2))))
    except (TypeError, ValueError):
        out["shadow"] = 2
    # MESSAGES
    if out.get("quickReplyStyle") not in ("pill", "button"):
        out["quickReplyStyle"] = "pill"
    if out.get("sendStyle") not in ("icon", "colored"):
        out["sendStyle"] = "icon"
    out["sound"] = out.get("sound") is True  # bool strict, defaut False

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


# Triggers proactifs servis au bootstrap : bornes (miroir de _check_triggers,
# mais SILENCIEUX — pattern _sanitize_journey). Constantes + prédicat de
# validité factorisés dans src.core.triggers (raise vs continue chez l'appelant).


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
        if not _trigger_value_valid(ttype, value):
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


# --- A/B test & funnel ---

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
    except (AttributeError, TypeError, ValueError) as exc:
        # Best-effort funnel : seules les erreurs de construction de l'event
        # (attribut manquant, valeur invalide) sont avalees, jamais bloquantes
        # pour le visiteur. Les erreurs db reelles surviennent au commit, hors
        # de ce try -> elles remontent normalement.
        logger.warning("tree_event ignoré : %s", exc, exc_info=True)


# --- Gardes anti-abus par bot ---

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


# --- Session glissante ---

def _maybe_refresh(response: dict, bot: Bot, session: dict) -> dict:
    """Contrat de session glissante : si le JWT widget expire dans <10 min,
    la reponse contient `refresh_token` (meme conversation_id + domaine).
    Le widget remplace alors son token courant — la conversation et son
    contexte serveur sont conserves au-dela des 30 min initiales."""
    if widget_token_needs_refresh(session):
        response["refresh_token"] = create_widget_token(bot.id, session["sub"], session["domain"])
    return response
