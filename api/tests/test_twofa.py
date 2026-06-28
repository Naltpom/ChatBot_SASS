"""PR-12 — 2FA : TOTP, codes de secours (usage unique), challenge de login, WebAuthn.

La 2FA est le gate d'authentification le plus sensible et n'était couverte par
AUCUN test. Ce module pose la couverture sur les 5 axes du plan :

1. TOTP          : génération du secret + dérivation/vérification d'un code, et la
                   FENÊTRE de tolérance réelle du service (valid_window=1 -> ±1
                   pas de 30 s ; 2+ pas en arrière = refusé). Pur unitaire.
2. Enrôlement    : /totp/setup -> /totp/enable active `totp_enabled` (DB RÉELLE) ;
                   un code invalide laisse la 2FA inactive.
3. Recovery codes: USAGE UNIQUE prouvé sur DB RÉELLE (le code est CONSOMMÉ ; le
                   rejouer échoue). FakeSession masquerait la consommation
                   (twofa_recovery muté puis committé -> à relire en base).
4. Challenge     : un login mot de passe d'un compte 2FA renvoie le *challenge*
                   (scope twofa, AUCUN cookie de session) ; le compléter avec un
                   TOTP/recovery valide POSE le cookie ; un code faux -> 401.
5. WebAuthn      : options d'enrôlement/d'assertion (challenge émis + state
                   persisté), parsing du credential id, et REJET d'une assertion
                   malformée. L'assertion COMPLÈTE (verify_registration /
                   verify_authentication) fait de la vraie crypto d'attestation/
                   signature : NON forgeable sans authenticator matériel -> NON
                   testée ici (documenté, pas de faux test).

DB réelle (PR-10, real_db.py) : les axes 2/3/4/5-persistance exercent une vraie
persistance (totp_enabled committé, twofa_recovery consommé, challenge WebAuthn
stocké) et tournent sur `pg_session` (marqueur `real_db`, skip gracieux si la DB
est injoignable). `pg_session` est UNIQUE et partagée seed/endpoint : on relit la
ligne APRÈS l'appel pour asserter l'état persistant (cf. test_oauth_flow.py).
Les axes purement algorithmiques (TOTP, parsing) restent sans DB.

Le « challenge ne pose pas de cookie » est déjà couvert par test_auth_cookie.py
(PR-04) sur FakeSession sans secret : ici on couvre l'angle NOUVEAU et complémentaire
= le round-trip COMPLET (login -> challenge -> complétion TOTP/recovery -> cookie)
sur DB réelle, et le rejet d'une complétion invalide.
"""
import json
import time
from types import SimpleNamespace

import httpx
import pyotp
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers import bytes_to_base64url

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    AUTH_COOKIE_NAME,
    create_twofa_challenge_token,
    get_current_user,
    hash_password,
)
from src.main import app
from src.models.user import User, WebAuthnCredential
from src.services import twofa_service as tf
from src.services.crypto import encrypt_secret


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _session_cookie(resp) -> str | None:
    """En-tête Set-Cookie du cookie de session dashboard (ou None)."""
    for raw in resp.headers.get_list("set-cookie"):
        if raw.startswith(f"{AUTH_COOKIE_NAME}="):
            return raw
    return None


class _App:
    """Branche get_db -> session réelle (et, optionnellement, get_current_user ->
    `user` réel pour les endpoints d'enrôlement authentifiés). Fournit un client
    httpx ASGI ; restaure les overrides en sortie. Calque test_oauth_flow._RealApp."""

    def __init__(self, session: AsyncSession, user: User | None = None):
        self._session = session
        self._user = user

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        if self._user is not None:
            async def _get_user():
                return self._user

            app.dependency_overrides[get_current_user] = _get_user
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


_PW = "Sup3rSecret!42"


async def _seed_user(session: AsyncSession, *, email: str, password: str = _PW,
                     totp_secret: str | None = None, totp_enabled: bool = False,
                     recovery: list | None = None) -> User:
    """Crée un User local (mdp hashé via le repo) avec un état 2FA paramétrable."""
    u = User(email=email, name="Test 2FA", hashed_password=hash_password(password),
             is_active=True, auth_source="local", totp_enabled=totp_enabled)
    if totp_secret is not None:
        u.totp_secret = encrypt_secret(totp_secret)  # chiffré comme en prod
    if recovery is not None:
        u.twofa_recovery = recovery
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


