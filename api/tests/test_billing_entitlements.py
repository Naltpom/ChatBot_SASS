"""Couche entitlements (spec §3.2 / §7.3) :

- socle GRATUIT par défaut (billing OFF, bot sans entitlement -> ALL_UNLOCKED) ;
- module actif après « souscription » (ligne bot_entitlements -> has_module) ;
- BYOK non métré (ai_quota_for -> None) ;
- clé canonique de scope perso/équipe SANS fuite croisée ;
- quota inclus puis dépassement (ai_quota_consume, fail-closed COUNT SQL).

Aucune DB réelle : on monkeypatch les rares accès (`_load`, billing_enabled,
count SQL) — voir conftest.py pour le pourquoi.
"""
import pytest

from conftest import FakeSession, Obj
from src.core.constants import (
    MODULE_AI,
    MODULE_INBOX,
    MODULE_KEYS,
    MODULE_RAG,
)
from src.services import entitlement_service as es
from src.services import quota_service as qs
from src.core.billing_keys import billing_owner_user_id


def _bot(bot_id=1, api_key_mode="managed", organization_id=None, owner_user_id=None):
    return Obj(id=bot_id, api_key_mode=api_key_mode,
               organization_id=organization_id, owner_user_id=owner_user_id)


# --- Socle gratuit : invariant D0 ----------------------------------------

@pytest.mark.asyncio
async def test_socle_gratuit_billing_off(monkeypatch):
    """Billing OFF (RÈGLE 1) : ALL_UNLOCKED, tous les modules présents, illimité."""
    monkeypatch.setattr(es, "billing_enabled", lambda: False)
    ent = await es.resolve(FakeSession(), _bot(bot_id=42))
    assert ent.bot_id == 42
    assert ent.modules == set(MODULE_KEYS)
    assert es.ai_quota_for(ent) is None          # illimité
    for m in MODULE_KEYS:
        assert es.has_module(ent, m) is True


@pytest.mark.asyncio
async def test_socle_gratuit_bot_sans_entitlement(monkeypatch):
    """Billing ON mais bot SANS ligne (RÈGLE 2) : traité gratuit (ALL_UNLOCKED)."""
    monkeypatch.setattr(es, "billing_enabled", lambda: True)
    monkeypatch.setattr(es, "_load", _aretval(None))
    ent = await es.resolve(FakeSession(), _bot(bot_id=7))
    assert ent.modules == set(MODULE_KEYS)
    assert es.has_module(ent, MODULE_RAG) is True


# --- Module actif après souscription -------------------------------------

@pytest.mark.asyncio
async def test_module_actif_apres_souscription(monkeypatch):
    """Une ligne bot_entitlements active -> seuls ses modules passent has_module."""
    monkeypatch.setattr(es, "billing_enabled", lambda: True)
    row = Obj(bot_id=3, modules=[MODULE_RAG, MODULE_INBOX], ai_monthly_quota=1000,
              overage_mode="block", status="active")
    monkeypatch.setattr(es, "_load", _aretval(row))
    ent = await es.resolve(FakeSession(), _bot(bot_id=3))
    assert es.has_module(ent, MODULE_RAG) is True
    assert es.has_module(ent, MODULE_INBOX) is True
    assert es.has_module(ent, MODULE_AI) is False     # non souscrit
    assert es.ai_quota_for(ent) == 1000


@pytest.mark.asyncio
async def test_status_past_due_degrade_tous_modules(monkeypatch):
    """status != active -> has_module False pour TOUS les modules payants (§6)."""
    monkeypatch.setattr(es, "billing_enabled", lambda: True)
    row = Obj(bot_id=3, modules=[MODULE_RAG], ai_monthly_quota=0,
              overage_mode="block", status="past_due")
    monkeypatch.setattr(es, "_load", _aretval(row))
    ent = await es.resolve(FakeSession(), _bot(bot_id=3))
    assert es.has_module(ent, MODULE_RAG) is False


# --- BYOK non métré (RÈGLE 3) --------------------------------------------

@pytest.mark.asyncio
async def test_byok_non_metre(monkeypatch):
    """api_key_mode=byok -> byok=True, ai_quota_for None (illimité), module IA OK."""
    monkeypatch.setattr(es, "billing_enabled", lambda: True)
    row = Obj(bot_id=9, modules=[MODULE_AI], ai_monthly_quota=1000,
              overage_mode="block", status="active")
    monkeypatch.setattr(es, "_load", _aretval(row))
    ent = await es.resolve(FakeSession(), _bot(bot_id=9, api_key_mode="byok"))
    assert ent.byok is True
    assert es.ai_quota_for(ent) is None              # illimité malgré quota=1000
    assert es.has_module(ent, MODULE_AI) is True


