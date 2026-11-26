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
import time
import uuid
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import _encode, create_dashboard_token, get_current_user, get_optional_user, set_auth_cookie
from src.core.time import utcnow
from src.models.cm_mobile import CmAppOpen, CmFeedback, CmMobileDevice, CmUserIdentity
from src.models.user import User
from src.i18n import browser_lang, tr
from src.services.captcha import verify_turnstile_token
from src.services.email_service import send_account_email
from src.services.user_apps import client_ip
from src.services.rate_limit import RateLimiter, SingleUseTokens

router = APIRouter(prefix="/api/cm/mobile", tags=["cm-mobile"])

CODE_SCOPE = "cm_mobile_code"
CODE_TTL = timedelta(minutes=3)
SESSION_TTL = timedelta(hours=1)
# Appareil gardé connecté tant que l'app est ouverte au moins une fois tous les 7 jours (prévenu la veille).
IDLE_LIMIT = timedelta(days=7)
# Schémas de retour acceptés : l'app (build) et Expo Go (développement).
REDIRECT_RE = re.compile(r"^(chapotecm|exp|exps)://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,300}$")
CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
PUSH_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$")
PREF_KEYS = ("published", "failed", "draft", "comments", "storage")

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


async def _record_open(db: AsyncSession, user_id: int) -> None:
    """Jour d'ouverture de l'app (une ligne par jour et par personne) : mesure des retours J1, J3, J7."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    await db.execute(pg_insert(CmAppOpen).values(user_id=user_id, day=utcnow().date()).on_conflict_do_nothing())


async def _new_device(db: AsyncSession, user: User, name: Optional[str], platform: Optional[str]) -> dict:
    token = secrets.token_urlsafe(48)
    await _record_open(db, user.id)
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
    if dev.last_used_at is not None and utcnow() - dev.last_used_at > IDLE_LIMIT:
        dev.revoked_at, dev.push_token = utcnow(), None
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Déconnecté après 7 jours sans ouvrir l'app : reconnectez-vous.")
    return dev


# --------------------------------------------------------------------------
# Connexion par le navigateur intégré
# --------------------------------------------------------------------------

_PAGE = """<!doctype html><html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">{head}<title>Chapote CM</title>
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


GSI = "https://accounts.google.com/gsi/"


def _tx(text: str, lang: str) -> str:
    """Texte d'une page, dans sa langue (src/i18n/en_pages.py), échappé pour le HTML."""
    return html.escape(tr(text, lang), quote=False)


def _page(body: str, code: int = 200, google: bool = False, head: str = "", lang: str = "fr") -> HTMLResponse:
    """Page de connexion de l'app ; `lang` (« fr » | « en », voir src.i18n.browser_lang) : <html lang>, textes
    déjà traduits par l'appelant."""
    # Le nginx de cm ajoute sa propre CSP (form-action 'self') : le retour vers l'app ne passe donc
    # jamais par une redirection de formulaire, mais par un lien (voir connect_confirm).
    csp = ("default-src 'none'; style-src 'unsafe-inline'"
           + (f" {GSI}style; script-src 'self' {GSI}client; frame-src {GSI}; connect-src 'self' {GSI}" if google else "")
           + "; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    return HTMLResponse(_PAGE.format(body=body, head=head, lang=lang), status_code=code,
                        headers={"Content-Security-Policy": csp, "Cache-Control": "no-store",
                                 "Referrer-Policy": "no-referrer"})


def _check_connect(redirect_uri: str, challenge: str, state: str) -> None:
    if not REDIRECT_RE.match(redirect_uri or "") or not CHALLENGE_RE.match(challenge or "") or len(state or "") > 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien de connexion invalide : relancez la connexion depuis l'app.")