# ==========================================================================
# Axe 1 — TOTP : génération, vérification, FENÊTRE (pur unitaire)
# ==========================================================================

def test_totp_secret_generation_and_current_code_verifies():
    """Un secret fraîchement généré + le code TOTP courant (même lib pyotp que le
    service) passe la vérification ; un code vide ou un secret vide -> refus."""
    secret = tf.new_totp_secret()
    assert isinstance(secret, str) and len(secret) >= 16  # base32
    code = pyotp.TOTP(secret).now()
    assert tf.verify_totp(secret, code) is True
    # Garde-fous : entrées vides systématiquement refusées (pas d'auth « gratuite »).
    assert tf.verify_totp(secret, "") is False
    assert tf.verify_totp("", code) is False


def test_totp_wrong_code_rejected():
    """Un code qui n'est pas le TOTP courant (ni dans la fenêtre) est refusé."""
    secret = tf.new_totp_secret()
    current = pyotp.TOTP(secret).now()
    wrong = "000000" if current != "000000" else "123456"
    assert tf.verify_totp(secret, wrong) is False


def test_totp_window_tolerance_contract():
    """Contrat RÉEL du service (valid_window=1) : le code du pas PRÉCÉDENT (−30 s)
    est toléré (drift d'horloge), mais un code de 3 pas en arrière (−90 s) est
    refusé. Ancre la fenêtre exacte plutôt que de l'inventer."""
    secret = tf.new_totp_secret()
    totp = pyotp.TOTP(secret)
    now = time.time()
    # Pas précédent : exactement −1 step (les bornes de step sont des multiples de
    # 30 s d'epoch) -> dans la fenêtre ±1 -> accepté.
    assert tf.verify_totp(secret, totp.at(now - 30)) is True
    # 3 pas en arrière : hors fenêtre quelle que soit la position dans le step -> refusé.
    assert tf.verify_totp(secret, totp.at(now - 90)) is False


# ==========================================================================
# Axe 2 — Enrôlement TOTP (DB RÉELLE)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_totp_enroll_setup_then_enable_activates(pg_session: AsyncSession):
    """/totp/setup pose un secret chiffré « en attente » ; /totp/enable avec un
    1er code valide active `totp_enabled` (committé en base) et renvoie 10 codes
    de secours. On relit la ligne pour prouver la persistance."""
    user = await _seed_user(pg_session, email="enroll@test.dev")
    async with _App(pg_session, user=user) as c:
        r_setup = await c.post("/api/auth/2fa/totp/setup")
        assert r_setup.status_code == 200, r_setup.text
        secret = r_setup.json()["secret"]
        assert secret and r_setup.json()["otpauth_uri"].startswith("otpauth://")

        code = pyotp.TOTP(secret).now()
        r_enable = await c.post("/api/auth/2fa/totp/enable", json={"code": code})
        assert r_enable.status_code == 200, r_enable.text
        codes = r_enable.json()["recovery_codes"]
        assert len(codes) == tf.RECOVERY_CODE_COUNT == 10

    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert fresh.totp_enabled is True
    assert fresh.totp_secret is not None
    assert len(fresh.twofa_recovery) == 10  # hashes persistés


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_totp_enable_with_invalid_code_does_not_activate(pg_session: AsyncSession):
    """Un code FAUX à /totp/enable -> 400, et la 2FA reste INACTIVE (totp_enabled
    toujours False, aucun code de secours posé)."""
    user = await _seed_user(pg_session, email="enroll-bad@test.dev")
    async with _App(pg_session, user=user) as c:
        r_setup = await c.post("/api/auth/2fa/totp/setup")
        secret = r_setup.json()["secret"]
        valid = pyotp.TOTP(secret).now()
        wrong = "000000" if valid != "000000" else "123456"
        r_enable = await c.post("/api/auth/2fa/totp/enable", json={"code": wrong})
        assert r_enable.status_code == 400, r_enable.text

    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert fresh.totp_enabled is False
    assert fresh.twofa_recovery in (None, [])


