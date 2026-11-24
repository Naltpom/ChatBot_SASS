"""Application mobile de cm.chapote.fr (Expo, Android / iOS) : connexion et notifications.

Ajout pur : aucune route existante ne change. L'app appelle les mêmes routes que le site
(/api/cm/…, /api/tiktok/…, /api/youtube/…, /api/auth/…) avec une session ordinaire
(cookie `chapote_session`), qu'elle obtient ainsi :

1. Connexion, au choix :
   a. par le navigateur intégré (Google, double authentification, passkey : tout ce que le site sait
      faire) : `GET /connect?redirect_uri=chapotecm://auth&challenge=<S256>&state=…` montre une page
      « Connecter l'application à <compte> ? ». Pas connecté sur le site : la page le dit, avec un lien
      vers cm.chapote.fr. « Autoriser » (formulaire, même site) renvoie vers l'app avec un code à usage
      unique de 3 minutes, lié au `challenge` (PKCE : sha256 du `verifier` gardé par l'app).
      L'app l'échange : `POST /token {code, verifier, name, platform}`.
   b. par le formulaire de l'app (`POST /api/auth/login`, cookie de la réponse), puis
      `POST /devices {name, platform}` avec ce cookie.
   Les deux rendent `{refresh_token, session, expires_in, user}`. `refresh_token` : longue durée,
   révocable, gardé dans le coffre du téléphone ; seule son empreinte SHA-256 est en base.
2. `POST /refresh {refresh_token}` → `{session, expires_in}` : un cookie de session d'une heure
   (envoyé par l'app dans l'en-tête Cookie). Révoquer l'appareil coupe l'accès en une heure au plus.
3. `POST /logout {refresh_token}` : révoque l'appareil. `GET /devices` / `DELETE /devices/{id}` :
   ses appareils (depuis le site ou l'app).
4. `PUT /push {refresh_token, push_token, prefs}` : jeton de notifications Expo et choix
   (vidéo publiée, échec, brouillon TikTok, nouveaux commentaires). Envoi : services/cm_push.py.
"""
import base64
import hashlib
import html
import re
import secrets
import uuid
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, get_current_user, get_optional_user
from src.core.time import utcnow
from src.models.cm_mobile import CmMobileDevice
from src.models.user import User
from src.services.rate_limit import RateLimiter, SingleUseTokens

router = APIRouter(prefix="/api/cm/mobile", tags=["cm-mobile"])

CODE_SCOPE = "cm_mobile_code"
CODE_TTL = timedelta(minutes=3)
SESSION_TTL = timedelta(hours=1)
# Schémas de retour acceptés : l'app (build) et Expo Go (développement).
REDIRECT_RE = re.compile(r"^(chapotecm|exp|exps)://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,300}$")
CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
PUSH_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$")
PREF_KEYS = ("published", "failed", "draft", "comments")

code_store = SingleUseTokens("rl:cmmobcode:", int(CODE_TTL.total_seconds()))
connect_limiter = RateLimiter("rl:cmmobconnect:", 30, 3600)
token_limiter = RateLimiter("rl:cmmobtoken:", 60, 3600)
refresh_limiter = RateLimiter("rl:cmmobrefresh:", 240, 3600)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (
        request.client.host if request.client else "?")


def _session_token(user_id: int) -> str:
    return _encode({"sub": str(user_id), "scope": "dashboard", "via": "mobile"}, SESSION_TTL)


def _user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "avatar_url": getattr(user, "avatar_url", None)}


async def _new_device(db: AsyncSession, user: User, name: Optional[str], platform: Optional[str]) -> dict:
    token = secrets.token_urlsafe(48)
    db.add(CmMobileDevice(user_id=user.id, token_hash=_hash(token), name=(name or "").strip()[:120] or None,
                          platform=platform if platform in ("ios", "android") else None,
                          last_used_at=utcnow()))
    await db.commit()
    return {"refresh_token": token, "session": _session_token(user.id),
            "expires_in": int(SESSION_TTL.total_seconds()), "user": _user_out(user)}