# Connexion Google sur la page même (même bouton que le site, même Client ID autorisé pour cm.chapote.fr),
# puis code de double authentification si besoin ; la page se recharge connectée.
_CONNECT_JS = """(function () {
  var box = document.getElementById('g'), msg = document.getElementById('m'), form = document.getElementById('f');
  var challenge = null, en = document.documentElement.lang === 'en';
  function say(t) { msg.textContent = t || ''; }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Chapote-App': 'cm', 'X-Chapote-Lang': en ? 'en' : 'fr' },
      body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error((b && (typeof b.detail === 'string' ? b.detail : b.message)) || ((en ? 'Error ' : 'Erreur ') + r.status));
        return b; }); });
  }
  function done(b) {
    if (b && b.twofa_required) { challenge = b.challenge; form.hidden = false; form.code.focus(); say(''); return; }
    location.reload();
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    post('/api/auth/2fa/login/totp', { challenge: challenge, code: form.code.value.trim() }).then(done, function (err) { say(err.message); });
  });
  window.addEventListener('load', function () {
    if (!window.google || !box) return;
    google.accounts.id.initialize({ client_id: box.dataset.client, ux_mode: 'popup', callback: function (r) {
      say(en ? 'Signing in…' : 'Connexion…');
      post('/api/auth/google', { credential: r.credential }).then(done, function (err) { say(err.message); });
    } });
    google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', width: 300, text: 'continue_with', locale: en ? 'en' : 'fr' });
  });
})();
"""


