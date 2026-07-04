"""Tests de la défense anti-SSRF (services/safe_fetch.py) — exerce RÉELLEMENT
`resolve_public_ip` (angle mort de l'audit : garde jusqu'ici entièrement mockée).

On vérifie les invariants de sécurité sans réseau : les IP littérales privées /
loopback / link-local sont résolues localement par getaddrinfo (aucun DNS), et la
résolution DNS d'un hostname est mockée pour couvrir la préférence IPv4 et le
rejet « rebinding » (une seule IP non publique parmi plusieurs suffit à refuser).

On verrouille aussi le correctif PR-01 : `fetch_page_text` (génération d'arbre par
URL) ne fait plus de fetch laxiste et rejette http:// + IP internes via FetchError.

Lancement : pytest tests/test_safe_fetch.py -q  (depuis api/).
"""
import socket

import pytest

from src.services.safe_fetch import (
    FetchError, _read_bounded, pin_url, resolve_public_ip,
)
from src.services.tree_generator import TreeGenerationError, fetch_page_text


def _ai_v4(ip: str):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))


def _ai_v6(ip: str):
    return (socket.AF_INET6, socket.SOCK_STREAM, 6, "", (ip, 0, 0, 0))


# --- resolve_public_ip : schéma + IP littérales (aucun mock, aucun réseau) ----

@pytest.mark.asyncio
async def test_resolve_rejects_non_https():
    with pytest.raises(FetchError):
        await resolve_public_ip("http://example.com/")


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "https://127.0.0.1/",            # loopback v4
    "https://169.254.169.254/meta",  # link-local (métadonnées cloud)
    "https://10.0.0.1/",             # privé RFC1918
    "https://192.168.1.1/",          # privé RFC1918
    "https://[::1]/",                # loopback v6
])
async def test_resolve_rejects_internal_literal_ip(url):
    # getaddrinfo résout une IP littérale localement -> pas de DNS, déterministe.
    with pytest.raises(FetchError):
        await resolve_public_ip(url)


@pytest.mark.asyncio
@pytest.mark.parametrize("ipv6_literal", [
    "https://[64:ff9b::a9fe:a9fe]/",   # NAT64 -> 169.254.169.254 (passe is_global !)
    "https://[2002:a9fe:a9fe::]/",     # 6to4 -> 169.254.169.254
    "https://[::ffff:7f00:1]/",        # IPv4-mapped -> 127.0.0.1
    "https://[::ffff:a00:1]/",         # IPv4-mapped -> 10.0.0.1
])
async def test_resolve_rejects_ipv6_transition_to_internal(ipv6_literal):
    # Adresses IPv6 encapsulant une IPv4 interne : l'IPv4 embarquée est re-validée.
    with pytest.raises(FetchError):
        await resolve_public_ip(ipv6_literal)


@pytest.mark.asyncio
async def test_resolve_accepts_genuine_public_ipv6(monkeypatch):
    async def fake_getaddrinfo(host, port, *a, **k):
        return [_ai_v6("2606:2800:220:1:248:1893:25c8:1946")]

    import asyncio
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    ip = await resolve_public_ip("https://ipv6.example/")
    assert ip == "2606:2800:220:1:248:1893:25c8:1946"


# --- resolve_public_ip : résolution DNS mockée (public / rebinding) -----------

@pytest.mark.asyncio
async def test_resolve_accepts_public_and_prefers_ipv4(monkeypatch):
    async def fake_getaddrinfo(host, port, *a, **k):
        return [_ai_v6("2606:2800:220:1:248:1893:25c8:1946"),
                _ai_v4("93.184.216.34")]

    import asyncio
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    ip = await resolve_public_ip("https://example.com/aide")
    assert ip == "93.184.216.34"  # IPv4 publique préférée


@pytest.mark.asyncio
async def test_resolve_rejects_rebinding_mixed_record(monkeypatch):
    # Un enregistrement public ET un privé : TOUTES les IP doivent être publiques
    # (anti DNS-rebinding) -> rejet global.
    async def fake_getaddrinfo(host, port, *a, **k):
        return [_ai_v4("93.184.216.34"), _ai_v4("10.0.0.5")]

    import asyncio
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(FetchError):
        await resolve_public_ip("https://rebind.example/")


# --- pin_url : épinglage sur l'IP, Host/SNI = hostname d'origine --------------

def test_pin_url_pins_ip_keeps_host_header():
    pinned, host_header, hostname = pin_url("https://example.com/aide?x=1", "93.184.216.34")
    assert pinned == "https://93.184.216.34/aide?x=1"
    assert host_header == "example.com"
    assert hostname == "example.com"


