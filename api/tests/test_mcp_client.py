"""PR-13 — Client MCP (services/mcp_client.py).

Le client MCP parle à des serveurs externes en JSON-RPC 2.0, rejoue un
Mcp-Session-Id, signe ses requêtes d'un Bearer (jeton Fernet déchiffré) et
expose les tools découverts au modèle. Aucun test ne le couvrait. On pose la
couverture sur l'axe 6 du plan PR-13 :

- Fonctions PURES (sans réseau) : `_parse_rpc_body` (JSON direct, fallback SSE
  `data: {...}`, corps illisible -> ValueError), `_sanitize_tool_name`,
  `_sanitize_schema`.
- Découverte + appel : `list_mcp_tools` parse la réponse JSON et CAPTURE le
  Mcp-Session-Id (rejoué ensuite), `call_mcp_tool` parse le résultat texte et
  l'indicateur isError ; une réponse d'ERREUR JSON-RPC ou un serveur en échec
  est géré SANS exception sortante (contrat du module : jamais d'exception).

La couche réseau (`safe_post_json_read`) est monkeypatchée : un faux transport
répond selon la méthode JSON-RPC du payload, sans aucun socket. Le contrat
anti-SSRF de safe_post_json_read lui-même est couvert par test_safe_fetch.py
(PR-01) ; ici on exerce la logique PROTOCOLAIRE au-dessus.
"""
from types import SimpleNamespace

import pytest

from src.services import mcp_client as mc
from src.services.mcp_client import (
    _parse_rpc_body,
    _sanitize_schema,
    _sanitize_tool_name,
    call_mcp_tool,
    list_mcp_tools,
)
from src.services.safe_fetch import FetchError


# --------------------------------------------------------------------------
# Faux transport : répond selon la méthode JSON-RPC du payload
# --------------------------------------------------------------------------

def _fake_transport(monkeypatch, *, tools=None, call_result=None, session_id="sess-xyz",
                    fail_on=None):
    """Installe un faux `safe_post_json_read`. `tools` = liste brute renvoyée par
    tools/list ; `call_result` = bloc `result` renvoyé par tools/call ;
    `fail_on` = méthode JSON-RPC qui doit lever FetchError (serveur en échec)."""
    import json as _json

    if tools is None:
        tools = [{"name": "do_thing", "description": "Fait la chose",
                  "inputSchema": {"type": "object", "properties": {"x": {"type": "string"}}}}]

    async def fake(url, payload, headers=None, max_bytes=100_000):
        method = payload.get("method")
        if fail_on is not None and method == fail_on:
            raise FetchError("hôte injoignable")
        if method == "initialize":
            body = _json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"capabilities": {}}})
            return body, {"Mcp-Session-Id": session_id} if session_id else {}
        if method == "notifications/initialized":
            return "", {}
        if method == "tools/list":
            body = _json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": tools}})
            return body, {}
        if method == "tools/call":
            result = call_result if call_result is not None else {
                "content": [{"type": "text", "text": "résultat OK"}]}
            body = _json.dumps({"jsonrpc": "2.0", "id": 3, "result": result})
            return body, {}
        return _json.dumps({"jsonrpc": "2.0", "id": 0, "result": {}}), {}

    monkeypatch.setattr(mc, "safe_post_json_read", fake)


def _bot(bot_id, server_name="srv"):
    return SimpleNamespace(
        id=bot_id,
        mcp_servers_json=[{"name": server_name, "url": "https://mcp.example.com/rpc"}],
    )


# ==========================================================================
# Fonctions pures
# ==========================================================================

def test_parse_rpc_body_direct_json():
    assert _parse_rpc_body('{"jsonrpc":"2.0","id":1,"result":{}}')["id"] == 1


def test_parse_rpc_body_sse_fallback():
    """Fallback SSE : la DERNIÈRE ligne `data: {...}` est retenue."""
    text = "event: message\ndata: {\"id\": 1}\ndata: {\"id\": 2, \"result\": {}}\n"
    assert _parse_rpc_body(text)["id"] == 2


def test_parse_rpc_body_invalid_raises():
    with pytest.raises(ValueError):
        _parse_rpc_body("ni json ni sse")


def test_parse_rpc_body_non_dict_raises():
    with pytest.raises(ValueError):
        _parse_rpc_body("[1, 2, 3]")  # JSON valide mais pas un objet JSON-RPC


def test_sanitize_tool_name_filters_and_truncates():
    assert _sanitize_tool_name("srv", "get user!@#") == "getuser"
    assert _sanitize_tool_name("srv", "***") is None        # vide après filtrage
    # Nom complet borné à 64 chars : la part <tool> est tronquée au budget.
    long = _sanitize_tool_name("srv", "a" * 200)
    assert long is not None and len(f"mcp_srv_{long}") <= 64


def test_sanitize_schema_rejects_non_object():
    assert _sanitize_schema(None) == {"type": "object", "properties": {}}
    assert _sanitize_schema({"type": "string"}) == {"type": "object", "properties": {}}


