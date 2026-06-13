"""Fetch HTTP sortant SECURISE (anti-SSRF) : ingestion KB + notifications.

Pattern repris d'action_executor (JAMAIS celui, laxiste, de
tree_generator.fetch_page_text) : https uniquement, resolution DNS UNIQUE
avec rejet des IP non publiques, connexion EPINGLEE sur l'IP validee (anti
DNS-rebinding TOCTOU : httpx ne re-resout pas l'hote, le Host HTTP et le SNI
TLS — verification du certificat comprise — restent le hostname d'origine),
aucun redirect suivi, timeout 10 s, lecture bornee en stream.
"""
import asyncio
import ipaddress
import json
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx


class FetchError(Exception):
    """Erreur de fetch sortant — message FR montrable a l'utilisateur."""


async def resolve_public_ip(url: str) -> str:
    """https:// + resolution DNS UNIQUE : TOUTES les IP resolues doivent etre
    publiques (is_global exclut prive/loopback/link-local/reserve/multicast/
    unspecified), et la connexion se fera ensuite sur l'IP retournee — jamais
    de seconde resolution (anti DNS-rebinding TOCTOU)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise FetchError("URL invalide (https:// requis)")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None)
    except OSError:
        raise FetchError("Hôte introuvable")
    ips: list = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            raise FetchError("Adresse non publique (refusée)")
        if not ip.is_global:
            raise FetchError("Adresse non publique (refusée)")
        ips.append(ip)
    if not ips:
        raise FetchError("Hôte introuvable")
    # IPv4 d'abord (chemin le plus repandu), sinon la premiere IPv6 validee
    for ip in ips:
        if ip.version == 4:
            return str(ip)
    return str(ips[0])


def _pin(url: str, ip: str) -> tuple[str, str, str]:
    """(pinned_url, host_header, hostname) : l'hote de l'URL est remplace par
    l'IP validee, le Host HTTP et le SNI TLS restent le hostname d'origine."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    host_header = hostname if parsed.port in (None, 443) else f"{hostname}:{parsed.port}"
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc)), host_header, hostname


async def safe_get(url: str, max_bytes: int) -> str:
    """GET borne : 3xx refusees, lecture en stream coupee a max_bytes,
    decodage texte tolerant (le HTML/XML sera de toute facon re-nettoye)."""
    ip = await resolve_public_ip(url)
    pinned_url, host_header, hostname = _pin(url, ip)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream(
                "GET", pinned_url,
                headers={"Host": host_header, "User-Agent": "KertiosChat-KB/1.0"},
                extensions={"sni_hostname": hostname},
            ) as resp:
                if 300 <= resp.status_code < 400:
                    raise FetchError("Redirection refusée par sécurité")
                if resp.status_code != 200:
                    raise FetchError(f"réponse HTTP {resp.status_code}")
                read = 0
                parts: list[bytes] = []
                async for part in resp.aiter_bytes():
                    parts.append(part)
                    read += len(part)
                    if read >= max_bytes:
                        break
    except httpx.HTTPError:
        raise FetchError("hôte injoignable")
    data = b"".join(parts)[:max_bytes]
    return data.decode("utf-8", errors="replace")


async def safe_post_json_read(url: str, payload: dict, headers: Optional[dict] = None,
                              max_bytes: int = 100_000) -> tuple[str, dict]:
    """POST JSON dont la REPONSE est lue (client MCP) : meme pinning que
    safe_get, lecture bornee en stream, retour (corps texte, headers de
    reponse) — les headers servent a Mcp-Session-Id. 3xx refusees, statut
    hors 200-299 refuse (202 tolere : notifications MCP)."""
    ip = await resolve_public_ip(url)
    pinned_url, host_header, hostname = _pin(url, ip)
    base_headers = {"Host": host_header, "Content-Type": "application/json"}
    if headers:
        base_headers.update(headers)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream(
                "POST", pinned_url,
                content=json.dumps(payload).encode(),
                headers=base_headers,
                extensions={"sni_hostname": hostname},
            ) as resp:
                if 300 <= resp.status_code < 400:
                    raise FetchError("Redirection refusée par sécurité")
                if not 200 <= resp.status_code < 300:
                    raise FetchError(f"réponse HTTP {resp.status_code}")
                read = 0
                parts: list[bytes] = []
                async for part in resp.aiter_bytes():
                    parts.append(part)
                    read += len(part)
                    if read >= max_bytes:
                        break
                resp_headers = dict(resp.headers)
    except httpx.HTTPError:
        raise FetchError("hôte injoignable")
    data = b"".join(parts)[:max_bytes]
    return data.decode("utf-8", errors="replace"), resp_headers


async def safe_post_json(url: str, payload: dict) -> None:
    """POST JSON de notification (webhook handoff) : meme pinning, pas de
    signature HMAC (notification simple), reponse ignoree. En stream comme
    safe_get : le corps de reponse (cible controlee par un tiers) n'est
    JAMAIS lu en memoire, le contexte ferme la connexion sans le charger."""
    ip = await resolve_public_ip(url)
    pinned_url, host_header, hostname = _pin(url, ip)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream(
                "POST", pinned_url, json=payload,
                headers={"Host": host_header},
                extensions={"sni_hostname": hostname},
            ):
                pass  # statut/corps ignores volontairement (notification)
    except httpx.HTTPError:
        raise FetchError("hôte injoignable")