def test_pin_url_ipv6_bracketed_and_keeps_port():
    pinned, host_header, hostname = pin_url("https://example.com:8443/p", "2606:2800::1")
    assert pinned == "https://[2606:2800::1]:8443/p"
    assert host_header == "example.com:8443"


# --- _read_bounded : lecture coupée à la borne --------------------------------

class _FakeResp:
    def __init__(self, chunks):
        self._chunks = chunks

    async def aiter_bytes(self):
        for c in self._chunks:
            yield c


@pytest.mark.asyncio
async def test_read_bounded_truncates_to_max():
    resp = _FakeResp([b"a" * 100, b"b" * 100, b"c" * 100])
    out = await _read_bounded(resp, 150)
    assert len(out) == 150
    assert out == b"a" * 100 + b"b" * 50


# --- safe_get_follow : redirections re-validées + troncature bout-en-bout -----
# On simule la couche réseau (httpx.AsyncClient) SANS toucher resolve_public_ip :
# l'URL de départ est une IP littérale PUBLIQUE (résolue localement, sans DNS),
# pour exercer pour de vrai la résolution + l'épinglage + la boucle de redirection.

def _fake_httpx_client(responses):
    """Fabrique une classe httpx.AsyncClient bidon : chaque appel .stream() rend
    la réponse suivante de `responses` (objets avec status_code/headers/aiter_bytes)."""
    seq = iter(responses)

    class _Ctx:
        async def __aenter__(self):
            return next(seq)

        async def __aexit__(self, *a):
            return False

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **k):
            return _Ctx()

    return _Client


class _Resp:
    def __init__(self, status_code, *, headers=None, body=b""):
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body

    async def aiter_bytes(self):
        if self._body:
            yield self._body


@pytest.mark.asyncio
async def test_safe_get_follow_rejects_redirect_to_internal_http(monkeypatch):
    # 1er saut (IP publique) -> 302 vers http://10.0.0.1/ : le saut suivant repasse
    # par resolve_public_ip qui refuse (non https + IP privée) -> FetchError.
    from src.services import safe_fetch
    monkeypatch.setattr(
        safe_fetch.httpx, "AsyncClient",
        _fake_httpx_client([_Resp(302, headers={"location": "http://10.0.0.1/"})]),
    )
    with pytest.raises(FetchError):
        await safe_fetch.safe_get_follow("https://93.184.216.34/", 1000)


@pytest.mark.asyncio
async def test_safe_get_follow_truncates_public_response(monkeypatch):
    # URL publique légitime -> 200 dont le corps dépasse la borne : tronqué à max_bytes.
    from src.services import safe_fetch
    monkeypatch.setattr(
        safe_fetch.httpx, "AsyncClient",
        _fake_httpx_client([_Resp(200, body=b"x" * 500 + b"y" * 500)]),
    )
    text, final = await safe_fetch.safe_get_follow("https://93.184.216.34/", 600)
    assert len(text) == 600
    assert final == "https://93.184.216.34/"


# --- fetch_page_text : le correctif PR-01 (plus de fetch laxiste) -------------

@pytest.mark.asyncio
async def test_fetch_page_text_rejects_http_scheme():
    # http:// supprimé : resolve_public_ip refuse avant toute connexion.
    with pytest.raises(TreeGenerationError):
        await fetch_page_text("http://interne.local/")


@pytest.mark.asyncio
async def test_fetch_page_text_rejects_internal_ip():
    with pytest.raises(TreeGenerationError):
        await fetch_page_text("https://169.254.169.254/latest/meta-data/")


def test_no_laxist_httpx_client_in_tree_generator():
    """Garde anti-régression : `fetch_page_text` ne doit JAMAIS reconstruire un
    client httpx suivant les redirections — tout fetch d'URL utilisateur passe
    par safe_fetch (via kb_service.fetch_user_url)."""
    import inspect

    from src.services import tree_generator, tree_jobs
    src = inspect.getsource(tree_generator.fetch_page_text)
    assert "httpx" not in src
    assert "follow_redirects" not in src
    assert "fetch_user_url" in src

    # Le pipeline multi-sources (wizard + démo via build_demo_source) passe lui
    # aussi par la porte unique : aucun client httpx, fetch d'URL via fetch_user_url.
    jobs_src = inspect.getsource(tree_jobs.build_source_text)
    assert "httpx" not in jobs_src
    assert "fetch_user_url" in jobs_src