def test_sanitize_schema_truncates_free_text():
    schema = {"type": "object", "properties": {},
              "description": "x" * 500, "title": "y" * 500}
    out = _sanitize_schema(schema)
    assert len(out["description"]) == 200  # _MAX_SCHEMA_TEXT
    assert len(out["title"]) == 200


def test_sanitize_schema_drops_oversized():
    """Un schema dont la sérialisation dépasse la borne est remplacé par un schema
    vide (anti-amplification de tokens facturés à chaque tour)."""
    props = {f"f{i}": {"type": "string", "description": "z" * 50} for i in range(100)}
    out = _sanitize_schema({"type": "object", "properties": props})
    assert out == {"type": "object", "properties": {}}


# ==========================================================================
# Découverte + appel (faux transport)
# ==========================================================================

@pytest.mark.asyncio
async def test_list_mcp_tools_parses_and_captures_session(monkeypatch):
    """list_mcp_tools : initialize -> tools/list parsés en tools normalisés
    (mcp_<server>_<tool>), et le Mcp-Session-Id est CAPTURÉ (cache conversation)
    pour être rejoué aux appels suivants."""
    _fake_transport(monkeypatch, session_id="sess-123")
    conv = "conv-list-1"
    tools = await list_mcp_tools(_bot(101), conv)

    assert len(tools) == 1
    assert tools[0]["name"] == "mcp_srv_do_thing"
    assert tools[0]["description"] == "Fait la chose"
    assert tools[0]["input_schema"]["type"] == "object"
    # Session id mémorisé pour le serveur 'srv'.
    assert mc._conv_cache[conv]["sessions"]["srv"] == "sess-123"


@pytest.mark.asyncio
async def test_call_mcp_tool_parses_text_result(monkeypatch):
    """call_mcp_tool : après découverte, l'appel renvoie le texte concaténé des
    blocs `content` + is_error=False."""
    _fake_transport(monkeypatch, call_result={
        "content": [{"type": "text", "text": "Bonjour"},
                    {"type": "text", "text": "monde"}]})
    conv = "conv-call-1"
    await list_mcp_tools(_bot(102), conv)
    text, is_error = await call_mcp_tool(_bot(102), conv, "mcp_srv_do_thing", {"x": "1"})
    assert text == "Bonjour\nmonde"
    assert is_error is False


@pytest.mark.asyncio
async def test_call_mcp_tool_iserror_flag(monkeypatch):
    """Un résultat tools/call avec isError=True -> (texte, True)."""
    _fake_transport(monkeypatch, call_result={
        "content": [{"type": "text", "text": "échec côté serveur"}], "isError": True})
    conv = "conv-call-err"
    await list_mcp_tools(_bot(103), conv)
    text, is_error = await call_mcp_tool(_bot(103), conv, "mcp_srv_do_thing", {})
    assert is_error is True
    assert "échec" in text


@pytest.mark.asyncio
async def test_call_mcp_tool_unknown_name(monkeypatch):
    """Un nom de tool qui ne correspond à aucun serveur -> (message, True), pas d'appel."""
    _fake_transport(monkeypatch)
    text, is_error = await call_mcp_tool(_bot(104), "conv-unknown", "mcp_autre_x", {})
    assert is_error is True
    assert "inconnu" in text.lower()


@pytest.mark.asyncio
async def test_call_mcp_tool_jsonrpc_error_handled(monkeypatch):
    """Une réponse JSON-RPC portant un objet `error` -> McpError interceptée :
    retour gracieux (is_error=True), JAMAIS d'exception sortante."""
    import json as _json

    async def fake(url, payload, headers=None, max_bytes=100_000):
        method = payload.get("method")
        if method == "initialize":
            return _json.dumps({"result": {}}), {"Mcp-Session-Id": "s"}
        if method == "notifications/initialized":
            return "", {}
        if method == "tools/list":
            return _json.dumps({"result": {"tools": [
                {"name": "do_thing", "inputSchema": {"type": "object", "properties": {}}}]}}), {}
        # tools/call -> erreur JSON-RPC
        return _json.dumps({"error": {"code": -32000, "message": "serveur fâché"}}), {}

    monkeypatch.setattr(mc, "safe_post_json_read", fake)
    conv = "conv-rpc-err"
    await list_mcp_tools(_bot(105), conv)
    text, is_error = await call_mcp_tool(_bot(105), conv, "mcp_srv_do_thing", {})
    assert is_error is True
    assert "indisponible" in text.lower()


@pytest.mark.asyncio
async def test_list_mcp_tools_server_failure_yields_empty(monkeypatch):
    """Un serveur en échec à la découverte (FetchError) -> serveur sauté, aucun
    tool, AUCUNE exception (contrat : jamais bloquant)."""
    _fake_transport(monkeypatch, fail_on="initialize")
    tools = await list_mcp_tools(_bot(106), "conv-fail")
    assert tools == []


@pytest.mark.asyncio
async def test_list_mcp_tools_no_servers_returns_empty(monkeypatch):
    """Bot sans serveur MCP -> [] immédiat (pas d'appel réseau)."""
    bot = SimpleNamespace(id=107, mcp_servers_json=[])
    assert await list_mcp_tools(bot, "conv-none") == []
