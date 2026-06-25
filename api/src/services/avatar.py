"""Téléchargement + stockage local de la photo de profil (SSO Google).

Best-effort : tout échec renvoie None et ne bloque JAMAIS la connexion (l'avatar
retombe sur les initiales côté front). On ne récupère que des URLs Google
(`*.googleusercontent.com`) — le claim `picture` venant d'un JWT signé par
Google, ça ferme la porte à un SSRF vers un hôte arbitraire.
"""
import secrets
from pathlib import Path
from urllib.parse import urlparse

import httpx

from src.core.config import settings

# Mêmes formats raster que l'upload manuel (cf. routers/uploads.ALLOWED_TYPES) ;
# pas de SVG (XSS stocké servi depuis l'origine API).
_ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _is_google_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "googleusercontent.com" or host.endswith(".googleusercontent.com")


async def fetch_and_store_avatar(url: str | None) -> str | None:
    """Télécharge la photo `url` (Google) dans UPLOAD_DIR et renvoie l'URL
    publique servie par /uploads/*, ou None si indisponible/invalide."""
    if not url or not _is_google_host(url):
        return None
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except httpx.HTTPError:
        return None

    ext = _ALLOWED_TYPES.get((resp.headers.get("content-type") or "").split(";")[0].strip().lower())
    content = resp.content
    if ext is None or not content or len(content) > settings.MAX_UPLOAD_BYTES:
        return None

    name = secrets.token_urlsafe(16) + ext
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / name).write_bytes(content)
    return f"{settings.API_URL}/uploads/{name}"