# --- Clé canonique de scope : perso vs équipe, sans fuite croisée ---------

@pytest.mark.asyncio
async def test_cle_canonique_perso_pas_de_fuite(db: FakeSession):
    """`user:{id}` -> ce user paie. Aucune lecture d'org (pas de fuite croisée)."""
    from src.models.user import Organization
    db.seed(Organization(id=1, name="Acme", owner_user_id=99))
    assert await billing_owner_user_id("user:42", db) == 42
    # On n'a PAS résolu via l'org 1 : un bot perso ne fuit jamais vers un owner d'org.


@pytest.mark.asyncio
async def test_cle_canonique_equipe_owner(db: FakeSession):
    """`org:{id}` -> owner de l'org (un admin non-owner ne paie pas)."""
    from src.models.user import Organization
    db.seed(Organization(id=5, name="Acme", owner_user_id=77))
    assert await billing_owner_user_id("org:5", db) == 77


@pytest.mark.asyncio
async def test_cle_canonique_org_introuvable_none(db: FakeSession):
    """Org sans owner / introuvable -> None (bot non facturable, RÈGLE 2)."""
    assert await billing_owner_user_id("org:404", db) is None
    assert await billing_owner_user_id("bogus", db) is None


# --- Quota inclus puis dépassement (mode block) --------------------------

@pytest.mark.asyncio
async def test_quota_inclus_puis_depassement_sans_redis(monkeypatch):
    """Pas de Redis (REDIS_URL absent) -> fail-CLOSED via COUNT SQL durable.

    used < quota -> True (réponse comptabilisée) ; used >= quota -> False."""
    monkeypatch.setattr(qs.settings, "REDIS_URL", None, raising=False)
    monkeypatch.setattr(qs, "_get_redis", lambda: None)

    # 999 réponses déjà consommées, quota 1000 -> la 1000e passe.
    monkeypatch.setattr(qs, "_count_sql", _aretval(999))
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=1000) is True

    # 1000 déjà consommées -> dépassement, refus (mode block).
    monkeypatch.setattr(qs, "_count_sql", _aretval(1000))
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=1000) is False


@pytest.mark.asyncio
async def test_quota_zero_refuse(monkeypatch):
    """quota <= 0 (module IA absent) refuse sans toucher Redis ni SQL."""
    monkeypatch.setattr(qs, "_get_redis", lambda: None)
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=0) is False


@pytest.mark.asyncio
async def test_quota_redis_incr_borne(monkeypatch):
    """Avec Redis : INCR borne au quota, le dépassement décrémente et refuse."""
    monkeypatch.setattr(qs, "_count_sql", _aretval(0))  # source durable vide
    fake = _FakeRedis(initial=None)
    monkeypatch.setattr(qs, "_get_redis", lambda: fake)

    # 1er appel : reseed (clé absente) puis INCR -> 1, sous le quota de 2.
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=2) is True
    # 2e appel : INCR -> 2, encore dans le quota.
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=2) is True
    # 3e appel : INCR -> 3 > 2 -> décrément + refus.
    assert await qs.ai_quota_consume(FakeSession(), bot_id=1, quota=2) is False
    # Le refus n'a pas consommé de crédit : compteur reste à 2.
    key = qs._quota_key(qs.quota_period(), 1)
    assert int(fake.data[key]) == 2


# --------------------------------------------------------------------------
# Helpers locaux
# --------------------------------------------------------------------------

def _aretval(value):
    """Fabrique une coroutine async qui ignore ses args et renvoie `value`."""
    async def _inner(*a, **k):
        return value
    return _inner


class _FakeRedis:
    """Faux client redis.asyncio minimal (get/set/incr/decr/expire) en mémoire."""

    def __init__(self, initial=None):
        self.data: dict[str, int] = {}
        self._initial = initial

    async def get(self, key):
        v = self.data.get(key)
        return None if v is None else str(v)

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.data:
            return False
        self.data[key] = int(value)
        return True

    async def incr(self, key):
        self.data[key] = int(self.data.get(key, 0)) + 1
        return self.data[key]

    async def decr(self, key):
        self.data[key] = int(self.data.get(key, 0)) - 1
        return self.data[key]

    async def expire(self, key, ttl):
        return True
