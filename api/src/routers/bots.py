"""Bots : listes/creation par organisation, operations par bot (acces = membre
de l'org du bot, ou superadmin). Export/import config JSON versionnable,
snippets d'integration (script HTML, iframe, GTM)."""
import re
import zoneinfo
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user, require_org_access, require_org_admin
from src.models.analytics import InsightsReport, InsightsReportOut
from src.models.bot import Bot, BotCreate, BotOut, BotUpdate
from src.models.conversation import Message
from src.models.lead import Lead, LeadOut
from src.models.user import Organization, User
from src.services.crypto import encrypt_secret
from src.services.rate_limit import insights_limiter, treegen_limiter
from src.services.tree_engine import TreeError, validate_tree
from src.services.usage_service import bots_week_stats, count_bots, plan_limits

router = APIRouter(prefix="/api", tags=["bots"])

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
    "daily_ai_message_cap": "security",
    "is_active": "security",
    "mcp_servers_json": "context",
}


async def _get_accessible_bot(db: AsyncSession, bot_id: int, user: User) -> tuple[Bot, Any]:
    """(bot, membership). membership=None pour un superadmin non membre."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    membership = await require_org_access(bot.organization_id, user, db)
    return bot, membership


def _member_perms(membership, bot: Bot) -> list[str]:
    return (membership.permissions or {}).get(str(bot.id), [])


def _check_bot_perm(user: User, membership, bot: Bot, perm: str) -> None:
    """Members : permission par bot requise. Admins d'org + superadmins : tout."""
    if user.is_superadmin or membership is None or membership.role == "admin":
        return
    if perm not in _member_perms(membership, bot):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Permission « {perm} » requise sur ce bot — demandez à un admin de votre organisation")


def _mask_bot_out(out: BotOut, user: User, membership, bot: Bot) -> BotOut:
    """Champs sensibles en LECTURE : handoff_webhook_url (un webhook entrant
    Slack/Teams est un credential) n'est renvoyee qu'aux ayants droit de la
    perm 'context' — la meme que pour l'ecrire (FIELD_PERMS). Les autres
    members gardent le flag handoff_webhook_set (pose par from_bot)."""
    if user.is_superadmin or membership is None or membership.role == "admin":
        return out
    if "context" not in _member_perms(membership, bot):
        out.handoff_webhook_url = None
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
                try:
                    zoneinfo.ZoneInfo(tz)
                except Exception:
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


# Triggers proactifs : bornes de validation (PATCH, perm 'appearance')
_TRIGGER_TYPES = ("time_on_page", "scroll_depth", "exit_intent", "url_pattern")
_MAX_TRIGGERS = 5


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
        value = trigger.get("value")
        # bool est une sous-classe d'int : exclu explicitement des bornes int
        if ttype == "time_on_page":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 600:
                _bad(f"Valeur invalide pour le déclencheur {ttype}")
        elif ttype == "scroll_depth":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100:
                _bad(f"Valeur invalide pour le déclencheur {ttype}")
        elif ttype == "url_pattern":
            if not isinstance(value, str) or not 1 <= len(value) <= 200:
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


def _check_plan_constraints(org: Organization, user: User,
                            mode: str | None = None, tree_json: dict | None = None) -> None:
    """Contraintes du plan : free = mode arbre uniquement + quota de bulles.
    Les superadmins (staff) peuvent outrepasser."""
    if user.is_superadmin:
        return
    limits = plan_limits(org)
    if mode and mode != "tree" and limits.get("tree_only"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Le plan free est limité au mode arbre — passez au plan Starter pour activer l'IA")
    max_nodes = limits.get("max_tree_nodes")
    if tree_json is not None and max_nodes is not None:
        count = len(tree_json.get("nodes", {}))
        if count > max_nodes:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Le plan {org.plan} est limité à {max_nodes} bulles dans l'arbre ({count} actuellement)")


# --- Par organisation ---

@router.get("/orgs/{org_id}/bots", response_model=list[BotOut])
async def list_bots(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    membership = await require_org_access(org_id, user, db)
    result = await db.execute(select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at))
    week = await bots_week_stats(db, org_id)
    out = []
    for b in result.scalars().all():
        bo = _mask_bot_out(BotOut.from_bot(b), user, membership, b)
        bo.msgs_7d = week.get(b.id, {}).get("msgs_7d", 0)
        bo.visitors_7d = week.get(b.id, {}).get("visitors_7d", 0)
        out.append(bo)
    return out


@router.post("/orgs/{org_id}/bots", response_model=BotOut)
async def create_bot(org_id: int, body: BotCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # Creation reservee aux admins de l'org (les members ont des permissions
    # par bot existant, pas de creation)
    await require_org_admin(org_id, user, db)
    # Fetch verrouille : serialise le comptage de bots vis-a-vis des creations
    # concurrentes de la meme org (limite max_bots du plan)
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id).with_for_update()
    )).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")

    # Limite de bots du plan (les superadmins peuvent outrepasser)
    if not user.is_superadmin:
        max_bots = plan_limits(org)["max_bots"]
        if await count_bots(db, org_id) >= max_bots:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Limite du plan {org.plan} atteinte ({max_bots} bots). Passez au plan supérieur.")
    _check_plan_constraints(org, user, mode=body.mode or "hybrid")

    bot = Bot(organization_id=org_id, name=body.name, mode=body.mode or "hybrid")
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


