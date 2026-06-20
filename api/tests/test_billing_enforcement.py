"""Enforcement aux points exacts de la spec §3.3 (1 négatif / 1 positif par point).

Convention HTTP : gating config/staff = 402 (distinct du 403 perm, du 429
rate-limit). Le mode ENFORCE doit être actif pour bloquer (sinon observe = log).

Couvre :
- IA config (mode/system_prompt/provider/model)            -> _enforce_config_modules
- Actions&MCP config (actions_json / mcp_servers_json)      -> idem
- A/B config : ab_split_pct>0 ET tree_variant_json non-null -> idem
- RAG ingestion (kb.create_source/pdf)                      -> gate(MODULE_RAG)
- Live chat staff (inbox take/reply)                        -> gate(MODULE_INBOX)
- BYOK config (api_key_mode=byok)                           -> gate(MODULE_AI)
- treegen NON gaté (génération arbre = gratuite)
- gate() observe vs enforce.
"""
import pytest
from fastapi import HTTPException

from conftest import FakeSession, Obj
from src.core.constants import (
    MODULE_AB,
    MODULE_ACTIONS,
    MODULE_AI,
    MODULE_INBOX,
    MODULE_RAG,
)
from src.services import entitlement_service as es
from src.services.entitlement_service import Entitlement, gate
from src.routers.bots import _enforce_config_modules


def _ent(modules=(), quota=0, status="active", byok=False):
    return Entitlement(bot_id=1, modules=set(modules), ai_monthly_quota=quota,
                       overage_mode="block", status=status, byok=byok)


def _enforce(monkeypatch, on: bool):
    monkeypatch.setattr(es.settings, "BILLING_ENFORCE", on, raising=False)


# --- gate() : observe vs enforce -----------------------------------------

def test_gate_positif_module_present():
    gate(_ent(modules=[MODULE_RAG]), MODULE_RAG)  # ne lève pas


def test_gate_negatif_enforce_402(monkeypatch):
    _enforce(monkeypatch, True)
    with pytest.raises(HTTPException) as ei:
        gate(_ent(modules=[]), MODULE_RAG)
    assert ei.value.status_code == 402
    assert ei.value.detail == {"error": "module_required", "module": MODULE_RAG}


def test_gate_negatif_observe_ne_bloque_pas(monkeypatch):
    _enforce(monkeypatch, False)
    gate(_ent(modules=[]), MODULE_RAG)  # mode observe : log-only, pas d'exception


# --- IA config (bots._enforce_config_modules) ----------------------------

def test_ia_config_negatif(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    with pytest.raises(HTTPException) as ei:
        _enforce_config_modules(bot, {"system_prompt": "x"}, _ent(modules=[]))
    assert ei.value.status_code == 402


def test_ia_config_positif(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"system_prompt": "x"}, _ent(modules=[MODULE_AI]))


def test_ia_config_mode_tree_non_gate(monkeypatch):
    """mode='tree' ne touche pas l'IA -> pas de gate IA (seuls ai|hybrid gatent)."""
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"mode": "tree"}, _ent(modules=[]))  # ne lève pas


# --- Actions & MCP config -------------------------------------------------

def test_actions_config_negatif(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    with pytest.raises(HTTPException) as ei:
        _enforce_config_modules(bot, {"actions_json": [{"name": "a"}]}, _ent(modules=[]))
    assert ei.value.status_code == 402


def test_actions_config_positif(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"actions_json": [{"name": "a"}]},
                            _ent(modules=[MODULE_ACTIONS]))


def test_actions_config_liste_vide_non_gate(monkeypatch):
    """actions_json=[] (vide) = pas de configuration active -> pas de gate."""
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"actions_json": []}, _ent(modules=[]))  # ne lève pas


# --- A/B config : LES DEUX formes (split>0 ET variante non-null) ----------

def test_ab_split_pct_positif_gate(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    with pytest.raises(HTTPException) as ei:
        _enforce_config_modules(bot, {"ab_split_pct": 50}, _ent(modules=[]))
    assert ei.value.status_code == 402


def test_ab_variant_non_null_gate(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    with pytest.raises(HTTPException) as ei:
        _enforce_config_modules(bot, {"tree_variant_json": {"start": "r", "nodes": {}}},
                                _ent(modules=[]))
    assert ei.value.status_code == 402


def test_ab_split_zero_non_gate(monkeypatch):
    """ab_split_pct=0 = A/B désactivé -> jamais gaté (les deux ensemble, spec)."""
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"ab_split_pct": 0}, _ent(modules=[]))  # ne lève pas


def test_ab_variant_null_non_gate(monkeypatch):
    """tree_variant_json=null = désactivation explicite -> jamais gaté."""
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json={"old": True}, ab_split_pct=0)
    _enforce_config_modules(bot, {"tree_variant_json": None}, _ent(modules=[]))  # ne lève pas


def test_ab_positif(monkeypatch):
    _enforce(monkeypatch, True)
    bot = Obj(id=1, tree_variant_json=None, ab_split_pct=0)
    _enforce_config_modules(bot, {"ab_split_pct": 50}, _ent(modules=[MODULE_AB]))


# --- BYOK config (bots._apply_secrets garde) ------------------------------

@pytest.mark.asyncio
async def test_byok_config_negatif(monkeypatch):
    from src.routers.bots import _apply_secrets
    _enforce(monkeypatch, True)
    bot = Obj(id=1)
    with pytest.raises(HTTPException) as ei:
        await _apply_secrets(bot, {"api_key_mode": "byok"}, _ent(modules=[]))
    assert ei.value.status_code == 402