# ==========================================================================
# Axe 3 — Codes de secours : USAGE UNIQUE (DB RÉELLE) — cœur du module
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_recovery_code_single_use_on_real_db(pg_session: AsyncSession):
    """Un code de secours au login réussit ET est CONSOMMÉ : le rejouer échoue.
    Prouvé sur DB réelle (la consommation = twofa_recovery muté+committé n'est
    visible qu'en relisant la ligne ; FakeSession la masquerait)."""
    plain, hashed = tf.new_recovery_codes()
    assert len(plain) == 10 and len(hashed) == 10
    user = await _seed_user(pg_session, email="recovery@test.dev",
                            totp_enabled=True, recovery=list(hashed))
    challenge = create_twofa_challenge_token(user.id)

    async with _App(pg_session) as c:
        # 1er usage du code[0] -> succès + session ouverte (cookie posé).
        r1 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": challenge, "code": plain[0]})
        assert r1.status_code == 200, r1.text
        assert _session_cookie(r1) is not None  # 2e facteur validé -> cookie

        # Le code est CONSOMMÉ en base : 9 codes restants, le code[0] absent.
        fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
        await pg_session.refresh(fresh)
        assert len(fresh.twofa_recovery) == 9
        assert not tf.consume_recovery_code(fresh.twofa_recovery, plain[0])[0]

        # 2e tentative avec le MÊME code -> 401 (usage strictement unique).
        r2 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": challenge, "code": plain[0]})
        assert r2.status_code == 401, r2.text

        # Un AUTRE code encore valide passe (preuve que seul le code[0] a brûlé).
        r3 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": challenge, "code": plain[1]})
        assert r3.status_code == 200, r3.text


