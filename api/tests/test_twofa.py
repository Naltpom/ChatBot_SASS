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
import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pyotp
import pytest
from fastapi import HTTPException
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
from src.core.time import utcnow
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
    httpx ASGI ; restaure les overrides en sortie. Calque test_oauth_flow._RealApp.

    `ip` fixe l'adresse cliente vue côté serveur (`request.client.host`) — utile
    pour exercer le rate-limit 2FA porté par (user + IP)."""

    def __init__(self, session: AsyncSession, user: User | None = None,
                 ip: str | None = None):
        self._session = session
        self._user = user
        self._ip = ip

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        if self._user is not None:
            async def _get_user():
                return self._user

            app.dependency_overrides[get_current_user] = _get_user
        transport = (
            httpx.ASGITransport(app=app, client=(self._ip, 12345))
            if self._ip is not None
            else httpx.ASGITransport(app=app)
        )
        self._client = httpx.AsyncClient(transport=transport, base_url="http://test")
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


@pytest.fixture(autouse=True)
def _twofa_local_limits(monkeypatch):
    """Limiteurs/stores 2FA en backend MÉMOIRE déterministe, intégralement vidés
    avant ET après chaque test.

    `REDIS_URL=None` force le repli mémoire (pas de dépendance à un Redis : le job
    CI `pytest` n'en a pas, comme la CI). Le reset est GÉNÉRIQUE : on parcourt tous
    les objets du module rate_limit (RateLimiter throttle par-IP, FailureCounter cap
    par-challenge, SingleUseTokens anti-rejeu, etc.) et on remet à zéro leur structure
    mémoire interne. Indispensable car les tests réutilisent les mêmes user_id
    (TRUNCATE RESTART IDENTITY) et le throttle par-IP est porté par {user_id}:{ip} :
    sans reset complet, un compteur fuiterait d'un test à l'autre selon l'ordre
    d'exécution -> faux 429."""
    from src.services import rate_limit as rl

    monkeypatch.setattr(settings, "REDIS_URL", None, raising=False)

    def _clear():
        for obj in vars(rl).values():
            mem = getattr(obj, "_memory", None)
            if mem is None:
                continue
            if hasattr(mem, "_events"):   # RateLimiter (_MemoryWindow)
                mem._events.clear()
            if hasattr(mem, "_seen"):     # SingleUseTokens (_MemoryNonces)
                mem._seen.clear()
            if hasattr(mem, "_counts"):   # FailureCounter (_MemoryCounter)
                mem._counts.clear()

    _clear()
    yield
    _clear()


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
    visible qu'en relisant la ligne ; FakeSession la masquerait).

    NB : le challenge 2FA étant désormais single-use (anti-rejeu), chaque login
    utilise un challenge FRAIS — on isole ainsi la consommation du CODE de secours
    de celle du challenge (prouvée séparément ci-dessous)."""
    plain, hashed = tf.new_recovery_codes()
    assert len(plain) == 10 and len(hashed) == 10
    user = await _seed_user(pg_session, email="recovery@test.dev",
                            totp_enabled=True, recovery=list(hashed))

    async with _App(pg_session) as c:
        # 1er usage du code[0] -> succès + session ouverte (cookie posé).
        r1 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": create_twofa_challenge_token(user.id),
                                "code": plain[0]})
        assert r1.status_code == 200, r1.text
        assert _session_cookie(r1) is not None  # 2e facteur validé -> cookie

        # Le code est CONSOMMÉ en base : 9 codes restants, le code[0] absent.
        fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
        await pg_session.refresh(fresh)
        assert len(fresh.twofa_recovery) == 9
        assert not tf.consume_recovery_code(fresh.twofa_recovery, plain[0])[0]

        # 2e tentative avec le MÊME code (challenge FRAIS) -> 401 : le code de
        # secours est bien à usage unique, indépendamment du challenge.
        r2 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": create_twofa_challenge_token(user.id),
                                "code": plain[0]})
        assert r2.status_code == 401, r2.text

        # Un AUTRE code encore valide passe (preuve que seul le code[0] a brûlé).
        r3 = await c.post("/api/auth/2fa/login/recovery",
                          json={"challenge": create_twofa_challenge_token(user.id),
                                "code": plain[1]})
        assert r3.status_code == 200, r3.text


# ==========================================================================
# Axe 4 — Challenge au login (DB RÉELLE) : round-trip complet
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_2fa_challenge_then_totp_completion_sets_session(
        pg_session: AsyncSession):
    """Round-trip complet (angle NOUVEAU vs test_auth_cookie) :
    1) POST /login (mdp) d'un compte TOTP -> challenge (scope twofa), AUCUN cookie ;
    2) POST /2fa/login/totp (code valide) -> session ouverte (cookie posé) ;
    3) un code TOTP faux -> 401."""
    secret = tf.new_totp_secret()
    await _seed_user(pg_session, email="login2fa@test.dev",
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
# Axe 6 — PR-01 (API-01) : anti-brute-force du 2nd facteur. NOUVEAU design,
#   atomique et sans DoS :
#     - THROTTLE PAR-IP ATOMIQUE (clé {user}:{ip}, check() incrément-et-test
#       AVANT la vérif crypto) -> borne un burst concurrent ; reset au succès.
#     - CAP D'ÉCHECS PAR-CHALLENGE (clé = jti, INDÉPENDANT de l'IP) -> ferme la
#       rotation d'IP ; à MAX échecs le challenge est invalidé (single-use).
#     - PAS de verrou persistant par compte (pas de DoS ciblé).
#     - SINGLE-USE atomique du challenge conservé (anti-rejeu).
# ==========================================================================

def _twofa_verify_limit() -> int:
    from src.services import rate_limit as rl
    return rl.twofa_verify_limiter.max_events


def _challenge_failure_cap() -> int:
    from src.core.constants import MAX_2FA_CHALLENGE_FAILURES
    return MAX_2FA_CHALLENGE_FAILURES


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_throttle_per_ip_atomic(pg_session: AsyncSession):
    """(a) THROTTLE PAR-IP ATOMIQUE : `limit` tentatives depuis la MÊME IP -> 429,
    même avec le BON code (aucune session). Le throttle, porté par {user_id}:{ip},
    est incrémenté ATOMIQUEMENT (check) AVANT la vérif crypto. Challenge FRAIS à
    chaque essai pour ISOLER ce throttle du cap par-challenge : seul le compteur
    par-IP accumule -> le 429 prouve la barrière par-IP."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="rl-totp@test.dev",
                            totp_secret=secret, totp_enabled=True)
    limit = _twofa_verify_limit()
    async with _App(pg_session, ip="9.9.9.1") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": create_twofa_challenge_token(user.id),
                                   "code": "000000"})
            assert r.status_code == 401, r.text
        # Au-delà du seuil par-IP : 429 même avec le bon code TOTP, aucune session.
        good = pyotp.TOTP(secret).now()
        r_blocked = await c.post("/api/auth/2fa/login/totp",
                                 json={"challenge": create_twofa_challenge_token(user.id),
                                       "code": good})
        assert r_blocked.status_code == 429, r_blocked.text
        assert _session_cookie(r_blocked) is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_success_before_threshold_resets_per_ip(pg_session: AsyncSession):
    """(a) Un SUCCÈS avant le seuil RÉINITIALISE le throttle par-IP (pas de lockout
    du légitime). Le throttle comptant CHAQUE tentative (atomique), seul le reset au
    succès évite de bloquer un utilisateur qui se connecte normalement : après le
    succès on peut de nouveau enchaîner `limit-1` échecs sans 429 (compteur reparti
    de zéro ; sinon le 1er échec post-succès serait déjà 429)."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="reset-totp@test.dev",
                            totp_secret=secret, totp_enabled=True)
    limit = _twofa_verify_limit()
    async with _App(pg_session, ip="7.7.7.7") as c:
        # limit-1 échecs (sous le seuil), challenge frais à chaque fois.
        for _ in range(limit - 1):
            rb = await c.post("/api/auth/2fa/login/totp",
                              json={"challenge": create_twofa_challenge_token(user.id),
                                    "code": "000000"})
            assert rb.status_code == 401, rb.text
        # Bon code -> succès, ce qui RÉINITIALISE la clé par-IP.
        r_ok = await c.post("/api/auth/2fa/login/totp",
                            json={"challenge": create_twofa_challenge_token(user.id),
                                  "code": pyotp.TOTP(secret).now()})
        assert r_ok.status_code == 200, r_ok.text
        assert _session_cookie(r_ok) is not None
        # Après reset : limit-1 échecs de nouveau possibles sans 429.
        for _ in range(limit - 1):
            r = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": create_twofa_challenge_token(user.id),
                                   "code": "000000"})
            assert r.status_code == 401, r.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_challenge_cap_closes_ip_rotation(pg_session: AsyncSession):
    """(b) Le cap PAR-CHALLENGE ferme la ROTATION D'IP : sur UN MÊME challenge,
    `cap` échecs répartis sur des IP DIFFÉRENTES (le throttle par-IP, à 1 essai/IP,
    n'est jamais atteint) invalident le challenge. La tentative suivante, même avec
    le BON code et depuis une IP neuve, échoue (401 : challenge consommé). On ne
    peut donc pas dépasser ~cap essais par challenge en changeant d'IP."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="rot-totp@test.dev",
                            totp_secret=secret, totp_enabled=True)
    challenge = create_twofa_challenge_token(user.id)
    cap = _challenge_failure_cap()
    for i in range(cap):
        async with _App(pg_session, ip=f"10.0.0.{i}") as c:
            r = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": challenge, "code": "000000"})
            assert r.status_code == 401, (i, r.text)
    # Challenge invalidé : le BON code depuis une IP ENCORE neuve -> 401 (consommé),
    # AUCUNE session.
    async with _App(pg_session, ip="10.9.9.9") as c:
        r_blocked = await c.post("/api/auth/2fa/login/totp",
                                 json={"challenge": challenge,
                                       "code": pyotp.TOTP(secret).now()})
        assert r_blocked.status_code == 401, r_blocked.text
        assert _session_cookie(r_blocked) is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_no_persistent_account_lock(pg_session: AsyncSession):
    """(c) PAS de verrou persistant par compte : après l'invalidation d'un challenge
    (cap d'échecs atteint via rotation d'IP), un NOUVEAU challenge (re-login simulé)
    + bon code ouvre la session IMMÉDIATEMENT. Aucun lock par-compte ne survit à la
    mort d'un challenge -> pas de DoS ciblé (le détenteur du mot de passe ne peut pas
    verrouiller durablement le 2FA de la victime)."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="nolock-totp@test.dev",
                            totp_secret=secret, totp_enabled=True)
    cap = _challenge_failure_cap()
    # Épuise un 1er challenge : cap+1 tentatives, IP différentes (pas de throttle
    # par-IP) -> les `cap` premières consomment le budget, la (cap+1)e l'invalide.
    dead = create_twofa_challenge_token(user.id)
    for i in range(cap + 1):
        async with _App(pg_session, ip=f"172.16.0.{i}") as c:
            r = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": dead, "code": "000000"})
            assert r.status_code == 401, (i, r.text)
    # Re-login simulé : challenge FRAIS + bon code depuis une IP neuve -> 200 immédiat.
    async with _App(pg_session, ip="172.16.9.9") as c:
        r_ok = await c.post("/api/auth/2fa/login/totp",
                            json={"challenge": create_twofa_challenge_token(user.id),
                                  "code": pyotp.TOTP(secret).now()})
        assert r_ok.status_code == 200, r_ok.text
        assert _session_cookie(r_ok) is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_recovery_good_code_in_budget_succeeds(pg_session: AsyncSession):
    """(d) RECOVERY : un bon code de secours DANS le budget d'échecs du challenge
    réussit (challenge consommé). `cap-1` mauvais codes comptent sur le cap
    par-challenge mais ne brûlent aucun code ni ne bloquent le bon code qui suit."""
    plain, hashed = tf.new_recovery_codes()
    user = await _seed_user(pg_session, email="rec-budget@test.dev",
                            totp_enabled=True, recovery=list(hashed))
    challenge = create_twofa_challenge_token(user.id)
    cap = _challenge_failure_cap()
    async with _App(pg_session, ip="8.8.8.1") as c:
        for _ in range(cap - 1):
            rb = await c.post("/api/auth/2fa/login/recovery",
                              json={"challenge": challenge, "code": "zzzzz-zzzzz"})
            assert rb.status_code == 401, rb.text
        r_ok = await c.post("/api/auth/2fa/login/recovery",
                            json={"challenge": challenge, "code": plain[0]})
        assert r_ok.status_code == 200, r_ok.text
        assert _session_cookie(r_ok) is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_recovery_challenge_cap_then_relogin(pg_session: AsyncSession):
    """(d) RECOVERY + cap par-challenge + pas de verrou persistant : `cap` mauvais
    codes de secours sur UN challenge (IP différentes) invalident le challenge ; le
    bon code arrive trop tard (401, challenge consommé) SANS être brûlé. Un re-login
    (challenge frais) + ce même bon code -> 200. Aucun verrou persistant ; le code de
    secours n'est consommé qu'au login réussi."""
    plain, hashed = tf.new_recovery_codes()
    user = await _seed_user(pg_session, email="rec-cap@test.dev",
                            totp_enabled=True, recovery=list(hashed))
    dead = create_twofa_challenge_token(user.id)
    cap = _challenge_failure_cap()
    for i in range(cap):
        async with _App(pg_session, ip=f"192.0.2.{i}") as c:
            r = await c.post("/api/auth/2fa/login/recovery",
                             json={"challenge": dead, "code": "zzzzz-zzzzz"})
            assert r.status_code == 401, (i, r.text)
    # Challenge mort : le BON code -> 401 (consommé), et il N'EST PAS brûlé.
    async with _App(pg_session, ip="192.0.2.200") as c:
        r_dead = await c.post("/api/auth/2fa/login/recovery",
                              json={"challenge": dead, "code": plain[0]})
        assert r_dead.status_code == 401, r_dead.text
    # Re-login (challenge frais) + le même bon code -> 200 (pas de verrou persistant).
    async with _App(pg_session, ip="192.0.2.201") as c:
        r_ok = await c.post("/api/auth/2fa/login/recovery",
                            json={"challenge": create_twofa_challenge_token(user.id),
                                  "code": plain[0]})
        assert r_ok.status_code == 200, r_ok.text
        assert _session_cookie(r_ok) is not None
    # plain[0] n'a été consommé qu'au login réussi : 9 codes restants, plain[0] absent.
    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert len(fresh.twofa_recovery) == 9
    assert not tf.consume_recovery_code(fresh.twofa_recovery, plain[0])[0]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_challenge_is_single_use(pg_session: AsyncSession):
    """Un challenge validé avec succès est CONSOMMÉ : le rejouer (même challenge +
    même code encore valide dans sa fenêtre) -> 401, AUCUNE nouvelle session. Le
    challenge stateless n'est donc plus rejouable après un login réussi."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="single-totp@test.dev",
                            totp_secret=secret, totp_enabled=True)
    challenge = create_twofa_challenge_token(user.id)
    code = pyotp.TOTP(secret).now()
    async with _App(pg_session) as c:
        r1 = await c.post("/api/auth/2fa/login/totp",
                          json={"challenge": challenge, "code": code})
        assert r1.status_code == 200, r1.text
        assert _session_cookie(r1) is not None
        # Rejeu : même challenge + même code (toujours valide) -> 401, pas de cookie.
        r2 = await c.post("/api/auth/2fa/login/totp",
                          json={"challenge": challenge, "code": code})
        assert r2.status_code == 401, r2.text
        assert _session_cookie(r2) is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_totp_failed_attempt_does_not_consume_challenge(pg_session: AsyncSession):
    """Un mauvais code NE consomme PAS le challenge (single-use uniquement au
    SUCCÈS) : après un essai raté, le bon code sur le MÊME challenge ouvre bien la
    session (pas de régression UX : une faute de frappe ne force pas un re-login)."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="single-totp2@test.dev",
                            totp_secret=secret, totp_enabled=True)
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session) as c:
        r_bad = await c.post("/api/auth/2fa/login/totp",
                             json={"challenge": challenge, "code": "000000"})
        assert r_bad.status_code == 401, r_bad.text
        good = pyotp.TOTP(secret).now()
        r_ok = await c.post("/api/auth/2fa/login/totp",
                            json={"challenge": challenge, "code": good})
        assert r_ok.status_code == 200, r_ok.text
        assert _session_cookie(r_ok) is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_recovery_challenge_single_use_keeps_code(pg_session: AsyncSession):
    """Le chemin code de secours est lui aussi single-use : après un login réussi,
    rejouer le MÊME challenge (avec un AUTRE code valide) -> 401 SANS brûler ce
    second code (le rejet a lieu AVANT la consommation du code)."""
    plain, hashed = tf.new_recovery_codes()
    user = await _seed_user(pg_session, email="single-rec@test.dev",
                            totp_enabled=True, recovery=list(hashed))
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session) as c:
        r_ok = await c.post("/api/auth/2fa/login/recovery",
                            json={"challenge": challenge, "code": plain[0]})
        assert r_ok.status_code == 200, r_ok.text
        # Rejeu du challenge consommé avec un autre code valide -> 401.
        r_replay = await c.post("/api/auth/2fa/login/recovery",
                                json={"challenge": challenge, "code": plain[1]})
        assert r_replay.status_code == 401, r_replay.text

    # plain[1] n'a PAS été consommé (rejet au stade challenge) : 9 codes restants
    # et plain[1] toujours valide.
    fresh = (await pg_session.execute(select(User).where(User.id == user.id))).scalar_one()
    await pg_session.refresh(fresh)
    assert len(fresh.twofa_recovery) == 9
    assert tf.consume_recovery_code(fresh.twofa_recovery, plain[1])[0] is True


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_recovery_rate_limited_after_threshold(pg_session: AsyncSession):
    """(a) Le throttle par-IP s'applique AUSSI au chemin recovery : `limit` essais
    depuis la même IP -> 429, même avec un VRAI code de secours (helper partagé,
    challenges frais pour isoler le throttle par-IP du cap par-challenge)."""
    plain, hashed = tf.new_recovery_codes()
    user = await _seed_user(pg_session, email="rl-rec@test.dev",
                            totp_enabled=True, recovery=list(hashed))
    limit = _twofa_verify_limit()
    async with _App(pg_session, ip="9.9.9.2") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/login/recovery",
                             json={"challenge": create_twofa_challenge_token(user.id),
                                   "code": "zzzzz-zzzzz"})
            assert r.status_code == 401, r.text
        # Au-delà du seuil par-IP : 429 même avec un VRAI code de secours (jamais
        # atteint -> non brûlé : le rejet a lieu AVANT la vérif).
        r_blocked = await c.post("/api/auth/2fa/login/recovery",
                                 json={"challenge": create_twofa_challenge_token(user.id),
                                       "code": plain[0]})
        assert r_blocked.status_code == 429, r_blocked.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_twofa_throttle_scoped_per_user_and_ip(pg_session: AsyncSession):
    """Non-régression : le throttle par-IP est porté par {user_id}:{ip}. Saturer le
    quota d'un user depuis une IP ne bloque NI un autre user (même IP) NI le même
    user depuis une autre IP. Challenges FRAIS à chaque essai pour isoler le throttle
    par-IP du cap par-challenge."""
    s_a, s_b = tf.new_totp_secret(), tf.new_totp_secret()
    user_a = await _seed_user(pg_session, email="iso-a@test.dev",
                              totp_secret=s_a, totp_enabled=True)
    user_b = await _seed_user(pg_session, email="iso-b@test.dev",
                              totp_secret=s_b, totp_enabled=True)
    limit = _twofa_verify_limit()

    # IP A : sature le quota de user_a -> 429.
    async with _App(pg_session, ip="1.1.1.1") as c:
        for _ in range(limit):
            await c.post("/api/auth/2fa/login/totp",
                         json={"challenge": create_twofa_challenge_token(user_a.id),
                               "code": "000000"})
        r_a = await c.post("/api/auth/2fa/login/totp",
                           json={"challenge": create_twofa_challenge_token(user_a.id),
                                 "code": "000000"})
        assert r_a.status_code == 429, r_a.text
        # MÊME IP, AUTRE user -> clé {user_b}:{ip} distincte, pas bloqué (401).
        r_b = await c.post("/api/auth/2fa/login/totp",
                           json={"challenge": create_twofa_challenge_token(user_b.id),
                                 "code": "000000"})
        assert r_b.status_code == 401, r_b.text

    # MÊME user_a, AUTRE IP -> clé distincte, pas bloqué.
    async with _App(pg_session, ip="2.2.2.2") as c:
        r_a_other_ip = await c.post("/api/auth/2fa/login/totp",
                                    json={"challenge": create_twofa_challenge_token(user_a.id),
                                          "code": "000000"})
        assert r_a_other_ip.status_code == 401, r_a_other_ip.text


@pytest.mark.asyncio
async def test_single_use_store_claim_is_atomic():
    """Anti-TOCTOU : le store anti-rejeu consomme un jti via un claim ATOMIQUE.
    Un seul claim « gagne » pour un même jti — y compris sous appels concurrents
    (asyncio.gather) — ce qui garantit qu'un challenge ne peut re-minter deux
    sessions même si deux requêtes valides arrivent en même temps."""
    from src.services.rate_limit import SingleUseTokens

    store = SingleUseTokens("rl:test2fa:", 600)
    key = "jti-xyz"
    assert await store.is_used(key) is False
    assert await store.claim(key) is True       # 1er claim -> gagne
    assert await store.claim(key) is False      # rejeu -> perd
    assert await store.is_used(key) is True      # marqué consommé

    # Concurrence : N claims simultanés sur un MÊME jti -> exactement 1 succès.
    race = SingleUseTokens("rl:test2fa2:", 600)
    results = await asyncio.gather(*[race.claim("same-jti") for _ in range(16)])
    assert sum(1 for r in results if r) == 1


@pytest.mark.asyncio
async def test_challenge_cap_atomic_under_concurrent_multi_ip():
    """(FIX 1) Le cap par-challenge TIENT SOUS CONCURRENCE multi-IP : la barrière
    amont (`_enforce_2fa_verify`) décompte un crédit du challenge via un INCR ATOMIQUE
    AVANT toute crypto. N requêtes concurrentes (asyncio.gather) depuis des IP
    DIFFÉRENTES sur le MÊME challenge -> au plus MAX franchissent la barrière (les
    autres -> 401 challenge épuisé). Sans atomicité amont, les N passeraient toutes
    `is_used()=False` et la borne réelle serait MAX×(nb d'IP) — la rotation d'IP ne
    serait PAS fermée. Test sans DB : la barrière n'utilise que limiteurs/stores
    (backend mémoire forcé par la fixture autouse)."""
    from src.routers import twofa as tw

    cap = _challenge_failure_cap()
    challenge_key = "jti-concurrency"

    def _req(i: int):
        return SimpleNamespace(client=SimpleNamespace(host=f"203.0.113.{i}"))

    async def _attempt(i: int) -> bool:
        try:
            await tw._enforce_2fa_verify(_req(i), 1, challenge_key)
            return True   # a franchi la barrière -> irait vérifier la crypto
        except HTTPException:
            return False

    results = await asyncio.gather(*[_attempt(i) for i in range(20)])
    assert sum(1 for r in results if r) == cap


# ==========================================================================
# Axe 6b — FIX 2 : endpoints 2FA SESSION-AUTHED plafonnés (brute-force d'un
#          code via une session volée — ex. désactiver la 2FA)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_totp_disable_throttled_after_threshold(pg_session: AsyncSession):
    """(FIX 2) /totp/disable vérifie un code SANS challenge -> brute-forçable avec une
    session volée pour désactiver la 2FA. Le throttle par-IP s'applique : `limit`
    codes faux -> 400, puis 429 (la 2FA n'est jamais désactivée par force brute)."""
    _, hashed = tf.new_recovery_codes()
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="mgmt-disable@test.dev",
                            totp_secret=secret, totp_enabled=True, recovery=list(hashed))
    limit = _twofa_verify_limit()
    async with _App(pg_session, user=user, ip="4.4.4.1") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/totp/disable", json={"code": "000000"})
            assert r.status_code == 400, r.text
        r_blocked = await c.post("/api/auth/2fa/totp/disable", json={"code": "000000"})
        assert r_blocked.status_code == 429, r_blocked.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_totp_enable_throttled_after_threshold(pg_session: AsyncSession):
    """(FIX 2) /totp/enable (confirmation d'enrôlement) plafonné de même : `limit`
    codes faux -> 400, puis 429."""
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="mgmt-enable@test.dev",
                            totp_secret=secret, totp_enabled=False)  # enrôlement en attente
    limit = _twofa_verify_limit()
    async with _App(pg_session, user=user, ip="4.4.4.2") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/totp/enable", json={"code": "000000"})
            assert r.status_code == 400, r.text
        r_blocked = await c.post("/api/auth/2fa/totp/enable", json={"code": "000000"})
        assert r_blocked.status_code == 429, r_blocked.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_recovery_regenerate_throttled_after_threshold(pg_session: AsyncSession):
    """(FIX 2) /recovery/regenerate plafonné de même : `limit` codes TOTP faux -> 400,
    puis 429."""
    _, hashed = tf.new_recovery_codes()
    secret = tf.new_totp_secret()
    user = await _seed_user(pg_session, email="mgmt-regen@test.dev",
                            totp_secret=secret, totp_enabled=True, recovery=list(hashed))
    limit = _twofa_verify_limit()
    async with _App(pg_session, user=user, ip="4.4.4.3") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/recovery/regenerate", json={"code": "000000"})
            assert r.status_code == 400, r.text
        r_blocked = await c.post("/api/auth/2fa/recovery/regenerate", json={"code": "000000"})
        assert r_blocked.status_code == 429, r_blocked.text


