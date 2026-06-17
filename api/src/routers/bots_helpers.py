"""Helpers partages des routers bots/inbox/kb : acces & permissions par bot,
masquage des champs sensibles, et validation metier des champs riches
(actions IA, serveurs MCP, triggers proactifs).

Extrait de routers/bots.py pour casser le couplage : inbox.py et kb.py
importent les helpers d'acces depuis ce module (et non plus depuis bots.py).
Ce module ne doit JAMAIS importer routers.bots (cycle)."""
import logging
import re
import zoneinfo
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import require_bot_access
from src.core.triggers import _MAX_TRIGGERS, _TRIGGER_TYPES, _trigger_value_valid
from src.models.bot import Bot, BotOut
from src.models.user import Membership, User
from src.services.crypto import encrypt_secret

logger = logging.getLogger(__name__)

# Champs de config exportes dans le fichier JSON (jamais de secrets)
CONFIG_FIELDS = ["name", "mode", "ai_provider", "ai_model", "system_prompt",
                 "temperature", "tree_json", "design_json"]

# Permission requise par champ modifiable, pour les MEMBERS (les admins de
# l'org et les superadmins ont tout). Aligne sur la matrice de la page Équipe.
FIELD_PERMS = {
    "name": "appearance",
    "design_json": "appearance",
    "mode": "appearance",
    "triggers_json": "appearance",
    "tree_json": "context",
    "tree_variant_json": "context",
    "ab_split_pct": "context",
    "actions_json": "context",
    "system_prompt": "context",
    "ai_provider": "context",
    "ai_model": "context",
    "temperature": "context",
    "api_key_mode": "context",
    "byok_key": "context",
    "handoff_webhook_url": "context",
    "allowed_domains": "security",
    "captcha_provider": "security",
    "captcha_site_key": "security",
    "captcha_secret": "security",
    "is_active": "security",
    "mcp_servers_json": "context",
}


async def _get_accessible_bot(db: AsyncSession, bot_id: int, user: User) -> tuple[Bot, "Membership | None"]:
    """(bot, membership). membership=None pour un superadmin non membre."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    membership = await require_bot_access(bot, user, db)
    return bot, membership


def _member_perms(membership: "Membership | None", bot: Bot) -> list[str]:
    return (membership.permissions or {}).get(str(bot.id), [])


def _check_bot_perm(user: User, membership: "Membership | None", bot: Bot, perm: str) -> None:
    """Members : permission par bot requise. Admins d'org + superadmins : tout."""
    if user.is_superadmin or membership is None or membership.role == "admin":
        return
    if perm not in _member_perms(membership, bot):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Permission « {perm} » requise sur ce bot — demandez à un admin de votre organisation")


def _mask_bot_out(out: BotOut, user: User, membership: "Membership | None", bot: Bot) -> BotOut:
    """Champs sensibles en LECTURE : handoff_webhook_url (un webhook entrant
    Slack/Teams est un credential) n'est renvoyee qu'aux ayants droit de la
    perm 'context' — la meme que pour l'ecrire (FIELD_PERMS). Les autres
    members gardent le flag handoff_webhook_set (pose par from_bot)."""
    if user.is_superadmin or membership is None or membership.role == "admin":
        return out
    if "context" not in _member_perms(membership, bot):
        out.handoff_webhook_url = None
    return out


def attach_week_stats(out: BotOut, bot_id: int, week: dict[int, dict]) -> BotOut:
    """Recopie les compteurs hebdomadaires (msgs_7d / visitors_7d) issus de
    usage_service.bots_week_stats* dans un BotOut de carte. Source unique du
    mapping (utilise par les endpoints de liste de bots.py ; exposé pour
    admin.py qui sert la meme structure). 0 par defaut si le bot n'a aucune
    activite sur la fenetre."""
    stats = week.get(bot_id) or {}
    out.msgs_7d = stats.get("msgs_7d", 0)
    out.visitors_7d = stats.get("visitors_7d", 0)
    return out


# Actions IA (tool-use) : bornes de validation. handoff : ni url ni fields
# (ignores comme capture_lead — _project_action ne garde que name/description/type)
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_ACTION_TYPES = ("webhook", "capture_lead", "handoff", "create_ticket", "calendar_slots")
_ACTION_FIELD_TYPES = ("string", "number", "boolean")
_MAX_ACTIONS = 5
_MAX_ACTION_FIELDS = 8
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Secret par type d'action : (cle en clair a l'entree, cle chiffree stockee).
# Semantique commune : fourni -> chiffre, omis -> herite par NOM de l'existant.
_ACTION_SECRET_KEYS = {
    "webhook": ("secret", "secret_encrypted"),
    "calendar_slots": ("api_key", "api_key_encrypted"),
}

# Connecteur MCP : bornes de validation des serveurs declares par bot
_MCP_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
_MAX_MCP_SERVERS = 2


