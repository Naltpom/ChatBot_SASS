"""E2E du parcours « Construis mon bot pour ce WP » — funnel BACKEND complet en
un seul scénario, contre une vraie base Postgres.

Là où test_account_onboarding.py et test_widget_preview.py couvrent CHAQUE
endpoint isolément, ce test prouve que la SÉQUENCE s'enchaîne avec un état
cohérent de bout en bout — exactement ce que le plugin WordPress orchestre :

  créer le bot -> découvrir les URLs -> lancer la génération -> suivre le job
  jusqu'à « done » -> enregistrer l'arbre -> recommander l'offre (palier IA +
  modules déduits de l'arbre) -> élaguer au décochage d'un module -> jeton embed
  -> ouvrir le bot via /api/embed -> sauver depuis l'éditeur embarqué -> jeton
  preview -> bootstrap + session widget en APERÇU (bot non public).

La génération IA elle-même (fetch réseau + Gemini) est remplacée par un arbre
déterministe (run_bot_generation mocké marque le job « done ») : on teste le
CÂBLAGE du funnel, pas le LLM. Harness identique aux deux suites onboarding.

NB : l'E2E navigateur complet (admin WP -> popup OAuth -> Stripe) n'est pas
automatisé ici (stack WP + Stripe test) ; voir la checklist manuelle livrée.
"""
import asyncio

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.main import app
from src.models.user import User
from src.routers import widget, widget_helpers
from src.routers.external import onboarding as ext_onboarding
from src.services import oauth_service as oauth
from src.services import onboarding_service, tree_jobs


class _RealApp:
    """Override get_db -> pg_session ; require_oauth_token / require_embed_token
    EXERCÉS (vrais JWT)."""

    def __init__(self, session: AsyncSession):
        self._session = session

    async def __aenter__(self) -> httpx.AsyncClient:
        async def _get_db():
            yield self._session

        app.dependency_overrides[get_db] = _get_db
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test")
        return self._client

    async def __aexit__(self, *exc):
        await self._client.aclose()
        app.dependency_overrides.pop(get_db, None)


async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Plug", is_active=True)
    session.add(u)
    await session.flush()
    return u


async def _plugin_token(session: AsyncSession, user: User) -> str:
    access, _refresh, _exp = await oauth._issue_token_pair(session, user.id)
    return access


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _aret(value):
    async def _inner(*a, **k):
        return value
    return _inner


