"""Point d'écriture UNIQUE du statut d'éligibilité (set_bot_status) + dérivé
is_usable + journal bot_status_history.

Couvre les invariants critiques du modèle unifié :
- genèse (1re ligne d'historique quand la ligne entitlement est créée) ;
- transition journalisée UNIQUEMENT si le statut change ;
- garde STICKY : 'suspended' ne se lève QUE par 'staff' (un acteur stripe ne
  débloque pas, même avec un plan) ;
- plan=None ne VIDE PAS les modules (transition de statut seule) ;
- mapping source (staff -> staff, sinon stripe) ;
- is_usable : active / essai en cours = True ; suspended / past_due / inactive /
  canceled / essai expiré = False.

DB en mémoire (FakeSession) : set_bot_status n'utilise que select(...).where(...)
+ db.add, supportés par le faux session (le .with_for_update() est transparent).
"""
from datetime import timedelta

import pytest

from fastapi import HTTPException

from conftest import FakeSession, Obj
from src.core.constants import MODULE_AI, MODULE_RAG
from src.core.time import utcnow
from src.models.billing import BotEntitlement, BotStatusHistory
from src.routers import widget_helpers as wh
from src.services import entitlement_service as es


def _history(db: FakeSession) -> list[BotStatusHistory]:
    return db.rows(BotStatusHistory)


def _seed_ent(db: FakeSession, *, bot_id, status, modules=None, quota=None):
    db.seed(BotEntitlement(
        bot_id=bot_id, status=status,
        modules=list(modules or []), ai_monthly_quota=quota,
    ))


# --- is_usable : le dérivé unique d'éligibilité --------------------------

def _ent(status, trial_expired=False):
    return es.Entitlement(bot_id=1, status=status, trial_expired=trial_expired)


def test_is_usable_matrix():
    assert es.is_usable(_ent("active")) is True
    assert es.is_usable(_ent("trialing", trial_expired=False)) is True
    assert es.is_usable(_ent("trialing", trial_expired=True)) is False
    assert es.is_usable(_ent("suspended")) is False
    assert es.is_usable(_ent("past_due")) is False
    assert es.is_usable(_ent("inactive")) is False
    assert es.is_usable(_ent("canceled")) is False


def test_has_module_uses_is_usable():
    """has_module = is_usable ET module présent (suspended gate tout)."""
    usable = es.Entitlement(bot_id=1, status="active", modules={MODULE_RAG})
    blocked = es.Entitlement(bot_id=1, status="suspended", modules={MODULE_RAG})
    assert es.has_module(usable, MODULE_RAG) is True
    assert es.has_module(usable, MODULE_AI) is False
    assert es.has_module(blocked, MODULE_RAG) is False


# --- set_bot_status : genèse + journalisation ----------------------------

@pytest.mark.asyncio
async def test_genese_cree_ligne_et_historique():
    db = FakeSession()
    row = await es.set_bot_status(
        db, 10, new_status="inactive", actor_kind="system", reason="bot_created",
    )
    assert row.status == "inactive"
    assert row.source == "stripe"          # system -> stripe (compat)
    hist = _history(db)
    assert len(hist) == 1
    assert (hist[0].old_status, hist[0].new_status) == (None, "inactive")
    assert hist[0].actor_kind == "system"
    assert hist[0].reason == "bot_created"


@pytest.mark.asyncio
async def test_transition_journalisee_si_changement():
    db = FakeSession()
    _seed_ent(db, bot_id=10, status="active", modules=[MODULE_RAG])
    await es.set_bot_status(db, 10, new_status="inactive", actor_kind="stripe",
                            stripe_event_id="evt_X", reason="subscription.deleted")
    hist = _history(db)
    assert len(hist) == 1
    assert (hist[0].old_status, hist[0].new_status) == ("active", "inactive")
    assert hist[0].stripe_event_id == "evt_X"


