"""2FA dashboard — enrôlement (authentifié) + étape de login (challenge).

Deux familles d'endpoints sous /api/auth/2fa :

1. Enrôlement / gestion (token dashboard requis, get_current_user) :
   - TOTP   : setup -> enable(code) -> disable(code)
   - Passkey: register/begin -> register/complete ; list ; delete
   - Codes de secours : regenerate
   - status

2. Login 2nd facteur (PAS de token dashboard : un *challenge* 2FA émis par
   /api/auth/login quand la 2FA est active) :
   - /login/totp, /login/recovery
   - /login/webauthn/begin -> /login/webauthn/complete
   Chacun échange le challenge contre un vrai token dashboard.
"""
import hashlib
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import MAX_2FA_CHALLENGE_FAILURES
from src.core.database import get_db
from src.core.security import (
    create_dashboard_token,
    decode_twofa_challenge_payload,
    get_current_user,
    set_auth_cookie,
)
from src.core.time import utcnow
from src.models.user import User, UserOut, WebAuthnCredential
from src.routers.widget_helpers import _client_ip
from src.services import twofa_service as tf
from src.services.crypto import decrypt_secret, encrypt_secret
from src.services.rate_limit import (
    twofa_challenge_failures,
    twofa_challenge_store,
    twofa_verify_limiter,
)

router = APIRouter(prefix="/api/auth/2fa", tags=["2fa"])

# Durée de validité d'un challenge WebAuthn (cérémonie register/auth).
WEBAUTHN_CHALLENGE_TTL = timedelta(minutes=5)


# ----------------------------------------------------------------- helpers ---

async def _passkeys(db: AsyncSession, user_id: int) -> list[WebAuthnCredential]:
    rows = await db.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user_id)
        .order_by(WebAuthnCredential.created_at)
    )
    return list(rows.scalars().all())


async def _user_by_challenge(db: AsyncSession, challenge: str) -> tuple[User, str]:
    """Résout un challenge 2FA : charge l'user (actif requis) et renvoie aussi sa
    clé anti-rejeu (`(user, challenge_key)`).

    `challenge_key` = le `jti` du challenge (présent sur tout jeton émis depuis ce
    correctif) ; repli sur une empreinte du jeton pour un éventuel challenge
    « legacy » encore en vol pendant un déploiement."""
    payload = decode_twofa_challenge_payload(challenge)
    user_id = int(payload["sub"])
    challenge_key = payload.get("jti") or hashlib.sha256(challenge.encode()).hexdigest()
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur introuvable")
    return user, challenge_key


def _ip_key(request: Request, user_id: int) -> str:
    return f"{user_id}:{_client_ip(request)}"


