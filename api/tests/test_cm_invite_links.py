"""cm : lien d'invitation à un groupe (création, aperçu, rejoindre, expiration, révocation, page web) et mesure
des retours dans l'app mobile (jours d'ouverture, cohortes)."""
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm_mobile import CmAppOpen, CmGroupInviteLink, CmUserIdentity

from test_cm import cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, tiktok  # noqa: F401  (fixture)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_invite_link_join_and_revoke(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    c_ = await _user(pg_session, "c@t.dev")
    a1 = await _account(pg_session, owner=a, open_id="la1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        # c.as_() change l'utilisateur du client : à appeler juste avant chaque requête.
        rg = await c.as_(a).post("/api/cm/groups", json={"name": "Contes", "accounts": [{"platform": "tiktok", "account_id": a1.id}]})
        assert rg.status_code == 200, rg.text
        g = rg.json()
        # Seul un admin du groupe crée un lien.
        assert (await c.as_(b).post(f"/api/cm/groups/{g['id']}/invite-link", json={"role": "viewer"})).status_code == 404
        r = await c.as_(a).post(f"/api/cm/groups/{g['id']}/invite-link", json={"role": "viewer"})
        assert r.status_code == 200, r.text
        link = r.json()
        token = parse_qs(urlparse(link["url"]).query)["t"][0]
        assert token == link["token"] and link["role_label"] == "Lecture seule"
        # Seule l'empreinte est stockée.
        row = (await pg_session.execute(select(CmGroupInviteLink))).scalar_one()
        assert row.token_hash != token and len(row.token_hash) == 64
        # Page web publique du lien.
        page = await c.http.get("/api/cm/join", params={"t": token})
        assert page.status_code == 200 and "Contes" in page.text and "chapotecm://join?t=" in page.text
        assert (await c.http.get("/api/cm/join", params={"t": "faux"})).status_code == 404
        # Aperçu puis rejoindre : B voit le compte du groupe, en lecture seule.
        p = (await c.as_(b).get(f"/api/cm/invite-links/{token}")).json()
        assert p["group_name"] == "Contes" and p["role"] == "viewer" and p["accounts"] == 1
        r = await c.as_(b).post(f"/api/cm/invite-links/{token}/accept")
        assert r.status_code == 200, r.text
        rows = {x["id"]: x for x in (await c.as_(b).get("/api/cm/accounts?scope=all")).json()}
        assert a1.id in rows and rows[a1.id]["role"] == "viewer" and rows[a1.id]["mine"] is False
        assert [s["email"] for s in (await c.as_(a).get(f"/api/cm/groups/{g['id']}/shares")).json()] == ["b@t.dev"]
        # Rejoindre deux fois : sans effet de bord.
        assert (await c.as_(b).post(f"/api/cm/invite-links/{token}/accept")).status_code == 200
        # Révocation : le lien ne marche plus.
        assert (await c.as_(a).delete(f"/api/cm/groups/{g['id']}/invite-link")).status_code == 200
        assert (await c.as_(c_).post(f"/api/cm/invite-links/{token}/accept")).status_code == 404
        # Expiré : refusé.
        r = (await c.as_(a).post(f"/api/cm/groups/{g['id']}/invite-link", json={"role": "editor"})).json()
        row = (await pg_session.execute(select(CmGroupInviteLink).where(CmGroupInviteLink.revoked_at.is_(None)))).scalar_one()
        row.expires_at = utcnow() - timedelta(minutes=1)
        await pg_session.commit()
        assert (await c.as_(c_).get(f"/api/cm/invite-links/{r['token']}")).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_app_opens_and_metrics(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    admin = await _user(pg_session, "root@t.dev")
    admin.is_superadmin = True
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        r = await h.post("/api/cm/mobile/devices", json={"name": "Pixel", "platform": "android"})
        assert r.status_code == 200
        token = r.json()["refresh_token"]
        c.http.cookies.clear()
        assert (await c.http.post("/api/cm/mobile/refresh", json={"refresh_token": token})).status_code == 200
        days = (await pg_session.execute(select(CmAppOpen.day).where(CmAppOpen.user_id == a.id))).scalars().all()
        assert days == [utcnow().date()]              # une ligne par jour, même après plusieurs ouvertures
        # Cohorte : inscrit il y a 3 jours, revenu au 3e jour.
        pg_session.add(CmUserIdentity(user_id=a.id, first_name="A", last_name="B", birth_date=utcnow().date().replace(year=1990),
                                      terms_version="x", terms_accepted_at=utcnow(), created_at=utcnow() - timedelta(days=3),
                                      updated_at=utcnow()))
        await pg_session.commit()
        assert (await c.as_(a).get("/api/cm/mobile/metrics")).status_code == 403
        m = (await c.as_(admin).get("/api/cm/mobile/metrics")).json()["weeks"]
        assert sum(w["signed_up"] for w in m) == 1 and sum(w["d3"] for w in m) == 1 and sum(w["d1"] for w in m) == 0


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_feedback_on_abandon(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    admin = await _user(pg_session, "root@t.dev")
    admin.is_superadmin = True
    await pg_session.commit()
    async with Client(pg_session) as c:
        assert (await c.http.post("/api/cm/mobile/feedback", json={"context": "new_post_abandon", "reason": "when"})).status_code == 401
        h = c.as_(a)
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "autre", "reason": "when"})).status_code == 400
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "new_post_abandon"})).status_code == 400
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "new_post_abandon", "reason": "when"})).status_code == 200
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "new_post_abandon", "reason": "other", "text": " pas le temps "})).status_code == 200
        assert (await c.as_(a).get("/api/cm/mobile/feedback")).status_code == 403
        rows = (await c.as_(admin).get("/api/cm/mobile/feedback")).json()
        assert [(r["reason"], r["text"]) for r in rows] == [("other", "pas le temps"), ("when", None)]


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_feedback_general(pg_session, cmenv, monkeypatch):
    """« Donner mon avis » : texte libre (2 000 caractères), sans choix proposé, copie e-mail aux superadmins."""
    from src.routers import cm_mobile
    sent = []
    monkeypatch.setattr(cm_mobile, "send_account_email", lambda to, subject, body, **kw: sent.append((to, subject, body, kw)))
    a = await _user(pg_session, "a@t.dev")
    admin = await _user(pg_session, "root@t.dev")
    admin.is_superadmin = True
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(a)
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "general"})).status_code == 400
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "general", "reason": "when", "text": "x"})).status_code == 400
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "general", "text": "y" * 2001})).status_code == 422
        long = "Je publie le soir sur 4 comptes. " * 50
        assert (await h.post("/api/cm/mobile/feedback", json={"context": "general", "text": long[:1900]})).status_code == 200
        rows = (await c.as_(admin).get("/api/cm/mobile/feedback")).json()
        assert rows[0]["context"] == "general" and len(rows[0]["text"]) > 500
    assert len(sent) == 1
    to, subject, body, kw = sent[0]
    assert to == ["root@t.dev"] and kw["reply_to"] == "a@t.dev"
    assert "a@t.dev" in body and "Je publie le soir" in body


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_contact_public(pg_session, cmenv, monkeypatch):
    """« Donner mon avis » sans compte : piège et délai minimum (succès muet), e-mail valide, copie aux superadmins."""
    from src.routers import cm_mobile
    sent = []
    monkeypatch.setattr(cm_mobile, "send_account_email", lambda to, subject, body, **kw: sent.append((to, subject, body, kw)))
    admin = await _user(pg_session, "root@t.dev")
    admin.is_superadmin = True
    await pg_session.commit()
    ok = {"name": "Léa", "email": "lea@exemple.fr", "message": "Je publie sur 3 comptes le soir.", "elapsed_ms": 9000}
    async with Client(pg_session) as c:
        assert (await c.http.get("/api/cm/mobile/contact-config")).json()["enabled"] is True
        assert (await c.http.post("/api/cm/mobile/contact", json={**ok, "website": "http://spam"})).status_code == 200
        assert (await c.http.post("/api/cm/mobile/contact", json={**ok, "elapsed_ms": 500})).status_code == 200
        assert sent == []
        assert (await c.http.post("/api/cm/mobile/contact", json={**ok, "email": "lea@exemple"})).status_code == 400
        assert (await c.http.post("/api/cm/mobile/contact", json=ok)).status_code == 200
    assert len(sent) == 1
    to, subject, body, kw = sent[0]
    assert to == ["root@t.dev"] and kw["reply_to"] == "lea@exemple.fr" and "Léa" in subject and "3 comptes" in body
