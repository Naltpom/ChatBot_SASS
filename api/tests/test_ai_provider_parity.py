"""PR-23 — Parité fonctionnelle des providers IA (services/ai_service.py).

Findings audit : le provider Gemini IGNORAIT SILENCIEUSEMENT les actions IA, le
tool interne search_docs (RAG) et les tools MCP, alors qu'Anthropic et OpenAI les
exposaient et les exécutaient — une abstraction fuyante (la capacité du chatbot
dégradait selon le provider, sans erreur visible). La boucle tool-use était aussi
DUPLIQUÉE entre Anthropic et OpenAI.

Ces tests prouvent la PARITÉ : pour CHAQUE provider, les tools sont (a) bien
ENVOYÉS au modèle au format propriétaire, et (b) EXÉCUTÉS quand le modèle en
demande un, le résultat étant ré-injecté pour le tour final. Gemini a reçu le
function-calling réel (plus de silence) ; on le couvre en plus sur search_docs
(RAG) et le routage MCP — les deux capacités qu'il laissait tomber.

Aucun réseau : la couche HTTP sortante est mockée en monkeypatchant
`ai_service.httpx.AsyncClient` (les trois providers, y compris Anthropic via
core.anthropic.call_messages, postent sur le client créé par _run_tool_loop). Le
dispatch d'outil (`_run_action` / `_run_search_docs` / `call_mcp_tool`) est lui
aussi monkeypatché + capturé : on prouve l'exécution sans DB ni provider réel.
Même esprit de mock que test_action_executor.py / test_widget_message.py.
"""
from types import SimpleNamespace

import pytest

from src.core.config import settings
from src.services import ai_service
from src.services.ai_service import MANAGED_KEYS, generate_reply


# --------------------------------------------------------------------------
# Faux client httpx : sert une liste scriptée de réponses JSON et capture
# chaque payload sortant (url / json / headers / params). Aucun réseau.
# --------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


def _fake_client_cls(responses, captures):
    it = iter(responses)

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            captures.append({"url": url, "json": kw.get("json"),
                             "headers": kw.get("headers"), "params": kw.get("params")})
            return _FakeResp(next(it))

    return _Client


def _bot(provider, **kw):
    base = {
        "id": 1, "ai_provider": provider, "ai_model": "m-test",
        "api_key_mode": "managed", "byok_key_encrypted": None,
        "temperature": 70, "system_prompt": "Tu es un assistant.",
        "design_json": {}, "actions_json": None, "mcp_servers_json": None,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _setup(monkeypatch, provider, responses, captures):
    """MOCK_AI off, clé managed posée, client httpx mocké (scripté)."""
    monkeypatch.setattr(settings, "MOCK_AI", False)
    monkeypatch.setattr(settings, MANAGED_KEYS[provider], "managed-key", raising=False)
    monkeypatch.setattr(ai_service.httpx, "AsyncClient",
                        _fake_client_cls(responses, captures))


# --------------------------------------------------------------------------
# Réponses provider scriptées : tour 1 = demande d'outil, tour 2 = texte final.
# Et extraction des noms de tools envoyés dans le payload du 1er appel.
# --------------------------------------------------------------------------

def _toolcall_response(provider, name, args):
    if provider == "anthropic":
        return {"content": [{"type": "tool_use", "id": "t1", "name": name, "input": args}],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 5, "output_tokens": 3}}
    if provider == "openai":
        import json as _j
        return {"choices": [{"message": {"content": None, "tool_calls": [
                    {"id": "c1", "type": "function",
                     "function": {"name": name, "arguments": _j.dumps(args)}}]}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 3}}
    return {"candidates": [{"content": {"role": "model",
                "parts": [{"functionCall": {"name": name, "args": args}}]}}],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 3}}


def _text_response(provider, text):
    if provider == "anthropic":
        return {"content": [{"type": "text", "text": text}], "stop_reason": "end_turn",
                "usage": {"input_tokens": 2, "output_tokens": 4}}
    if provider == "openai":
        return {"choices": [{"message": {"content": text}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 4}}
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}}],
            "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 4}}


def _sent_tool_names(provider, payload):
    tools = payload.get("tools")
    if not tools:
        return []
    if provider == "anthropic":
        return [t["name"] for t in tools]
    if provider == "openai":
        return [t["function"]["name"] for t in tools]
    # gemini : functionDeclarations groupées sous un bloc tool
    return [d["name"] for d in tools[0]["functionDeclarations"]]


PROVIDERS = ["anthropic", "openai", "gemini"]