async def _throttle_2fa_mgmt(request: Request, user_id: int) -> None:
    """Throttle par-IP des endpoints 2FA SESSION-AUTHED qui vérifient un code ou
    réalisent une action sensible (activation/désactivation TOTP, régénération des
    codes de secours). Réutilise le throttle par-IP atomique (clé {user_id}:{ip}) du
    flux de login -> empêche le brute-force d'un code via une session volée (ex.
    désactiver la 2FA en devinant le code). Pas de challenge ici -> pas de cap
    par-challenge : seulement la barrière par-IP/user. 429 au-delà du seuil."""
    if not await twofa_verify_limiter.check(_ip_key(request, user_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives, réessayez dans quelques minutes")


async def _enforce_2fa_verify(request: Request, user_id: int, challenge_key: str) -> None:
    """Garde-fous communs à la vérification du 2nd facteur (à appeler APRÈS
    résolution du challenge, AVANT de vérifier le facteur). Trois barrières, toutes
    ATOMIQUES et AMONT de la crypto :

    1. THROTTLE PAR-IP ATOMIQUE (clé {user_id}:{ip}) : incrément-et-test en UN seul
       pipeline (`check`). Borne un burst concurrent depuis une source -> 429.
       Vérifié EN PREMIER : une source unique qui sature voit 429 (et non 401). Un
       succès en aval réinitialise cette clé (`_reset_2fa_counters`) : pas de lockout
       du légitime (le throttle compte chaque tentative).
    2. ANTI-REJEU (pré-check) : un challenge déjà consommé -> 401 AVANT toute mutation
       (rejeu d'un challenge validé, OU challenge déjà épuisé par le cap ci-dessous) —
       ne brûle pas un code de secours sur un rejeu.
    3. CAP PAR-CHALLENGE ATOMIQUE (clé = `jti`, INDÉPENDANT de l'IP) : chaque tentative
       consomme un crédit du challenge via un INCR atomique (Redis INCR / mémoire),
       fait ICI, AVANT la crypto. Au-delà de MAX_2FA_CHALLENGE_FAILURES crédits le
       challenge est INVALIDÉ (claim single-use) -> 401. C'est la VRAIE borne
       anti-brute-force : au plus ~MAX tentatives TOTALES par challenge quelle que
       soit la rotation d'IP, et la borne TIENT SOUS CONCURRENCE multi-IP (l'INCR
       atomique amont empêche N requêtes simultanées de toutes franchir la barrière
       avant que le compteur n'atteigne le plafond). PAS de verrou persistant par
       compte : re-login = nouveau challenge (borné par le limiteur de login). Un
       SUCCÈS consomme le challenge (single-use) -> le compteur devient caduc (reset
       au succès / expire au TTL), jamais retenu contre l'utilisateur.
    """
    if not await twofa_verify_limiter.check(_ip_key(request, user_id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives, réessayez dans quelques minutes")
    if await twofa_challenge_store.is_used(challenge_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Challenge 2FA déjà utilisé ou expiré.")
    if await twofa_challenge_failures.incr(challenge_key) > MAX_2FA_CHALLENGE_FAILURES:
        await twofa_challenge_store.claim(challenge_key)  # challenge épuisé -> invalidé
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Challenge 2FA déjà utilisé ou expiré.")


async def _reset_2fa_counters(request: Request, user_id: int, challenge_key: str) -> None:
    """Succès : oublie le throttle par-IP de la source (un usage normal répété
    depuis la même IP ne lockoute jamais) et le compteur de crédits du challenge (de
    toute façon consommé via le single-use)."""
    await twofa_verify_limiter.reset(_ip_key(request, user_id))
    await twofa_challenge_failures.reset(challenge_key)


async def _consume_challenge(challenge_key: str) -> None:
    """Consomme le challenge de façon ATOMIQUE (claim SET NX) après une vérif
    réussie. Si un appel concurrent l'a réservé entre le pré-check et ici -> 401
    (ferme la course TOCTOU : une seule session émise par challenge)."""
    if not await twofa_challenge_store.claim(challenge_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Challenge 2FA déjà utilisé ou expiré.")


async def _issue_dashboard(db: AsyncSession, user: User, response: Response) -> UserOut:
    """Login réussi (2nd facteur validé) : pose le cookie de session httpOnly
    (le JWT ne transite plus par le corps) et renvoie l'UserOut complet."""
    from src.routers.auth import _user_out  # import paresseux (évite tout cycle)

    user.last_login = utcnow()
    # Nettoie un éventuel challenge WebAuthn de login encore en base.
    user.webauthn_challenge = None
    user.webauthn_challenge_at = None
    await db.commit()
    # mfa=True : la session a franchi le 2nd facteur (exigé par emails.chapote.fr).
    set_auth_cookie(response, create_dashboard_token(user.id, mfa=True))
    return await _user_out(db, user)


def _challenge_fresh(user: User) -> bool:
    return bool(user.webauthn_challenge) and user.webauthn_challenge_at is not None \
        and (utcnow() - user.webauthn_challenge_at) < WEBAUTHN_CHALLENGE_TTL


# ------------------------------------------------------------------ status ---

class TwoFAStatus(BaseModel):
    totp_enabled: bool
    passkeys: list[dict]
    recovery_remaining: int
    required: bool          # obligatoire pour ce compte (superadmin)
    enabled: bool           # au moins un 2nd facteur actif


@router.get("/status", response_model=TwoFAStatus)
async def status_2fa(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pk = await _passkeys(db, user.id)
    return TwoFAStatus(
        totp_enabled=user.totp_enabled,
        passkeys=[{"id": c.id, "name": c.name,
                   "created_at": c.created_at.isoformat() if c.created_at else None,
                   "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None}
                  for c in pk],
        recovery_remaining=len(user.twofa_recovery or []),
        required=user.is_superadmin,
        enabled=user.totp_enabled or len(pk) > 0,
    )


# -------------------------------------------------------------------- TOTP ---

class CodeBody(BaseModel):
    code: str


class TotpSetupOut(BaseModel):
    secret: str          # base32 en clair (à saisir manuellement si pas de QR)
    otpauth_uri: str     # à encoder en QR côté front


@router.post("/totp/setup", response_model=TotpSetupOut)
async def totp_setup(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Génère un secret TOTP *en attente* (chiffré en base). À confirmer via
    /totp/enable avec un 1er code valide. Refusé si TOTP déjà actif."""
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "TOTP déjà activé — désactivez-le d'abord pour le régénérer.")
    secret = tf.new_totp_secret()
    user.totp_secret = encrypt_secret(secret)
    await db.commit()
    return TotpSetupOut(secret=secret, otpauth_uri=tf.totp_provisioning_uri(secret, user.email))


class TotpEnableOut(BaseModel):
    recovery_codes: list[str]


@router.post("/totp/enable", response_model=TotpEnableOut)
async def totp_enable(body: CodeBody, request: Request,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Confirme l'enrôlement TOTP avec un 1er code, active la 2FA et renvoie les
    codes de secours (affichés UNE seule fois)."""
    await _throttle_2fa_mgmt(request, user.id)  # anti-bruteforce du code (par-IP)
    secret = decrypt_secret(user.totp_secret)
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Aucun enrôlement TOTP en cours — relancez la configuration.")
    if not tf.verify_totp(secret, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code invalide. Réessayez.")
    plain, hashed = tf.new_recovery_codes()
    user.totp_enabled = True
    user.twofa_recovery = hashed
    await db.commit()
    return TotpEnableOut(recovery_codes=plain)


@router.post("/totp/disable")
async def totp_disable(body: CodeBody, request: Request,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Désactive le TOTP après vérification d'un code TOTP (ou de secours).
    Les passkeys éventuelles restent valides."""
    await _throttle_2fa_mgmt(request, user.id)  # anti-bruteforce du code (par-IP)
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "TOTP non activé.")
    secret = decrypt_secret(user.totp_secret)
    ok = bool(secret) and tf.verify_totp(secret, body.code)
    if not ok:
        matched, remaining = tf.consume_recovery_code(user.twofa_recovery, body.code)
        ok = matched
        if matched:
            user.twofa_recovery = remaining
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code invalide.")
    user.totp_enabled = False
    user.totp_secret = None
    user.twofa_recovery = None
    await db.commit()
    return {"ok": True}


@router.post("/recovery/regenerate", response_model=TotpEnableOut)
async def recovery_regenerate(body: CodeBody, request: Request,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Régénère les codes de secours (invalide les anciens) après un code TOTP."""
    await _throttle_2fa_mgmt(request, user.id)  # anti-bruteforce du code (par-IP)
    secret = decrypt_secret(user.totp_secret)
    if not (user.totp_enabled and secret and tf.verify_totp(secret, body.code)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code TOTP invalide.")
    plain, hashed = tf.new_recovery_codes()
    user.twofa_recovery = hashed
    await db.commit()
    return TotpEnableOut(recovery_codes=plain)


# ----------------------------------------------------------------- Passkey ---

class WebAuthnBeginOut(BaseModel):
    options: str  # JSON sérialisé (à parser côté front pour navigator.credentials)


class RegisterComplete(BaseModel):
    name: Optional[str] = None
    credential: dict      # réponse brute de navigator.credentials.create()


@router.post("/webauthn/register/begin", response_model=WebAuthnBeginOut)
async def webauthn_register_begin(user: User = Depends(get_current_user),
                                  db: AsyncSession = Depends(get_db)):
    existing = await _passkeys(db, user.id)
    options_json, challenge = tf.registration_options(user, existing)
    user.webauthn_challenge = challenge
    user.webauthn_challenge_at = utcnow()
    await db.commit()
    return WebAuthnBeginOut(options=options_json)


@router.post("/webauthn/register/complete")
async def webauthn_register_complete(body: RegisterComplete,
                                     user: User = Depends(get_current_user),
                                     db: AsyncSession = Depends(get_db)):
    if not _challenge_fresh(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Cérémonie expirée — relancez l'ajout de la passkey.")
    import json
    try:
        cred_id, public_key, sign_count = tf.verify_registration(
            json.dumps(body.credential), user.webauthn_challenge)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Passkey invalide ou non vérifiable.")
    # Unicité : une credential ne peut être enregistrée qu'une fois.
    dup = (await db.execute(select(WebAuthnCredential)
                            .where(WebAuthnCredential.credential_id == cred_id))).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette passkey est déjà enregistrée.")
    name = (body.name or "").strip()[:60] or "Passkey"
    db.add(WebAuthnCredential(user_id=user.id, credential_id=cred_id, public_key=public_key,
                              sign_count=sign_count, transports=None, name=name))
    user.webauthn_challenge = None
    user.webauthn_challenge_at = None
    await db.commit()
    return {"ok": True, "name": name}


@router.get("/webauthn/credentials")
async def webauthn_list(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pk = await _passkeys(db, user.id)
    return [{"id": c.id, "name": c.name,
             "created_at": c.created_at.isoformat() if c.created_at else None,
             "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None} for c in pk]


@router.delete("/webauthn/credentials/{cred_id}")
async def webauthn_delete(cred_id: int, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    cred = (await db.execute(select(WebAuthnCredential).where(
        WebAuthnCredential.id == cred_id, WebAuthnCredential.user_id == user.id))).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passkey introuvable.")
    await db.delete(cred)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------- Login : 2nd facteur ----

class TotpLogin(BaseModel):
    challenge: str
    code: str


@router.post("/login/totp", response_model=UserOut)
async def login_totp(body: TotpLogin, request: Request, response: Response,
                     db: AsyncSession = Depends(get_db)):
    user, challenge_key = await _user_by_challenge(db, body.challenge)
    await _enforce_2fa_verify(request, user.id, challenge_key)
    secret = decrypt_secret(user.totp_secret)
    if not (user.totp_enabled and secret and tf.verify_totp(secret, body.code)):
        # Échec : le crédit du challenge a déjà été décompté à la barrière amont.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Code invalide.")
    await _consume_challenge(challenge_key)  # single-use (claim atomique)
    await _reset_2fa_counters(request, user.id, challenge_key)  # succès -> reset throttle IP
    return await _issue_dashboard(db, user, response)


@router.post("/login/recovery", response_model=UserOut)
async def login_recovery(body: TotpLogin, request: Request, response: Response,
                         db: AsyncSession = Depends(get_db)):
    user, challenge_key = await _user_by_challenge(db, body.challenge)
    await _enforce_2fa_verify(request, user.id, challenge_key)
    matched, remaining = tf.consume_recovery_code(user.twofa_recovery, body.code)
    if not matched:
        # Échec : le crédit du challenge a déjà été décompté à la barrière amont.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Code de secours invalide.")
    user.twofa_recovery = remaining
    await _consume_challenge(challenge_key)  # single-use (claim atomique)
    await _reset_2fa_counters(request, user.id, challenge_key)  # succès -> reset throttle IP
    return await _issue_dashboard(db, user, response)


class ChallengeBody(BaseModel):
    challenge: str


@router.post("/login/webauthn/begin", response_model=WebAuthnBeginOut)
async def login_webauthn_begin(body: ChallengeBody, db: AsyncSession = Depends(get_db)):
    user, _ = await _user_by_challenge(db, body.challenge)
    creds = await _passkeys(db, user.id)
    if not creds:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Aucune passkey enregistrée.")
    options_json, ceremony = tf.authentication_options(creds)
    user.webauthn_challenge = ceremony
    user.webauthn_challenge_at = utcnow()
    await db.commit()
    return WebAuthnBeginOut(options=options_json)


class WebAuthnLoginComplete(BaseModel):
    challenge: str
    credential: dict


@router.post("/login/webauthn/complete", response_model=UserOut)
async def login_webauthn_complete(body: WebAuthnLoginComplete, request: Request,
                                  response: Response, db: AsyncSession = Depends(get_db)):
    user, challenge_key = await _user_by_challenge(db, body.challenge)
    await _enforce_2fa_verify(request, user.id, challenge_key)
    if not _challenge_fresh(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cérémonie expirée — réessayez.")
    import json
    cred_id = tf.credential_id_from_assertion(json.dumps(body.credential))
    cred = (await db.execute(select(WebAuthnCredential).where(
        WebAuthnCredential.credential_id == cred_id,
        WebAuthnCredential.user_id == user.id))).scalar_one_or_none()
    if cred is None:
        # Échec : le crédit du challenge a déjà été décompté à la barrière amont.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Passkey inconnue.")
    try:
        new_count = tf.verify_authentication(
            json.dumps(body.credential), user.webauthn_challenge,
            cred.public_key, cred.sign_count)
    except Exception:
        # Échec : le crédit du challenge a déjà été décompté à la barrière amont.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Vérification de la passkey échouée.")
    cred.sign_count = new_count
    cred.last_used_at = utcnow()
    await _consume_challenge(challenge_key)  # single-use (claim atomique)
    await _reset_2fa_counters(request, user.id, challenge_key)  # succès -> reset throttle IP
    return await _issue_dashboard(db, user, response)
