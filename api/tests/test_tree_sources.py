"""Tests du flux de génération d'arbre depuis sources (routers/tree.py).

Sans réseau ni DB réelle : on surcharge get_current_user / get_db via
app.dependency_overrides et on monkeypatch fetch_user_url / safe_probe. MOCK_AI=true
(défaut) -> generate_tree renvoie MOCK_TREE sans appeler Gemini.

Lancement : pytest tests/test_tree_sources.py -q  (depuis api/).
"""
import asyncio
import io
import json

import httpx
import pytest

from src.core.database import get_db
from src.core.security import get_current_user
from src.main import app
from src.services import safe_fetch, tree_generator
from src.services.tree_generator import MOCK_TREE


class _FakeUser:
    id = 1
    is_active = True
    is_superadmin = False


async def _fake_user():
    return _FakeUser()


async def _fake_db():
    yield None


@pytest.fixture(autouse=True)
def _overrides():
    app.dependency_overrides[get_current_user] = _fake_user
    app.dependency_overrides[get_db] = _fake_db
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _pdf_bytes(text: str = "hello") -> bytes:
    # Magic %PDF- suffit pour passer la validation d'en-tête (pdf_to_text est
    # monkeypatché dans les tests qui en dépendent).
    return b"%PDF-1.4\n" + text.encode()


# --- generate-from-sources : chemin nominal (MOCK_AI -> MOCK_TREE) ---

@pytest.mark.asyncio
async def test_generate_from_one_url_returns_mock_tree(client, monkeypatch):
    async def fake_fetch(url):
        return "Contenu d'aide riche et exploitable. " * 5

    monkeypatch.setattr("src.services.tree_jobs.fetch_user_url", fake_fetch)

    sources = json.dumps([{"url": "https://example.com/aide", "type": "aide"}])
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources", data={"sources": sources})
    assert resp.status_code == 200, resp.text
    assert resp.json()["tree_json"] == MOCK_TREE


@pytest.mark.asyncio
async def test_generate_no_usable_content_422(client, monkeypatch):
    async def fake_fetch(url):
        raise safe_fetch.FetchError("hôte injoignable")

    monkeypatch.setattr("src.services.tree_jobs.fetch_user_url", fake_fetch)
    sources = json.dumps([{"url": "https://down.example.com", "type": "site"}])
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources", data={"sources": sources})
    assert resp.status_code == 422
    assert "exploitable" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_generate_too_many_urls_422(client):
    sources = json.dumps([{"url": f"https://e{i}.com", "type": "site"} for i in range(6)])
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources", data={"sources": sources})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_too_many_pdfs_422(client):
    files = [
        ("files", ("a.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")),
        ("files", ("b.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")),
        ("files", ("c.pdf", io.BytesIO(_pdf_bytes()), "application/pdf")),
    ]
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources",
                            data={"sources": "[]"}, files=files)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_oversized_pdf_413(client, monkeypatch):
    from src.services import kb_service
    monkeypatch.setattr(kb_service, "MAX_PDF_BYTES", 10)
    monkeypatch.setattr("src.routers.tree.MAX_PDF_BYTES", 10)
    files = [("files", ("big.pdf", io.BytesIO(_pdf_bytes("x" * 100)), "application/pdf"))]
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources",
                            data={"sources": "[]"}, files=files)
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_generate_from_pdf_returns_mock_tree(client, monkeypatch):
    def fake_pdf(data):
        return ("Texte PDF assez long pour dépasser le seuil de 50 caractères utiles.", 1)

    monkeypatch.setattr("src.services.tree_jobs.pdf_to_text", fake_pdf)
    files = [("files", ("doc.pdf", io.BytesIO(_pdf_bytes()), "application/pdf"))]
    async with client as c:
        resp = await c.post("/api/tree/generate-from-sources",
                            data={"sources": "[]"}, files=files)
    assert resp.status_code == 200, resp.text
    assert resp.json()["tree_json"] == MOCK_TREE


# --- validate-url : contrat {ok, status, reason} ---

@pytest.mark.asyncio
async def test_validate_url_ok(client, monkeypatch):
    async def fake_probe(url):
        return 200

    monkeypatch.setattr("src.routers.tree.safe_probe", fake_probe)
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={"url": "https://example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "status": 200, "reason": None}


@pytest.mark.asyncio
async def test_validate_url_redirect(client, monkeypatch):
    async def fake_probe(url):
        return 301

    monkeypatch.setattr("src.routers.tree.safe_probe", fake_probe)
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={"url": "https://example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "status": 301, "reason": "redirect"}


@pytest.mark.asyncio
async def test_validate_url_http_error(client, monkeypatch):
    async def fake_probe(url):
        return 404

    monkeypatch.setattr("src.routers.tree.safe_probe", fake_probe)
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={"url": "https://example.com"})
    assert resp.json() == {"ok": False, "status": 404, "reason": "http_error"}


@pytest.mark.asyncio
async def test_validate_url_not_https(client, monkeypatch):
    async def fake_probe(url):
        raise safe_fetch.FetchError("URL invalide (https:// requis)")

    monkeypatch.setattr("src.routers.tree.safe_probe", fake_probe)
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={"url": "http://example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "status": None, "reason": "not_https"}


@pytest.mark.asyncio
async def test_validate_url_unreachable(client, monkeypatch):
    async def fake_probe(url):
        raise safe_fetch.FetchError("Hôte introuvable")

    monkeypatch.setattr("src.routers.tree.safe_probe", fake_probe)
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={"url": "https://nope.invalid"})
    assert resp.json() == {"ok": False, "status": None, "reason": "unreachable"}


@pytest.mark.asyncio
async def test_validate_url_malformed_body_422(client):
    async with client as c:
        resp = await c.post("/api/tree/validate-url", json={})
    assert resp.status_code == 422


# --- jobs + SSE : la tâche de fond produit MOCK_TREE (couvre run_generation) ---

@pytest.mark.asyncio
async def test_job_flow_produces_mock_tree(client, monkeypatch):
    async def fake_fetch(url):
        return "Contenu d'aide riche et exploitable. " * 5

    monkeypatch.setattr("src.services.tree_jobs.fetch_user_url", fake_fetch)
    from src.services import tree_jobs

    sources = json.dumps([{"url": "https://example.com/aide", "type": "aide"}])
    async with client as c:
        resp = await c.post("/api/tree/jobs", data={"sources": sources})
        assert resp.status_code == 200, resp.text
        job_id = resp.json()["job_id"]
        assert job_id
        # La tâche de fond (asyncio.create_task) tourne dans la même loop : on
        # rend la main jusqu'à son aboutissement (MOCK_AI -> MOCK_TREE), borné.
        job = None
        for _ in range(60):
            job = await tree_jobs.get(job_id)
            if job and job["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.05)
    assert job is not None and job["status"] == "done", job
    assert job["tree_json"] == MOCK_TREE