@pytest.mark.asyncio
async def test_byok_config_positif(monkeypatch):
    from src.routers.bots import _apply_secrets
    _enforce(monkeypatch, True)
    bot = Obj(id=1)
    # Module IA présent -> pas de blocage (pas de byok_key à chiffrer ici).
    await _apply_secrets(bot, {"api_key_mode": "byok"}, _ent(modules=[MODULE_AI]))


# --- RAG ingestion (kb.create_source) : 402 sans module -------------------

@pytest.mark.asyncio
async def test_rag_ingestion_negatif(client, overrides, db, current_user, monkeypatch):
    from src.models.bot import Bot
    _enforce(monkeypatch, True)
    monkeypatch.setattr(es, "billing_enabled", lambda: True)

    current_user.id = 1
    bot = Bot(id=1, owner_user_id=1, organization_id=None, name="X")
    db.seed(bot)
    # Entitlement SANS module RAG -> gate -> 402. _get_accessible_bot/_check_bot_perm
    # passent (bot perso, owner) ; on stoppe au gate RAG avant le cap de sources.
    from src.models.billing import BotEntitlement
    db.seed(BotEntitlement(bot_id=1, modules=[], ai_monthly_quota=0,
                           status="active", source="stripe"))
    async with client as c:
        resp = await c.post("/api/bots/1/kb/sources",
                            json={"type": "text", "content": "du contenu", "title": "t"})
    assert resp.status_code == 402


@pytest.mark.asyncio
async def test_rag_ingestion_positif(client, overrides, db, current_user, monkeypatch):
    from src.models.bot import Bot
    from src.models.billing import BotEntitlement
    from src.routers import kb as kb_router
    _enforce(monkeypatch, True)
    monkeypatch.setattr(es, "billing_enabled", lambda: True)
    # On neutralise l'ingestion réelle (tâche de fond) et le cap.
    monkeypatch.setattr(kb_router, "_spawn_ingest", lambda coro: coro.close())

    async def _noop_cap(db, bot_id):
        return None
    monkeypatch.setattr(kb_router, "_check_sources_cap", _noop_cap)

    current_user.id = 1
    db.seed(Bot(id=1, owner_user_id=1, organization_id=None, name="X"))
    db.seed(BotEntitlement(bot_id=1, modules=[MODULE_RAG], ai_monthly_quota=0,
                           status="active", source="stripe"))
    async with client as c:
        resp = await c.post("/api/bots/1/kb/sources",
                            json={"type": "text", "content": "du contenu", "title": "t"})
    assert resp.status_code == 200, resp.text


# --- Live chat staff (inbox.take) : refus n'altère pas la conversation ----

@pytest.mark.asyncio
async def test_inbox_take_negatif_402_conversation_intacte(client, overrides, db,
                                                           current_user, monkeypatch):
    from src.models.bot import Bot
    from src.models.billing import BotEntitlement
    from src.models.conversation import Conversation
    from src.routers import inbox as inbox_router
    _enforce(monkeypatch, True)
    monkeypatch.setattr(es, "billing_enabled", lambda: True)

    # Court-circuite l'accès bot/inbox (testé ailleurs) pour isoler le gate Inbox.
    bot = Bot(id=1, owner_user_id=1, organization_id=None, name="X")
    conv = Conversation(id="c1", bot_id=1, visitor_id="v", domain="d",
                        status="human_requested")
    db.seed(bot, conv)
    current_user.id = 1

    async def _acc(db, bot_id, user):
        return bot, None
    monkeypatch.setattr(inbox_router, "_get_accessible_bot", _acc)

    async def _conv(db, bot, user, membership, cid):
        return conv
    monkeypatch.setattr(inbox_router, "_get_inbox_conversation", _conv)

    db.seed(BotEntitlement(bot_id=1, modules=[], ai_monthly_quota=0,
                           status="active", source="stripe"))
    async with client as c:
        resp = await c.post("/api/bots/1/conversations/c1/take")
    assert resp.status_code == 402
    # La conversation N'A PAS basculé en 'human' (gate AVANT la transition SQL).
    assert conv.status == "human_requested"


# --- treegen NON gaté par le module IA -----------------------------------

@pytest.mark.asyncio
async def test_treegen_non_gate_par_module_ia(client, overrides, db, current_user,
                                              monkeypatch):
    """Génération d'arbre = gratuite : aucun gate module IA, même billing ON
    et sans module IA souscrit (spec §3.3 vigilance IA)."""
    from src.models.bot import Bot
    from src.models.billing import BotEntitlement
    from src.routers import bots as bots_router
    _enforce(monkeypatch, True)
    monkeypatch.setattr(es, "billing_enabled", lambda: True)

    current_user.id = 1
    db.seed(Bot(id=1, owner_user_id=1, organization_id=None, name="X"))
    # Entitlement SANS module IA : si treegen gatait, ce serait 402. On attend 200.
    db.seed(BotEntitlement(bot_id=1, modules=[], ai_monthly_quota=0,
                           status="active", source="stripe"))

    # Rate-limit passant + génération mockée (pas d'appel IA réel).
    class _OkLimiter:
        async def check(self, key):
            return True
    monkeypatch.setattr(bots_router, "treegen_limiter", _OkLimiter())

    async def _fake_generate(source):
        return {"start": "root", "nodes": {"root": {"message": "hi", "options": []}}}

    import src.services.tree_generator as tg
    monkeypatch.setattr(tg, "generate_tree", _fake_generate)

    async with client as c:
        resp = await c.post("/api/bots/1/tree/generate",
                            json={"source_text": "Une FAQ assez longue pour générer."})
    assert resp.status_code == 200, resp.text
    assert "tree_json" in resp.json()
