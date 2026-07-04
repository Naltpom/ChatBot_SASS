"""Vérification souple de l'email + réinitialisation de mot de passe.

Couvre les 4 endpoints ajoutés à routers/auth.py, dans le gabarit des tests
billing (FakeSession en mémoire, dépendances surchargées) :

- POST /api/auth/verify-email/request   (authentifié, (re)envoi)
- POST /api/auth/verify-email/confirm   (token -> email_verified, idempotent)
- POST /api/auth/password/forgot        (réponse neutre, zéro énumération)
- POST /api/auth/password/reset         (token lié au hash courant = usage unique)

Aucun SMTP : send_email part en fire-and-forget et log « SMTP non configuré »
(SMTP_HOST absent en test) -> aucun envoi réel, aucune exception.
"""
import pytest

from src.core.security import (
    account_fingerprint,
    create_password_reset_token,
    create_verify_email_token,
)
from src.models.user import User


def _user(**kw) -> User:
    base = dict(id=1, email="alice@test.dev", hashed_password="hash-v1",
                name="Alice", email_verified=False, auth_source="local", is_active=True)
    base.update(kw)
    return User(**base)


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    """Neutralise l'anti-bruteforce par IP : la suite enchaîne >10 appels depuis
    la même IP de test, le limiteur (10/15 min) trancherait sinon en 429."""
    async def _ok(_key):
        return True
    monkeypatch.setattr("src.routers.auth.auth_limiter.check", _ok)


# --------------------------- verify-email/confirm ---------------------------

@pytest.mark.asyncio
async def test_confirm_ok(client, overrides, db):
    user = _user(email_verified=False)
    db.seed(user)
    token = create_verify_email_token(user.id, user.email)
    async with client as c:
        resp = await c.post("/api/auth/verify-email/confirm", json={"token": token})
    assert resp.status_code == 200
    assert resp.json() == {"verified": True}
    assert user.email_verified is True


@pytest.mark.asyncio
async def test_confirm_idempotent_already_verified(client, overrides, db):
    user = _user(email_verified=True)
    db.seed(user)
    token = create_verify_email_token(user.id, user.email)
    async with client as c:
        resp = await c.post("/api/auth/verify-email/confirm", json={"token": token})
    assert resp.status_code == 200
    assert resp.json() == {"verified": True}


@pytest.mark.asyncio
async def test_confirm_invalid_token(client, overrides, db):
    db.seed(_user())
    async with client as c:
        resp = await c.post("/api/auth/verify-email/confirm", json={"token": "not-a-jwt"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_confirm_rejected_when_email_changed(client, overrides, db):
    # Token émis pour l'ancienne adresse ; l'email a changé depuis -> 401.
    user = _user(email="new@test.dev", email_verified=False)
    db.seed(user)
    token = create_verify_email_token(user.id, "old@test.dev")
    async with client as c:
        resp = await c.post("/api/auth/verify-email/confirm", json={"token": token})
    assert resp.status_code == 401
    assert user.email_verified is False


# --------------------------- verify-email/request ---------------------------

@pytest.mark.asyncio
async def test_request_authenticated_ok(client, overrides, current_user):
    current_user.email = "alice@test.dev"
    current_user.email_verified = False
    async with client as c:
        resp = await c.post("/api/auth/verify-email/request")
    assert resp.status_code == 200
    assert resp.json() == {"sent": True}


@pytest.mark.asyncio
async def test_request_already_verified_noop(client, overrides, current_user):
    current_user.email = "alice@test.dev"
    current_user.email_verified = True
    async with client as c:
        resp = await c.post("/api/auth/verify-email/request")
    assert resp.status_code == 200
    assert resp.json() == {"sent": True}


# ------------------------------ password/forgot -----------------------------

@pytest.mark.asyncio
async def test_forgot_no_enumeration(client, overrides, db):
    # Compte existant.
    db.seed(_user(email="known@test.dev"))
    async with client as c:
        existing = await c.post("/api/auth/password/forgot", json={"email": "known@test.dev"})
        missing = await c.post("/api/auth/password/forgot", json={"email": "ghost@test.dev"})
    assert existing.status_code == 200
    assert missing.status_code == 200
    # Réponse STRICTEMENT identique (corps + statut) que le compte existe ou non.
    assert existing.json() == missing.json()


# ------------------------------ password/reset ------------------------------

@pytest.mark.asyncio
async def test_reset_ok_changes_password(client, overrides, db):
    user = _user(hashed_password="hash-v1")
    db.seed(user)
    token = create_password_reset_token(user.id, user.hashed_password)
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": token, "new_password": "brandnewpwd"})
    assert resp.status_code == 200
    assert resp.json() == {"changed": True}
    assert user.hashed_password != "hash-v1"  # ré-haché (bcrypt)


@pytest.mark.asyncio
async def test_reset_invalid_token(client, overrides, db):
    db.seed(_user())
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": "not-a-jwt", "new_password": "brandnewpwd"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reset_token_single_use_after_change(client, overrides, db):
    # Token lié au hash courant : si le mot de passe a déjà changé, il est cassé.
    user = _user(hashed_password="hash-v1")
    db.seed(user)
    token = create_password_reset_token(user.id, "hash-v1")
    user.hashed_password = "hash-v2"  # mot de passe déjà modifié entre-temps
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": token, "new_password": "brandnewpwd"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_reset_password_too_short(client, overrides, db):
    user = _user(hashed_password="hash-v1")
    db.seed(user)
    token = create_password_reset_token(user.id, user.hashed_password)
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": token, "new_password": "short"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reset_rejected_when_inactive(client, overrides, db):
    # Compte désactivé entre l'émission du lien et son usage -> 401 (le lien ne
    # doit pas survivre à la désactivation, même dans sa fenêtre de validité).
    user = _user(hashed_password="hash-v1", is_active=False)
    db.seed(user)
    token = create_password_reset_token(user.id, user.hashed_password)
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": token, "new_password": "brandnewpwd"})
    assert resp.status_code == 401
    assert user.hashed_password == "hash-v1"  # inchangé


@pytest.mark.asyncio
async def test_reset_rejected_when_not_local(client, overrides, db):
    # Compte SSO (Google) : pas de reset du mot de passe local -> 401.
    user = _user(hashed_password="hash-v1", auth_source="google")
    db.seed(user)
    token = create_password_reset_token(user.id, user.hashed_password)
    async with client as c:
        resp = await c.post("/api/auth/password/reset",
                            json={"token": token, "new_password": "brandnewpwd"})
    assert resp.status_code == 401
    assert user.hashed_password == "hash-v1"  # inchangé


def test_fingerprint_changes_with_value():
    """L'empreinte change si la valeur liée change (email / hash) : c'est ce qui
    casse le lien à usage unique."""
    assert account_fingerprint("a@x.dev") != account_fingerprint("b@x.dev")
    assert account_fingerprint("hash-v1") != account_fingerprint("hash-v2")
