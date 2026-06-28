"""JWT dashboard en cookie httpOnly (audit §3.5, PR-04).

Vérifie le contrat de la migration cookie SANS DB réelle (gabarit conftest :
`FakeSession` + `app.dependency_overrides[get_db]`). On NE surcharge PAS
`get_current_user` ici : on veut exercer la VRAIE lecture du cookie.

Scénarios :
- dev-login pose un cookie `chapote_session` HttpOnly + SameSite=Lax et NE
  renvoie PAS le token dans le corps (juste l'UserOut) ;
- une requête authentifiée via ce cookie (/api/auth/me) passe ;
- /api/auth/logout efface le cookie -> /api/auth/me redevient 401 ;
- sans cookie -> 401 ;
- un cookie forgé contenant un JWT dashboard valide authentifie aussi.

Lancement : pytest tests/test_auth_cookie.py -q  (depuis api/).
"""
import pytest

from src.core.config import settings
from src.core.database import get_db
from src.core.security import AUTH_COOKIE_NAME, create_dashboard_token, hash_password
from src.main import app
from src.models.user import User


@pytest.fixture
def seeded_db(db):
    """FakeSession (fixture conftest) seedée avec l'admin DEV, branchée sur get_db.
    get_current_user N'est PAS surchargé : il lira réellement le cookie."""
    db.seed(User(id=1, email=settings.ADMIN_EMAIL, name="Admin DEV",
                 is_superadmin=True, auth_source="local"))

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    yield db
    app.dependency_overrides.clear()


def _session_cookie(resp):
    """Renvoie l'en-tête Set-Cookie du cookie de session (ou None)."""
    for raw in resp.headers.get_list("set-cookie"):
        if raw.startswith(f"{AUTH_COOKIE_NAME}="):
            return raw
    return None


@pytest.fixture
def dev_login_on(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_LOGIN_ADMIN_DEV", True, raising=False)
    # ENV dev par défaut -> is_production False -> cookie sans Secure (posable en
    # http://test). On le garantit explicitement.
    monkeypatch.setattr(settings, "ENV", "dev", raising=False)
    yield


@pytest.mark.asyncio
async def test_login_sets_httponly_cookie_and_hides_token(client, seeded_db, dev_login_on):
    async with client as c:
        resp = await c.post("/api/auth/dev-login")
        assert resp.status_code == 200, resp.text

        # 1) Cookie httpOnly + SameSite=Lax posé.
        raw = _session_cookie(resp)
        assert raw is not None, "cookie chapote_session absent"
        low = raw.lower()
        assert "httponly" in low, raw
        assert "samesite=lax" in low, raw
        # Pas de Secure en dev (sinon le navigateur ne pose pas le cookie en http).
        assert "secure" not in low, raw

        # 2) Le token ne fuit PAS dans le corps : juste l'UserOut.
        body = resp.json()
        assert "access_token" not in body
        assert body["id"] == 1 and body["email"] == settings.ADMIN_EMAIL

        # 3) Requête authentifiée via le cookie (porté par le jar du client).
        me = await c.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["id"] == 1

        # 4) logout efface le cookie -> /me redevient 401.
        out = await c.post("/api/auth/logout")
        assert out.status_code == 200
        me2 = await c.get("/api/auth/me")
        assert me2.status_code == 401


@pytest.mark.asyncio
async def test_me_without_cookie_is_401(client, seeded_db):
    async with client as c:
        resp = await c.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_forged_valid_cookie(client, seeded_db):
    token = create_dashboard_token(1)
    async with client as c:
        c.cookies.set(AUTH_COOKIE_NAME, token)
        resp = await c.get("/api/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == 1


@pytest.mark.asyncio
async def test_me_with_wrong_scope_cookie_is_401(client, seeded_db):
    # Un JWT de scope 'plugin' (surface externe) ne doit PAS être accepté comme
    # session dashboard : decode_token impose scope='dashboard'.
    from src.core.security import create_oauth_token

    async with client as c:
        c.cookies.set(AUTH_COOKIE_NAME, create_oauth_token(1)[0])
        resp = await c.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_authorization_header_is_no_longer_accepted(client, seeded_db):
    # Invariant de sécurité (PR-04) : le fallback header Authorization a été
    # supprimé. Un JWT dashboard VALIDE envoyé en `Authorization: Bearer`, SANS
    # cookie, ne doit PAS authentifier -> 401. Un token volé ne passe donc que
    # par le cookie httpOnly (inaccessible au JS / non rejouable hors cookie).
    token = create_dashboard_token(1)
    async with client as c:
        resp = await c.get("/api/auth/me",
                           headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_2fa_challenge_does_not_set_session_cookie(client, seeded_db):
    # Un login d'un compte avec la 2FA active renvoie le *challenge* (scope twofa,
    # à échanger via /api/auth/2fa/login/*) et NE pose PAS de cookie de session :
    # tant que le 2nd facteur n'est pas validé, aucune session n'est ouverte.
    pw = "Sup3rSecret!42"
    seeded_db.seed(User(id=2, email="twofa@test.dev", name="TwoFA",
                        hashed_password=hash_password(pw), auth_source="local",
                        totp_enabled=True))
    async with client as c:
        resp = await c.post("/api/auth/login",
                            json={"email": "twofa@test.dev", "password": pw})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("twofa_required") is True, body
    assert "challenge" in body
    assert "access_token" not in body
    # Aucun cookie chapote_session posé avant la validation du 2nd facteur.
    assert _session_cookie(resp) is None