# ==========================================================================
# Parité : pour CHAQUE provider, l'action est exposée ET exécutée
# ==========================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_provider_exposes_and_executes_action(monkeypatch, provider):
    """Pour chaque provider : (a) l'action configurée est ENVOYÉE au modèle au
    format propriétaire, (b) quand le modèle la demande elle est EXÉCUTÉE via le
    dispatch commun, (c) le texte du tour final est rendu. C'est la parité que
    Gemini n'avait pas (il ignorait silencieusement les actions)."""
    action = {"name": "do_thing", "type": "webhook",
              "description": "Fait la chose",
              "fields": [{"name": "x", "type": "string", "required": True}]}
    bot = _bot(provider, actions_json=[action])

    ran = []

    async def _fake_run_action(b, name, args, db, conversation_id):
        ran.append((name, args))
        return {"ok": True}

    monkeypatch.setattr(ai_service, "_run_action", _fake_run_action)

    captures = []
    _setup(monkeypatch, provider, [
        _toolcall_response(provider, "do_thing", {"x": "v"}),
        _text_response(provider, "C'est fait."),
    ], captures)

    res = await generate_reply(bot, [{"role": "user", "content": "fais-le"}],
                               db=None, conversation_id="c1", allow_actions=True)

    # (a) tool envoyé au 1er appel
    assert "do_thing" in _sent_tool_names(provider, captures[0]["json"])
    # (b) action exécutée avec les bons args
    assert ran == [("do_thing", {"x": "v"})]
    # (c) texte final rendu + tokens cumulés sur les deux tours
    assert res.content == "C'est fait."
    assert res.tokens_in == 7 and res.tokens_out == 7
    assert len(captures) == 2  # 1 demande d'outil + 1 réponse finale


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_provider_no_tools_when_actions_disabled(monkeypatch, provider):
    """Sans le module Actions (allow_actions=False) AUCUN tool n'est exposé — vrai
    pour les TROIS providers (parité du gating modulaire, pas seulement
    anthropic/openai)."""
    bot = _bot(provider, actions_json=[{"name": "do_thing", "type": "webhook"}])
    captures = []
    _setup(monkeypatch, provider, [_text_response(provider, "Bonjour.")], captures)

    res = await generate_reply(bot, [{"role": "user", "content": "salut"}],
                               db=None, conversation_id="c1", allow_actions=False)

    assert res.content == "Bonjour."
    assert _sent_tool_names(provider, captures[0]["json"]) == []
    assert "tools" not in captures[0]["json"]  # clé absente, pas juste vide


# ==========================================================================
# Gemini : parité sur les deux autres capacités qu'il laissait tomber
# ==========================================================================

@pytest.mark.asyncio
async def test_gemini_executes_search_docs(monkeypatch):
    """RAG : un bot Gemini avec base de connaissances expose search_docs et
    l'EXÉCUTE (avant, Gemini loggait « non supporté » et répondait sans RAG)."""
    bot = _bot("gemini")
    ran = []

    async def _fake_search(b, args, db):
        ran.append(args)
        return ("RESULTAT KB", False)

    monkeypatch.setattr(ai_service, "_run_search_docs", _fake_search)

    captures = []
    _setup(monkeypatch, "gemini", [
        _toolcall_response("gemini", "search_docs", {"query": "horaires"}),
        _text_response("gemini", "Nous ouvrons à 9h."),
    ], captures)

    res = await generate_reply(bot, [{"role": "user", "content": "horaires ?"}],
                               db=object(), conversation_id="c1", has_kb=True)

    assert "search_docs" in _sent_tool_names("gemini", captures[0]["json"])
    assert ran == [{"query": "horaires"}]
    assert res.content == "Nous ouvrons à 9h."


@pytest.mark.asyncio
async def test_gemini_routes_mcp_tool(monkeypatch):
    """MCP : un tool au préfixe réservé mcp_ demandé par Gemini est routé vers
    call_mcp_tool (avant, Gemini ignorait les serveurs MCP). On vérifie le
    ROUTAGE du dispatch, indépendamment de l'exposition du tool."""
    bot = _bot("gemini")
    routed = []

    async def _fake_call_mcp(b, conversation_id, name, args):
        routed.append((name, args))
        return ("MCP OK", False)

    # call_mcp_tool est importé PARESSEUSEMENT dans _dispatch_tool_call.
    import src.services.mcp_client as mcp_client
    monkeypatch.setattr(mcp_client, "call_mcp_tool", _fake_call_mcp)

    captures = []
    _setup(monkeypatch, "gemini", [
        _toolcall_response("gemini", "mcp_srv_lookup", {"q": "x"}),
        _text_response("gemini", "Voici la réponse."),
    ], captures)

    res = await generate_reply(bot, [{"role": "user", "content": "cherche"}],
                               db=None, conversation_id="c1", allow_mcp=True)

    assert routed == [("mcp_srv_lookup", {"q": "x"})]
    assert res.content == "Voici la réponse."


# ==========================================================================
# Provider inconnu : erreur EXPLICITE (jamais de silence)
# ==========================================================================

@pytest.mark.asyncio
async def test_unknown_provider_raises_explicit(monkeypatch):
    """Un provider hors registre -> AIServiceError explicite (jamais un chatbot
    muet)."""
    monkeypatch.setattr(settings, "MOCK_AI", False)
    bot = _bot("anthropic", ai_provider="mystery", api_key_mode="byok",
               byok_key_encrypted=None)
    # byok renvoie None si pas de clé -> on force une clé pour atteindre le dispatch
    monkeypatch.setattr(ai_service, "resolve_api_key", lambda b: "k")

    with pytest.raises(ai_service.AIServiceError) as exc:
        await generate_reply(bot, [{"role": "user", "content": "hi"}])
    assert "inconnu" in str(exc.value).lower()
