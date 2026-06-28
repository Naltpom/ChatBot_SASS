"""RGPD prospection à froid (reporté de PR-07, §4.4 / Sécurité audit).

Couvre les trois garanties posées :
1. Garde-fou à l'ENVOI : un prospect opt_out=True ne reçoit JAMAIS de cold email.
2. DÉSINSCRIPTION : l'endpoint public /api/prospect/optout pose opt_out via un
   token HMAC signé (valide -> opt-out ; invalide/forgé -> sans effet), réponse
   neutre et idempotente. + round-trip make/parse du token.
3. PURGE/RÉTENTION : purge_old_prospects anonymise les PII des prospects au-delà
   de la rétention OU opt_out, et préserve les prospects récents non opt-out.

DB réelle (pg_session) pour tout ce qui touche au filtrage SQL et à la
persistance (le filtrage non-`==` est neutralisé sous FakeSession, cf. conftest).
Token : test unitaire pur (pas de DB).

Lancement : pytest tests/test_prospect_rgpd.py -q  (depuis api/).
"""
from datetime import timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.main import app
from src.models.prospect import Prospect
from src.models.user import User
from src.services import prospecting_service
from src.services.prospecting_service import (make_optout_token,
                                              parse_optout_token,
                                              purge_old_prospects)

pytestmark = pytest.mark.real_db


# --------------------------------------------------------------------------
# Harness : override get_db -> pg_session (+ require_superadmin pour l'admin).
# --------------------------------------------------------------------------

class _RealApp:
    def __init__(self, session: AsyncSession, superadmin: User | None = None):
        self._session = session
        self._superadmin = superadmin

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        if self._superadmin is not None:
            async def _su():
                return self._superadmin
            app.dependency_overrides[require_superadmin] = _su
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test")
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_superadmin, None)


async def _mk_superadmin(session: AsyncSession) -> User:
    u = User(email="su@test.dev", hashed_password="x", name="SU", is_superadmin=True)
    session.add(u)
    await session.flush()
    return u


def _pii_prospect(**kw) -> Prospect:
    """Prospect porteur de PII (email/nom/résumé/brouillon/enrichissement)."""
    base = dict(
        company_name="ACME SARL",
        contact_email="contact@acme.test",
        contact_name="Jean Dupont",
        site_summary="Garagiste à Versailles, ouvert 6j/7.",
        website="https://acme.test",
        email_subject="Un chatbot pour ACME ?",
        email_body="Bonjour, …",
        enrichment={"web": {"emails": [{"value": "contact@acme.test"}],
                            "phones": ["0139000000"]}},
        status="drafted",
    )
    base.update(kw)
    return Prospect(**base)


# --- 1. Token HMAC (round-trip + falsification) ---------------------------

def test_optout_token_roundtrip_and_tamper():
    tok = make_optout_token(42)
    assert parse_optout_token(tok) == 42
    # Falsifié / mal formé / id substitué -> None (non énumérable, non rejouable).
    assert parse_optout_token(None) is None
    assert parse_optout_token("") is None
    assert parse_optout_token("42") is None
    assert parse_optout_token("42.badsig") is None
    assert parse_optout_token("abc.def") is None
    # On ne peut pas forger le token d'un autre id sans le secret.
    assert parse_optout_token("43." + tok.split(".", 1)[1]) is None


# --- 2a. Garde-fou à l'envoi : opt_out exclut du cold email ----------------

@pytest.mark.asyncio
async def test_send_blocked_for_opted_out_prospect(pg_session: AsyncSession, monkeypatch):
    sent: list = []

    async def _fake_send(*a, **k):
        sent.append((a, k))
        return True

    monkeypatch.setattr("src.routers.admin_prospecting.send_email", _fake_send)
    su = await _mk_superadmin(pg_session)
    p = _pii_prospect(opt_out=True, opt_out_at=utcnow())
    pg_session.add(p)
    await pg_session.commit()

    async with _RealApp(pg_session, su) as c:
        r = await c.post(f"/api/admin/prospecting/prospects/{p.id}/send")
    assert r.status_code == 409, r.text
    assert sent == []  # JAMAIS d'envoi à un prospect opt-out


