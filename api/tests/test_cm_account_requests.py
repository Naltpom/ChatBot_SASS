"""cm : reprise d'un compte relié ailleurs par DEMANDE (accord de l'espace actuel, refus, réclamation au support)."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm_mobile import CmAccountRequest
from src.models.tiktok import TikTokAccount

from test_cm import _tt_target, cmenv  # noqa: F401  (fixture)
from test_cm_team import _plan  # noqa: F401
from test_tiktok import Client, _account, _org, _state, _user, tiktok  # noqa: F401  (fixture)


async def _claim_token(c, user) -> str:
    r = await c.as_(user).post("/api/tiktok/oauth/exchange", json={"code": "ok", "state": _state(user.id)})
    assert r.status_code == 409, r.text
    return r.json()["detail"]["claim_token"]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_request_accepted_by_current_owner(pg_session, cmenv, tiktok, monkeypatch):
    sent = []
    monkeypatch.setattr("src.routers.cm_account_requests.send_account_email", lambda to, subject, text, **kw: sent.append((to, subject)))
    stagiaire = await _user(pg_session, "stagiaire@t.dev")
    referent = await _user(pg_session, "cm@t.dev")
    intrus = await _user(pg_session, "intrus@t.dev")
    acc = await _account(pg_session, owner=stagiaire, open_id="oid-1")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=2)).isoformat() + "Z"
    async with Client(pg_session) as c:
        await _plan(c.as_(stagiaire), [_tt_target(acc.id, scheduled_at=later)])
        token = await _claim_token(c, referent)
        # Le jeton est lié à la personne.
        assert (await c.as_(intrus).post("/api/cm/account-requests", json={"claim_token": token})).status_code == 400
        r = await c.as_(referent).post("/api/cm/account-requests", json={"claim_token": token, "message": "Je gère ce compte désormais"})
        assert r.status_code == 200, r.text
        req = r.json()["request"]
        assert req["status"] == "pending" and req["can_dispute"] is False
        # Rien n'a bougé : le compte reste chez son propriétaire, qui est prévenu par e-mail.
        await pg_session.refresh(acc)
        assert acc.owner_user_id == stagiaire.id
        assert sent and sent[-1][0] == ["stagiaire@t.dev"]
        # Jeton à usage unique.
        assert (await c.as_(referent).post("/api/cm/account-requests", json={"claim_token": token})).status_code == 400
        # Seul l'espace actuel voit la demande et peut répondre.
        inc = (await c.as_(stagiaire).get("/api/cm/account-requests")).json()["incoming"]
        assert [x["id"] for x in inc] == [req["id"]] and inc[0]["requester"]["email"] == "cm@t.dev"
        assert (await c.as_(intrus).get("/api/cm/account-requests")).json()["incoming"] == []
        assert (await c.as_(intrus).post(f"/api/cm/account-requests/{req['id']}/accept")).status_code == 404
        assert (await c.as_(referent).post(f"/api/cm/account-requests/{req['id']}/accept")).status_code == 404
        # Accord : le compte part avec son planning à venir.
        r = await c.as_(stagiaire).post(f"/api/cm/account-requests/{req['id']}/accept")
        assert r.status_code == 200 and r.json()["moved_targets"] == 1
        await pg_session.refresh(acc)
        assert acc.owner_user_id == referent.id
        assert [a["id"] for a in (await c.as_(referent).get("/api/cm/accounts")).json()] == [acc.id]
        assert (await c.as_(stagiaire).post(f"/api/cm/account-requests/{req['id']}/decline")).status_code == 404
        out = (await c.as_(referent).get("/api/cm/account-requests")).json()["outgoing"]
        assert out[0]["status"] == "accepted"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_request_declined_then_disputed_in_team(pg_session, cmenv, tiktok, monkeypatch):
    sent = []
    monkeypatch.setattr("src.routers.cm_account_requests.send_account_email", lambda to, subject, text, **kw: sent.append((to, subject, text)))
    boss = await _user(pg_session, "boss@t.dev")
    editor = await _user(pg_session, "editor@t.dev")
    me = await _user(pg_session, "me@t.dev")
    org = await _org(pg_session, boss, (editor, "member"))
    acc = await _account(pg_session, org=org, by=boss, open_id="oid-1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        token = await _claim_token(c, me)
        req = (await c.as_(me).post("/api/cm/account-requests", json={"claim_token": token})).json()["request"]
        assert sent[-1][0] == ["boss@t.dev"]
        # Pas encore de réclamation possible (ni refus, ni 3 jours).
        assert (await c.as_(me).post(f"/api/cm/account-requests/{req['id']}/dispute", json={"message": "C'est mon compte personnel."})).status_code == 409
        # Un membre non administrateur ne répond pas.
        assert (await c.as_(editor).post(f"/api/cm/account-requests/{req['id']}/decline")).status_code in (403, 404)
        assert (await c.as_(boss).post(f"/api/cm/account-requests/{req['id']}/decline")).status_code == 200
        await pg_session.refresh(acc)
        assert acc.organization_id == org.id
        out = (await c.as_(me).get("/api/cm/account-requests")).json()["outgoing"][0]
        assert out["status"] == "declined" and out["can_dispute"] is True
        r = await c.as_(me).post(f"/api/cm/account-requests/{req['id']}/dispute", json={"message": "C'est mon compte personnel, voici pourquoi."})
        assert r.status_code == 200, r.text
        assert sent[-1][0] == ["support@chapote.fr"] and "me@t.dev" in sent[-1][2]
        assert (await c.as_(me).post(f"/api/cm/account-requests/{req['id']}/dispute", json={"message": "Encore une fois svp merci."})).status_code == 409


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_request_without_answer_can_be_disputed_and_cancelled(pg_session, cmenv, tiktok, monkeypatch):
    monkeypatch.setattr("src.routers.cm_account_requests.send_account_email", lambda *a, **kw: None)
    owner = await _user(pg_session, "owner@t.dev")
    me = await _user(pg_session, "me@t.dev")
    await _account(pg_session, owner=owner, open_id="oid-1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        req = (await c.as_(me).post("/api/cm/account-requests", json={"claim_token": await _claim_token(c, me)})).json()["request"]
        # Une nouvelle demande remplace l'ancienne.
        req2 = (await c.as_(me).post("/api/cm/account-requests", json={"claim_token": await _claim_token(c, me)})).json()["request"]
        rows = {r.id: r.status for r in (await pg_session.execute(select(CmAccountRequest))).scalars()}
        assert rows == {req["id"]: "cancelled", req2["id"]: "pending"}
        row = await pg_session.get(CmAccountRequest, req2["id"])
        row.created_at = utcnow() - timedelta(days=4)
        await pg_session.commit()
        out = (await c.as_(me).get("/api/cm/account-requests")).json()["outgoing"]
        assert [x["can_dispute"] for x in out] == [True]
        assert (await c.as_(me).delete(f"/api/cm/account-requests/{req2['id']}")).status_code == 200
        assert (await c.as_(owner).get("/api/cm/account-requests")).json()["incoming"] == []
        # L'ancienne route de reprise immédiate est inchangée (toujours en place pour le site).
        assert (await pg_session.execute(select(TikTokAccount))).scalars().one().owner_user_id == owner.id


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_request_emails_in_each_recipient_language(pg_session, cmenv, tiktok, monkeypatch):
    """Chaque administrateur reçoit l'e-mail dans sa langue de Chapote CM (cm_profiles.language) ; le demandeur aussi."""
    from src.models.cm import CmProfile
    sent = []
    monkeypatch.setattr("src.routers.cm_account_requests.send_account_email",
                        lambda to, subject, text, **kw: sent.append((to, subject, text, kw.get("lang"))))
    boss = await _user(pg_session, "boss@t.dev")
    other = await _user(pg_session, "other@t.dev")
    me = await _user(pg_session, "me@t.dev")
    org = await _org(pg_session, boss, (other, "admin"))
    acc = await _account(pg_session, org=org, by=boss, open_id="oid-1")
    pg_session.add_all([CmProfile(user_id=boss.id, language="en"), CmProfile(user_id=other.id, language="fr"),
                        CmProfile(user_id=me.id, language="en")])
    await pg_session.commit()
    async with Client(pg_session) as c:
        token = await _claim_token(c, me)
        # La requête du demandeur est en français : chaque admin reçoit quand même sa langue.
        req = (await c.as_(me).post("/api/cm/account-requests", json={"claim_token": token, "message": "C'est le mien"})).json()["request"]
        mails = {tuple(m[0]): m for m in sent}
        assert set(mails) == {("boss@t.dev",), ("other@t.dev",)}
        _, subject, text, lang = mails[("boss@t.dev",)]
        assert lang == "en" and subject.startswith("Request to take over")
        assert "is asking to take over the TikTok account" in text and "Their message: “C'est le mien”" in text
        assert "Accounts tab" in text and "demande" not in text
        _, subject, text, lang = mails[("other@t.dev",)]
        assert lang is None and subject.startswith("Demande de reprise du compte")
        assert "demande à reprendre le compte TikTok" in text and "Son message : « C'est le mien »" in text
        sent.clear()
        assert (await c.as_(other).post(f"/api/cm/account-requests/{req['id']}/decline")).status_code == 200
        assert sent[-1][0] == ["me@t.dev"] and sent[-1][3] == "en" and sent[-1][1].endswith(": request declined")
        assert "declined your takeover request" in sent[-1][2]


def test_account_email_html_in_english():
    """Habillage HTML : bouton, catégorie, pied de page et <html lang> en anglais ; français inchangé sans langue."""
    from src.services.email_service import THEMES, render_email_html
    en = render_email_html("Hi Ann,\n\nhttps://x.test/a", theme=THEMES["verify"], lang="en")
    assert '<html lang="en">' in en and "Confirm my email" in en and "CONFIRMATION" in en and "Questions? support@chapote.fr" in en
    fr = render_email_html("Bonjour Ann,\n\nhttps://x.test/a", theme=THEMES["reset"])
    assert '<html lang="fr">' in fr and "Choisir un nouveau mot de passe" in fr and "Une question ? support@chapote.fr" in fr