@router.get("/connect.js")
async def connect_js():
    return Response(_CONNECT_JS, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@router.get("/connect", response_class=HTMLResponse)
async def connect_page(request: Request, redirect_uri: str = "", challenge: str = "", state: str = "",
                       db: AsyncSession = Depends(get_db)):
    _check_connect(redirect_uri, challenge, state)
    lang = browser_lang(request)
    user = await get_optional_user(request, db)
    here = html.escape(str(request.url))
    if user is None:
        site = html.escape(settings.CM_URL.rstrip("/") + "/")
        client = settings.GOOGLE_CLIENT_ID
        google = (f'<div id="g" data-client="{html.escape(client)}" style="display:flex;justify-content:center;min-height:44px"></div>'
                  f'<form id="f" hidden><p>{_tx("Code de double authentification", lang)}</p>'
                  '<input name="code" inputmode="numeric" autocomplete="one-time-code" aria-label="Code" '
                  'style="font:inherit;width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;border:1px solid var(--line);padding:0 12px;margin:8px 0">'
                  f'<button class="btn" type="submit">{_tx("Valider", lang)}</button></form>'
                  '<p id="m" role="status"></p>'
                  f'<script src="{GSI}client" async></script><script src="connect.js"></script>') if client else ""
        return _page(
            "<h1>" + _tx("Connexion", lang) + "</h1>"
            "<p>" + _tx("Connectez-vous avec votre compte Chapote pour relier l'application.", lang) + "</p>"
            + google
            + f'<a class="btn sec" href="{site}">' + _tx("E-mail et mot de passe sur cm.chapote.fr", lang) + "</a>"
            + f'<a class="btn sec" href="{here}">' + _tx("Je suis connecté, continuer", lang) + "</a>",
            google=bool(client), lang=lang)
    who = html.escape(user.email or user.name or "")
    fields = "".join(f'<input type="hidden" name="{k}" value="{html.escape(v)}">'
                     for k, v in (("redirect_uri", redirect_uri), ("challenge", challenge), ("state", state)))
    return _page(
        "<h1>" + _tx("Connecter l'application", lang) + "</h1>"
        '<div class="card"><p>' + _tx("Compte", lang) + f"</p><strong>{who}</strong></div>"
        "<p>" + _tx("L'application Chapote CM pourra voir et gérer votre planning, vos comptes et vos commentaires, "
                    "comme sur le site. Vous pourrez la déconnecter à tout moment.", lang) + "</p>"
        f'<form method="post" action="connect">{fields}<button class="btn" type="submit">'
        + _tx("Autoriser", lang) + "</button></form>",
        lang=lang)


@router.post("/connect", response_class=HTMLResponse)
async def connect_confirm(request: Request, redirect_uri: str = Form(""), challenge: str = Form(""),
                          state: str = Form(""), db: AsyncSession = Depends(get_db)):
    _check_connect(redirect_uri, challenge, state)
    lang = browser_lang(request)
    user = await get_current_user(request, db)
    if not await connect_limiter.check(f"u:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez dans une heure.")
    code = _encode({"sub": str(user.id), "scope": CODE_SCOPE, "ch": challenge, "jti": uuid.uuid4().hex}, CODE_TTL)
    await _pending_put(challenge, code)
    sep = "&" if "?" in redirect_uri else "?"
    back = html.escape(redirect_uri + sep + urlencode({"code": code, "state": state}))
    # Lien (et rafraîchissement automatique) plutôt qu'une redirection : la CSP form-action du site
    # bloquerait la redirection vers chapotecm:// ou exp://.
    return _page(
        "<h1>" + _tx("C'est fait", lang) + "</h1><p>"
        + _tx("Retour dans l'application… Si rien ne se passe, fermez cette page : "
              "l'application finit la connexion toute seule.", lang) + "</p>"
        + f'<a class="btn" href="{back}">' + _tx("Ouvrir l'application", lang) + "</a>",
        head=f'<meta http-equiv="refresh" content="0;url={back}">', lang=lang)


# Le retour automatique dans l'app (lien chapotecm:// ou exp://) n'est pas fiable partout (Expo Go…) :
# le code est aussi gardé 3 minutes sous le challenge, et l'app le reprend elle-même en prouvant qu'elle
# détient le verifier (POST /token/pending), quand on revient dans l'app en fermant la page.
_PENDING_PREFIX = "rl:cmmobpend:"
_pending_memory: dict[str, tuple[str, float]] = {}


async def _pending_put(challenge: str, code: str) -> None:
    from src.services.rate_limit import _get_redis, _redis_failed
    ttl = int(CODE_TTL.total_seconds())
    client = _get_redis()
    if client is not None:
        try:
            await client.set(_PENDING_PREFIX + challenge, code, ex=ttl)
            return
        except Exception as exc:  # repli mémoire, comme rate_limit
            _redis_failed(exc)
    now = time.monotonic()
    for k in [k for k, (_, exp) in _pending_memory.items() if exp < now]:
        _pending_memory.pop(k, None)
    _pending_memory[challenge] = (code, now + ttl)


async def _pending_take(challenge: str) -> Optional[str]:
    from src.services.rate_limit import _get_redis, _redis_failed
    client = _get_redis()
    if client is not None:
        try:
            value = await client.getdel(_PENDING_PREFIX + challenge)
            return value.decode() if isinstance(value, bytes) else value
        except Exception as exc:
            _redis_failed(exc)
    code, exp = _pending_memory.pop(challenge, (None, 0.0))
    return code if code and exp > time.monotonic() else None


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


class PendingIn(BaseModel):
    verifier: str = Field(..., min_length=43, max_length=128)
    name: Optional[str] = Field(None, max_length=120)
    platform: Optional[str] = Field(None, max_length=20)


@router.post("/token/pending")
async def token_pending(body: PendingIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Après « Autoriser », si le retour automatique dans l'app n'a pas marché : 404 tant que rien n'est autorisé."""
    if not await token_limiter.check(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez plus tard.")
    code = await _pending_take(_s256(body.verifier))
    if not code:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pas encore autorisé.")
    return await token(TokenIn(code=code, verifier=body.verifier, name=body.name, platform=body.platform), request, db)


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
    # Ouverte à nouveau : le prochain avertissement « déconnexion demain » pourra repartir.
    from src.models.cm_mobile import CmPushEvent
    await db.execute(delete(CmPushEvent).where(CmPushEvent.kind == "idle", CmPushEvent.ref_id == dev.id))
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


# --------------------------------------------------------------------------
# Connexion d'un compte TikTok / YouTube / Instagram / Drive depuis l'app
# --------------------------------------------------------------------------
# L'autorisation se fait dans le navigateur du téléphone, et la page de retour du site
# (cm.chapote.fr/<plateforme>/callback) termine la connexion avec le cookie de session du
# navigateur. Si ce navigateur n'est pas connecté, ou l'est à un autre compte Chapote, l'échange
# est refusé (le state est lié à l'utilisateur qui a commencé). L'app demande donc un lien à usage
# unique (2 minutes) : il connecte le navigateur au compte de l'app, puis l'envoie chez la plateforme.

WEB_SCOPE = "cm_mobile_web"
WEB_TTL = timedelta(minutes=2)
WEB_HOSTS = ("accounts.google.com", "www.tiktok.com", "www.instagram.com")
web_store = SingleUseTokens("rl:cmmobweb:", int(WEB_TTL.total_seconds()) + 30)
web_limiter = RateLimiter("rl:cmmobweblink:", 60, 3600)


def _web_next_ok(url: str) -> bool:
    from urllib.parse import urlsplit
    if not url or len(url) > 4000:
        return False
    u = urlsplit(url)
    return u.scheme == "https" and u.hostname in WEB_HOSTS and u.port is None and not u.username


class WebLinkIn(BaseModel):
    next: str = Field(..., max_length=4000)


@router.post("/web-link")
async def web_link(body: WebLinkIn, user: User = Depends(get_current_user)):
    """Lien à ouvrir dans le navigateur : `/api/cm/mobile/web-session?t=…`."""
    if not _web_next_ok(body.next):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Adresse d'autorisation non acceptée")
    if not await web_limiter.check(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de tentatives : réessayez plus tard.")
    t = _encode({"sub": str(user.id), "scope": WEB_SCOPE, "next": body.next, "jti": uuid.uuid4().hex}, WEB_TTL)
    return {"path": "/api/cm/mobile/web-session?" + urlencode({"t": t}), "expires_in": int(WEB_TTL.total_seconds())}


@router.get("/web-session")
async def web_session(request: Request, t: str = "", db: AsyncSession = Depends(get_db)):
    lang = browser_lang(request)
    invalid = _page("<h1>" + _tx("Lien expiré", lang) + "</h1><p>"
                    + _tx("Revenez dans l'app Chapote CM et recommencez la connexion du compte.", lang) + "</p>",
                    400, lang=lang)
    try:
        claims = jwt.decode(t, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return invalid
    nxt = str(claims.get("next") or "")
    if claims.get("scope") != WEB_SCOPE or not claims.get("jti") or not _web_next_ok(nxt):
        return invalid
    if not await web_store.claim(claims["jti"]):
        return invalid
    user = await db.get(User, int(claims["sub"]))
    if user is None or not user.is_active:
        return invalid
    resp = RedirectResponse(nxt, status_code=status.HTTP_303_SEE_OTHER,
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    set_auth_cookie(resp, create_dashboard_token(user.id))
    return resp


# --------------------------------------------------------------------------
# Inscription dans l'app : nom, date de naissance, conditions acceptées, âge minimum
# --------------------------------------------------------------------------
# Une personne sous l'âge minimum (CM_MIN_AGE) termine son inscription, mais l'app reste bloquée
# jusqu'à son anniversaire (`blocked_until`). La date de naissance ne se modifie plus ensuite.

LEGAL_DOCS = {"cgu": "https://chapote.fr/legal/cgu", "cgv": "https://chapote.fr/legal/cgv",
              "privacy": "https://chapote.fr/legal/confidentialite"}


def _birthday(born, years: int):
    from datetime import date
    try:
        return born.replace(year=born.year + years)
    except ValueError:  # 29 février
        return date(born.year + years, 3, 1)


def _identity_out(row: Optional[CmUserIdentity]) -> dict:
    from datetime import date
    min_age = settings.CM_MIN_AGE
    out = {"done": False, "first_name": None, "last_name": None, "birth_date": None, "terms_version": None,
           "terms_current": settings.CM_TERMS_VERSION, "terms_ok": False, "min_age": min_age,
           "blocked_until": None, "legal": LEGAL_DOCS}
    if row is None:
        return out
    until = _birthday(row.birth_date, min_age)
    out.update(first_name=row.first_name, last_name=row.last_name, birth_date=row.birth_date.isoformat(),
               terms_version=row.terms_version, terms_ok=row.terms_version == settings.CM_TERMS_VERSION,
               blocked_until=until.isoformat() if until > date.today() else None)
    out["done"] = out["terms_ok"]
    return out


class IdentityIn(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    birth_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    accept_terms: bool


@router.get("/identity")
async def get_identity(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return _identity_out(await db.get(CmUserIdentity, user.id))


@router.put("/identity")
async def put_identity(body: IdentityIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from datetime import date
    if not body.accept_terms:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Acceptez les conditions pour continuer.")
    first, last = " ".join(body.first_name.split()), " ".join(body.last_name.split())
    if not first or not last:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Prénom et nom obligatoires.")
    try:
        born = date.fromisoformat(body.birth_date)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Date de naissance invalide.")
    today = date.today()
    if born >= today or born < date(today.year - 120, 1, 1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Date de naissance invalide.")
    row = await db.get(CmUserIdentity, user.id)
    now = utcnow()
    if row is None:
        row = CmUserIdentity(user_id=user.id, first_name=first, last_name=last, birth_date=born,
                             terms_version=settings.CM_TERMS_VERSION, terms_accepted_at=now, created_at=now, updated_at=now)
        db.add(row)
    else:
        if row.birth_date != born:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "La date de naissance ne se modifie pas ici : contactez-nous en cas d'erreur.")
        row.first_name, row.last_name = first, last
        row.terms_version, row.terms_accepted_at, row.updated_at = settings.CM_TERMS_VERSION, now, now
    user.name = f"{first} {last}"[:200]
    await db.commit()
    return _identity_out(row)


# --------------------------------------------------------------------------
# Mesure : de l'inscription à la 1re vidéo, et retours dans l'app (superadmin)
# --------------------------------------------------------------------------

@router.get("/metrics")
async def metrics(weeks: int = 8, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Par semaine d'inscription dans l'app (étape « Vos informations ») : inscrits, avec au moins une publication
    créée, revenus le 1er, le 3e et le 7e jour (ouverture de l'app ce jour-là)."""
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé à l'administration.")
    from datetime import timedelta as _td
    from sqlalchemy import func
    from src.models.cm import CmPost
    weeks = max(1, min(weeks, 26))
    since = utcnow() - _td(weeks=weeks)
    rows = (await db.execute(select(CmUserIdentity.user_id, CmUserIdentity.created_at).where(CmUserIdentity.created_at >= since))).all()
    opens: dict[int, set] = {}
    if rows:
        ids = [r[0] for r in rows]
        for uid, day in (await db.execute(select(CmAppOpen.user_id, CmAppOpen.day).where(CmAppOpen.user_id.in_(ids)))).all():
            opens.setdefault(uid, set()).add(day)
        posted = set((await db.execute(select(CmPost.user_id).where(CmPost.user_id.in_(ids)).group_by(CmPost.user_id))).scalars())
    else:
        posted = set()
    cohorts: dict[str, dict] = {}
    for uid, created in rows:
        d0 = created.date()
        wk = (d0 - _td(days=d0.weekday())).isoformat()
        c = cohorts.setdefault(wk, {"week": wk, "signed_up": 0, "first_post": 0, "d1": 0, "d3": 0, "d7": 0})
        c["signed_up"] += 1
        c["first_post"] += uid in posted
        days = opens.get(uid, set())
        for n in (1, 3, 7):
            c[f"d{n}"] += (d0 + _td(days=n)) in days
    return {"weeks": sorted(cohorts.values(), key=lambda c: c["week"], reverse=True)}


# --------------------------------------------------------------------------
# Question courte au moment d'un abandon (une réponse, facultative), et « Donner mon avis » (texte libre)
# --------------------------------------------------------------------------

feedback_limiter = RateLimiter("rl:cmmobfeedback:", 20, 86400)
FEEDBACK_CONTEXTS = ("new_post_abandon", "general")
FEEDBACK_MAX = {"general": 2000}   # texte libre plus long pour « Donner mon avis » ; 500 sinon
FEEDBACK_REASONS = ("no_video", "too_complex", "when", "accounts", "other")


class FeedbackIn(BaseModel):
    context: str = Field(..., max_length=40)
    reason: Optional[str] = Field(None, max_length=40)
    text: Optional[str] = Field(None, max_length=2000)


@router.post("/feedback")
async def feedback(body: FeedbackIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if body.context not in FEEDBACK_CONTEXTS or (body.reason and body.reason not in FEEDBACK_REASONS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Réponse non reconnue")
    if body.context == "general" and body.reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Réponse non reconnue")
    if not body.reason and not (body.text or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Réponse vide")
    if not await feedback_limiter.check(str(user.id)):
        return {"ok": True}
    text = (body.text or "").strip()[:FEEDBACK_MAX.get(body.context, 500)] or None
    db.add(CmFeedback(user_id=user.id, context=body.context, reason=body.reason, text=text, created_at=utcnow()))
    await db.commit()
    if body.context == "general" and text:
        await _mail_feedback(db, user, text)
    return {"ok": True}


async def _admin_emails(db: AsyncSession) -> list[str]:
    return list((await db.execute(select(User.email).where(User.is_superadmin.is_(True)))).scalars())


async def _mail_feedback(db: AsyncSession, user: User, text: str) -> None:
    """« Donner mon avis » : copie par e-mail aux superadmins (l'équipe Chapote), avec qui l'a écrit. Répondre
    à l'e-mail répond à l'auteur. Envoi en arrière-plan : n'échoue jamais l'enregistrement."""
    to = await _admin_emails(db)
    if not to:
        return
    when = utcnow().strftime("%d/%m/%Y %H:%M UTC")
    body = (f"Nouvel avis sur Chapote CM.\n\n"
            f"De : {user.name} <{user.email}> (compte n° {user.id}, inscrit le {user.created_at:%d/%m/%Y})\n"
            f"Envoyé le : {when}\n\n{text}\n\nRépondez à cet e-mail pour lui répondre directement.")
    send_account_email(to, f"Avis Chapote CM — {user.name}", body, error_label="cm_feedback_mail", reply_to=user.email)


@router.get("/feedback")
async def list_feedback(limit: int = 100, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Dernières réponses (superadmin)."""
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé à l'administration.")
    rows = (await db.execute(select(CmFeedback).order_by(CmFeedback.id.desc()).limit(max(1, min(limit, 500))))).scalars()
    return [{"context": f.context, "reason": f.reason, "text": f.text, "created_at": f.created_at.isoformat()} for f in rows]


# --------------------------------------------------------------------------
# « Donner mon avis » sans compte (page /avis, visiteur non connecté)
# Anti-robot : Turnstile (clés Chapote), champ piège invisible, délai minimum de saisie, 5 envois par heure et par IP.
# En production, sans clé Turnstile, le formulaire est fermé (404) : jamais de formulaire public sans captcha.
# Rien n'est stocké : le message part par e-mail aux superadmins, « répondre » répond au visiteur.
# --------------------------------------------------------------------------

contact_limiter = RateLimiter("rl:cmcontact:", 5, 3600)
CONTACT_MIN_MS = 3000
_EMAIL_RE = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$")


def _contact_open() -> bool:
    return not settings.is_production or bool(settings.TURNSTILE_SECRET_KEY and settings.TURNSTILE_SITE_KEY)


class ContactIn(BaseModel):
    name: str = Field("", max_length=80)
    email: str = Field(..., max_length=200)
    message: str = Field(..., max_length=2000)
    website: str = Field("", max_length=200)          # champ piège : invisible pour un humain
    elapsed_ms: int = Field(0, ge=0)
    turnstile_token: Optional[str] = Field(None, max_length=4000)


@router.get("/contact-config")
async def contact_config():
    """Pour la page /avis : le formulaire est-il ouvert, et la clé publique Turnstile à afficher."""
    return {"enabled": _contact_open(), "turnstile_site_key": settings.TURNSTILE_SITE_KEY or None}


@router.post("/contact")
async def contact(body: ContactIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not _contact_open():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formulaire indisponible")
    if body.website.strip() or body.elapsed_ms < CONTACT_MIN_MS:
        return {"ok": True}                              # robot : on ne lui dit rien
    ip = client_ip(request)
    if not await contact_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d’envois. Réessayez dans une heure.")
    email, message = body.email.strip(), body.message.strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Adresse e-mail incomplète (ex. vous@exemple.fr).")
    if len(message) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Écrivez votre message.")
    if not await verify_turnstile_token(body.turnstile_token, ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vérification anti-robot échouée. Réessayez.")
    to = await _admin_emails(db)
    if to:
        name = " ".join(body.name.split())[:80] or email.split("@")[0]
        text = (f"Nouvel avis sur Chapote CM, par un visiteur sans compte.\n\n"
                f"De : {name} <{email}>\nEnvoyé le : {utcnow():%d/%m/%Y %H:%M UTC}\n\n{message}\n\n"
                f"Répondez à cet e-mail pour lui répondre directement.")
        send_account_email(to, f"Avis Chapote CM (visiteur) — {name}", text, error_label="cm_contact_mail", reply_to=email)
    return {"ok": True}
