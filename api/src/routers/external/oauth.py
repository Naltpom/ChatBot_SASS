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
    # Confirmation explicite d'AJOUT d'un nouveau site quand l'utilisateur a déjà
    # des domaines enregistrés (re-consentement). Sans elle, un hôte non enregistré
    # est refusé (anti consent-phishing). Le 1er domaine d'un user s'auto-enregistre.
    confirm_unregistered: bool = False


class AuthorizeOut(BaseModel):
    redirect_url: str


class AuthorizePreviewOut(BaseModel):
    valid: bool
    host: str | None = None
    requires_confirmation: bool = False


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


def _rate_limited_response() -> JSONResponse:
    """Réponse de rate-limit du endpoint /token, UNIFORMISÉE avec /authorize :
    HTTP 429 + contrat {detail, code, message}. On conserve le champ
    OAuth `error` (RFC 6749 §5.2) car /token est appelé server-to-server par le
    plugin PHP / des clients OAuth standards qui peuvent le lire. Les erreurs de
    GRANT (invalid_grant, invalid_request…) restent, elles, en 400 + {"error":…}
    OAuth pur (inchangé) : on n'uniformise QUE le rate-limit."""
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "error": "slow_down",
            "detail": "Trop de requêtes",
            "code": "rate_limited",
            "message": "Trop de requêtes. Réessayez dans un instant.",
        },
    )


# --- Surface DASHBOARD (page /authorize, get_current_user) -----------------

@router.get("/authorize/preview", response_model=AuthorizePreviewOut)
async def authorize_preview(
    redirect_uri: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Le front AFFICHE le bon écran de consentement sans RE-DÉCIDER la validité :
    cet endpoint dit si le redirect_uri est de forme valide et si son hôte est déjà
    enregistré pour l'utilisateur. `requires_confirmation` = hôte valide mais non
    enregistré ALORS QUE l'user a déjà des sites → ajout d'un 2e site à confirmer
    explicitement (re-consentement). La décision d'émettre le code reste serveur."""
    host = svc.validated_redirect_host(
        redirect_uri, allow_insecure_localhost=not settings.is_production
    )
    if host is None:
        return AuthorizePreviewOut(valid=False)
    domains = await svc.registered_domains(db, user.id)
    return AuthorizePreviewOut(
        valid=True, host=host, requires_confirmation=host not in domains and bool(domains)
    )

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
    host = svc.validated_redirect_host(
        body.redirect_uri, allow_insecure_localhost=not settings.is_production
    )
    if host is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "redirect_uri invalide")
    # Allowlist par utilisateur (anti consent-phishing §3.2) : un hôte non
    # enregistré n'est accepté que si l'user n'a encore AUCUN domaine (bootstrap au
    # 1er consentement) ou s'il confirme explicitement l'ajout d'un nouveau site.
    domains = await svc.registered_domains(db, user.id)
    if host not in domains:
        if domains and not body.confirm_unregistered:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "redirect_uri non enregistré")
        await svc.register_domain(db, user.id, host)
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
    (rotation). Erreurs de grant au format OAuth (HTTP 400 + {"error": code}) ;
    rate-limit uniformisé en HTTP 429 + {detail, code, message}."""
    if not await oauth_token_limiter.check(_ip(request)):
        return _rate_limited_response()
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
                return _rate_limited_response()
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
async def revoke_token(body: TokenIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Déconnexion : révoque le refresh (idempotent). Toujours 200 (ne révèle pas
    l'existence du token). Rate-limité comme /authorize et /token."""
    if not await oauth_token_limiter.check(_ip(request)):
        return _rate_limited_response()
    if body.refresh_token:
        await svc.revoke(db, body.refresh_token)
        await db.commit()
    return {}