# --- Par bot ---

@router.get("/bots/{bot_id}", response_model=BotOut)
async def get_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


@router.patch("/bots/{bot_id}", response_model=BotOut)
async def update_bot(bot_id: int, body: BotUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    data = body.model_dump(exclude_unset=True)

    # Colonnes JSON/int NOT NULL : un null explicite serait persiste (JSON
    # null) ou violerait l'integrite -> bot illisible (tous les GET en 500).
    # On ignore ces null AVANT la boucle setattr. tree_variant_json n'y figure
    # PAS : null explicite = desactivation voulue de la variante A/B.
    for field in ("actions_json", "tree_json", "design_json", "allowed_domains",
                  "mcp_servers_json", "triggers_json", "ab_split_pct"):
        if field in data and data[field] is None:
            data.pop(field)

    # Permissions par bot : chaque champ modifie doit etre couvert
    for field in data:
        perm = FIELD_PERMS.get(field)
        if perm:
            _check_bot_perm(user, membership, bot, perm)

    org = await db.get(Organization, bot.organization_id)

    # BYOK : reserve aux plans qui incluent l'option (superadmin bypass, coherent
    # avec _check_plan_constraints). Uniquement si la valeur CHANGE : un bot deja
    # en BYOK hors plan (pose par un superadmin, downgrade webhook) doit rester
    # sauvable sur ses autres champs.
    if data.get("api_key_mode") == "byok" and bot.api_key_mode != "byok" and not user.is_superadmin:
        if not plan_limits(org).get("byok"):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "L'utilisation de votre propre clé API (BYOK) est réservée au plan Agence — passez au plan supérieur")

    # Contraintes du plan : uniquement si le mode, l'arbre ou la variante A/B
    # CHANGENT reellement (un patch design seul, ou renvoyant des valeurs
    # identiques, ne doit pas etre bloque par l'etat existant d'un bot hors
    # plan apres downgrade)
    mode_changed = "mode" in data and data["mode"] != bot.mode
    tree_changed = "tree_json" in data and data["tree_json"] != bot.tree_json
    variant_changed = "tree_variant_json" in data and data["tree_variant_json"] != bot.tree_variant_json
    if mode_changed or tree_changed or variant_changed:
        _check_plan_constraints(org, user, mode=data.get("mode", bot.mode), tree_json=data.get("tree_json"))
    # Variante A/B : memes contraintes de plan (max_tree_nodes, decision actee)
    # et meme validation structurelle que l'arbre principal. null = desactiver.
    if variant_changed and data["tree_variant_json"] is not None:
        _check_plan_constraints(org, user, tree_json=data["tree_variant_json"])
        try:
            validate_tree(data["tree_variant_json"])
        except TreeError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    if "tree_json" in data and data["tree_json"] is not None:
        try:
            validate_tree(data["tree_json"])
        except TreeError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    # Triggers proactifs : validation metier (types, bornes, messages)
    if "triggers_json" in data and data["triggers_json"] is not None:
        _check_triggers(data["triggers_json"])

    # Webhook de notification handoff : https:// + borne, chaine vide = effacer
    if "handoff_webhook_url" in data and data["handoff_webhook_url"] is not None:
        url = data["handoff_webhook_url"].strip()
        if not url:
            data["handoff_webhook_url"] = None
        elif not url.startswith("https://") or len(url) > 500:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "URL de notification invalide (https:// requis, 500 caractères max)")
        else:
            data["handoff_webhook_url"] = url

    # Secrets : chiffres au stockage, jamais renvoyes en clair
    if "byok_key" in data:
        bot.byok_key_encrypted = encrypt_secret(data.pop("byok_key"))
    if "captcha_secret" in data:
        bot.captcha_secret_encrypted = encrypt_secret(data.pop("captcha_secret"))

    # Actions IA : validation metier + fusion des secrets (chiffres au
    # stockage, omis = conserves)
    if "actions_json" in data and data["actions_json"] is not None:
        _check_actions(data["actions_json"])
        data["actions_json"] = _merge_action_secrets(bot.actions_json or [], data["actions_json"])

    # Serveurs MCP : validation metier + fusion des jetons (chiffres au
    # stockage, omis = conserves par nom)
    if "mcp_servers_json" in data and data["mcp_servers_json"] is not None:
        _check_mcp_servers(data["mcp_servers_json"])
        data["mcp_servers_json"] = _merge_mcp_secrets(bot.mcp_servers_json or [], data["mcp_servers_json"])

    for field, value in data.items():
        setattr(bot, field, value)

    await db.commit()
    await db.refresh(bot)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


