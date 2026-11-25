"""Client MCP maison : JSON-RPC 2.0 sur HTTP POST via safe_fetch.

Sous-ensemble supporte : transport HTTP POST (« streamable http » simplifie),
reponses JSON uniques avec fallback parsing SSE minimal (derniere ligne
`data: {...}`), JAMAIS de session SSE entrante. Sequence : initialize ->
notifications/initialized (best-effort) -> tools/list -> tools/call, header
Mcp-Session-Id rejoue si le serveur en fournit un, Authorization: Bearer si
un jeton est configure (Fernet).

Securite : tout le trafic passe par safe_post_json_read (https only, IP
publiques only, pinning anti-rebinding, no redirect, lecture bornee),
timeout 10 s par requete + 15 s par serveur a la decouverte. Un serveur en
echec => tools absents + log, JAMAIS d'exception sortante ni de blocage.

Les tools decouverts sont exposes au modele sous le nom mcp_<server>_<tool>
(sanitises, cap global 20), cache court par conversation (pas de re-decouverte
a chaque tour de boucle tool-use).
"""
import asyncio
import contextvars
import json
import logging
import re
import time
from typing import Optional

from src.services.crypto import decrypt_secret
from src.services.safe_fetch import FetchError, safe_post_json_read

logger = logging.getLogger(__name__)

_PROTOCOL_VERSION = "2025-03-26"
_MAX_TOOLS = 20
_MAX_DESCRIPTION = 300
_MAX_RESULT_CHARS = 2000
_MAX_TOOL_NAME = 64  # limite de nom de tool cote providers
_MAX_SCHEMA_CHARS = 2000  # taille serialisee max d'un inputSchema (anti amplification de tokens)
_MAX_SCHEMA_TEXT = 200    # troncature des description/title INTERNES au schema

# Cache de decouverte par conversation : {conversation_id: {"ts", "tools",
# "sessions": {server_name: sid},
# "names": {full_name: (server_name, tool_serveur)}}} — le proprietaire est
# memorise pour router tools/call exactement (noms de serveurs en relation de
# prefixe). TTL court + purge opportuniste + eviction des plus vieux (pattern
# _maybe_purge de rate_limit).
_CACHE_TTL_SECONDS = 300.0
_CACHE_MAX_ENTRIES = 500
_conv_cache: dict[str, dict] = {}

# Cache NEGATIF par serveur (pattern _retry_at de rate_limit) : un serveur en
# echec de decouverte ne re-paie le timeout qu'une fois par fenetre, pas a
# chaque nouvelle conversation. {f"{bot_id}:{server_name}": retry_at monotonic}.
_NEG_TTL_SECONDS = 90.0
_NEG_MAX_ENTRIES = 500
_neg_cache: dict[str, float] = {}


# Jeton assistant cm (mode « mes données », docs/CM_MCP.md) de la requête widget EN COURS : posé par
# routers/widget.py autour de generate_reply, propre à la tâche asyncio (jamais global, jamais en
# cache, jamais journalisé). Absent -> les outils du serveur cm ne sont pas proposés (mode public).
user_token: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("mcp_user_token", default=None)


def _cache_key(conversation_id: str) -> str:
    # Avec ou sans jeton, la liste des outils diffère : deux entrées de cache distinctes.
    return f"{conversation_id}|u" if user_token.get() else conversation_id


def _assistant_tools(server_name: str) -> tuple[list[dict], dict]:
    """Outils du serveur cm « mes données », décrits localement (même processus : pas d'appel réseau)."""
    from src.services import cm_assistant
    tools, names = [], {}
    for tool, spec in cm_assistant.TOOLS.items():
        suffix = _sanitize_tool_name(server_name, tool)
        if not suffix:
            continue
        full = f"mcp_{server_name}_{suffix}"
        tools.append({"name": full, "description": spec["description"][:_MAX_DESCRIPTION],
                      "input_schema": spec["schema"]})
        names[full] = (server_name, tool)
    return tools, names


class McpError(Exception):
    """Echec protocolaire MCP — message interne (log), jamais montre brut."""


