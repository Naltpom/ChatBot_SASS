"""Fetch HTTP sortant SECURISE (anti-SSRF) : ingestion KB + notifications.

Pattern repris d'action_executor : https uniquement, resolution DNS UNIQUE
avec rejet des IP non publiques, connexion EPINGLEE sur l'IP validee (anti
DNS-rebinding TOCTOU : httpx ne re-resout pas l'hote, le Host HTTP et le SNI
TLS — verification du certificat comprise — restent le hostname d'origine),
aucun redirect suivi, timeout 10 s, lecture bornee en stream.
"""
import asyncio
import ipaddress
import json
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx


class FetchError(Exception):
    """Erreur de fetch sortant — message FR montrable a l'utilisateur."""


_NAT64_PREFIX = ipaddress.ip_network("64:ff9b::/96")


def _is_public_ip(ip: "ipaddress._BaseAddress") -> bool:
    """is_global, mais re-valide aussi l'IPv4 EMBARQUEE des adresses IPv6 de
    transition (6to4 2002::/16, IPv4-mapped ::ffff:0:0/96, NAT64 64:ff9b::/96).

    `is_global` ne re-teste pas systematiquement l'IPv4 encapsulee : NAT64 vers
    169.254.169.254 passe is_global=True sur CPython 3.11. On extrait l'IPv4 et
    on exige qu'elle soit elle-meme publique (defense en profondeur, ne repose
    pas seul sur is_global — cf. CVE-2024-4032)."""
    if not ip.is_global:
        return False
    if ip.version == 6:
        embedded = ip.sixtofour or ip.ipv4_mapped
        if embedded is None and ip in _NAT64_PREFIX:
            embedded = ipaddress.ip_address(int(ip) & 0xFFFFFFFF)
        if embedded is not None and not embedded.is_global:
            return False
    return True


async def resolve_public_ip(url: str) -> str:
    """https:// + resolution DNS UNIQUE : TOUTES les IP resolues doivent etre
    publiques (is_global exclut prive/loopback/link-local/reserve/multicast/
    unspecified, + re-validation de l'IPv4 embarquee des adresses de transition),
    et la connexion se fera ensuite sur l'IP retournee — jamais de seconde
    resolution (anti DNS-rebinding TOCTOU)."""
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
        if not _is_public_ip(ip):
            raise FetchError("Adresse non publique (refusée)")
        ips.append(ip)
    if not ips:
        raise FetchError("Hôte introuvable")
    # IPv4 d'abord (chemin le plus repandu), sinon la premiere IPv6 validee
    for ip in ips:
        if ip.version == 4:
            return str(ip)
    return str(ips[0])