# Arbre « généré » déterministe : un menu, une page service, une mise en relation
# conseiller (handoff -> module Inbox) et un repli IA (option -> __ai__ -> module
# IA). De quoi exercer la déduction de modules ET l'élagage.
_GENERATED = {"start": "root", "nodes": {
    "root": {"message": "Bonjour ! Comment puis-je vous aider ?", "options": [
        {"label": "Nos services", "next": "svc"},
        {"label": "Parler à un conseiller", "next": "adv"},
        {"label": "Autre question", "next": "__ai__"}]},
    "svc": {"message": "Voici nos services.", "options": [{"label": "Retour", "next": "root"}]},
    "adv": {"message": "Je vous mets en relation avec un conseiller.",
            "type": "handoff", "options": []}}}


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_onboarding_full_funnel_e2e(pg_session: AsyncSession, monkeypatch):
    # Billing OFF (pas de clés Stripe) : la recommandation retombe sur le palier
    # de base mais déduit quand même les modules de l'arbre.
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None, raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", None, raising=False)
    # Limiters widget ouverts (on teste le bypass d'aperçu, pas le rate-limit).
    monkeypatch.setattr(widget_helpers.ip_limiter, "check", _aret(True))
    monkeypatch.setattr(widget.session_limiter, "check", _aret(True))
    monkeypatch.setattr(ext_onboarding.treegen_limiter, "check", _aret(True))

    # Génération mockée : marque le job « done » avec l'arbre déterministe.
    async def _fake_gen(job_id, urls, context, exclude_modules=None):
        await tree_jobs._update(job_id, status="done", stage="Terminé", pct=100,
                                tree_json=_GENERATED)
    monkeypatch.setattr(onboarding_service, "run_bot_generation", _fake_gen)

    user = await _mk_user(pg_session, "e2e@test.dev")
    token = await _plugin_token(pg_session, user)
    await pg_session.commit()

    async with _RealApp(pg_session) as c:
        H = _bearer(token)

        # 1. Créer le bot (surface plugin existante).
        rb = await c.post("/api/account/bots",
                          json={"name": "Mon commerce", "mode": "hybrid"}, headers=H)
        assert rb.status_code in (200, 201), rb.text
        bot_id = rb.json()["id"]

        # 2. Découverte des URLs énumérées par le plugin WP.
        urls = ["https://moncommerce.fr/", "https://moncommerce.fr/contact",
                "https://moncommerce.fr/a-propos", "https://moncommerce.fr/produits",
                "https://moncommerce.fr/tarifs"]
        rd = await c.post(f"/api/account/bots/{bot_id}/discover-urls",
                          json={"site_url": "https://moncommerce.fr", "urls": urls}, headers=H)
        assert rd.status_code == 200, rd.text
        assert rd.json()["source"] == "plugin_list"
        picked = [s["url"] for s in rd.json()["suggested"]][:15]
        assert "https://moncommerce.fr/" in picked          # home en tête

        # 3. Lancer la génération d'arbre (job de fond).
        rg = await c.post(f"/api/account/bots/{bot_id}/generate-from-urls",
                          json={"urls": picked, "description": "Assistant commercial",
                                "visitors_per_month": 1500}, headers=H)
        assert rg.status_code == 200, rg.text
        job_id = rg.json()["job_id"]

        # 4. Suivre le job jusqu'à « done » (la tâche de fond mockée écrit l'arbre).
        tree = None
        for _ in range(40):
            rs = await c.get(
                f"/api/account/bots/{bot_id}/generate-status?job_id={job_id}", headers=H)
            assert rs.status_code == 200, rs.text
            if rs.json()["status"] == "done":
                tree = rs.json()["tree_json"]
                break
            await asyncio.sleep(0.05)
        assert tree == _GENERATED, "le job n'a pas abouti à l'arbre attendu"

        # 5. Enregistrer l'arbre généré (comme le ferait l'éditeur).
        rput = await c.put(f"/api/account/bots/{bot_id}/tree",
                           json={"tree_json": tree}, headers=H)
        assert rput.status_code == 200, rput.text

        # 6. Recommandation : IA + Inbox déduits de l'arbre (handoff + option __ai__).
        rr = await c.post(f"/api/account/bots/{bot_id}/recommendation",
                          json={"visitors_per_month": 1500,
                                "description": "Assistant commercial"}, headers=H)
        assert rr.status_code == 200, rr.text
        rec = rr.json()
        assert "inbox" in rec["required_modules"]            # handoff -> Inbox imposé
        assert {"ai", "inbox"} <= set(rec["recommended_modules"])

        # 7. L'utilisateur décoche Inbox -> prune retire la branche handoff (diff seul).
        rpr = await c.post(f"/api/account/bots/{bot_id}/tree/prune",
                           json={"kept_modules": ["ai"]}, headers=H)
        assert rpr.status_code == 200, rpr.text
        assert "adv" in rpr.json()["removed_node_ids"]
        assert "adv" not in rpr.json()["tree_json"]["nodes"]

        # 8. Jeton embed -> la surface /api/embed ouvre CE bot, avec l'arbre persisté.
        re_ = await c.post(f"/api/account/bots/{bot_id}/embed-token", headers=H)
        assert re_.status_code == 200, re_.text
        embed_tok = re_.json()["embed_token"]
        rbot = await c.get("/api/embed/bot", headers=_bearer(embed_tok))
        assert rbot.status_code == 200, rbot.text
        assert rbot.json()["id"] == bot_id
        assert rbot.json()["tree_json"] == tree
        public_key = rbot.json()["public_key"]

        # 9. L'éditeur embarqué sauvegarde via la surface embed (Bearer embed).
        rpe = await c.put("/api/embed/bot/tree", json={"tree_json": tree},
                          headers=_bearer(embed_tok))
        assert rpe.status_code == 200, rpe.text

        # 10. Jeton preview -> bootstrap widget en APERÇU (bot non public, origine
        #     étrangère) : 200 grâce au bypass d'aperçu.
        rp = await c.post(f"/api/account/bots/{bot_id}/preview-token", headers=H)
        assert rp.status_code == 200, rp.text
        preview_tok = rp.json()["preview_token"]
        rboot = await c.get(
            f"/api/widget/bootstrap?key={public_key}&preview_token={preview_tok}",
            headers={"Origin": "https://moncommerce.fr"})
        assert rboot.status_code == 200, rboot.text
        assert "design" in rboot.json()

        # 11. Session widget en aperçu (captcha + origine bypassés par le token).
        rsess = await c.post(
            f"/api/widget/session?preview_token={preview_tok}",
            json={"public_key": public_key, "visitor_id": "visitor-e2e-001"},
            headers={"Origin": "https://moncommerce.fr"})
        assert rsess.status_code == 200, rsess.text
        assert "first" in rsess.json()
