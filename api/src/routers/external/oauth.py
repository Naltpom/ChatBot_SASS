"""OAuth « plugin » — Authorization Code + PKCE (RFC 7636).

Endpoint DASHBOARD (page /authorize, auth get_current_user) :
- POST /api/oauth/authorize : après consentement de l'utilisateur connecté, crée
  un code d'autorisation lié au redirect_uri (page admin du plugin) + code_challenge
  PKCE, et renvoie l'URL de redirection (code + state) à suivre.

Endpoints EXTERNES (appelés server-to-server par le backend PHP du plugin, sans
JWT dashboard ; bornés par rate-limit) :
- POST /api/oauth/token  : grant authorization_code (échange + PKCE) OU
  refresh_token (rotation).
- POST /api/oauth/revoke : révoque un refresh (déconnexion).

Sécurité = PKCE (S256) + redirect_uri lié au code + state CSRF (côté client) +
code one-time + écran de consentement côté dashboard (domaine affiché).
"""
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import OAUTH_PLUGIN_CLIENT_ID, get_current_user
from src.models.user import User
from src.services import oauth_service as svc
from src.services.rate_limit import (
    oauth_authorize_limiter,
    oauth_refresh_limiter,
    oauth_token_limiter,
)

router = APIRouter(prefix="/api/oauth", tags=["oauth-plugin"])


# --- Schémas ---------------------------------------------------------------

class AuthorizeIn(BaseModel):
    client_id: str
    redirect_uri: str
    state: str | None = None
    code_challenge: str
    code_challenge_method: str = "S256"
    scope: str = "plugin"


class AuthorizeOut(BaseModel):
    redirect_url: str


class TokenIn(BaseModel):
    grant_type: str | None = None
    # grant authorization_code
    code: str | None = None
    redirect_uri: str | None = None
    code_verifier: str | None = None
    client_id: str | None = None
    # grant refresh_token / revoke
    refresh_token: str | None = None


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _redirect_uri_ok(uri: str) -> bool:
    """redirect_uri du client public 'chapote_wp' : DOIT être la page admin du
    plugin WordPress (allowlist de FORME, pas un redirect_uri arbitraire).

    Anti-prise de contrôle de compte (OAuth) : sans contrainte, un attaquant peut
    fabriquer une URL d'autorisation pointant vers un domaine qu'il contrôle, faire
    cliquer « Autoriser » à un utilisateur Chapote connecté, et récupérer le code →
    échange (il détient le code_verifier qu'il a généré) → token sur le compte de la
    victime. PKCE NE protège PAS ce phishing de consentement (l'initiateur a le
    verifier). On borne donc à : URL absolue, https (http toléré uniquement sur
    localhost/127.0.0.1 en dev), pas d'userinfo, et chemin/param de la page admin du
    plugin. Le consentement (domaine affiché) reste la défense de tête."""
    parsed = urlparse(uri or "")
    if not parsed.netloc or parsed.username or parsed.password:
        return False
    if parsed.scheme == "https":
        pass
    elif parsed.scheme == "http" and not settings.is_production:
        host = (parsed.hostname or "").lower()
        if not (host == "localhost" or host == "127.0.0.1" or host.startswith("127.") or host == "::1"):
            return False
    else:
        return False
    # Forme RESTREINTE à la page admin du plugin (endswith gère les installs WP en
    # sous-répertoire, ex. /blog/wp-admin/admin.php).
    if not parsed.path.endswith("/wp-admin/admin.php"):
        return False
    # Slug de la page admin du plugin : 'chapote-chatbot' (nouveau) ou
    # 'chapote-backoffice' (anciennes installs encore déployées) — transition.
    query = parsed.query or ""
    return "page=chapote-chatbot" in query or "page=chapote-backoffice" in query


# --- Surface DASHBOARD (page /authorize, get_current_user) -----------------

@router.post("/authorize", response_model=AuthorizeOut)
async def authorize(
    body: AuthorizeIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Émet un code d'autorisation après consentement de l'utilisateur CONNECTÉ.
    Valide client_id/redirect_uri/PKCE/scope, crée le code (lié au redirect_uri +
    code_challenge) et renvoie l'URL de redirection (code + state) à suivre."""
    if not await oauth_authorize_limiter.check(_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes")
    if body.client_id != OAUTH_PLUGIN_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "client_id inconnu")
    if body.scope != "plugin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope non supporté")
    if body.code_challenge_method != "S256" or not body.code_challenge:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "PKCE requis (code_challenge_method=S256)")
    if not _redirect_uri_ok(body.redirect_uri):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "redirect_uri invalide")
    code = await svc.create_authorization_code(
        db,
        user_id=user.id,
        client_id=body.client_id,
        redirect_uri=body.redirect_uri,
        code_challenge=body.code_challenge,
        code_challenge_method=body.code_challenge_method,
        scope=body.scope,
    )
    await db.commit()
    params = {"code": code}
    if body.state:
        params["state"] = body.state
    # Bon séparateur : & si le redirect_uri porte déjà une query (cas WP
    # admin.php?page=...), ? sinon.
    sep = "&" if urlparse(body.redirect_uri).query else "?"
    return AuthorizeOut(redirect_url=f"{body.redirect_uri}{sep}{urlencode(params)}")


# --- Surface EXTERNE (plugin, server-to-server) ----------------------------

@router.post("/token")
async def token(body: TokenIn, request: Request, db: AsyncSession = Depends(get_db)):
    """grant_type = authorization_code (échange + PKCE) ou refresh_token
    (rotation). Erreurs au format OAuth (HTTP 400 + {"error": code})."""
    if not await oauth_token_limiter.check(_ip(request)):
        return JSONResponse(status_code=400, content={"error": "slow_down"})
    try:
        if body.grant_type == "authorization_code":
            if not (body.code and body.redirect_uri and body.code_verifier):
                return JSONResponse(status_code=400, content={"error": "invalid_request"})
            access, refresh, expires_in = await svc.exchange_authorization_code(
                db, body.code, body.redirect_uri, body.code_verifier
            )
        elif body.grant_type == "refresh_token":
            if not body.refresh_token:
                return JSONResponse(status_code=400, content={"error": "invalid_request"})
            if not await oauth_refresh_limiter.check(_ip(request)):
                return JSONResponse(status_code=400, content={"error": "slow_down"})
            access, refresh, expires_in = await svc.rotate_refresh(db, body.refresh_token)
        else:
            return JSONResponse(status_code=400, content={"error": "unsupported_grant_type"})
    except svc.OAuthError as e:
        await db.commit()  # persiste les transitions (ex. lignée refresh révoquée sur rejeu)
        return JSONResponse(status_code=400, content={"error": e.code})
    await db.commit()
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "scope": "plugin",
    }


@router.post("/revoke")
async def revoke_token(body: TokenIn, db: AsyncSession = Depends(get_db)):
    """Déconnexion : révoque le refresh (idempotent). Toujours 200 (ne révèle pas
    l'existence du token)."""
    if body.refresh_token:
        await svc.revoke(db, body.refresh_token)
        await db.commit()
    return {}
