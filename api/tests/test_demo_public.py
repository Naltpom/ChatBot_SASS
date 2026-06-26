"""Tests de la démo publique « 1 URL -> chatbot » (routers/public.py + demo_service).

Sans réseau ni vraie DB : on réutilise les fixtures conftest (overrides ->
FakeSession + client httpx ASGI), on monkeypatche src.services.tree_jobs.safe_get
(point d'injection réseau du pipeline) et on s'appuie sur MOCK_AI=true (défaut) ->
generate_tree renvoie MOCK_TREE sans appeler Gemini.

Lancement : pytest tests/test_demo_public.py -q  (depuis api/).
"""
import pytest

from src.core.config import settings
from src.models.demo import DemoGeneration
from src.services import rate_limit
from src.services.safe_fetch import FetchError
from src.services.tree_generator import MOCK_TREE

RICH_HTML = "<html><body>" + "Contenu d'aide riche et exploitable. " * 8 + "</body></html>"


# --- Helpers de monkeypatch des limiteurs (déterministe, hors mémoire process) --
async def _allow(_key):
    return True


async def _deny(_key):
    return False


@pytest.fixture
def pass_limits(monkeypatch):
    """Laisse passer les 3 garde-fous (flood IP, IP/jour, global) — état mémoire
    des RateLimiter neutralisé pour des tests déterministes."""
    monkeypatch.setattr(rate_limit.ip_limiter, "check", _allow)
    monkeypatch.setattr(rate_limit.demo_ip_limiter, "check", _allow)
    monkeypatch.setattr(rate_limit.demo_global_limiter, "check", _allow)
    yield


@pytest.fixture
def fake_fetch(monkeypatch):
    """safe_get -> HTML riche, avec compteur d'appels (0 sur un cache hit)."""
    calls = {"n": 0}

    async def _safe_get(url, max_bytes):
        calls["n"] += 1
        return RICH_HTML

    monkeypatch.setattr("src.services.tree_jobs.safe_get", _safe_get)
    return calls


# --- Chemin nominal + cache --------------------------------------------------
@pytest.mark.asyncio
async def test_demo_generates_then_serves_from_cache(client, db, overrides, pass_limits, fake_fetch):
    async with client as c:
        r1 = await c.post("/api/public/demo-tree", json={"url": "https://exemple.fr/aide"})
        assert r1.status_code == 200, r1.text
        assert r1.json() == {"tree_json": MOCK_TREE, "cached": False}
        assert fake_fetch["n"] == 1
        # 1 ligne posée en cache
        rows = db.rows(DemoGeneration)
        assert len(rows) == 1 and rows[0].hits == 0

        # 2e appel MÊME URL (variante non normalisée) -> cache hit, AUCUNE IA
        r2 = await c.post("/api/public/demo-tree", json={"url": "exemple.fr/aide/"})
        assert r2.status_code == 200, r2.text
        assert r2.json() == {"tree_json": MOCK_TREE, "cached": True}
        assert fake_fetch["n"] == 1            # pas de nouveau fetch -> pas d'IA
        assert db.rows(DemoGeneration)[0].hits == 1


# --- Garde-fous --------------------------------------------------------------
@pytest.mark.asyncio
async def test_demo_disabled_404(client, db, overrides, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_ENABLED", False, raising=False)
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "https://exemple.fr"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_demo_prod_requires_turnstile_404(client, db, overrides, monkeypatch):
    # En prod sans clé Turnstile, la démo est désactivée (gate souple -> 404).
    monkeypatch.setattr(settings, "ENV", "production", raising=False)
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", None, raising=False)
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "https://exemple.fr"})
        cfg = await c.get("/api/public/demo-config")
    assert r.status_code == 404
    assert cfg.json() == {"enabled": False}


@pytest.mark.asyncio
async def test_demo_ip_quota_429(client, db, overrides, monkeypatch, fake_fetch):
    monkeypatch.setattr(rate_limit.ip_limiter, "check", _allow)
    monkeypatch.setattr(rate_limit.demo_ip_limiter, "check", _deny)   # quota IP/jour épuisé
    monkeypatch.setattr(rate_limit.demo_global_limiter, "check", _allow)
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "https://nouvelle-url.fr"})
    assert r.status_code == 429
    assert db.rows(DemoGeneration) == []   # aucune génération IA persistée


@pytest.mark.asyncio
async def test_demo_global_cap_503(client, db, overrides, monkeypatch, fake_fetch):
    monkeypatch.setattr(rate_limit.ip_limiter, "check", _allow)
    monkeypatch.setattr(rate_limit.demo_ip_limiter, "check", _allow)
    monkeypatch.setattr(rate_limit.demo_global_limiter, "check", _deny)  # plafond global atteint
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "https://autre-url.fr"})
    assert r.status_code == 503
    assert db.rows(DemoGeneration) == []


@pytest.mark.asyncio
async def test_demo_captcha_failure_403(client, db, overrides, pass_limits, monkeypatch, fake_fetch):
    async def _bad(token, ip):
        return False
    monkeypatch.setattr("src.routers.public.verify_turnstile_token", _bad)
    async with client as c:
        r = await c.post("/api/public/demo-tree",
                         json={"url": "https://site-captcha.fr", "turnstile_token": "x"})
    assert r.status_code == 403
    assert fake_fetch["n"] == 0


# --- Validation d'URL --------------------------------------------------------
@pytest.mark.asyncio
async def test_demo_invalid_url_422(client, db, overrides, pass_limits):
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "pas-une-url"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_demo_http_rejected_422(client, db, overrides, pass_limits):
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "http://exemple.fr"})
    assert r.status_code == 422
    assert "https" in r.json()["detail"]


@pytest.mark.asyncio
async def test_demo_unreachable_url_422(client, db, overrides, pass_limits, monkeypatch):
    async def _boom(url, max_bytes):
        raise FetchError("hôte injoignable")
    monkeypatch.setattr("src.services.tree_jobs.safe_get", _boom)
    async with client as c:
        r = await c.post("/api/public/demo-tree", json={"url": "https://injoignable.invalid"})
    assert r.status_code == 422
    assert "exploitable" in r.json()["detail"]


# --- Unitaire : normalisation d'URL (clé de cache) ---------------------------
def test_normalize_url_canonicalises():
    from src.services.demo_service import normalize_url, url_hash
    a = normalize_url("Exemple.FR/Aide/")
    b = normalize_url("https://exemple.fr/Aide")
    assert a == "https://exemple.fr/Aide" == b
    assert url_hash(a) == url_hash(b)
    # le fragment est ignoré, le host minusculisé
    assert normalize_url("https://EXEMPLE.fr/p#section") == "https://exemple.fr/p"