# --- Fonctions pures (testables sans reseau) ---

def _parse_rpc_body(text: str) -> dict:
    """Corps de reponse -> dict JSON-RPC complet. JSON direct, sinon fallback
    SSE minimal (derniere ligne `data: {...}`), sinon ValueError."""
    try:
        data = json.loads(text)
    except ValueError:
        last = None
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                last = line[len("data:"):].strip()
        if last is None:
            raise ValueError("corps JSON-RPC illisible")
        try:
            data = json.loads(last)
        except ValueError:
            raise ValueError("corps SSE illisible")
    if not isinstance(data, dict):
        raise ValueError("réponse JSON-RPC invalide")
    return data


def _sanitize_tool_name(server_name: str, tool: str) -> Optional[str]:
    """Partie <tool> du nom expose mcp_<server>_<tool> : filtree [A-Za-z0-9_-],
    tronquee pour que le nom complet tienne en 64 chars. Vide -> None (ignore)."""
    clean = re.sub(r"[^A-Za-z0-9_-]", "", tool or "")
    if not clean:
        return None
    budget = _MAX_TOOL_NAME - len(f"mcp_{server_name}_")
    if budget <= 0:
        return None
    return clean[:budget]


def _truncate_schema_texts(node):
    """Troncature recursive des champs texte libres (description/title) d'un
    schema JSON : vecteur d'injection de prompt equivalent a la description
    top-level, non couvert par sa seule troncature."""
    if isinstance(node, dict):
        return {
            key: (value[:_MAX_SCHEMA_TEXT]
                  if key in ("description", "title") and isinstance(value, str)
                  else _truncate_schema_texts(value))
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_truncate_schema_texts(v) for v in node]
    return node


def _sanitize_schema(schema) -> dict:
    """inputSchema d'un tool MCP -> schema borne transmissible au modele.
    Textes internes tronques, et schema trop volumineux remplace par un schema
    vide : il serait renvoye au provider A CHAQUE tour pendant le TTL du cache
    (amplification de tokens factures sur la cle managee)."""
    if not isinstance(schema, dict) or schema.get("type") != "object":
        return {"type": "object", "properties": {}}
    schema = _truncate_schema_texts(schema)
    if len(json.dumps(schema, ensure_ascii=False)) > _MAX_SCHEMA_CHARS:
        return {"type": "object", "properties": {}}
    return schema


# --- Protocole ---

def _auth_headers(server: dict) -> dict:
    """Headers de base d'un serveur. Jeton configure mais indechiffrable
    (ENCRYPTION_KEY changee ?) -> McpError : le serveur est ignore (log au
    niveau appelant), jamais d'appel anonyme a sa place."""
    headers = {"Accept": "application/json, text/event-stream"}
    encrypted = server.get("auth_token_encrypted")
    if encrypted:
        token = decrypt_secret(encrypted)
        if not token:
            raise McpError("jeton indéchiffrable — reconfigurez-le dans le dashboard")
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _rpc(url: str, headers: dict, payload: dict) -> tuple[dict, dict]:
    """POST JSON-RPC -> (dict reponse, headers de reponse). Une reponse
    portant "error" est un echec (message tronque, jamais montre brut)."""
    body, resp_headers = await safe_post_json_read(url, payload, headers=headers)
    data = _parse_rpc_body(body)
    error = data.get("error")
    if isinstance(error, dict):
        raise McpError(str(error.get("message", "erreur JSON-RPC"))[:200])
    return data, resp_headers


async def _initialize(url: str, headers: dict) -> Optional[str]:
    """Handshake initialize + notification initialized (best-effort).
    Retourne le Mcp-Session-Id fourni par le serveur, ou None."""
    _, resp_headers = await _rpc(url, headers, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": _PROTOCOL_VERSION, "capabilities": {},
                   "clientInfo": {"name": "chapote", "version": "1.0"}},
    })
    sid = None
    for key, value in resp_headers.items():
        if key.lower() == "mcp-session-id":
            sid = value
            break
    h = dict(headers)
    if sid:
        h["Mcp-Session-Id"] = sid
    # Notification (pas de id) : statut et erreurs volontairement ignores
    try:
        await safe_post_json_read(url, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                                  headers=h)
    except FetchError:
        pass
    return sid


