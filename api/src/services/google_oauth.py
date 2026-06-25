"""Vérification d'un ID token Google (« Sign in with Google », flux ID token).

Le front (Google Identity Services) obtient un JWT signé par Google et nous
l'envoie. On vérifie ici :
  1. la signature (RS256) contre les clés publiques Google (JWKS) ;
  2. l'audience (`aud == GOOGLE_CLIENT_ID`) — c'est ce qui empêche de rejouer un
     token émis pour une autre application ;
  3. l'émetteur (`iss`) et `email_verified`.

Aucune dépendance nouvelle : python-jose (déjà utilisé pour nos propres JWT)
sait valider du RS256 à partir d'une JWK, et httpx (déjà présent) récupère les
certificats. `jwt.decode` vérifie en plus `exp`/`iat` et l'audience.
"""
import httpx
from jose import JWTError, jwt

from src.core.config import settings

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
# Google émet deux variantes historiques de `iss` : on accepte les deux.
_ACCEPTED_ISS = ("https://accounts.google.com", "accounts.google.com")

# Cache process des JWK (kid -> jwk). Les clés Google tournent : sur un `kid`
# inconnu on rafraîchit le cache une fois avant d'abandonner.
_certs_cache: dict[str, dict] = {}


class GoogleAuthError(Exception):
    """Token Google invalide / non vérifiable (mappé en 401 côté routeur)."""


async def _fetch_certs() -> dict[str, dict]:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(GOOGLE_CERTS_URL)
        resp.raise_for_status()
    keys = {k["kid"]: k for k in resp.json().get("keys", []) if k.get("kid")}
    _certs_cache.clear()
    _certs_cache.update(keys)
    return keys


async def _key_for(kid: str) -> dict:
    if kid in _certs_cache:
        return _certs_cache[kid]
    keys = await _fetch_certs()  # rotation des clés : on rafraîchit une fois
    if kid not in keys:
        raise GoogleAuthError("Clé de signature Google inconnue")
    return keys[kid]


async def verify_google_id_token(token: str) -> dict:
    """Renvoie les claims vérifiés (`email`, `email_verified`, `name`, `sub`, …)
    ou lève GoogleAuthError. Exige `GOOGLE_CLIENT_ID` configuré côté serveur."""
    if not settings.GOOGLE_CLIENT_ID:
        raise GoogleAuthError("SSO Google non configuré")
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except JWTError:
        raise GoogleAuthError("Token Google illisible")
    if not kid:
        raise GoogleAuthError("Token Google sans identifiant de clé")

    jwk = await _key_for(kid)
    try:
        claims = jwt.decode(
            token,
            jwk,
            algorithms=["RS256"],
            audience=settings.GOOGLE_CLIENT_ID,  # rejette un token d'une autre app
        )
    except JWTError as e:
        raise GoogleAuthError(f"Token Google invalide ({e})")

    if claims.get("iss") not in _ACCEPTED_ISS:
        raise GoogleAuthError("Émetteur du token inattendu")
    # `email_verified` peut arriver en booléen ou en chaîne "true" selon le flux.
    if str(claims.get("email_verified")).lower() != "true" or not claims.get("email"):
        raise GoogleAuthError("Email Google non vérifié")
    return claims