async def _device(db: AsyncSession, token: str) -> CmMobileDevice:
    if not token or len(token) > 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Appareil déconnecté : reconnectez-vous.")
    dev = (await db.execute(select(CmMobileDevice).where(
        CmMobileDevice.token_hash == _hash(token)))).scalar_one_or_none()
    if dev is None or dev.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Appareil déconnecté : reconnectez-vous.")
    return dev


# --------------------------------------------------------------------------
# Connexion par le navigateur intégré
# --------------------------------------------------------------------------

_PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Chapote CM</title>
<style>
:root{{color-scheme:light dark;--bg:#FAFAF9;--fg:#1C1917;--mute:#57534E;--line:#E7E5E4;--card:#fff;--accent:#1D4ED8}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0C0A09;--fg:#F5F5F4;--mute:#A8A29E;--line:#292524;--card:#1C1917;--accent:#3B82F6}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}}
main{{max-width:420px;margin:0 auto;padding:48px 20px;display:flex;flex-direction:column;gap:16px}}
h1{{font-size:24px;margin:0}} p{{margin:0;color:var(--mute)}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}}
.btn{{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:14px;border:0;
font:inherit;font-weight:600;text-decoration:none;background:var(--accent);color:#fff;width:100%;cursor:pointer}}
.sec{{background:transparent;color:var(--fg);border:1px solid var(--line)}}
</style></head><body><main>{body}</main></body></html>"""


def _page(body: str, code: int = 200) -> HTMLResponse:
    csp = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' chapotecm: exp: exps:; frame-ancestors 'none'"
    return HTMLResponse(_PAGE.format(body=body), status_code=code,
                        headers={"Content-Security-Policy": csp, "Cache-Control": "no-store",
                                 "Referrer-Policy": "no-referrer"})


def _check_connect(redirect_uri: str, challenge: str, state: str) -> None:
    if not REDIRECT_RE.match(redirect_uri or "") or not CHALLENGE_RE.match(challenge or "") or len(state or "") > 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien de connexion invalide : relancez la connexion depuis l'app.")


@router.get("/connect", response_class=HTMLResponse)
async def connect_page(request: Request, redirect_uri: str = "", challenge: str = "", state: str = "",
                       db: AsyncSession = Depends(get_db)):
    _check_connect(redirect_uri, challenge, state)
    user = await get_optional_user(request, db)
    here = html.escape(str(request.url))
    if user is None:
        site = html.escape(settings.CM_URL.rstrip("/") + "/")
        return _page(
            "<h1>Connectez-vous d'abord</h1>"
            "<p>Connectez-vous sur cm.chapote.fr (e-mail, Google…), puis revenez sur cette page.</p>"
            f'<a class="btn" href="{site}">Ouvrir cm.chapote.fr</a>'
            f'<a class="btn sec" href="{here}">J\'ai fini, continuer</a>')
    who = html.escape(user.email or user.name or "")
    fields = "".join(f'<input type="hidden" name="{k}" value="{html.escape(v)}">'
                     for k, v in (("redirect_uri", redirect_uri), ("challenge", challenge), ("state", state)))
    return _page(
        "<h1>Connecter l'application</h1>"
        f'<div class="card"><p>Compte</p><strong>{who}</strong></div>'
        "<p>L'application Chapote CM pourra voir et gérer votre planning, vos comptes et vos commentaires, "
        "comme sur le site. Vous pourrez la déconnecter à tout moment.</p>"
        f'<form method="post" action="connect">{fields}<button class="btn" type="submit">Autoriser</button></form>')


@router.post("/connect")
async def connect_confirm(request: Request, redirect_uri: str = Form(""), challenge: str = Form(""),
                          state: str = Form(""), db: AsyncSession = Depends(get_db)):
    _check_connect(redirect_uri, challenge, state)
    user = await get_current_user(request, db)
    if not await connect_limiter.check(f"u:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez dans une heure.")
    code = _encode({"sub": str(user.id), "scope": CODE_SCOPE, "ch": challenge, "jti": uuid.uuid4().hex}, CODE_TTL)
    sep = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(redirect_uri + sep + urlencode({"code": code, "state": state}), status_code=303)


class TokenIn(BaseModel):
    code: str = Field(..., max_length=2000)
    verifier: str = Field(..., min_length=43, max_length=128)
    name: Optional[str] = Field(None, max_length=120)
    platform: Optional[str] = Field(None, max_length=20)


@router.post("/token")
async def token(body: TokenIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not await token_limiter.check(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez plus tard.")
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "Code de connexion invalide ou expiré : recommencez.")
    try:
        claims = jwt.decode(body.code, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise invalid
    if claims.get("scope") != CODE_SCOPE or not claims.get("jti"):
        raise invalid
    if not secrets.compare_digest(_s256(body.verifier), str(claims.get("ch", ""))):
        raise invalid
    if not await code_store.claim(claims["jti"]):
        raise invalid
    user = await db.get(User, int(claims["sub"]))
    if user is None or not user.is_active:
        raise invalid
    return await _new_device(db, user, body.name, body.platform)


class DeviceIn(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    platform: Optional[str] = Field(None, max_length=20)


@router.post("/devices")
async def create_device(body: DeviceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Après une connexion par le formulaire de l'app (cookie de session de /api/auth/login)."""
    return await _new_device(db, user, body.name, body.platform)


class RefreshIn(BaseModel):
    refresh_token: str = Field(..., max_length=200)


@router.post("/refresh")
async def refresh(body: RefreshIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not await refresh_limiter.check(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez plus tard.")
    dev = await _device(db, body.refresh_token)
    user = await db.get(User, dev.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte désactivé.")
    dev.last_used_at = utcnow()
    await db.commit()
    return {"session": _session_token(user.id), "expires_in": int(SESSION_TTL.total_seconds()), "user": _user_out(user)}


@router.post("/logout")
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    try:
        dev = await _device(db, body.refresh_token)
    except HTTPException:
        return {"ok": True}
    dev.revoked_at, dev.push_token = utcnow(), None
    await db.commit()
    return {"ok": True}


def _device_out(d: CmMobileDevice) -> dict:
    return {"id": d.id, "name": d.name, "platform": d.platform, "push": bool(d.push_token),
            "created_at": d.created_at.isoformat() + "Z" if d.created_at else None,
            "last_used_at": d.last_used_at.isoformat() + "Z" if d.last_used_at else None}


@router.get("/devices")
async def list_devices(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(CmMobileDevice).where(
        CmMobileDevice.user_id == user.id, CmMobileDevice.revoked_at.is_(None))
        .order_by(CmMobileDevice.last_used_at.desc().nullslast(), CmMobileDevice.id.desc()))).scalars().all()
    return [_device_out(d) for d in rows]


@router.delete("/devices/{device_id}")
async def revoke_device(device_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    dev = await db.get(CmMobileDevice, device_id)
    if dev is None or dev.user_id != user.id or dev.revoked_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appareil introuvable")
    dev.revoked_at, dev.push_token = utcnow(), None
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------

class PushIn(BaseModel):
    refresh_token: str = Field(..., max_length=200)
    push_token: Optional[str] = Field(None, max_length=255)
    prefs: Optional[dict[str, bool]] = None


def _prefs(raw: Optional[dict]) -> dict:
    raw = raw or {}
    return {k: bool(raw.get(k, True)) for k in PREF_KEYS}


@router.get("/push")
async def get_push(refresh_token: str, db: AsyncSession = Depends(get_db)):
    dev = await _device(db, refresh_token)
    return {"enabled": bool(dev.push_token), "prefs": _prefs(dev.push_prefs)}


@router.put("/push")
async def put_push(body: PushIn, db: AsyncSession = Depends(get_db)):
    dev = await _device(db, body.refresh_token)
    if body.push_token is not None and body.push_token != "" and not PUSH_RE.match(body.push_token):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jeton de notifications invalide")
    if body.push_token is not None:
        token = body.push_token or None
        if token:
            # Un téléphone = un jeton : retiré d'un appareil plus ancien (reconnexion, autre compte).
            for other in (await db.execute(select(CmMobileDevice).where(
                    CmMobileDevice.push_token == token, CmMobileDevice.id != dev.id))).scalars():
                other.push_token = None
        dev.push_token = token
    if body.prefs is not None:
        dev.push_prefs = _prefs({**_prefs(dev.push_prefs), **body.prefs})
    await db.commit()
    return {"enabled": bool(dev.push_token), "prefs": _prefs(dev.push_prefs)}