def pin_url(url: str, ip: str) -> tuple[str, str, str]:
    """(pinned_url, host_header, hostname) : l'hote de l'URL est remplace par
    l'IP validee, le Host HTTP et le SNI TLS restent le hostname d'origine.

    Helper PARTAGE (anti DNS-rebinding) : utilise par les fetch de ce module
    ET par action_executor._webhook (signature HMAC en plus). Toute requete
    epinglee doit passer pinned_url + header Host=host_header +
    extensions={"sni_hostname": hostname} a httpx."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    host_header = hostname if parsed.port in (None, 443) else f"{hostname}:{parsed.port}"
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc)), host_header, hostname


@asynccontextmanager
async def _pinned_stream(method: str, url: str, *, headers: Optional[dict] = None,
                         **stream_kwargs) -> AsyncIterator[httpx.Response]:
    """Ouvre un stream httpx EPINGLE (anti DNS-rebinding), helper PARTAGE des
    fetch sortants : resolution DNS unique avec rejet des IP non publiques,
    connexion sur l'IP validee mais Host HTTP + SNI TLS = hostname d'origine,
    aucun redirect, timeout 10 s. Le `Host` est toujours impose (ecrase tout
    Host fourni dans `headers`), `extensions={"sni_hostname": ...}` ajoute.

    L'appelant lit le corps (borne) DANS le `async with` ; toute httpx.HTTPError
    est traduite en FetchError. NE filtre PAS le code de statut (chaque
    appelant a ses propres regles : 3xx/non-200/non-2xx)."""
    ip = await resolve_public_ip(url)
    pinned_url, host_header, hostname = pin_url(url, ip)
    final_headers = dict(headers or {})
    final_headers["Host"] = host_header
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream(
                method, pinned_url,
                headers=final_headers,
                extensions={"sni_hostname": hostname},
                **stream_kwargs,
            ) as resp:
                yield resp
    except httpx.HTTPError:
        raise FetchError("hôte injoignable")


async def _read_bounded(resp: httpx.Response, max_bytes: int) -> bytes:
    """Lecture en stream coupee a max_bytes (le corps reel peut etre plus gros :
    on s'arrete des qu'on a assez)."""
    read = 0
    parts: list[bytes] = []
    async for part in resp.aiter_bytes():
        parts.append(part)
        read += len(part)
        if read >= max_bytes:
            break
    return b"".join(parts)[:max_bytes]


async def safe_get(url: str, max_bytes: int) -> str:
    """GET borne : 3xx refusees, lecture en stream coupee a max_bytes,
    decodage texte tolerant (le HTML/XML sera de toute facon re-nettoye)."""
    async with _pinned_stream(
        "GET", url, headers={"User-Agent": "Chapote-KB/1.0"},
    ) as resp:
        if 300 <= resp.status_code < 400:
            raise FetchError("Redirection refusée par sécurité")
        if resp.status_code != 200:
            raise FetchError(f"réponse HTTP {resp.status_code}")
        data = await _read_bounded(resp, max_bytes)
    return data.decode("utf-8", errors="replace")


async def safe_get_follow(url: str, max_bytes: int, max_redirects: int = 4) -> tuple[str, str]:
    """GET qui SUIT les redirections, en restant 100 % anti-SSRF : CHAQUE saut
    repasse par `_pinned_stream` (resolution DNS unique + rejet des IP non
    publiques + epinglage sur l'IP validee, Host/SNI = hostname d'origine). La
    cible d'un 3xx est resolue via urljoin (Location relatif accepte) puis
    re-validee au tour suivant ; un saut vers http:// (non https) ou une IP
    privee leve FetchError. Boucle bornee a `max_redirects`.

    Renvoie (texte decode, url_finale). Sert au crawl des sites prospects, qui
    redirigent quasi toujours (www<->apex, http->https, slash final)."""
    current = url
    for _ in range(max_redirects + 1):
        async with _pinned_stream(
            "GET", current, headers={"User-Agent": "Chapote-KB/1.0"},
        ) as resp:
            if 300 <= resp.status_code < 400:
                location = resp.headers.get("location")
                if not location:
                    raise FetchError("Redirection sans cible")
                current = urljoin(current, location)
                continue
            if resp.status_code != 200:
                raise FetchError(f"réponse HTTP {resp.status_code}")
            data = await _read_bounded(resp, max_bytes)
            return data.decode("utf-8", errors="replace"), current
    raise FetchError("Trop de redirections")


async def safe_probe(url: str) -> int:
    """Probe de statut HTTP : ouvre le MEME stream epingle que safe_get (anti
    SSRF : https + IP publique imposes par resolve_public_ip, Host/SNI =
    hostname d'origine, aucun redirect SUIVI) mais NE rejette PAS les 3xx —
    retourne le code de statut tel quel sans lire le corps. Leve FetchError
    pour non-https / DNS / connexion / IP non publique."""
    async with _pinned_stream(
        "GET", url, headers={"User-Agent": "Chapote-KB/1.0"},
    ) as resp:
        return resp.status_code


async def safe_post_json_read(url: str, payload: dict, headers: Optional[dict] = None,
                              max_bytes: int = 100_000) -> tuple[str, dict]:
    """POST JSON dont la REPONSE est lue (client MCP) : meme pinning que
    safe_get, lecture bornee en stream, retour (corps texte, headers de
    reponse) — les headers servent a Mcp-Session-Id. 3xx refusees, statut
    hors 200-299 refuse (202 tolere : notifications MCP)."""
    post_headers = {"Content-Type": "application/json", **(headers or {})}
    async with _pinned_stream(
        "POST", url, headers=post_headers,
        content=json.dumps(payload).encode(),
    ) as resp:
        if 300 <= resp.status_code < 400:
            raise FetchError("Redirection refusée par sécurité")
        if not 200 <= resp.status_code < 300:
            raise FetchError(f"réponse HTTP {resp.status_code}")
        data = await _read_bounded(resp, max_bytes)
        resp_headers = dict(resp.headers)
    return data.decode("utf-8", errors="replace"), resp_headers


async def safe_post_json(url: str, payload: dict) -> None:
    """POST JSON de notification (webhook handoff) : meme pinning, pas de
    signature HMAC (notification simple), reponse ignoree. En stream comme
    safe_get : le corps de reponse (cible controlee par un tiers) n'est
    JAMAIS lu en memoire, le contexte ferme la connexion sans le charger."""
    async with _pinned_stream("POST", url, json=payload):
        pass  # statut/corps ignores volontairement (notification)
