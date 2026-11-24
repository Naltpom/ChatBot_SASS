"""OAuth 2.1 du serveur MCP d'emails.chapote.fr : découverte, inscription, autorisation, jetons.

Routes HORS /api (chemins imposés par la spécification d'autorisation MCP et les RFC),
relayées par le nginx d'emails : /.well-known/oauth-protected-resource (RFC 9728),
/.well-known/oauth-authorization-server (RFC 8414), /oauth/register (RFC 7591),
/oauth/authorize, /oauth/token, /oauth/revoke (RFC 7009). Logique : services/emails_oauth.

/oauth/authorize n'émet jamais de code lui-même : il valide la demande, vérifie la session
(superadmin + 2FA validée ; sinon page de connexion) puis renvoie vers l'écran de
consentement de l'interface (/consentement?req=…, demande signée 10 min). Le code naît de
POST /api/emails/oauth/consent (routers/emails.py), clic explicite du superadmin.
"""
import base64
import binascii
from datetime import timedelta
from typing import Optional
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, get_optional_user
from src.services import emails_oauth as eo
from src.services.emails_access import access_problem, require_enabled
from src.services.rate_limit import emails_authorize_limiter, emails_register_limiter, emails_token_limiter
from src.services.user_apps import client_ip

router = APIRouter(tags=["emails-oauth"], dependencies=[Depends(require_enabled)])

AUTHZ_REQUEST_TTL = timedelta(minutes=10)
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _error(e: eo.OAuthError) -> JSONResponse:
    body = {"error": e.error}
    if e.description:
        body["error_description"] = e.description
    headers = dict(NO_STORE)
    if e.status_code == 401:
        headers["WWW-Authenticate"] = 'Basic realm="emails.chapote.fr"'
    return JSONResponse(body, status_code=e.status_code, headers=headers)


def _too_many() -> JSONResponse:
    return JSONResponse({"error": "slow_down", "error_description": "Trop de requêtes, patientez."},
                        status_code=429, headers={"Retry-After": "60", **NO_STORE})


# --------------------------------------------------------------------------
# Découverte
# --------------------------------------------------------------------------

def _protected_resource() -> dict:
    return {
        "resource": settings.emails_resource,
        "authorization_servers": [eo.issuer()],
        "scopes_supported": [eo.SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "Chapote Emails",
        "resource_documentation": f"{eo.issuer()}/",
    }


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
@router.get("/.well-known/oauth-protected-resource/mcp", include_in_schema=False)
async def protected_resource():
    return JSONResponse(_protected_resource(), headers={"Cache-Control": "public, max-age=3600"})


def _authorization_server() -> dict:
    base = eo.issuer()
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "scopes_supported": [eo.SCOPE],
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "code_challenge_methods_supported": ["S256"],
        "service_documentation": f"{base}/",
    }


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
@router.get("/.well-known/oauth-authorization-server/mcp", include_in_schema=False)
async def authorization_server():
    return JSONResponse(_authorization_server(), headers={"Cache-Control": "public, max-age=3600"})


# --------------------------------------------------------------------------
# Inscription dynamique (RFC 7591)
# --------------------------------------------------------------------------

@router.post("/oauth/register", include_in_schema=False)
async def register(request: Request, db: AsyncSession = Depends(get_db)):
    ip = client_ip(request)
    if not await emails_register_limiter.check(ip):
        return _too_many()
    try:
        data = await request.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return _error(eo.OAuthError("invalid_client_metadata", "Corps JSON attendu."))
    try:
        client, secret = await eo.register_client(db, data, ip)
    except eo.OAuthError as e:
        return _error(e)
    await db.commit()
    return JSONResponse(eo.client_out(client, secret), status_code=201, headers=NO_STORE)


# --------------------------------------------------------------------------
# Autorisation
# --------------------------------------------------------------------------

def _redirect_with(uri: str, params: dict) -> RedirectResponse:
    sep = "&" if "?" in uri else "?"
    return RedirectResponse(uri + sep + urlencode({k: v for k, v in params.items() if v is not None}), status_code=302)


def _page(path: str, **params) -> RedirectResponse:
    """Redirection relative vers une page de l'interface (même origine via le nginx d'emails)."""
    return RedirectResponse(f"{path}?{urlencode(params)}", status_code=302)


