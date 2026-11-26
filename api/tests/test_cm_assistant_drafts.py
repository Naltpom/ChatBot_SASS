"""Assistant Chapote CM : préparer une publication en discutant (brouillon + liens « Lancer » / « Ouvrir »).

De bout en bout avec de vrais jetons et accords : search_actions / execute_action, recherche dans la
bibliothèque, créneaux, création du brouillon, lancement par le lien signé (mêmes vérifications que la main).
"""
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from src.core.time import utcnow
from src.models.cm import CmAsset, CmPost, CmProposal, CmSource, CmTarget, T_SCHEDULED
from src.services import cm_assistant as ca

from test_cm import cmenv  # noqa: F401  (fixture)
from test_cm_assistant import _consent, _token, assistant  # noqa: F401  (fixture)
from test_tiktok import Client, _account, _user, tiktok  # noqa: F401  (fixture)


async def _setup(db):
    a = await _user(db, "alice@t.dev")
    b = await _user(db, "bob@t.dev")
    a1 = await _account(db, owner=a, open_id="oid-alice", display_name="alice.secret")
    src = CmSource(owner_user_id=a.id, created_by_user_id=a.id, folder_id="fa", provider="gdrive", name="ghost-hands")
    other = CmSource(owner_user_id=b.id, created_by_user_id=b.id, folder_id="fb", provider="gdrive", name="bob")
    db.add_all([src, other])
    await db.flush()
    paul = CmAsset(source_id=src.id, file_id="f1", name="Paul's Dream (excerpt) (Piano).mp4", title="Paul's Dream (excerpt) (Piano)",
                   size=1000, duration_sec=112.0, mime_type="video/mp4", drive_created_at=utcnow())
    db.add_all([paul, CmAsset(source_id=other.id, file_id="f2", name="Paul secret de Bob.mp4", size=10)])
    # Une vidéo déjà programmée demain à 19 h 10 (Paris) : le créneau voisin est pris.
    p = CmPost(owner_user_id=a.id, user_id=a.id, title="déjà prévue", video_size=1, status="READY")
    db.add(p)
    await db.flush()
    db.add(CmTarget(post_id=p.id, platform="tiktok", account_id=a1.id, status=T_SCHEDULED,
                    scheduled_at=utcnow() + timedelta(days=1)))
    await db.commit()
    return a, b, a1, paul