@pytest.mark.asyncio
async def test_pas_de_ligne_si_statut_inchange():
    db = FakeSession()
    _seed_ent(db, bot_id=10, status="active", modules=[MODULE_RAG])
    await es.set_bot_status(
        db, 10, new_status="active", actor_kind="stripe",
        plan=es.PlanState(modules=[MODULE_RAG, MODULE_AI], ai_monthly_quota=1000),
    )
    assert _history(db) == []              # aucun changement de statut
    row = db.rows(BotEntitlement)[0]
    assert set(row.modules) == {MODULE_RAG, MODULE_AI}   # moteur mis à jour
    assert row.ai_monthly_quota == 1000


# --- Garde STICKY : suspended ne se lève que par staff -------------------

@pytest.mark.asyncio
async def test_sticky_stripe_ne_debloque_pas():
    db = FakeSession()
    _seed_ent(db, bot_id=10, status="suspended", modules=[])
    # Un paiement Stripe (active) avec plan : le statut RESTE suspended, mais le
    # moteur est rafraîchi (modules synchro pour un futur déblocage propre).
    await es.set_bot_status(
        db, 10, new_status="active", actor_kind="stripe", stripe_event_id="evt_pay",
        plan=es.PlanState(modules=[MODULE_RAG], ai_monthly_quota=500),
    )
    row = db.rows(BotEntitlement)[0]
    assert row.status == "suspended"        # collant
    assert set(row.modules) == {MODULE_RAG}  # moteur rafraîchi quand même
    assert _history(db) == []               # aucune transition de statut journalisée


@pytest.mark.asyncio
async def test_sticky_staff_peut_debloquer():
    db = FakeSession()
    _seed_ent(db, bot_id=10, status="suspended", modules=[])
    await es.set_bot_status(db, 10, new_status="inactive", actor_kind="staff",
                            actor_user_id=7, reason="unblock")
    row = db.rows(BotEntitlement)[0]
    assert row.status == "inactive"
    assert row.source == "staff"
    hist = _history(db)
    assert len(hist) == 1
    assert (hist[0].old_status, hist[0].new_status) == ("suspended", "inactive")
    assert hist[0].actor_user_id == 7


# --- plan=None ne vide jamais les modules --------------------------------

@pytest.mark.asyncio
async def test_plan_none_ne_vide_pas_les_modules():
    db = FakeSession()
    _seed_ent(db, bot_id=10, status="active", modules=[MODULE_RAG, MODULE_AI], quota=1000)
    await es.set_bot_status(db, 10, new_status="past_due", actor_kind="stripe",
                            stripe_event_id="evt_pd")   # plan non fourni
    row = db.rows(BotEntitlement)[0]
    assert row.status == "past_due"
    assert set(row.modules) == {MODULE_RAG, MODULE_AI}   # PRÉSERVÉS
    assert row.ai_monthly_quota == 1000


# --- Essai en cours reste utilisable (régression LIVE évitée) ------------

def test_is_usable_essai_en_cours_vs_expire():
    en_cours = es.Entitlement(bot_id=1, status="trialing",
                              trial_end=utcnow() + timedelta(days=2), trial_expired=False)
    expire = es.Entitlement(bot_id=1, status="trialing",
                            trial_end=utcnow() - timedelta(days=1), trial_expired=True)
    assert es.is_usable(en_cours) is True
    assert es.is_usable(expire) is False


# --- Widget cut : suspended coupe le widget (404), pas les autres états ---

@pytest.mark.asyncio
async def test_widget_coupe_si_suspended():
    db = FakeSession()
    db.seed(BotEntitlement(bot_id=5, status="suspended", modules=[MODULE_RAG]))
    bot = Obj(id=5, is_active=True, organization_id=None)
    with pytest.raises(HTTPException) as ei:
        await wh._assert_bot_servable(db, bot)
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_widget_sert_si_past_due_ou_sans_ligne():
    db = FakeSession()
    db.seed(BotEntitlement(bot_id=6, status="past_due", modules=[]))
    bot_pd = Obj(id=6, is_active=True, organization_id=None)
    assert await wh._assert_bot_servable(db, bot_pd) is bot_pd   # past_due servi
    bot_free = Obj(id=7, is_active=True, organization_id=None)
    assert await wh._assert_bot_servable(db, bot_free) is bot_free  # pas de ligne -> servi