@pytest.mark.asyncio
async def test_send_ok_includes_optout_link_and_rgpd_contact(pg_session: AsyncSession, monkeypatch):
    captured: dict = {}

    async def _fake_send(recipients, subject, body, **k):
        captured["body"] = body
        return True

    monkeypatch.setattr("src.routers.admin_prospecting.send_email", _fake_send)
    su = await _mk_superadmin(pg_session)
    p = _pii_prospect()
    pg_session.add(p)
    await pg_session.commit()

    async with _RealApp(pg_session, su) as c:
        r = await c.post(f"/api/admin/prospecting/prospects/{p.id}/send")
    assert r.status_code == 200, r.text
    body = captured["body"]
    # Information art. 14 : contact RGPD + lien de désinscription signé (token).
    assert "rgpd@chapote.fr" in body
    assert "/api/prospect/optout?token=" in body
    assert make_optout_token(p.id) in body


# --- 2b. Endpoint public de désinscription --------------------------------

@pytest.mark.asyncio
async def test_public_optout_sets_flag_and_is_idempotent(pg_session: AsyncSession):
    p = _pii_prospect()
    pg_session.add(p)
    await pg_session.commit()
    token = make_optout_token(p.id)

    async with _RealApp(pg_session) as c:
        r1 = await c.get("/api/prospect/optout", params={"token": token})
        assert r1.status_code == 200
        await pg_session.refresh(p)
        assert p.opt_out is True and p.opt_out_at is not None
        first_at = p.opt_out_at
        # Idempotent : 2e appel ne change pas l'horodatage.
        r2 = await c.get("/api/prospect/optout", params={"token": token})
        assert r2.status_code == 200
        await pg_session.refresh(p)
        assert p.opt_out_at == first_at


@pytest.mark.asyncio
async def test_public_optout_invalid_token_neutral_no_effect(pg_session: AsyncSession):
    p = _pii_prospect()
    pg_session.add(p)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        # Token forgé : réponse neutre (même message) ET aucun effet en base.
        r = await c.get("/api/prospect/optout", params={"token": f"{p.id}.forged"})
        assert r.status_code == 200
    await pg_session.refresh(p)
    assert p.opt_out is False


# --- 3. Purge / rétention des PII -----------------------------------------

@pytest.mark.asyncio
async def test_purge_anonymizes_old_and_optout_preserves_recent(pg_session: AsyncSession):
    now = utcnow()
    recent = _pii_prospect(company_name="RECENT", created_at=now)
    old = _pii_prospect(company_name="OLD", created_at=now - timedelta(days=400))
    opted = _pii_prospect(company_name="OPTED", created_at=now,
                          opt_out=True, opt_out_at=now)
    pg_session.add_all([recent, old, opted])
    await pg_session.commit()

    n = await purge_old_prospects(pg_session, retention_days=365)
    assert n == 2  # old (rétention dépassée) + opted (opposition)

    for p in (recent, old, opted):
        await pg_session.refresh(p)

    # Récent non opt-out : PII préservées.
    assert recent.contact_email == "contact@acme.test"
    assert recent.enrichment is not None

    # Vieux et opt-out : PII effacées, champ non personnel (raison sociale) gardé.
    for p in (old, opted):
        assert p.contact_email is None
        assert p.contact_name is None
        assert p.site_summary is None
        assert p.email_body is None
        assert p.email_subject is None
        assert p.website is None
        assert p.enrichment is None
        assert p.company_name in ("OLD", "OPTED")  # conservé (few-shot)


@pytest.mark.asyncio
async def test_admin_purge_endpoint(pg_session: AsyncSession):
    su = await _mk_superadmin(pg_session)
    old = _pii_prospect(created_at=utcnow() - timedelta(days=500))
    pg_session.add(old)
    await pg_session.commit()

    async with _RealApp(pg_session, su) as c:
        r = await c.post("/api/admin/prospecting/purge", params={"retention_days": 365})
    assert r.status_code == 200, r.text
    assert r.json()["purged"] == 1
    await pg_session.refresh(old)
    assert old.contact_email is None and old.enrichment is None


@pytest.mark.asyncio
async def test_admin_optout_endpoint_sets_flag(pg_session: AsyncSession):
    su = await _mk_superadmin(pg_session)
    p = _pii_prospect()
    pg_session.add(p)
    await pg_session.commit()

    async with _RealApp(pg_session, su) as c:
        r = await c.post(f"/api/admin/prospecting/prospects/{p.id}/optout")
    assert r.status_code == 200, r.text
    assert r.json()["opt_out"] is True
    await pg_session.refresh(p)
    assert p.opt_out is True and p.opt_out_at is not None
