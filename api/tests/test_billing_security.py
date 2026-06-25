"""Sécurité de la facturation (spec §3.6 / §5.4 / §7.3 — le plus important).

`require_billing_owner` (core/security.py) est la garde commune des routes
facturation. Matrice attendue :
- owner d'org            -> 200 (None, accès)
- admin NON-owner d'org  -> 403 (membre mais pas payeur)
- member                 -> 403 (idem : non payeur)   [même verdict 403 via l'org]
- bot perso self         -> 200
- bot perso d'un AUTRE   -> 404 (anti-énumération)
- superadmin             -> court-circuite (200)

Webhook : corps signé accepté SANS JWT ; non signé -> 400.
"""
import pytest
from fastapi import HTTPException

from conftest import FakeSession, FakeUser, Obj, sign_stripe, stripe_event, to_bytes
from src.core.security import require_billing_owner


def _team_bot(org_id=10):
    return Obj(id=1, organization_id=org_id, owner_user_id=None)


def _personal_bot(owner_id):
    return Obj(id=2, organization_id=None, owner_user_id=owner_id)


# --- Bot d'équipe ---------------------------------------------------------

@pytest.mark.asyncio
async def test_owner_org_200(db: FakeSession):
    from src.models.user import Organization
    db.seed(Organization(id=10, name="Acme", owner_user_id=1))
    user = FakeUser(id=1)
    assert await require_billing_owner(_team_bot(), user, db) is None  # accès


@pytest.mark.asyncio
async def test_admin_non_owner_403(db: FakeSession):
    """Un admin (membre) qui n'est PAS owner de l'org -> 403 (ne paie pas)."""
    from src.models.user import Organization
    db.seed(Organization(id=10, name="Acme", owner_user_id=1))  # owner = user 1
    user = FakeUser(id=2)  # autre user (admin non-owner)
    with pytest.raises(HTTPException) as ei:
        await require_billing_owner(_team_bot(), user, db)
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_member_403(db: FakeSession):
    """Un member non-owner -> 403 (même chemin que l'admin non-owner)."""
    from src.models.user import Organization
    db.seed(Organization(id=10, name="Acme", owner_user_id=99))
    user = FakeUser(id=3)
    with pytest.raises(HTTPException) as ei:
        await require_billing_owner(_team_bot(), user, db)
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_org_introuvable_404(db: FakeSession):
    """Org absente (legacy) -> 404 anti-énumération."""
    user = FakeUser(id=1)
    with pytest.raises(HTTPException) as ei:
        await require_billing_owner(_team_bot(org_id=404), user, db)
    assert ei.value.status_code == 404


# --- Bot perso ------------------------------------------------------------

@pytest.mark.asyncio
async def test_perso_self_200(db: FakeSession):
    user = FakeUser(id=5)
    assert await require_billing_owner(_personal_bot(owner_id=5), user, db) is None


@pytest.mark.asyncio
async def test_perso_autre_404(db: FakeSession):
    """Bot perso d'un AUTRE user -> 404 (anti-énumération, pas 403)."""
    user = FakeUser(id=5)
    with pytest.raises(HTTPException) as ei:
        await require_billing_owner(_personal_bot(owner_id=6), user, db)
    assert ei.value.status_code == 404


# --- Superadmin -----------------------------------------------------------

@pytest.mark.asyncio
async def test_superadmin_court_circuite(db: FakeSession):
    """superadmin : accès total, même sans être owner ni membre."""
    user = FakeUser(id=99, is_superadmin=True)
    assert await require_billing_owner(_team_bot(), user, db) is None
    assert await require_billing_owner(_personal_bot(owner_id=1234), user, db) is None


# --- Endpoint GET /api/bots/{id}/entitlement : owner vs autre -------------

@pytest.mark.asyncio
async def test_endpoint_entitlement_perso_autre_404(client, overrides, db, current_user):
    """Un user qui n'est pas owner du bot perso -> 404 (require_billing_owner)."""
    from src.models.bot import Bot
    current_user.id = 5
    db.seed(Bot(id=2, owner_user_id=6, organization_id=None, name="X"))
    async with client as c:
        resp = await c.get("/api/bots/2/entitlement")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_endpoint_entitlement_admin_non_owner_403(client, overrides, db, current_user):
    """Bot d'équipe, user membre mais pas owner de l'org -> 403."""
    from src.models.bot import Bot
    from src.models.user import Organization
    current_user.id = 2
    db.seed(Organization(id=10, name="Acme", owner_user_id=1))
    db.seed(Bot(id=1, owner_user_id=None, organization_id=10, name="Team"))
    async with client as c:
        resp = await c.get("/api/bots/1/entitlement")
    assert resp.status_code == 403


# --- Webhook : signé sans JWT accepté / non signé refusé ------------------

@pytest.mark.asyncio
async def test_webhook_non_signe_400(client, overrides, billing_on):
    """Aucun header Stripe-Signature -> 400 (jamais de no-op silencieux)."""
    async with client as c:
        resp = await c.post("/api/billing/webhook", content=to_bytes(
            stripe_event("customer.subscription.updated")))
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_webhook_signe_sans_jwt_accepte(client, overrides, db, billing_on,
                                               monkeypatch):
    """Corps signé HMAC, AUCUN Authorization -> accepté (200).

    Le webhook ne passe PAS par get_current_user : la signature fait foi."""
    from src.routers import billing as billing_router
    # On neutralise la projection (testée ailleurs) : ici on valide juste que la
    # signature seule ouvre l'accès, sans JWT.
    async def _noop(db, event):
        return None
    monkeypatch.setattr(billing_router, "apply_subscription_event", _noop)
    async def _noop_mirror(db, event):
        return None
    monkeypatch.setattr(billing_router, "_sync_subscription_mirror", _noop_mirror)

    body = to_bytes(stripe_event("customer.subscription.updated"))
    sig = sign_stripe(body, "whsec_test_xxx")
    async with client as c:
        resp = await c.post("/api/billing/webhook", content=body,
                            headers={"Stripe-Signature": sig})
    assert resp.status_code == 200
    assert resp.json().get("received") is True