def _check_actions(actions: Any) -> None:
    """Validation metier de actions_json (422 FR). capture_lead : url/fields
    ignores, le schema standard email/name/phone/message est impose cote
    ai_service."""
    def _bad(msg: str) -> None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)

    if not isinstance(actions, list):
        _bad("actions_json doit être une liste d'actions")
    if len(actions) > _MAX_ACTIONS:
        _bad(f"{_MAX_ACTIONS} actions maximum par bot")
    seen: set = set()
    for action in actions:
        if not isinstance(action, dict):
            _bad("Chaque action doit être un objet")
        name = action.get("name")
        if not isinstance(name, str) or not _ACTION_NAME_RE.fullmatch(name) or name in seen:
            _bad(f"Nom d'action invalide ou en double : {name}")
        # search_docs = tool interne (recherche KB) injecte par ai_service :
        # une action homonyme masquerait silencieusement la base documentaire
        if name == "search_docs":
            _bad("Nom d'action réservé : search_docs")
        # Les tools MCP decouverts sont exposes mcp_<server>_<tool> :
        # collision interdite avec une action du dashboard
        if name.startswith("mcp_"):
            _bad(f"Préfixe de nom d'action réservé : mcp_ ({name})")
        seen.add(name)
        description = action.get("description")
        if not isinstance(description, str) or not 1 <= len(description) <= 500:
            _bad(f"L'action {name} doit avoir une description (1 à 500 caractères)")
        atype = action.get("type")
        if atype not in _ACTION_TYPES:
            _bad(f"Type d'action inconnu : {atype}")
        if atype == "create_ticket":
            # url/fields ignores : schema impose cote ai_service (comme capture_lead)
            to_email = action.get("to_email")
            if to_email is not None and (
                not isinstance(to_email, str) or len(to_email) > 254
                or not _EMAIL_RE.fullmatch(to_email)
            ):
                _bad(f"L'email de destination de l'action {name} est invalide")
            continue
        if atype == "calendar_slots":
            etid = action.get("event_type_id")
            if isinstance(etid, bool) or not isinstance(etid, int) or not 1 <= etid <= 2_000_000_000:
                _bad(f"L'action {name} doit avoir un event_type_id Cal.com (entier positif)")
            tz = action.get("timezone")
            if tz is not None:
                if not isinstance(tz, str) or len(tz) > 50:
                    _bad(f"Fuseau horaire invalide dans l'action {name}")
                # ZoneInfo lève ZoneInfoNotFoundError (sous-classe de KeyError)
                # pour une zone inconnue, ValueError pour une clé malformée
                # (ex. composant '..'). On ne masque que ces deux cas attendus.
                try:
                    zoneinfo.ZoneInfo(tz)
                except (zoneinfo.ZoneInfoNotFoundError, ValueError) as e:
                    logger.info("Fuseau horaire rejeté (action %s): %r — %s", name, tz, e)
                    _bad(f"Fuseau horaire invalide dans l'action {name}")
            api_key = action.get("api_key")
            if api_key is not None and (not isinstance(api_key, str) or len(api_key) > 200):
                _bad(f"La clé API de l'action {name} est invalide (200 caractères max)")
            continue
        if atype != "webhook":
            continue
        url = action.get("url")
        if not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
            _bad(f"L'action {name} doit avoir une URL https://")
        secret = action.get("secret")
        if secret is not None and (not isinstance(secret, str) or len(secret) > 200):
            _bad(f"Le secret de l'action {name} est invalide (200 caractères max)")
        fields = action.get("fields", [])
        if not isinstance(fields, list) or len(fields) > _MAX_ACTION_FIELDS:
            _bad(f"L'action {name} accepte au plus {_MAX_ACTION_FIELDS} champs")
        for field in fields:
            if not isinstance(field, dict):
                _bad(f"Champ invalide dans l'action {name}")
            fname = field.get("name")
            if not isinstance(fname, str) or not _ACTION_NAME_RE.fullmatch(fname):
                _bad(f"Nom de champ invalide dans l'action {name} : {fname}")
            if field.get("type", "string") not in _ACTION_FIELD_TYPES:
                _bad(f"Type de champ invalide dans l'action {name} : {field.get('type')}")
            fdesc = field.get("description", "")
            if not isinstance(fdesc, str) or len(fdesc) > 200:
                _bad(f"Description de champ invalide dans l'action {name} (200 caractères max)")
            if not isinstance(field.get("required", False), bool):
                _bad(f"'required' doit être un booléen dans l'action {name}")


def _project_action(action: dict) -> dict:
    """Re-projette une action entrante sur les SEULES cles autorisees : aucune
    cle posee par le client (dont secret_encrypted, qui rendrait le webhook
    silencieusement non signe) ne doit etre persistee ni re-servie au front."""
    out = {
        "name": action.get("name"),
        "description": action.get("description"),
        "type": action.get("type"),
    }
    if action.get("type") == "webhook":
        out["url"] = action.get("url")
        out["fields"] = [
            {
                "name": f.get("name"),
                "type": f.get("type", "string"),
                "description": f.get("description", ""),
                "required": bool(f.get("required", False)),
            }
            for f in (action.get("fields") or [])
        ]
    if action.get("type") == "create_ticket":
        out["to_email"] = action.get("to_email") or None
    if action.get("type") == "calendar_slots":
        out["event_type_id"] = action.get("event_type_id")
        out["timezone"] = action.get("timezone") or "Europe/Paris"
    return out


