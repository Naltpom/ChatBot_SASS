"""cm mobile : se connecter avec l'empreinte (clé d'accès) dans l'app Android, comme second facteur.
La crypto WebAuthn n'est pas forgeable sans authentificateur : on remplace la vérification pour tester le câblage
(défi, origines acceptées, codes de secours, usage unique, session ouverte)."""
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from webauthn.helpers import bytes_to_base64url

from src.core.config import settings
from src.core.security import create_twofa_challenge_token
from src.models.user import User, WebAuthnCredential
from src.routers import cm_passkey as cp

from test_twofa import _App, _seed_user, _session_cookie, _twofa_local_limits  # noqa: F401  (fixture)


def test_android_origin_and_assetlinks():
    # Empreinte -> origine « android:apk-key-hash: » (base64url sans remplissage), comme Android la présente.
    o = cp.android_origin("00:" * 31 + "FF")
    assert o.startswith("android:apk-key-hash:") and "=" not in o and len(o.split(":", 2)[2]) == 43
    origins = cp.app_origins()
    assert settings.webauthn_origin in origins and len([x for x in origins if x.startswith("android:")]) == 3
    import pathlib
    links = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app/public/.well-known/assetlinks.json").read_text())
    assert "delegate_permission/common.get_login_creds" in links[0]["relation"]
    assert links[0]["target"]["package_name"] == "fr.chapote.cm"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_register_then_login_with_fingerprint(pg_session, monkeypatch):
    seen = {}

    def fake_reg(**kw):
        seen["reg_origins"] = kw["expected_origin"]
        return SimpleNamespace(credential_id=b"\x01\x02\x03", credential_public_key=b"\x09\x09", sign_count=0)

    def fake_auth(**kw):
        seen["auth_origins"] = kw["expected_origin"]
        return SimpleNamespace(new_sign_count=5)

    monkeypatch.setattr(cp, "verify_registration_response", fake_reg)
    monkeypatch.setattr(cp, "verify_authentication_response", fake_auth)
    user = await _seed_user(pg_session, email="pk@test.dev")
    async with _App(pg_session, user=user, ip="7.7.7.7") as c:
        r = await c.post("/api/cm/mobile/passkey/register/begin")
        assert r.status_code == 200, r.text
        opts = json.loads(r.json()["options"])
        assert opts["rp"]["id"] == settings.webauthn_rp_id and opts["challenge"]
        r = await c.post("/api/cm/mobile/passkey/register/complete", json={"name": "Pixel 8", "credential": {"id": "x"}})
        assert r.status_code == 200, r.text
        out = r.json()
        # Première clé, sans code de secours : on en donne (sinon un téléphone perdu fermerait le compte).
        assert out["name"] == "Pixel 8" and len(out["recovery_codes"]) >= 8
        assert any(o.startswith("android:apk-key-hash:") for o in seen["reg_origins"])
        # Même clé une deuxième fois : refusée.
        await c.post("/api/cm/mobile/passkey/register/begin")
        assert (await c.post("/api/cm/mobile/passkey/register/complete", json={"credential": {"id": "x"}})).status_code == 409
    cred = (await pg_session.execute(select(WebAuthnCredential))).scalar_one()
    assert cred.name == "Pixel 8"

    # Connexion : défi du mot de passe -> empreinte -> session ouverte ; défi à usage unique.
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session, ip="7.7.7.7") as c:
        r = await c.post("/api/cm/mobile/passkey/login/begin", json={"challenge": challenge})
        assert r.status_code == 200, r.text
        assert json.loads(r.json()["options"])["allowCredentials"][0]["id"] == cred.credential_id
        body = {"challenge": challenge, "credential": {"id": cred.credential_id}}
        r = await c.post("/api/cm/mobile/passkey/login/complete", json=body)
        assert r.status_code == 200, r.text
        assert _session_cookie(r) is not None and r.json()["email"] == "pk@test.dev"
        assert any(o.startswith("android:apk-key-hash:") for o in seen["auth_origins"])
        r2 = await c.post("/api/cm/mobile/passkey/login/complete", json=body)
        assert r2.status_code == 401 and _session_cookie(r2) is None
    await pg_session.refresh(cred)
    assert cred.sign_count == 5 and cred.last_used_at is not None


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_login_refused_without_key_or_with_bad_signature(pg_session, monkeypatch):
    def bad(**kw):
        raise ValueError("signature")

    monkeypatch.setattr(cp, "verify_authentication_response", bad)
    user = await _seed_user(pg_session, email="nokey@test.dev", recovery=["x"])
    async with _App(pg_session, ip="8.8.8.8") as c:
        r = await c.post("/api/cm/mobile/passkey/login/begin", json={"challenge": create_twofa_challenge_token(user.id)})
        assert r.status_code == 400
    pg_session.add(WebAuthnCredential(user_id=user.id, credential_id=bytes_to_base64url(b"\x07"), public_key=bytes_to_base64url(b"\x01"),
                                      sign_count=0, name="k"))
    await pg_session.commit()
    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session, ip="8.8.8.8") as c:
        assert (await c.post("/api/cm/mobile/passkey/login/begin", json={"challenge": challenge})).status_code == 200
        r = await c.post("/api/cm/mobile/passkey/login/complete", json={"challenge": challenge, "credential": {"id": bytes_to_base64url(b"\x07")}})
        assert r.status_code == 401 and _session_cookie(r) is None
        # Clé d'un autre compte : inconnue.
        r = await c.post("/api/cm/mobile/passkey/login/complete", json={"challenge": challenge, "credential": {"id": "autre"}})
        assert r.status_code == 401
    # Codes de secours déjà présents : on n'en régénère pas.
    monkeypatch.setattr(cp, "verify_registration_response", lambda **kw: SimpleNamespace(credential_id=b"\x0a", credential_public_key=b"\x0b", sign_count=0))
    u = (await pg_session.execute(select(User).where(User.email == "nokey@test.dev"))).scalar_one()
    async with _App(pg_session, user=u, ip="8.8.8.9") as c:
        await c.post("/api/cm/mobile/passkey/register/begin")
        r = await c.post("/api/cm/mobile/passkey/register/complete", json={"credential": {"id": "y"}})
        assert r.status_code == 200 and r.json()["recovery_codes"] is None


def test_refusal_reason_names_unknown_origin():
    import base64 as b64
    cd = b64.urlsafe_b64encode(json.dumps({"origin": "android:apk-key-hash:INCONNU"}).encode()).decode().rstrip("=")
    assert "android:apk-key-hash:INCONNU" in cp._why({"response": {"clientDataJSON": cd}}, ValueError("x"))
    ok = cp.app_origins()[-1]
    cd = b64.urlsafe_b64encode(json.dumps({"origin": ok}).encode()).decode().rstrip("=")
    assert cp._why({"response": {"clientDataJSON": cd}}, ValueError("mauvais défi")) == "ValueError : mauvais défi"
    assert cp._why({}, KeyError("id")).startswith("KeyError")