async def _discover(server: dict) -> tuple[list, Optional[str]]:
    """initialize -> initialized -> tools/list pour UN serveur.
    Retourne (tools bruts du serveur, session id eventuel)."""
    headers = _auth_headers(server)
    url = server["url"]
    sid = await _initialize(url, headers)
    h = dict(headers)
    if sid:
        h["Mcp-Session-Id"] = sid
    data, _ = await _rpc(url, h, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    tools = (data.get("result") or {}).get("tools")
    if not isinstance(tools, list):
        raise McpError("réponse tools/list invalide")
    return tools, sid


# --- Cache par conversation ---

def _maybe_purge(now: float) -> None:
    stale = [k for k, v in _conv_cache.items() if now - v["ts"] > _CACHE_TTL_SECONDS]
    for key in stale:
        del _conv_cache[key]
    if len(_conv_cache) > _CACHE_MAX_ENTRIES:
        # Eviction des entrees les plus vieilles (borne memoire dure)
        excess = len(_conv_cache) - _CACHE_MAX_ENTRIES
        for key, _ in sorted(_conv_cache.items(), key=lambda kv: kv[1]["ts"])[:excess]:
            del _conv_cache[key]
    # Cache negatif : fenetres expirees + meme borne memoire dure
    expired = [k for k, retry_at in _neg_cache.items() if retry_at <= now]
    for key in expired:
        del _neg_cache[key]
    if len(_neg_cache) > _NEG_MAX_ENTRIES:
        excess = len(_neg_cache) - _NEG_MAX_ENTRIES
        for key, _ in sorted(_neg_cache.items(), key=lambda kv: kv[1])[:excess]:
            del _neg_cache[key]


# --- API du module (contrat : JAMAIS d'exception sortante) ---

async def list_mcp_tools(bot, conversation_id: str) -> list[dict]:
    """Tools decouverts sur les serveurs MCP du bot, au format neutre
    [{"name": "mcp_<server>_<tool>", "description", "input_schema"}].
    Echec d'un serveur -> serveur saute + log + cache negatif, jamais bloquant.
    Decouverte des serveurs en PARALLELE (un serveur mort ne retarde pas
    l'autre), reassemblage dans l'ordre de configuration pour garder le cap
    _MAX_TOOLS deterministe."""
    servers = (getattr(bot, "mcp_servers_json", None) or [])[:2]
    if not servers or not conversation_id:
        return []
    now = time.monotonic()
    _maybe_purge(now)
    entry = _conv_cache.get(_cache_key(conversation_id))
    if entry is not None:
        return entry["tools"]

    # Serveur cm « mes données » (bot assistant + adresse exacte) : outils locaux, seulement avec un
    # jeton utilisateur ; sans jeton, rien n'est proposé (le bot reste en mode public).
    from src.services import cm_assistant
    local = [s for s in servers if cm_assistant.is_assistant_server(bot, s)]
    servers = [s for s in servers if s not in local]
    # Cache negatif consulte AVANT de payer le timeout : un serveur durablement
    # mort ne coute la decouverte qu'une fois par fenetre, pas par conversation
    pending = [s for s in servers
               if _neg_cache.get(f"{bot.id}:{s.get('name')}", 0.0) <= now]
    results = await asyncio.gather(
        *[asyncio.wait_for(_discover(s), 15) for s in pending],
        return_exceptions=True,
    )

    tools: list[dict] = []
    sessions: dict[str, str] = {}
    names: dict[str, tuple[str, str]] = {}
    if user_token.get():
        for s in local:
            local_tools, local_names = _assistant_tools(str(s.get("name") or ""))
            for t in local_tools:
                if len(tools) < _MAX_TOOLS and t["name"] not in names:
                    tools.append(t)
                    names[t["name"]] = local_names[t["name"]]
    for server, result in zip(pending, results):
        name = str(server.get("name") or "")
        if isinstance(result, BaseException):
            logger.warning("Serveur MCP %s indisponible : %s", name, str(result)[:200])
            _neg_cache[f"{bot.id}:{name}"] = now + _NEG_TTL_SECONDS
            continue
        raw_tools, sid = result
        if sid:
            sessions[name] = sid
        for tool in raw_tools:
            if len(tools) >= _MAX_TOOLS:
                break
            if not isinstance(tool, dict):
                continue
            suffix = _sanitize_tool_name(name, str(tool.get("name") or ""))
            if not suffix:
                continue
            full_name = f"mcp_{name}_{suffix}"
            if full_name in names:
                continue
            description = tool.get("description")
            description = description[:_MAX_DESCRIPTION] if isinstance(description, str) else ""
            schema = _sanitize_schema(tool.get("inputSchema"))
            tools.append({"name": full_name, "description": description,
                          "input_schema": schema})
            # Proprietaire + nom d'origine cote serveur : routage exact de
            # tools/call (la sanitisation peut avoir altere le nom, et deux
            # serveurs peuvent etre en relation de prefixe)
            names[full_name] = (name, str(tool.get("name") or ""))
    _conv_cache[_cache_key(conversation_id)] = {"ts": now, "tools": tools,
                                                "sessions": sessions, "names": names}
    return tools


async def call_mcp_tool(bot, conversation_id: str, full_name: str, args: dict) -> tuple[str, bool]:
    """Execute un tool MCP demande par le modele. Retour (tool_result,
    is_error) — messages FR montrables, jamais d'exception sortante.

    Routage : serveur PROPRIETAIRE memorise a la decouverte (cache names),
    repli au prefixe le PLUS LONG si le cache a expire — deux noms de serveurs
    peuvent etre en relation de prefixe (ex. crm / crm_v2) : le premier match
    naif enverrait les arguments et le Bearer au mauvais serveur."""
    servers = (getattr(bot, "mcp_servers_json", None) or [])[:2]
    entry = _conv_cache.get(_cache_key(conversation_id)) or {}
    cached = (entry.get("names") or {}).get(full_name)
    server = None
    tool_name = None
    if cached:
        owner, tool_name = cached
        server = next((s for s in servers if str(s.get("name")) == owner), None)
    if server is None:
        # Cache absent/expire (ou serveur retire de la config) : longest-prefix
        best_len = -1
        for s in servers:
            prefix = f"mcp_{s.get('name')}_"
            if full_name.startswith(prefix) and len(prefix) > best_len:
                server, best_len = s, len(prefix)
        if server is None:
            return ("Tool MCP inconnu", True)
        tool_name = full_name[best_len:]
    server_name = str(server.get("name"))
    from src.services import cm_assistant
    if cm_assistant.is_assistant_server(bot, server):
        token = user_token.get()
        if not token:
            return ("Données de compte indisponibles : l'utilisateur n'est pas connecté ou n'a pas donné "
                    "son accord IA.", True)
        return await cm_assistant.run_tool(token, tool_name, args or {})
    try:
        headers = _auth_headers(server)
        sid = (entry.get("sessions") or {}).get(server_name)
        if sid is None:
            sid = await _initialize(server["url"], headers)
            if sid and entry:
                entry.setdefault("sessions", {})[server_name] = sid
        h = dict(headers)
        if sid:
            h["Mcp-Session-Id"] = sid
        data, _ = await _rpc(server["url"], h, {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": tool_name, "arguments": args or {}},
        })
        result = data.get("result") or {}
        texts = [block["text"] for block in (result.get("content") or [])
                 if isinstance(block, dict) and isinstance(block.get("text"), str)]
        text = "\n".join(texts)[:_MAX_RESULT_CHARS]
        if result.get("isError"):
            return (text or "Le serveur MCP a signalé une erreur", True)
        return (text or "(réponse vide)", False)
    except Exception as exc:
        logger.warning("Serveur MCP %s : tools/call %s en échec : %s",
                       server_name, tool_name, str(exc)[:200])
        return ("Le serveur MCP est momentanément indisponible", True)