def _merge_action_secrets(existing: list, incoming: list) -> list:
    """Semantique des secrets (par type, table _ACTION_SECRET_KEYS) : envoyer
    la cle en clair pour la (re)poser, l'omettre (ou None) pour conserver
    celle deja stockee (chiffree) sous le MEME name (renommage sans ressaisie
    = secret perdu, voulu). Chaque action est reconstruite via _project_action :
    la cle chiffree n'est posable QUE par encrypt_secret() ou heritee."""
    by_name = {a.get("name"): a for a in (existing or [])}
    out = []
    for action in incoming:
        clean = _project_action(action)
        plain_key, enc_key = _ACTION_SECRET_KEYS.get(clean["type"], (None, None))
        if plain_key:
            value = action.get(plain_key)
            if value:
                clean[enc_key] = encrypt_secret(value)
            else:
                previous = by_name.get(clean.get("name"))
                if previous and previous.get(enc_key):
                    clean[enc_key] = previous[enc_key]
        out.append(clean)
    return out


def _check_mcp_servers(servers: Any) -> None:
    """Validation metier de mcp_servers_json (422 FR, pattern _check_actions)."""
    def _bad(msg: str) -> None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)

    if not isinstance(servers, list):
        _bad("mcp_servers_json doit être une liste de serveurs")
    if len(servers) > _MAX_MCP_SERVERS:
        _bad(f"{_MAX_MCP_SERVERS} serveurs MCP maximum par bot")
    seen: set = set()
    for server in servers:
        if not isinstance(server, dict):
            _bad("Chaque serveur MCP doit être un objet")
        name = server.get("name")
        if not isinstance(name, str) or not _MCP_NAME_RE.fullmatch(name) or name in seen:
            _bad(f"Nom de serveur MCP invalide ou en double : {name}")
        seen.add(name)
        url = server.get("url")
        if not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
            _bad(f"Le serveur MCP {name} doit avoir une URL https:// (500 caractères max)")
        token = server.get("auth_token")
        if token is not None and (not isinstance(token, str) or len(token) > 500):
            _bad(f"Le jeton du serveur MCP {name} est invalide (500 caractères max)")


# Triggers proactifs : bornes de validation (PATCH, perm 'appearance').
# Constantes + prédicat de validité factorisés dans src.core.triggers.


def _check_triggers(triggers: Any) -> None:
    """Validation metier de triggers_json (422 FR, pattern _check_actions).
    value selon type : time_on_page = secondes 1-600, scroll_depth = % 1-100,
    url_pattern = motif 1-200 chars, exit_intent = sans value (ignoree)."""
    def _bad(msg: str) -> None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)

    if not isinstance(triggers, list):
        _bad("triggers_json doit être une liste de déclencheurs")
    if len(triggers) > _MAX_TRIGGERS:
        _bad(f"{_MAX_TRIGGERS} déclencheurs maximum par bot")
    for trigger in triggers:
        if not isinstance(trigger, dict):
            _bad("Chaque déclencheur doit être un objet")
        ttype = trigger.get("type")
        if ttype not in _TRIGGER_TYPES:
            _bad(f"Type de déclencheur inconnu : {ttype}")
        if not _trigger_value_valid(ttype, trigger.get("value")):
            _bad(f"Valeur invalide pour le déclencheur {ttype}")
        message = trigger.get("message")
        if not isinstance(message, str) or not 1 <= len(message) <= 300:
            _bad("Chaque déclencheur doit avoir un message (1 à 300 caractères)")
        if not isinstance(trigger.get("once_per_session", True), bool):
            _bad("'once_per_session' doit être un booléen")


def _merge_mcp_secrets(existing: list, incoming: list) -> list:
    """Projection stricte {name, url} + auth_token_encrypted : pose via
    encrypt_secret(auth_token) si fourni, sinon herite de l'existant par NOM
    et UNIQUEMENT a URL inchangee. Divergence voulue avec _merge_action_secrets :
    un Bearer est un credential brut ENVOYE au serveur (contrairement au secret
    HMAC webhook, jamais transmis) — sans ce verrou, un member 'context'
    pourrait repointer l'URL vers un hote a lui et exfiltrer le jeton
    write-only. Changer l'URL = ressaisir le jeton (le renommage l'invalide
    deja, meme regle). Un auth_token_encrypted pose par le client est JETE
    (meme raison que _project_action : seul encrypt_secret pose la cle)."""
    by_name = {s.get("name"): s for s in (existing or [])}
    out = []
    for server in incoming:
        clean = {"name": server.get("name"), "url": server.get("url")}
        token = server.get("auth_token")
        if token:
            clean["auth_token_encrypted"] = encrypt_secret(token)
        else:
            previous = by_name.get(clean["name"])
            if previous and previous.get("url") == clean["url"] \
                    and previous.get("auth_token_encrypted"):
                clean["auth_token_encrypted"] = previous["auth_token_encrypted"]
        out.append(clean)
    return out
