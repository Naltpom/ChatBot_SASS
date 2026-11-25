"""Tests des en-tetes de securite globaux (PR-03, audit §3.5/§4.8).

Verifie que le middleware FastAPI pose les en-tetes anti-clickjacking sur les
routes dashboard et les RETIRE des routes widget embarquables en iframe.

Gabarit httpx ASGI identique a test_tree_sources.py. Aucune auth requise :
- /health        -> route dashboard publique (non-widget)
- /widget-frame  -> page hote du widget, embarquable en iframe
- /uploads/*     -> assets embarquables, garde leur CSP stricte propre

Lancement : pytest tests/test_security_headers.py -q  (depuis api/).
"""
import httpx
import pytest

from src.main import app


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_dashboard_route_has_anticlickjacking_headers(client):
    async with client as c:
        resp = await c.get("/health")
    assert resp.status_code == 200
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    csp = resp.headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in csp
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    # L'app React pose des styles inline -> 'unsafe-inline' indispensable.
    assert "style-src 'self' 'unsafe-inline'" in csp
    # Scripts : pas de 'unsafe-inline' (l'IIFE anti-flash passe par un hash).
    assert "'unsafe-inline'" not in csp.split("script-src", 1)[1].split(";", 1)[0]
    # Origines tierces reellement chargees par l'app servie (cf. nginx.conf) :
    #   captcha Turnstile (/demo) en script + iframe + endpoint.
    assert "https://challenges.cloudflare.com" in csp  # script-src + frame-src
    assert "frame-src https://challenges.cloudflare.com" in csp
    #   polices distantes : Google Fonts (CSS + gstatic) + Fontshare (CSS + cdn).
    assert "https://fonts.googleapis.com" in csp
    assert "https://fonts.gstatic.com" in csp
    assert "https://api.fontshare.com" in csp
    assert "https://cdn.fontshare.com" in csp


@pytest.mark.asyncio
async def test_widget_frame_is_embeddable(client):
    # Le widget vit en iframe sur des sites tiers : aucun en-tete anti-embarquement.
    async with client as c:
        resp = await c.get("/widget-frame", params={"key": "pk_" + "a" * 12})
    assert resp.status_code == 200
    assert "X-Frame-Options" not in resp.headers
    assert "frame-ancestors" not in resp.headers.get("Content-Security-Policy", "")
    # Le durcissement non-embarquant (anti-sniffing) reste tout de meme applique.
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.asyncio
async def test_widget_frame_turnstile_and_look(client):
    # Turnstile autorisé dans l'iframe (sinon pas de jeton -> session refusée) ;
    # couleur et thème reflétés SEULEMENT s'ils sont bien formés (anti-XSS).
    async with client as c:
        ok = await c.get("/widget-frame", params={
            "key": "pk_" + "a" * 12, "color": "#C93F17", "color_text": "#ffffff", "theme": "dark"})
        bad = await c.get("/widget-frame", params={
            "key": "pk_" + "a" * 12, "color": '#fff" onload="x', "color_text": "red", "theme": "neon"})
        nohead = await c.get("/widget-frame", params={"key": "pk_" + "a" * 12, "header": "0"})
        withhead = await c.get("/widget-frame", params={"key": "pk_" + "a" * 12, "header": "<x>"})
    csp = ok.headers["Content-Security-Policy"]
    assert "frame-src https://challenges.cloudflare.com" in csp
    assert "https://challenges.cloudflare.com" in csp.split("script-src", 1)[1].split(";", 1)[0]
    assert 'data-color="#C93F17"' in ok.text
    assert 'data-color-text="#ffffff"' in ok.text
    assert 'data-theme="dark"' in ok.text
    assert 'data-header="false"' in nohead.text and "data-header" not in withhead.text
    assert "data-color" not in bad.text and "data-theme" not in bad.text
    assert "onload" not in bad.text


@pytest.mark.asyncio
async def test_uploads_csp_not_clobbered(client):
    # /uploads conserve sa CSP stricte propre (default-src 'none') posee par
    # widget_cors : le middleware securite ne doit pas l'ecraser ni l'embarquer.
    async with client as c:
        resp = await c.get("/uploads/does-not-exist.png")
    assert "X-Frame-Options" not in resp.headers
    csp = resp.headers.get("Content-Security-Policy", "")
    assert "default-src 'none'" in csp
    assert "frame-ancestors" not in csp