@router.delete("/bots/{bot_id}")
async def delete_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from sqlalchemy import delete as sa_delete

    from src.models.conversation import Conversation, Message

    bot, _ = await _get_accessible_bot(db, bot_id, user)
    await require_org_admin(bot.organization_id, user, db)
    # Purge explicite des donnees liees (la cascade FK est aussi ajoutee au
    # schema par ailleurs ; ce delete garantit le comportement quelle que soit la base)
    await db.execute(sa_delete(Message).where(Message.bot_id == bot.id))
    await db.execute(sa_delete(Conversation).where(Conversation.bot_id == bot.id))
    await db.delete(bot)
    await db.commit()
    return {"deleted": True}


@router.get("/bots/{bot_id}/leads")
async def list_leads(bot_id: int, limit: int = 50,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Leads captures par le bot (formulaire arbre ou action IA capture_lead),
    plus recents d'abord."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    limit = max(1, min(200, limit))
    total = (await db.execute(
        select(func.count(Lead.id)).where(Lead.bot_id == bot.id)
    )).scalar_one()
    rows = (await db.execute(
        select(Lead).where(Lead.bot_id == bot.id)
        .order_by(Lead.created_at.desc())
        .limit(limit)
    )).scalars().all()
    return {"total": total, "leads": [LeadOut.model_validate(lead) for lead in rows]}


@router.get("/bots/{bot_id}/config.json")
async def export_config(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Export de la config en fichier JSON versionnable (sans secrets ni domaines)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    return {field: getattr(bot, field) for field in CONFIG_FIELDS}


@router.put("/bots/{bot_id}/config.json", response_model=BotOut)
async def import_config(bot_id: int, config: dict[str, Any], db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Import d'un fichier de config exporte (les champs inconnus sont ignores)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    # Permission par champ effectivement importe (meme mapping que le PATCH)
    for field in CONFIG_FIELDS:
        if field in config:
            perm = FIELD_PERMS.get(field)
            if perm:
                _check_bot_perm(user, membership, bot, perm)
    org = await db.get(Organization, bot.organization_id)
    # Contraintes du plan : uniquement si le mode ou l'arbre CHANGENT reellement
    # (comme le PATCH — un import partiel ou identique, ex. design seul, ne doit
    # pas etre bloque par l'etat existant d'un bot hors plan apres un downgrade)
    mode_changed = "mode" in config and config["mode"] != bot.mode
    tree_changed = "tree_json" in config and config["tree_json"] != bot.tree_json
    if mode_changed or tree_changed:
        _check_plan_constraints(org, user, mode=config.get("mode", bot.mode),
                                tree_json=config.get("tree_json"))
    if "tree_json" in config:
        try:
            validate_tree(config["tree_json"])
        except TreeError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    for field in CONFIG_FIELDS:
        # Toutes les colonnes de CONFIG_FIELDS sont NOT NULL : un null importe
        # est ignore (meme regle que le PATCH)
        if field in config and config[field] is not None:
            setattr(bot, field, config[field])
    await db.commit()
    await db.refresh(bot)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


from pydantic import BaseModel as _BaseModel
from typing import Optional as _Optional


class TreeGenerateRequest(_BaseModel):
    source_text: _Optional[str] = None
    url: _Optional[str] = None


@router.post("/bots/{bot_id}/tree/generate")
async def generate_tree_endpoint(bot_id: int, body: TreeGenerateRequest,
                                 db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Construit un arbre par IA à partir d'un texte (FAQ collée) ou d'une URL
    de page d'aide. Retourne le tree_json SANS le sauvegarder — le client
    prévisualise puis enregistre. Plans payants uniquement (coût IA côté SaaS)."""
    from src.services.tree_generator import TreeGenerationError, fetch_page_text, generate_tree

    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")

    org = await db.get(Organization, bot.organization_id)
    if not user.is_superadmin and plan_limits(org).get("price", 0) <= 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "La génération d'arbre par IA est réservée aux plans payants")

    # Rate-limit par organisation AVANT tout appel IA (protection cout,
    # superadmin inclus)
    if not await treegen_limiter.check(str(bot.organization_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations d'arbre atteinte pour aujourd'hui — réessayez demain")

    try:
        if body.url:
            source = await fetch_page_text(body.url.strip())
        elif body.source_text and body.source_text.strip():
            source = body.source_text
        else:
            raise TreeGenerationError("Fournissez un texte ou une URL")
        tree = await generate_tree(source)
    except TreeGenerationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    return {"tree_json": tree}


@router.post("/bots/{bot_id}/insights/generate", response_model=InsightsReportOut)
async def generate_insights_endpoint(bot_id: int, db: AsyncSession = Depends(get_db),
                                     user: User = Depends(get_current_user)):
    """Analyse IA « questions sans réponse » : clusterise les messages visiteurs
    adressés à l'IA sur les 30 derniers jours et suggère des bulles d'arbre.
    Plans payants uniquement (coût IA côté SaaS), 3 analyses/jour/organisation.
    Le rapport est persisté (insights_reports) et renvoyé."""
    from src.services.insights_service import InsightsError, generate_insights

    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")

    org = await db.get(Organization, bot.organization_id)
    if not user.is_superadmin and plan_limits(org).get("price", 0) <= 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "L'analyse des questions sans réponse est réservée aux plans payants")

    # Rate-limit par organisation AVANT tout echantillonnage/appel IA
    # (protection cout, superadmin inclus — comme treegen). NB : un 422
    # « aucune question » ci-dessous a donc deja consomme un credit (voulu :
    # le limiteur protege le cout, pas le confort).
    if not await insights_limiter.check(str(bot.organization_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite d'analyses atteinte pour aujourd'hui — réessayez demain")

    since = datetime.utcnow() - timedelta(days=30)
    samples = (await db.execute(
        select(Message.content)
        .where(Message.bot_id == bot.id, Message.role == "user",
               Message.source == "ai", Message.created_at >= since)
        .order_by(Message.created_at.desc())
        .limit(200)
    )).scalars().all()
    if not samples:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Aucune question visiteur à analyser sur les 30 derniers jours")

    try:
        report = await generate_insights(list(samples))
    except InsightsError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    record = InsightsReport(bot_id=bot.id, report_json=report, message_count=len(samples))
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return InsightsReportOut.model_validate(record)


@router.get("/bots/{bot_id}/insights")
async def get_insights(bot_id: int, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Dernier rapport d'insights du bot (null JSON si aucun)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    record = (await db.execute(
        select(InsightsReport).where(InsightsReport.bot_id == bot.id)
        .order_by(InsightsReport.id.desc()).limit(1)
    )).scalar_one_or_none()
    return InsightsReportOut.model_validate(record) if record else None


@router.get("/bots/{bot_id}/embed")
async def embed_snippets(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Les differents modes d'integration sur le site du client."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "copy")
    api = settings.API_URL
    pk = bot.public_key
    script_tag = f'<script src="{api}/widget.js" data-bot-key="{pk}" defer></script>'
    return {
        "public_key": pk,
        "integrations": [
            {
                "id": "html",
                "label": "Balise HTML <script>",
                "icon": "</>",
                "description": "À coller juste avant </body> sur les pages où le chat doit apparaître.",
                "snippet": script_tag,
            },
            {
                "id": "wordpress",
                "label": "Plugin WordPress",
                "icon": "W",
                "description": "Apparence → Éditeur de thème → footer.php avant </body>, ou via un plugin d'insertion de code (WPCode…).",
                "snippet": script_tag,
            },
            {
                "id": "gtm",
                "label": "Google Tag Manager",
                "icon": "GTM",
                "description": "Créer une balise « HTML personnalisé » déclenchée sur All Pages, et y coller le script.",
                "snippet": script_tag,
            },
            {
                "id": "react",
                "label": "Composant React (npm)",
                "icon": "npm",
                "description": "Chargez le widget depuis un composant React (le script s'injecte au montage).",
                "snippet": (
                    "useEffect(() => {\n"
                    "  const s = document.createElement('script');\n"
                    f"  s.src = '{api}/widget.js';\n"
                    f"  s.dataset.botKey = '{pk}';\n"
                    "  s.defer = true;\n"
                    "  document.body.appendChild(s);\n"
                    "  return () => s.remove();\n"
                    "}, []);"
                ),
            },
            {
                "id": "iframe",
                "label": "iFrame (page dédiée)",
                "icon": "ifr",
                "description": "Intègre le chat ouvert dans un bloc de la page (FAQ, page contact…).",
                "snippet": f'<iframe src="{api}/widget-frame?key={pk}" style="width:100%;height:600px;border:none;border-radius:12px;" title="Chat"></iframe>',
            },
        ],
    }
