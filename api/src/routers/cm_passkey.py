"""cm.chapote.fr — se connecter avec l'empreinte dans l'app Android (clé d'accès, « passkey »).

La clé d'accès sert de second facteur, à la place du code à 6 chiffres : mot de passe (ou Google), puis
l'empreinte. Mêmes clés que le site (même table, même domaine `chapote.fr`) ; ces routes acceptent EN PLUS
l'origine de l'app Android signée (`android:apk-key-hash:…`), que le navigateur ne présente jamais.
Les routes du site (/api/auth/2fa/…) ne changent pas.

  POST /api/cm/mobile/passkey/register/begin      (connecté) options de création de la clé
  POST /api/cm/mobile/passkey/register/complete   (connecté) enregistre la clé ; codes de secours s'il n'y en a pas
  POST /api/cm/mobile/passkey/login/begin         {challenge} : défi de connexion (après mot de passe ou Google)
  POST /api/cm/mobile/passkey/login/complete      {challenge, credential} : ouvre la session

Mêmes garde-fous que /api/auth/2fa/login/webauthn/* : limite par adresse, plafond par défi, défi à usage unique.
"""
import base64
import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import verify_authentication_response, verify_registration_response
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user
from src.core.time import utcnow
from src.models.user import User, UserOut, WebAuthnCredential
from src.routers.twofa import (
    _challenge_fresh, _consume_challenge, _enforce_2fa_verify, _issue_dashboard, _passkeys,
    _reset_2fa_counters, _throttle_2fa_mgmt, _user_by_challenge,
)
from src.services import twofa_service as tf

router = APIRouter(prefix="/api/cm/mobile/passkey", tags=["cm-mobile-passkey"])

# Empreintes SHA-256 des certificats qui signent l'app Android fr.chapote.cm (les mêmes que dans
# assetlinks.json) : clé de signature Google Play, ancienne clé Google Play, clé d'envoi (APK de test).
DEFAULT_ANDROID_CERTS = (
    "9B:9E:DE:01:8C:F0:50:DC:BB:D1:78:BA:AF:9B:7E:43:C0:DC:80:3D:A5:45:EF:E1:5C:E9:2E:1E:D1:11:89:A7",
    "73:38:48:CA:D2:C1:A1:3D:CE:9C:DF:C4:46:AC:F9:EE:58:D8:9C:8B:9B:3C:F8:24:05:93:9A:F1:9C:A8:85:EF",
    "FD:A4:89:EA:4A:B1:B4:CB:E2:7A:F9:17:A9:10:72:33:E6:C6:3B:BE:CD:DF:C4:98:F3:15:5F:D4:73:5F:DE:62",
)


def android_origin(sha256: str) -> str:
    """Origine WebAuthn d'une app Android : `android:apk-key-hash:` + empreinte du certificat en base64url."""
    raw = bytes.fromhex(sha256.replace(":", "").strip())
    return "android:apk-key-hash:" + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def app_origins() -> list[str]:
    """Origines acceptées ici : celles du site, plus l'app Android (CM_ANDROID_CERT_SHA256 pour en changer)."""
    certs = [c for c in os.environ.get("CM_ANDROID_CERT_SHA256", "").split(",") if c.strip()] or list(DEFAULT_ANDROID_CERTS)
    return list(settings.webauthn_origins) + [android_origin(c) for c in certs]


class BeginOut(BaseModel):
    options: str            # JSON des options WebAuthn


class RegisterIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=60)
    credential: dict


class LoginBeginIn(BaseModel):
    challenge: str


class LoginCompleteIn(BaseModel):
    challenge: str
    credential: dict


@router.post("/register/begin", response_model=BeginOut)
async def register_begin(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    options_json, challenge = tf.registration_options(user, await _passkeys(db, user.id))
    user.webauthn_challenge, user.webauthn_challenge_at = challenge, utcnow()
    await db.commit()
    return BeginOut(options=options_json)


@router.post("/register/complete")
async def register_complete(body: RegisterIn, request: Request, user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    await _throttle_2fa_mgmt(request, user.id)
    if not _challenge_fresh(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Délai dépassé : recommencez l'activation.")
    try:
        v = verify_registration_response(
            credential=json.dumps(body.credential), expected_challenge=base64url_to_bytes(user.webauthn_challenge),
            expected_origin=app_origins(), expected_rp_id=settings.webauthn_rp_id)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empreinte non vérifiée : recommencez.")
    cred_id = bytes_to_base64url(v.credential_id)
    if (await db.execute(select(WebAuthnCredential.id).where(WebAuthnCredential.credential_id == cred_id))).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette clé est déjà enregistrée.")
    name = (body.name or "").strip()[:60] or "Téléphone"
    db.add(WebAuthnCredential(user_id=user.id, credential_id=cred_id, public_key=bytes_to_base64url(v.credential_public_key),
                              sign_count=v.sign_count, transports=None, name=name))
    user.webauthn_challenge = user.webauthn_challenge_at = None
    # Sans code de secours, perdre le téléphone fermerait le compte : on en donne à la première activation.
    codes = None
    if not user.twofa_recovery:
        codes, hashed = tf.new_recovery_codes()
        user.twofa_recovery = hashed
    await db.commit()
    return {"ok": True, "name": name, "recovery_codes": codes}


@router.post("/login/begin", response_model=BeginOut)
async def login_begin(body: LoginBeginIn, db: AsyncSession = Depends(get_db)):
    user, _ = await _user_by_challenge(db, body.challenge)
    creds = await _passkeys(db, user.id)
    if not creds:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Aucune empreinte enregistrée pour ce compte.")
    options_json, ceremony = tf.authentication_options(creds)
    user.webauthn_challenge, user.webauthn_challenge_at = ceremony, utcnow()
    await db.commit()
    return BeginOut(options=options_json)


@router.post("/login/complete", response_model=UserOut)
async def login_complete(body: LoginCompleteIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user, challenge_key = await _user_by_challenge(db, body.challenge)
    await _enforce_2fa_verify(request, user.id, challenge_key)
    if not _challenge_fresh(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Délai dépassé : réessayez.")
    cred_id = tf.credential_id_from_assertion(json.dumps(body.credential))
    cred = (await db.execute(select(WebAuthnCredential).where(
        WebAuthnCredential.credential_id == cred_id, WebAuthnCredential.user_id == user.id))).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Clé inconnue pour ce compte.")
    try:
        v = verify_authentication_response(
            credential=json.dumps(body.credential), expected_challenge=base64url_to_bytes(user.webauthn_challenge),
            expected_rp_id=settings.webauthn_rp_id, expected_origin=app_origins(),
            credential_public_key=base64url_to_bytes(cred.public_key), credential_current_sign_count=cred.sign_count)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Empreinte non vérifiée.")
    cred.sign_count, cred.last_used_at = v.new_sign_count, utcnow()
    await _consume_challenge(challenge_key)
    await _reset_2fa_counters(request, user.id, challenge_key)
    return await _issue_dashboard(db, user, response)