# ==========================================================================
# Axe 6c — FIX 3 : login/webauthn/complete (câblage throttle + cap + single-use,
#          crypto d'assertion MOCKÉE — non forgeable sans authenticator matériel)
# ==========================================================================

async def _seed_passkey_user(session: AsyncSession, email: str) -> str:
    """Crée un user avec une passkey + une cérémonie WebAuthn FRAÎCHE persistée
    (webauthn_challenge + horodatage). Renvoie le credential_id (base64url) à
    présenter dans l'assertion."""
    user = await _seed_user(session, email=email)
    cred_id = bytes_to_base64url(b"\x01\x02\x03\x04")
    session.add(WebAuthnCredential(
        user_id=user.id, credential_id=cred_id,
        public_key=bytes_to_base64url(b"\x05\x06"), sign_count=0, name="k"))
    user.webauthn_challenge = "ceremony-xyz"
    user.webauthn_challenge_at = utcnow()
    await session.commit()
    return cred_id


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_webauthn_complete_success_and_single_use(pg_session: AsyncSession, monkeypatch):
    """(FIX 3) login/webauthn/complete câblé : assertion VALIDE (crypto MOCKÉE) -> 200
    + session ; le challenge est CONSOMMÉ (rejeu -> 401, aucune nouvelle session). La
    vraie crypto d'assertion n'est pas forgeable sans authenticator -> on mocke
    tf.verify_authentication pour exercer le CÂBLAGE de l'endpoint."""
    monkeypatch.setattr(tf, "verify_authentication", lambda *a, **k: 7)
    cred_id = await _seed_passkey_user(pg_session, "wac-ok@test.dev")
    user = (await pg_session.execute(select(User).where(User.email == "wac-ok@test.dev"))).scalar_one()
    body = {"challenge": create_twofa_challenge_token(user.id), "credential": {"id": cred_id}}
    async with _App(pg_session, ip="5.5.5.5") as c:
        r = await c.post("/api/auth/2fa/login/webauthn/complete", json=body)
        assert r.status_code == 200, r.text
        assert _session_cookie(r) is not None
        # Rejeu du même challenge consommé -> 401, aucune session.
        r2 = await c.post("/api/auth/2fa/login/webauthn/complete", json=body)
        assert r2.status_code == 401, r2.text
        assert _session_cookie(r2) is None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_webauthn_complete_invalid_counts_on_challenge_cap(pg_session: AsyncSession, monkeypatch):
    """(FIX 3) login/webauthn/complete : une assertion INVALIDE (crypto MOCKÉE qui
    lève) -> 401 ET consomme un crédit du challenge (cap par-challenge atomique amont).
    cap+1 tentatives sur UN challenge via des IP DIFFÉRENTES -> challenge invalidé ;
    ensuite, même une assertion qui VALIDERAIT est rejetée (challenge consommé) ->
    prouve que les échecs webauthn comptent sur le cap et ferment la rotation d'IP."""
    def _boom(*a, **k):
        raise Exception("bad signature")
    monkeypatch.setattr(tf, "verify_authentication", _boom)
    cred_id = await _seed_passkey_user(pg_session, "wac-cap@test.dev")
    user = (await pg_session.execute(select(User).where(User.email == "wac-cap@test.dev"))).scalar_one()
    dead = create_twofa_challenge_token(user.id)
    cap = _challenge_failure_cap()
    for i in range(cap + 1):
        async with _App(pg_session, ip=f"198.51.100.{i}") as c:
            r = await c.post("/api/auth/2fa/login/webauthn/complete",
                             json={"challenge": dead, "credential": {"id": cred_id}})
            assert r.status_code == 401, (i, r.text)
    # Challenge épuisé : même une assertion qui validerait -> 401 (consommé).
    monkeypatch.setattr(tf, "verify_authentication", lambda *a, **k: 9)
    async with _App(pg_session, ip="198.51.100.250") as c:
        r = await c.post("/api/auth/2fa/login/webauthn/complete",
                         json={"challenge": dead, "credential": {"id": cred_id}})
        assert r.status_code == 401, r.text


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_webauthn_complete_throttled_per_ip(pg_session: AsyncSession, monkeypatch):
    """(FIX 3) login/webauthn/complete : le throttle par-IP s'applique aussi -> `limit`
    assertions invalides depuis la même IP -> 429 (challenges frais pour isoler le
    throttle par-IP du cap par-challenge)."""
    def _boom(*a, **k):
        raise Exception("bad signature")
    monkeypatch.setattr(tf, "verify_authentication", _boom)
    cred_id = await _seed_passkey_user(pg_session, "wac-rl@test.dev")
    user = (await pg_session.execute(select(User).where(User.email == "wac-rl@test.dev"))).scalar_one()
    limit = _twofa_verify_limit()
    async with _App(pg_session, ip="6.6.6.6") as c:
        for _ in range(limit):
            r = await c.post("/api/auth/2fa/login/webauthn/complete",
                             json={"challenge": create_twofa_challenge_token(user.id),
                                   "credential": {"id": cred_id}})
            assert r.status_code == 401, r.text
        r_blocked = await c.post("/api/auth/2fa/login/webauthn/complete",
                                 json={"challenge": create_twofa_challenge_token(user.id),
                                       "credential": {"id": cred_id}})
        assert r_blocked.status_code == 429, r_blocked.text


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