# ==========================================================================
# Axe 4 — Challenge au login (DB RÉELLE) : round-trip complet
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_2fa_challenge_then_totp_completion_sets_session(
        pg_session: AsyncSession, monkeypatch):
    """Round-trip complet (angle NOUVEAU vs test_auth_cookie) :
    1) POST /login (mdp) d'un compte TOTP -> challenge (scope twofa), AUCUN cookie ;
    2) POST /2fa/login/totp (code valide) -> session ouverte (cookie posé) ;
    3) un code TOTP faux -> 401."""
    # Auth locale (sinon authenticate() tape l'intranet en premier).
    monkeypatch.setattr(settings, "INTRANET_AUTH_ENABLED", False, raising=False)
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="login2fa@test.dev",
                            totp_secret=secret, totp_enabled=True)

    async with _App(pg_session) as c:
        # 1) Login mot de passe -> challenge, pas de cookie, pas de token.
        r_login = await c.post("/api/auth/login",
                               json={"email": "login2fa@test.dev", "password": _PW})
        assert r_login.status_code == 200, r_login.text
        body = r_login.json()
        assert body.get("twofa_required") is True
        assert body.get("methods", {}).get("totp") is True
        assert "access_token" not in body
        assert _session_cookie(r_login) is None  # pas de session avant 2e facteur
        challenge = body["challenge"]

        # 2) Mauvais code -> 401, toujours aucune session.
        r_bad = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": challenge, "code": "000000"})
        assert r_bad.status_code == 401, r_bad.text
        assert _session_cookie(r_bad) is None

        # 3) Bon code TOTP -> session ouverte (cookie httpOnly posé).
        code = pyotp.TOTP(secret).now()
        r_ok = await c.post("/api/auth/2fa/login/totp",
                            json={"challenge": challenge, "code": code})
        assert r_ok.status_code == 200, r_ok.text
        raw = _session_cookie(r_ok)
        assert raw is not None and "httponly" in raw.lower()
        assert r_ok.json()["email"] == "login2fa@test.dev"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_rejects_forged_challenge(pg_session: AsyncSession):
    """Un challenge pour un user 2FA + code faux -> 401 (pas de session). Garantit
    qu'un challenge seul (1er facteur) n'ouvre jamais de session sans 2e facteur."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="login2fa2@test.dev",
                            totp_secret=secret, totp_enabled=True)
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session) as c:
        r = await c.post("/api/auth/2fa/login/totp",
                         json={"challenge": challenge, "code": "111111"})
        assert r.status_code == 401, r.text
        assert _session_cookie(r) is None


# ==========================================================================
# Axe 5 — WebAuthn : options + persistance + parsing + rejet malformé
# ==========================================================================
# NOTE : la vérification COMPLÈTE d'une attestation (verify_registration) ou d'une
# assertion (verify_authentication) repose sur de la VRAIE crypto (signature de
# l'authenticator, clé COSE, anti-rejeu sign_count) : impossible à forger sans
# matériel/clé. On couvre donc proprement ce qui l'est : émission/persistance du
# challenge, parsing du credential id, et REJET d'une assertion malformée.

def test_webauthn_registration_options_emit_challenge():
    """Pur unitaire : registration_options émet des options JSON valides + un
    challenge base64url (à présenter à navigator.credentials.create)."""
    u = SimpleNamespace(id=1, email="pk@test.dev", name="PK User")
    options_json, challenge = tf.registration_options(u, [])
    assert challenge  # base64url non vide
    data = json.loads(options_json)
    assert data["challenge"]
    assert data["rp"]["id"] == settings.webauthn_rp_id
    assert data["user"]["name"] == "pk@test.dev"


def test_credential_id_from_assertion_parses_id():
    """Extraction du credential id d'une assertion brute : `id` prioritaire, repli
    sur `rawId` (sert à retrouver la passkey avant vérification)."""
    assert tf.credential_id_from_assertion(json.dumps({"id": "abc", "rawId": "xyz"})) == "abc"
    assert tf.credential_id_from_assertion(json.dumps({"rawId": "xyz"})) == "xyz"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_webauthn_register_begin_persists_challenge(pg_session: AsyncSession):
    """/webauthn/register/begin émet des options + PERSISTE le challenge de
    cérémonie (webauthn_challenge + horodatage) sur l'user — relu en base."""
    user = await _seed_user(pg_session, email="pkbegin@test.dev")
    async with _App(pg_session, user=user) as c:
        r = await c.post("/api/auth/2fa/webauthn/register/begin")
        assert r.status_code == 200, r.text
        opts = json.loads(r.json()["options"])
        assert opts["challenge"]

    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert fresh.webauthn_challenge  # state de cérémonie persisté
    assert fresh.webauthn_challenge_at is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_webauthn_register_complete_rejects_malformed(pg_session: AsyncSession):
    """Après un begin (challenge frais), une attestation MALFORMÉE est rejetée
    (400) : verify_registration lève, l'endpoint répond « passkey invalide » et
    n'enregistre aucune credential."""
    user = await _seed_user(pg_session, email="pkbad@test.dev")
    async with _App(pg_session, user=user) as c:
        await c.post("/api/auth/2fa/webauthn/register/begin")  # pose un challenge frais
        r = await c.post("/api/auth/2fa/webauthn/register/complete",
                         json={"name": "Clé", "credential": {"garbage": True}})
        assert r.status_code == 400, r.text

    n = len((await pg_session.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
    )).scalars().all())
    assert n == 0


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_webauthn_login_begin_requires_a_passkey(pg_session: AsyncSession):
    """/login/webauthn/begin sans passkey enregistrée -> 400 ; AVEC une passkey ->
    200 + challenge d'assertion persisté (couvre authentication_options + state)."""
    user = await _seed_user(pg_session, email="pklogin@test.dev", totp_enabled=True)
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session) as c:
        r_none = await c.post("/api/auth/2fa/login/webauthn/begin",
                              json={"challenge": challenge})
        assert r_none.status_code == 400, r_none.text

    # Ajoute une passkey (credential_id base64url valide) puis re-tente.
    pg_session.add(WebAuthnCredential(
        user_id=user.id, credential_id=bytes_to_base64url(b"\x01\x02\x03\x04"),
        public_key=bytes_to_base64url(b"\x05\x06"), sign_count=0, name="Clé test"))
    await pg_session.commit()

    async with _App(pg_session) as c:
        r_ok = await c.post("/api/auth/2fa/login/webauthn/begin",
                            json={"challenge": challenge})
        assert r_ok.status_code == 200, r_ok.text
        assert json.loads(r_ok.json()["options"])["challenge"]

    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert fresh.webauthn_challenge  # challenge d'assertion persisté
