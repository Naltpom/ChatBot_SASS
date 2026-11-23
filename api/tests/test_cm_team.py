"""cm.chapote.fr : rôles d'équipe (admin / éditeur / lecteur, limitation par groupes), un compte
connecté dans un seul espace, transferts et reprise par preuve.

TikTok est simulé (fixture `tiktok` de test_tiktok) ; vraie base jetable.
"""
from datetime import timedelta

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmGroup, CmGroupAccount, CmMemberRole, CmPost, CmTarget, CmTransfer
from src.models.tiktok import TikTokAccount
from src.models.user import Invitation, Membership

from test_cm import _ig_routine, _tt_target, _send, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _org, _state, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)


async def _plan(h, targets, **kw):
    data = mp4_bytes(8_000)
    body = {"title": "x", "file_name": "c.mp4", "video_size": len(data), "targets": targets, **kw}
    r = await h.post("/api/cm/posts", json=body)
    assert r.status_code == 200, r.text
    await _send(h, r.json()["post_id"], data)
    r = await h.post(f"/api/cm/posts/{r.json()['post_id']}/submit")
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# Rôles et périmètre
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_roles_and_group_scope(pg_session, cmenv, tiktok):
    boss = await _user(pg_session, "boss@t.dev")
    editor = await _user(pg_session, "edit@t.dev")
    viewer = await _user(pg_session, "voir@t.dev")
    org = await _org(pg_session, boss, (editor, "member"), (viewer, "member"))
    a1 = await _account(pg_session, org=org, by=boss, open_id="o1")
    a2 = await _account(pg_session, org=org, by=boss, open_id="o2")
    g = CmGroup(organization_id=org.id, name="Clients musique")
    pg_session.add(g)
    await pg_session.flush()
    pg_session.add(CmGroupAccount(group_id=g.id, platform="tiktok", account_id=a1.id))
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        hb = c.as_(boss)
        team = (await hb.get(f"/api/cm/team?org_id={org.id}")).json()
        assert team["my_role"] == "admin" and team["can_manage_members"] is True
        assert {m["email"]: m["cm_role"] for m in team["members"]} == {"boss@t.dev": "admin", "edit@t.dev": "editor", "voir@t.dev": "editor"}
        assert (await hb.patch(f"/api/cm/team/{org.id}/members/voir@t.dev", json={"role": "viewer"})).status_code == 200
        r = await hb.patch(f"/api/cm/team/{org.id}/members/edit@t.dev", json={"role": "editor", "group_ids": [g.id]})
        assert r.status_code == 200
        r = await hb.patch(f"/api/cm/team/{org.id}/members/boss@t.dev", json={"role": "viewer"})
        assert r.status_code == 400                                       # admin d'équipe = toujours admin
        await _plan(hb, [_tt_target(a1.id, scheduled_at=later), _tt_target(a2.id, scheduled_at=later)], org_id=org.id)

        # Éditeur limité au groupe : un seul compte visible, planning filtré, pas d'accès à a2.
        he = c.as_(editor)
        assert [a["id"] for a in (await he.get(f"/api/cm/accounts?org_id={org.id}")).json()] == [a1.id]
        posts = (await he.get(f"/api/cm/posts?org_id={org.id}")).json()
        assert [t["account_id"] for t in posts[0]["targets"]] == [a1.id]
        r = await he.post("/api/cm/posts", json={"org_id": org.id, "title": "x", "video_size": 10, "targets": [_tt_target(a2.id)]})
        assert r.status_code == 404
        hidden = (await pg_session.execute(select(CmTarget).where(CmTarget.account_id == a2.id))).scalar_one()
        assert (await he.post(f"/api/cm/targets/{hidden.id}/cancel")).status_code == 404
        assert [x["id"] for x in (await he.get(f"/api/cm/groups?org_id={org.id}")).json()] == [g.id]
        r = await he.post("/api/cm/groups", json={"org_id": org.id, "name": "y", "accounts": []})
        assert r.status_code == 403 and "éditeur" in r.json()["detail"]
        assert (await he.post("/api/tiktok/oauth/start", json={"org_id": org.id, "app": "cm"})).status_code == 403

        # Lecteur : voit tout, ne modifie rien.
        hv = c.as_(viewer)
        assert len((await hv.get(f"/api/cm/accounts?org_id={org.id}")).json()) == 2
        r = await hv.post("/api/cm/posts", json={"org_id": org.id, "title": "x", "video_size": 10, "targets": [_tt_target(a1.id)]})
        assert r.status_code == 403 and "lecteur" in r.json()["detail"]
        assert (await hv.post(f"/api/cm/targets/{hidden.id}/cancel")).status_code == 403
        spaces = {s["org_id"]: s for s in (await hv.get("/api/cm/spaces")).json()}
        assert spaces[org.id]["cm_role"] == "viewer"
        # Seul un admin d'équipe invite.
        assert (await hv.post(f"/api/cm/team/{org.id}/members", json={"email": "x@t.dev"})).status_code == 403


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_invite_existing_and_new_people(pg_session, cmenv):
    boss = await _user(pg_session, "boss@t.dev")
    known = await _user(pg_session, "known@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(boss)
        org_id = (await h.post("/api/cm/team", json={"name": "Studio"})).json()["org_id"]
        r = await h.post(f"/api/cm/team/{org_id}/members", json={"email": "Known@t.dev", "role": "viewer"})
        assert r.status_code == 200 and r.json()["joined"] is True
        r = await h.post(f"/api/cm/team/{org_id}/members", json={"email": "nouveau@t.dev", "role": "editor"})
        assert r.status_code == 200 and r.json()["joined"] is False
        assert (await h.post(f"/api/cm/team/{org_id}/members", json={"email": "known@t.dev"})).status_code == 409
        team = (await h.get(f"/api/cm/team?org_id={org_id}")).json()
        assert {m["email"]: m["cm_role"] for m in team["members"]}["known@t.dev"] == "viewer"
        assert [(i["email"], i["cm_role"]) for i in team["invitations"]] == [("nouveau@t.dev", "editor")]
        inv = (await pg_session.execute(select(Invitation))).scalar_one()
        assert (await h.delete(f"/api/cm/team/{org_id}/invitations/{inv.id}")).status_code == 200
        assert (await h.delete(f"/api/cm/team/{org_id}/members/{known.id}")).status_code == 200
        assert (await pg_session.execute(select(CmMemberRole))).scalars().all() == []
        assert (await h.delete(f"/api/cm/team/{org_id}/members/{boss.id}")).status_code == 422   # dernier admin


# --------------------------------------------------------------------------
# Un compte = un seul espace ; transfert ; reprise par preuve
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_account_connected_elsewhere_is_refused_then_claimed(pg_session, cmenv, tiktok):
    stagiaire = await _user(pg_session, "stagiaire@t.dev")
    referent = await _user(pg_session, "cm@t.dev")
    acc = await _account(pg_session, owner=stagiaire, open_id="oid-1")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=2)).isoformat() + "Z"
    async with Client(pg_session) as c:
        await _plan(c.as_(stagiaire), [_tt_target(acc.id, scheduled_at=later)])
        # Le référent connecte le même compte TikTok : refusé, avec la preuve de reprise.
        h = c.as_(referent)
        r = await h.post("/api/tiktok/oauth/exchange", json={"code": "ok", "state": _state(referent.id)})
        assert r.status_code == 409
        d = r.json()["detail"]
        assert d["code"] == "account_taken" and "Rapprochez-vous" in d["message"] and d["claim_token"]
        assert (await pg_session.execute(select(TikTokAccount))).scalars().all() == [acc]
        # Jeton de reprise : lié à la personne, usage unique.
        assert (await c.as_(stagiaire).post("/api/cm/accounts/claim", json={"claim_token": d["claim_token"]})).status_code == 400
        r = await c.as_(referent).post("/api/cm/accounts/claim", json={"claim_token": d["claim_token"]})
        assert r.status_code == 200 and r.json()["moved_targets"] == 1
        assert (await c.as_(referent).post("/api/cm/accounts/claim", json={"claim_token": d["claim_token"]})).status_code == 400
        await pg_session.refresh(acc)
        assert acc.owner_user_id == referent.id and acc.connected_by_user_id == referent.id
        assert [a["id"] for a in (await c.as_(referent).get("/api/cm/accounts")).json()] == [acc.id]
        assert (await c.as_(stagiaire).get("/api/cm/accounts")).json() == []
        # Le planning à venir a suivi le compte.
        assert len((await c.as_(referent).get("/api/cm/posts")).json()) == 1
        assert (await c.as_(stagiaire).get("/api/cm/posts")).json() == []


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_own_other_space_and_direct_transfer_splits_mixed_posts(pg_session, cmenv, tiktok):
    u = await _user(pg_session, "a@t.dev")
    org = await _org(pg_session, u)
    acc = await _account(pg_session, owner=u, open_id="oid-1")
    other = await _account(pg_session, owner=u, open_id="oid-2")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=2)).isoformat() + "Z"
    async with Client(pg_session) as c:
        h = c.as_(u)
        await _plan(h, [_tt_target(acc.id, scheduled_at=later), _tt_target(other.id, scheduled_at=later)])
        # Connecter le même compte dans l'équipe : refusé, sans reprise (c'est son propre espace).
        r = await h.post("/api/tiktok/oauth/exchange", json={"code": "ok", "state": _state(u.id, org.id)})
        assert r.status_code == 409 and "votre espace perso" in r.json()["detail"]["message"]
        assert "claim_token" not in r.json()["detail"]
        # Transfert direct vers l'équipe : la publication commune est coupée en deux.
        r = await h.post(f"/api/cm/accounts/tiktok/{acc.id}/transfer", json={"to_org_id": org.id})
        assert r.status_code == 200 and r.json()["moved_targets"] == 1
        perso = (await h.get("/api/cm/posts")).json()
        team = (await h.get(f"/api/cm/posts?org_id={org.id}")).json()
        assert [t["account_id"] for t in perso[0]["targets"]] == [other.id]
        assert [t["account_id"] for t in team[0]["targets"]] == [acc.id]
        p1, p2 = (await pg_session.execute(select(CmPost).order_by(CmPost.id))).scalars().all()
        assert p1.media_path != p2.media_path and open(p1.media_path, "rb").read() == open(p2.media_path, "rb").read()


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_transfer_to_someone_else_needs_acceptance(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    intruder = await _user(pg_session, "x@t.dev")
    acc = await _account(pg_session, owner=a, open_id="oid-1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(a).post(f"/api/cm/accounts/tiktok/{acc.id}/transfer", json={"to_email": "B@t.dev"})
        assert r.status_code == 200 and r.json()["pending"] is True
        # Rien ne bouge avant l'acceptation ; personne d'autre ne peut accepter.
        await pg_session.refresh(acc)
        assert acc.owner_user_id == a.id
        tr = (await c.as_(b).get("/api/cm/transfers")).json()["incoming"][0]
        assert tr["account_name"] == "studio.demo" and tr["from"] == "a"
        assert (await c.as_(intruder).post(f"/api/cm/transfers/{tr['id']}/accept", json={})).status_code == 404
        assert (await c.as_(intruder).get("/api/cm/transfers")).json()["incoming"] == []
        r = await c.as_(b).post(f"/api/cm/transfers/{tr['id']}/accept", json={})
        assert r.status_code == 200, r.text
        await pg_session.refresh(acc)
        assert acc.owner_user_id == b.id
        assert (await c.as_(b).post(f"/api/cm/transfers/{tr['id']}/accept", json={})).status_code == 409
        assert (await pg_session.execute(select(CmTransfer))).scalar_one().status == "accepted"
        # Un compte d'un autre espace ne peut pas être transféré par quelqu'un d'extérieur.
        assert (await c.as_(a).post(f"/api/cm/accounts/tiktok/{acc.id}/transfer", json={"to_email": "a2@t.dev"})).status_code == 404


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_routine_instagram_username_unique(pg_session, cmenv):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    await _ig_routine(pg_session, owner=a, username="ghosthands.music")
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.as_(b).post("/api/cm/instagram/routine-accounts", json={"username": "@GhostHands.music"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "account_taken"


# --------------------------------------------------------------------------
# Partage par compte / par groupe, page Personnes
# --------------------------------------------------------------------------

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_share_account_from_personal_space(pg_session, cmenv, tiktok):
    me = await _user(pg_session, "moi@t.dev")
    friend = await _user(pg_session, "ami@t.dev")
    a1 = await _account(pg_session, owner=me, open_id="p1")
    a2 = await _account(pg_session, owner=me, open_id="p2")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        hm = c.as_(me)
        await _plan(c.as_(me), [_tt_target(a1.id, scheduled_at=later)])
        sp = (await c.as_(me).get("/api/cm/spaces")).json()
        assert sp[0]["org_id"] is None and sp[0]["accounts"] == 2
        # Partager un compte : l'espace perso devient partageable, tout y passe.
        r = await c.as_(me).post("/api/cm/shares", json={"email": "ami@t.dev", "role": "editor", "platform": "tiktok", "account_id": a1.id})
        assert r.status_code == 200, r.text
        org_id = r.json()["org_id"]
        assert org_id
        await pg_session.refresh(a2)
        assert a2.organization_id == org_id and a2.owner_user_id is None
        assert len((await c.as_(me).get(f"/api/cm/posts?org_id={org_id}")).json()) == 1
        sp = {s["org_id"]: s for s in (await c.as_(me).get("/api/cm/spaces")).json()}
        assert sp[None]["accounts"] == 0 and sp[org_id]["accounts"] == 2 and sp[org_id]["owner"] is True

        # L'ami ne voit que le compte partagé.
        hf = c.as_(friend)
        assert [a["id"] for a in (await c.as_(friend).get(f"/api/cm/accounts?org_id={org_id}")).json()] == [a1.id]
        sf = {s["org_id"]: s for s in (await c.as_(friend).get("/api/cm/spaces")).json()}
        assert sf[org_id]["owner_name"] and sf[org_id]["cm_role"] == "editor"
        assert (await c.as_(friend).post("/api/cm/shares", json={"org_id": org_id, "email": "x@t.dev", "platform": "tiktok", "account_id": a1.id})).status_code == 403

        # Deuxième partage : union.
        r = await c.as_(me).post("/api/cm/shares", json={"org_id": org_id, "email": "ami@t.dev", "role": "editor", "platform": "tiktok", "account_id": a2.id})
        assert r.status_code == 200, r.text
        assert len((await c.as_(friend).get(f"/api/cm/accounts?org_id={org_id}")).json()) == 2
        acc = await c.as_(me).get(f"/api/cm/shares/tiktok/{a2.id}?org_id={org_id}")
        assert {p["email"] for p in acc.json()} == {"moi@t.dev", "ami@t.dev"}

        # Filtre compte unique.
        assert len((await c.as_(me).get(f"/api/cm/accounts?org_id={org_id}&account=tiktok:{a2.id}")).json()) == 1
        assert (await c.as_(me).get(f"/api/cm/accounts?org_id={org_id}&account=tiktok:x")).status_code == 400

        # Personnes : restreindre, passer lecteur, retirer.
        ppl = (await c.as_(me).get(f"/api/cm/people?org_id={org_id}")).json()
        assert ppl["can_manage"] and {p["email"]: p["role"] for p in ppl["people"]} == {"moi@t.dev": "admin", "ami@t.dev": "editor"}
        r = await c.as_(me).patch("/api/cm/people", json={"org_id": org_id, "email": "ami@t.dev", "role": "viewer", "all": False, "accounts": [f"tiktok:{a2.id}"]})
        assert r.status_code == 200, r.text
        assert [a["id"] for a in (await c.as_(friend).get(f"/api/cm/accounts?org_id={org_id}")).json()] == [a2.id]
        assert (await c.as_(me).patch("/api/cm/people", json={"org_id": org_id, "email": "moi@t.dev", "role": "viewer"})).status_code == 400
        assert (await c.as_(me).post("/api/cm/people/remove", json={"org_id": org_id, "email": "moi@t.dev"})).status_code == 400
        assert (await c.as_(me).post("/api/cm/people/remove", json={"org_id": org_id, "email": "ami@t.dev"})).status_code == 200
        assert (await c.as_(friend).get(f"/api/cm/accounts?org_id={org_id}")).status_code in (403, 404)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_share_group_and_admin_invite(pg_session, cmenv, tiktok):
    boss = await _user(pg_session, "chef@t.dev")
    org = await _org(pg_session, boss)
    a1 = await _account(pg_session, org=org, by=boss, open_id="g1")
    await _account(pg_session, org=org, by=boss, open_id="g2")
    g = CmGroup(organization_id=org.id, name="Musique")
    pg_session.add(g)
    await pg_session.flush()
    pg_session.add(CmGroupAccount(group_id=g.id, platform="tiktok", account_id=a1.id))
    await pg_session.commit()
    mate = await _user(pg_session, "monteur@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        hb = c.as_(boss)
        r = await c.as_(boss).post("/api/cm/shares", json={"org_id": org.id, "email": "monteur@t.dev", "role": "viewer", "group_id": g.id})
        assert r.status_code == 200 and r.json()["org_id"] == org.id
        hm = c.as_(mate)
        assert [a["id"] for a in (await c.as_(mate).get(f"/api/cm/accounts?org_id={org.id}")).json()] == [a1.id]
        # Invitation (pas encore de compte) en admin : accès à tout.
        r = await c.as_(boss).post("/api/cm/shares", json={"org_id": org.id, "email": "Nouveau@t.dev", "role": "admin", "all": True})
        assert r.status_code == 200 and r.json()["invited"] is True
        inv = (await pg_session.execute(select(Invitation).where(Invitation.email == "nouveau@t.dev"))).scalar_one()
        assert inv.role == "admin"
        ppl = {p["email"]: p for p in (await c.as_(boss).get(f"/api/cm/people?org_id={org.id}")).json()["people"]}
        assert ppl["nouveau@t.dev"]["pending"] and ppl["nouveau@t.dev"]["role"] == "admin"
        assert ppl["monteur@t.dev"]["scope"] == {"all": False, "groups": [g.id], "accounts": []}
        # Le monteur passe admin : accès à tout, membre admin de l'équipe.
        r = await c.as_(boss).patch("/api/cm/people", json={"org_id": org.id, "email": "monteur@t.dev", "role": "admin"})
        assert r.status_code == 200
        assert len((await c.as_(mate).get(f"/api/cm/accounts?org_id={org.id}")).json()) == 2
        m = (await pg_session.execute(select(Membership).where(Membership.user_id == mate.id))).scalar_one()
        await pg_session.refresh(m)
        assert m.role == "admin"