async def _run(token, name, args):
    text, err = await ca.run_tool(token, name, args)
    return text, err


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_prepare_then_launch_from_chat(pg_session, assistant, tiktok):
    a, b, a1, paul = await _setup(pg_session)
    async with Client(pg_session) as c:
        ha = c.as_(a)
        await _consent(ha, captions=True)
        await ha.put(f"/api/cm/assistant/accounts/tiktok/{a1.id}/permissions",
                     json={"stats": True, "planning": True, "captions": True})
        token = await _token(ha)

    # 1er niveau : le modèle trouve l'action utile et ses arguments.
    found, err = await _run(token, "search_actions", {"query": "trouver une vidéo dans la bibliothèque"})
    assert not err and json.loads(found)["actions"][0]["action"] == "library_search"

    # Recherche sans accents ni casse, jamais dans la bibliothèque des autres.
    out, err = await _run(token, "execute_action", {"action": "library_search", "arguments": {"query": "paul DREAM"}})
    assert not err, out
    vids = json.loads(out)["videos"]
    assert [v["video_id"] for v in vids] == [paul.id] and "Bob" not in out

    # Créneaux : jamais dans le passé, jamais à moins d'une heure d'une autre vidéo du compte.
    out, err = await _run(token, "execute_action", {"action": "suggest_slots",
                                                    "arguments": {"accounts": ["Compte TikTok 1"], "days": 3}})
    assert not err, out
    slots = json.loads(out)["creneaux"]
    assert slots
    busy = (await pg_session.execute(select(CmTarget.scheduled_at))).scalars().all()
    from datetime import datetime
    from zoneinfo import ZoneInfo
    for s in slots:
        utc = datetime.strptime(s["quand"], "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Europe/Paris")) \
            .astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        assert utc > utcnow() + timedelta(minutes=14)
        assert all(abs(b_ - utc) >= timedelta(minutes=60) for b_ in busy)

    # Brouillon : TikTok demande qui peut voir la vidéo (jamais choisi à la place de l'utilisateur).
    args = {"video_id": paul.id, "accounts": ["Compte TikTok 1"], "when": slots[0]["quand"],
            "title": "Paul's Dream", "caption": "Dune au piano #piano"}
    out, err = await _run(token, "create_draft", args)
    assert err and "privacy_level" in out
    args["per_account"] = {"Compte TikTok 1": {"privacy_level": "PUBLIC_TO_EVERYONE", "allow_comment": True}}
    args["ai_generated"] = False
    out, err = await _run(token, "execute_action", {"action": "create_draft", "arguments": args})
    assert not err, out
    res = json.loads(out)
    launch, open_ = res["liens"]
    assert launch["label"] == "Lancer la programmation" and open_["label"] == "Ouvrir le brouillon"
    prop = (await pg_session.execute(select(CmProposal))).scalar_one()
    assert prop.origin == "assistant" and prop.accounts == [f"tiktok:{a1.id}"]
    assert prop.options[f"tiktok:{a1.id}"]["privacy_level"] == "PUBLIC_TO_EVERYONE"
    assert urlparse(open_["url"]).path == f"/brouillon/{prop.id}"

    sig = parse_qs(urlparse(launch["url"]).query)["s"][0]
    async with Client(pg_session) as c:
        launch_url = f"/api/cm/proposals/{prop.id}/launch"
        # Lien abîmé ou utilisé par une autre personne : rien ne part.
        assert (await c.as_(a).post(launch_url, json={"s": sig[:-2] + "00"})).status_code == 409
        assert (await c.as_(b).post(launch_url, json={"s": sig})).status_code == 404
        # Le bon lien programme le brouillon tel qu'il a été montré, une seule fois.
        r = await c.as_(a).post(launch_url, json={"s": sig})
        assert r.status_code == 200, r.text
        pid = r.json().get("post_id") or r.json().get("id")
        t = (await pg_session.execute(select(CmTarget).where(CmTarget.post_id == pid))).scalar_one()
        assert t.status == "SCHEDULED" and t.options["privacy_level"] == "PUBLIC_TO_EVERYONE" and t.account_id == a1.id
        assert (await c.as_(a).post(launch_url, json={"s": sig})).status_code == 409
    await pg_session.refresh(prop)
    assert prop.status == "used"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_read_only_and_link_after_edit(pg_session, assistant, tiktok):
    a, b, a1, paul = await _setup(pg_session)
    async with Client(pg_session) as c:
        ha = c.as_(a)
        await _consent(ha, captions=True)
        await ha.put(f"/api/cm/assistant/accounts/tiktok/{a1.id}/permissions",
                     json={"stats": True, "planning": True, "captions": True})
        token = await _token(ha)
    when = (utcnow() + timedelta(days=3)).strftime("%Y-%m-%d") + " 20:30"
    args = {"video_id": paul.id, "accounts": ["Compte TikTok 1"], "when": when,
            "per_account": {"Compte TikTok 1": {"privacy_level": "SELF_ONLY"}}}
    out, err = await _run(token, "create_draft", args)
    assert not err, out
    sig = parse_qs(urlparse(json.loads(out)["liens"][0]["url"]).query)["s"][0]
    # Le brouillon change (nouvelle proposition de l'assistant) : l'ancien lien ne vaut plus.
    args["when"] = (utcnow() + timedelta(days=4)).strftime("%Y-%m-%d") + " 20:30"
    out2, err = await _run(token, "create_draft", args)
    assert not err
    prop = (await pg_session.execute(select(CmProposal))).scalar_one()
    async with Client(pg_session) as c:
        r = await c.as_(a).post(f"/api/cm/proposals/{prop.id}/launch", json={"s": sig})
        assert r.status_code == 409
    # Vidéo d'une autre personne, compte inconnu, heure passée : refusés.
    for bad, why in [({**args, "video_id": paul.id + 1}, "introuvable"), ({**args, "accounts": ["Compte TikTok 9"]}, "aucun compte"),
                     ({**args, "when": "2020-01-01 10:00"}, "trop proche")]:
        out, err = await _run(token, "create_draft", bad)
        assert err and why in out.lower(), out
