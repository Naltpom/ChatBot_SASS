"""cm mobile : empreinte gérée par l'app (clé dans la puce sécurisée) à la place du code de double authentification."""
import pytest
from sqlalchemy import select

from src.core.security import create_twofa_challenge_token
from src.models.cm_mobile import CmBiometricKey

from test_twofa import _App, _seed_user, _session_cookie, _twofa_local_limits  # noqa: F401  (fixture)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_enable_list_login_and_revoke(pg_session):
    user = await _seed_user(pg_session, email="bio@test.dev")
    other = await _seed_user(pg_session, email="autre@test.dev")
    async with _App(pg_session, user=user, ip="9.9.9.1") as c:
        r = await c.post("/api/cm/mobile/biometric/enable", json={"name": "Galaxy S24"})
        assert r.status_code == 200, r.text
        k = r.json()
        assert k["name"] == "Galaxy S24" and len(k["secret"]) >= 40 and len(k["recovery_codes"]) >= 8
        # Seule l'empreinte de la clé est gardée.
        row = (await pg_session.execute(select(CmBiometricKey))).scalar_one()
        assert row.secret_hash != k["secret"] and len(row.secret_hash) == 64
        assert [x["id"] for x in (await c.get("/api/cm/mobile/biometric/keys")).json()] == [k["id"]]
        # Deuxième téléphone : pas de nouveaux codes de secours.
        assert (await c.post("/api/cm/mobile/biometric/enable", json={})).json()["recovery_codes"] is None

    challenge = create_twofa_challenge_token(user.id)
    async with _App(pg_session, ip="9.9.9.2") as c:
        # Mauvaise clé, clé d'un autre compte : refusées, sans session.
        r = await c.post("/api/cm/mobile/biometric/login", json={"challenge": challenge, "key_id": k["id"], "secret": "x" * 43})
        assert r.status_code == 401 and _session_cookie(r) is None
        r = await c.post("/api/cm/mobile/biometric/login",
                         json={"challenge": create_twofa_challenge_token(other.id), "key_id": k["id"], "secret": k["secret"]})
        assert r.status_code == 401
        # Bonne clé : session ouverte ; le défi ne sert qu'une fois.
        body = {"challenge": challenge, "key_id": k["id"], "secret": k["secret"]}
        r = await c.post("/api/cm/mobile/biometric/login", json=body)
        assert r.status_code == 200, r.text
        assert _session_cookie(r) is not None and r.json()["email"] == "bio@test.dev"
        r2 = await c.post("/api/cm/mobile/biometric/login", json=body)
        assert r2.status_code == 401 and _session_cookie(r2) is None
    await pg_session.refresh(row)
    assert row.last_used_at is not None

    # Retirée : ne sert plus. Une autre personne ne peut pas la retirer.
    async with _App(pg_session, user=other, ip="9.9.9.3") as c:
        assert (await c.delete(f"/api/cm/mobile/biometric/keys/{k['id']}")).status_code == 404
    async with _App(pg_session, user=user, ip="9.9.9.4") as c:
        assert (await c.delete(f"/api/cm/mobile/biometric/keys/{k['id']}")).status_code == 200
        assert k["id"] not in [x["id"] for x in (await c.get("/api/cm/mobile/biometric/keys")).json()]
    async with _App(pg_session, ip="9.9.9.5") as c:
        r = await c.post("/api/cm/mobile/biometric/login",
                         json={"challenge": create_twofa_challenge_token(user.id), "key_id": k["id"], "secret": k["secret"]})
        assert r.status_code == 401