@router.get("/oauth/authorize", include_in_schema=False)
async def authorize(request: Request, db: AsyncSession = Depends(get_db),
                    user=Depends(get_optional_user)):
    if not await emails_authorize_limiter.check(client_ip(request)):
        return _page("/consentement", erreur="rate_limited")
    q = request.query_params
    client = await eo.active_client(db, q.get("client_id"))
    redirect_uri = q.get("redirect_uri") or ""
    # Tant que client et redirect_uri ne sont pas validés, aucune redirection vers le client.
    if client is None:
        return _page("/consentement", erreur="invalid_client")
    if redirect_uri not in (client.redirect_uris or []):
        if redirect_uri or len(client.redirect_uris or []) != 1:
            return _page("/consentement", erreur="invalid_redirect_uri")
        redirect_uri = client.redirect_uris[0]
    state = q.get("state")
    if q.get("response_type") != "code":
        return _redirect_with(redirect_uri, {"error": "unsupported_response_type", "state": state})
    challenge = q.get("code_challenge") or ""
    if q.get("code_challenge_method") != "S256" or not (43 <= len(challenge) <= 128):
        return _redirect_with(redirect_uri, {"error": "invalid_request",
                                             "error_description": "PKCE S256 obligatoire", "state": state})
    scope = q.get("scope") or eo.SCOPE
    if any(s not in (eo.SCOPE,) for s in scope.split()):
        return _redirect_with(redirect_uri, {"error": "invalid_scope", "state": state})
    resource = q.get("resource")
    if not eo.resource_ok(resource):
        return _redirect_with(redirect_uri, {"error": "invalid_target", "state": state})
    # Session : connexion (puis retour ici), refus explicite, ou écran de consentement.
    if user is None:
        suite = request.url.path + ("?" + request.url.query if request.url.query else "")
        return RedirectResponse(f"/connexion?suite={quote(suite, safe='')}", status_code=302)
    problem = await access_problem(db, user, request)
    if problem:
        return _page("/consentement", erreur=problem)
    req = _encode({"scope": "emails_authz", "sub": str(user.id), "cid": client.client_id, "ru": redirect_uri,
                   "cc": challenge, "st": state, "sc": eo.SCOPE, "rs": resource}, AUTHZ_REQUEST_TTL)
    return _page("/consentement", req=req)


# --------------------------------------------------------------------------
# Jetons
# --------------------------------------------------------------------------

def _client_credentials(request: Request, form) -> tuple[Optional[str], Optional[str]]:
    """client_id / client_secret : en-tête Basic (client_secret_basic) ou formulaire."""
    auth = request.headers.get("authorization") or ""
    if auth[:6].lower() == "basic ":
        try:
            raw = base64.b64decode(auth[6:].strip()).decode()
            cid, _, secret = raw.partition(":")
            from urllib.parse import unquote
            return unquote(cid), unquote(secret)
        except (binascii.Error, UnicodeDecodeError, ValueError):
            return None, None
    return form.get("client_id"), form.get("client_secret")


@router.post("/oauth/token", include_in_schema=False)
async def token(request: Request, db: AsyncSession = Depends(get_db)):
    if not await emails_token_limiter.check(client_ip(request)):
        return _too_many()
    form = await request.form()
    cid, secret = _client_credentials(request, form)
    client = await eo.active_client(db, cid)
    try:
        if client is None:
            raise eo.OAuthError("invalid_client", "Client inconnu ou révoqué.", 401)
        eo.check_client_secret(client, secret)
        grant = form.get("grant_type")
        if grant == "authorization_code":
            tokens = await eo.exchange_code(db, client, form.get("code"), form.get("redirect_uri"),
                                            form.get("code_verifier"), form.get("resource"))
        elif grant == "refresh_token":
            tokens = await eo.refresh_tokens(db, client, form.get("refresh_token"))
        else:
            raise eo.OAuthError("unsupported_grant_type", "authorization_code ou refresh_token.")
    except eo.OAuthError as e:
        return _error(e)
    return JSONResponse(tokens, headers=NO_STORE)


@router.post("/oauth/revoke", include_in_schema=False)
async def revoke(request: Request, db: AsyncSession = Depends(get_db)):
    if not await emails_token_limiter.check(client_ip(request)):
        return _too_many()
    form = await request.form()
    cid, secret = _client_credentials(request, form)
    client = await eo.active_client(db, cid)
    if client is not None:
        try:
            eo.check_client_secret(client, secret)
        except eo.OAuthError as e:
            return _error(e)
    await eo.revoke_token(db, client, form.get("token") or "")
    return JSONResponse({}, headers=NO_STORE)
