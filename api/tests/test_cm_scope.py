"""cm.chapote.fr : vue sans « espaces » — partage par groupe (rôle par groupe, invitations), périmètre combiné
(?scope=), droits par compte, capacités, nom de l'espace perso, nombre « à valider » par groupe."""
from datetime import timedelta

import pytest

from src.core.time import utcnow

from test_cm import _send, _tt_target, cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, mp4_bytes, tiktok  # noqa: F401  (fixture)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_group_sharing_scope_and_roles(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    a1 = await _account(pg_session, owner=a, open_id="sa1")
    a2 = await _account(pg_session, owner=a, open_id="sa2")
    b1 = await _account(pg_session, owner=b, open_id="sb1")
    await pg_session.commit()
    later = (utcnow() + timedelta(days=1)).isoformat() + "Z"
    async with Client(pg_session) as c:
        ha = c.as_(a)
        g = (await ha.post("/api/cm/groups", json={"name": "Musique", "accounts": [{"platform": "tiktok", "account_id": a1.id}]})).json()
        await ha.post("/api/cm/groups", json={"name": "Privé", "accounts": [{"platform": "tiktok", "account_id": a2.id}]})
        # A partage le groupe à B en lecture seule : une équipe est créée en arrière-plan, B voit une invitation.
        r = await ha.post(f"/api/cm/groups/{g['id']}/shares", json={"email": "b@t.dev", "role": "viewer"})
        assert r.status_code == 200 and r.json()["status"] == "pending"
        assert [s["email"] for s in (await ha.get(f"/api/cm/groups/{g['id']}/shares")).json()] == ["b@t.dev"]
        hb = c.as_(b)
        inv = (await hb.get("/api/cm/invitations")).json()
        assert len(inv) == 1 and inv[0]["group_name"] == "Musique" and inv[0]["role"] == "viewer" and inv[0]["accounts"] == 1
        # Avant d'accepter : rien de A n'est visible.
        keys = {f"{x['platform']}:{x['id']}" for x in (await hb.get("/api/cm/accounts?scope=all")).json()}
        assert keys == {f"tiktok:{b1.id}"}
        r = await hb.post(f"/api/cm/invitations/{inv[0]['id']}/accept")
        assert r.status_code == 200
        org_id = r.json()["org_id"]
        assert (await hb.get("/api/cm/invitations")).json() == []
        # « Tous » : mes comptes + le groupe partagé (pas les autres comptes de A), avec propriétaire et rôle.
        rows = {f"{x['platform']}:{x['id']}": x for x in (await hb.get("/api/cm/accounts?scope=all")).json()}
        assert set(rows) == {f"tiktok:{b1.id}", f"tiktok:{a1.id}"}
        shared = rows[f"tiktok:{a1.id}"]
        assert shared["org_id"] == org_id and shared["role"] == "viewer" and shared["mine"] is False and g["id"] in shared["groups"]
        assert rows[f"tiktok:{b1.id}"]["role"] == "admin" and rows[f"tiktok:{b1.id}"]["mine"] is True
        # Groupes de « Tous » : seulement le groupe partagé (pas « Privé »), avec son org_id.
        gl = (await hb.get("/api/cm/groups?scope=all")).json()
        assert [(x["name"], x["org_id"]) for x in gl] == [("Musique", org_id)]
        # Périmètre précis, vérifié élément par élément.
        one = (await hb.get(f"/api/cm/accounts?scope=org:{org_id}/group:{g['id']}")).json()
        assert [x["id"] for x in one] == [a1.id]
        both = (await hb.get(f"/api/cm/accounts?scope=perso,acc:tiktok:{a1.id}")).json()
        assert {x["id"] for x in both} == {a1.id, b1.id}
        assert (await hb.get(f"/api/cm/accounts?scope=acc:tiktok:{a2.id}")).status_code == 404
        assert (await hb.get("/api/cm/accounts?scope=org:999999")).status_code == 404
        assert (await hb.get("/api/cm/accounts?scope=n'importe quoi")).status_code == 400
        # Capacités : où publier.
        cap = (await hb.get("/api/cm/me/capabilities")).json()
        roles = {x["key"]: x["role"] for x in cap["accounts"]}
        assert roles == {f"tiktok:{b1.id}": "admin", f"tiktok:{a1.id}": "viewer"} and cap["can_publish_any"] is True
        # Lecture seule : pas de publication sur ce compte ; « Peut publier » : oui.
        data = mp4_bytes(8_000)
        body = {"org_id": org_id, "title": "x", "video_size": len(data), "targets": [_tt_target(a1.id, scheduled_at=later)]}
        assert (await hb.post("/api/cm/posts", json=body)).status_code == 403
        await c.as_(a).post(f"/api/cm/groups/{g['id']}/shares", json={"email": "b@t.dev", "role": "editor"})
        hb = c.as_(b)
        r = await hb.post("/api/cm/posts", json=body)
        assert r.status_code == 200, r.text
        await _send(hb, r.json()["post_id"], data)
        assert (await hb.post(f"/api/cm/posts/{r.json()['post_id']}/submit")).status_code == 200
        # Planning combiné : la publication (de l'équipe) apparaît dans « Tous » de B, avec son org_id.
        hb = c.as_(b)
        posts = (await hb.get("/api/cm/posts?scope=all")).json()
        assert [p["org_id"] for p in posts] == [org_id]
        for path in ("calendar", "overview", "stats", "videos", "inbox/comments", "inbox/accounts", "assets", "proposals", "proposals/count"):
            r = await hb.get(f"/api/cm/{path}?scope=all")
            assert r.status_code == 200, (path, r.text)
        # Un périmètre combiné ne permet jamais d'écrire.
        assert (await hb.post(f"/api/cm/posts?scope=all", json={**body, "org_id": None})).status_code in (403, 404)
        # Retrait du partage : plus rien de A.
        ha = c.as_(a)
        share_id = (await ha.get(f"/api/cm/groups/{g['id']}/shares")).json()[0]["id"]
        assert (await ha.delete(f"/api/cm/groups/{g['id']}/shares/{share_id}")).status_code == 200
        keys = {f"{x['platform']}:{x['id']}" for x in (await c.as_(b).get("/api/cm/accounts?scope=all")).json()}
        assert keys == {f"tiktok:{b1.id}"}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_decline_profile_and_counts(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "a@t.dev")
    b = await _user(pg_session, "b@t.dev")
    a1 = await _account(pg_session, owner=a, open_id="da1")
    await pg_session.commit()
    async with Client(pg_session) as c:
        ha = c.as_(a)
        g = (await ha.post("/api/cm/groups", json={"name": "Clients", "accounts": [{"platform": "tiktok", "account_id": a1.id}]})).json()
        await ha.post(f"/api/cm/groups/{g['id']}/shares", json={"email": "b@t.dev", "role": "admin"})
        hb = c.as_(b)
        inv = (await hb.get("/api/cm/invitations")).json()[0]
        assert (await hb.post(f"/api/cm/invitations/{inv['id']}/decline")).json()["status"] == "declined"
        assert (await hb.get("/api/cm/accounts?scope=all")).json() == []
        # Seul l'invité répond à son invitation.
        ha = c.as_(a)
        assert (await ha.post(f"/api/cm/invitations/{inv['id']}/accept")).status_code == 404
        # Nom de l'espace perso.
        assert (await ha.get("/api/cm/profile")).json() == {"perso_name": "Espace perso", "palette": "warm",
                                                            "theme": "system", "language": "system", "prefs_rev": 0}
        assert (await ha.patch("/api/cm/profile", json={"perso_name": "Studio Nathan"})).json()["perso_name"] == "Studio Nathan"
        # Apparence partagée site / app : le numéro n'augmente que si la couleur ou le thème change.
        r = (await ha.patch("/api/cm/profile", json={"palette": "forest", "theme": "dark"})).json()
        assert (r["palette"], r["theme"], r["prefs_rev"], r["perso_name"]) == ("forest", "dark", 1, "Studio Nathan")
        assert (await ha.patch("/api/cm/profile", json={"palette": "forest"})).json()["prefs_rev"] == 1
        assert (await ha.patch("/api/cm/profile", json={"theme": "light"})).json()["prefs_rev"] == 2
        assert (await ha.patch("/api/cm/profile", json={"palette": "rose"})).status_code == 422
        # Langue, comme le thème ; réponses en anglais quand le client le demande (X-Chapote-Lang).
        r = (await ha.patch("/api/cm/profile", json={"language": "en"})).json()
        assert (r["language"], r["prefs_rev"]) == ("en", 3)
        assert (await ha.patch("/api/cm/profile", json={"language": "de"})).status_code == 422
        en = await ha.get("/api/cm/posts/999999", headers={"X-Chapote-Lang": "en"})
        assert en.status_code == 404 and en.json()["message"] == en.json()["detail"] == "Post not found"
        assert (await ha.get("/api/cm/posts/999999")).json()["message"] == "Publication introuvable"
        assert (await ha.get("/api/cm/spaces")).json()[0]["name"] == "Studio Nathan"
        # « À valider » : total et par groupe.
        cnt = (await ha.get("/api/cm/proposals/count?scope=all")).json()
        assert cnt["open"] == 0 and cnt["by_group"] == {str(g["id"]): 0}
