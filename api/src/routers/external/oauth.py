"""OAuth « plugin » — device flow (RFC 8628).

Endpoints EXTERNES (appelés server-to-server par le backend PHP du plugin, sans
JWT dashboard ; bornés par rate-limit) :
- POST /api/oauth/device   : démarre l'appairage -> device_code + user_code.
- POST /api/oauth/token    : grant device_code (polling) OU refresh_token (rotation).
- POST /api/oauth/revoke   : révoque un refresh (déconnexion).

Endpoints DASHBOARD (page /link, auth get_current_user) :
- GET  /api/oauth/device/info    : ce que le code autorise (consentement).
- POST /api/oauth/device/approve : approuve l'appairage.
- POST /api/oauth/device/deny    : refuse l'appairage.

Aucune URL de redirection => zéro open-redirect, fonctionne sur tout domaine WP.
"""
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
    oauth_approve_limiter,
    oauth_device_limiter,
    oauth_poll_limiter,
    oauth_refresh_limiter,
)

router = APIRouter(prefix="/api/oauth", tags=["oauth-plugin"])

DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"


# --- Schémas ---------------------------------------------------------------

class DeviceStartIn(BaseModel):
    client_id: str | None = None
    site_url: str | None = None


class DeviceStartOut(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


class TokenIn(BaseModel):
    grant_type: str | None = None
    device_code: str | None = None
    refresh_token: str | None = None


class UserCodeIn(BaseModel):
    user_code: str


class DeviceInfoOut(BaseModel):
    user_code: str
    site_url: str | None = None
    status: str


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# --- Surface EXTERNE (plugin) ---------------------------------------------

@router.post("/device", response_model=DeviceStartOut)
async def device_start(body: DeviceStartIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Démarre l'appairage : crée un device_code + user_code court à saisir sur
    /link. Appelé par le backend PHP du plugin."""
    if not await oauth_device_limiter.check(_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes")
    if body.client_id and body.client_id != OAUTH_PLUGIN_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "client_id inconnu")
    device_code, row = await svc.new_device_authorization(db, body.site_url)
    await db.commit()
    base = settings.APP_URL.rstrip("/")
    return DeviceStartOut(
        device_code=device_code,
        user_code=row.user_code,
        verification_uri=f"{base}/link",
        verification_uri_complete=f"{base}/link?code={row.user_code}",
        expires_in=svc.OAUTH_DEVICE_CODE_EXPIRE_MINUTES * 60,
        interval=row.interval_seconds,
    )


@router.post("/token")
async def token(body: TokenIn, request: Request, db: AsyncSession = Depends(get_db)):
    """grant_type = device_code (polling) ou refresh_token (rotation). Erreurs au
    format OAuth (HTTP 400 + {"error": code})."""
    try:
        if body.grant_type == DEVICE_GRANT:
            if not body.device_code:
                return JSONResponse(status_code=400, content={"error": "invalid_request"})
            if not await oauth_poll_limiter.check(body.device_code):
                return JSONResponse(status_code=400, content={"error": "slow_down"})
            access, refresh, expires_in = await svc.exchange_device_code(db, body.device_code)
        elif body.grant_type == "refresh_token":
            if not body.refresh_token:
                return JSONResponse(status_code=400, content={"error": "invalid_request"})
            if not await oauth_refresh_limiter.check(_ip(request)):
                return JSONResponse(status_code=400, content={"error": "slow_down"})
            access, refresh, expires_in = await svc.rotate_refresh(db, body.refresh_token)
        else:
            return JSONResponse(status_code=400, content={"error": "unsupported_grant_type"})
    except svc.DeviceFlowError as e:
        await db.commit()  # persiste last_polled_at / transitions (expired, lignée révoquée)
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


# --- Surface DASHBOARD (page /link, get_current_user) ----------------------

@router.get("/device/info", response_model=DeviceInfoOut)
async def device_info(
    user_code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await svc.find_pending_by_user_code(db, user_code)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Code inconnu")
    return DeviceInfoOut(user_code=row.user_code, site_url=row.site_url, status=row.status)


@router.post("/device/approve", response_model=DeviceInfoOut)
async def device_approve(
    body: UserCodeIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Anti-bruteforce de la saisie du user_code (par IP, en plus de l'auth dashboard).
    if not await oauth_approve_limiter.check(_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives")
    row = await svc.find_pending_by_user_code(db, body.user_code)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Code inconnu ou expiré")
    try:
        await svc.approve_device(db, row, user.id)
    except svc.DeviceFlowError as e:
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, e.code)
    await db.commit()
    return DeviceInfoOut(user_code=row.user_code, site_url=row.site_url, status=row.status)


@router.post("/device/deny", response_model=DeviceInfoOut)
async def device_deny(
    body: UserCodeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await svc.find_pending_by_user_code(db, body.user_code)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Code inconnu")
    await svc.deny_device(db, row)
    await db.commit()
    return DeviceInfoOut(user_code=row.user_code, site_url=row.site_url, status=row.status)
