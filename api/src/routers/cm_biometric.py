"""cm.chapote.fr — se connecter avec l'empreinte dans l'app mobile, sans gestionnaire de clés d'accès.

L'app demande une clé secrète au serveur (32 octets tirés au sort) et la range dans la puce sécurisée du téléphone,
protégée par l'empreinte ou le visage (expo-secure-store, `requireAuthentication`). À la connexion, après le mot de
passe ou Google, l'app lit la clé (le téléphone demande l'empreinte) et l'envoie à la place du code à 6 chiffres.
Le serveur ne garde que l'empreinte SHA-256 de la clé.

  POST   /api/cm/mobile/biometric/enable        (connecté) {name} → {id, secret, recovery_codes} (clé donnée une fois)
  GET    /api/cm/mobile/biometric/keys          (connecté) clés actives
  DELETE /api/cm/mobile/biometric/keys/{id}     (connecté) retirer une clé
  POST   /api/cm/mobile/biometric/login         {challenge, key_id, secret} : second facteur, ouvre la session

Mêmes garde-fous que les autres seconds facteurs (/api/auth/2fa/login/*) : limite par adresse, plafond d'essais par
défi, défi à usage unique. Aucune route existante ne change.
"""
import hashlib
import hmac
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user
from src.core.time import utcnow
from src.models.cm_mobile import CmBiometricKey
from src.models.user import User, UserOut
from src.routers.twofa import (
    _consume_challenge, _enforce_2fa_verify, _issue_dashboard, _reset_2fa_counters, _throttle_2fa_mgmt, _user_by_challenge,
)
from src.services import twofa_service as tf

router = APIRouter(prefix="/api/cm/mobile/biometric", tags=["cm-mobile-biometric"])

MAX_KEYS = 10


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


class EnableIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)


class LoginIn(BaseModel):
    challenge: str
    key_id: int
    secret: str = Field(min_length=20, max_length=200)


def _out(k: CmBiometricKey) -> dict:
    return {"id": k.id, "name": k.name, "created_at": k.created_at.isoformat() + "Z",
            "last_used_at": k.last_used_at.isoformat() + "Z" if k.last_used_at else None}


async def _active(db: AsyncSession, user_id: int) -> list[CmBiometricKey]:
    return list((await db.execute(select(CmBiometricKey).where(
        CmBiometricKey.user_id == user_id, CmBiometricKey.revoked_at.is_(None)).order_by(CmBiometricKey.id))).scalars())


@router.post("/enable")
async def enable(body: EnableIn, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _throttle_2fa_mgmt(request, user.id)
    if len(await _active(db, user.id)) >= MAX_KEYS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Trop de téléphones : retirez-en un dans Réglages → Sécurité.")
    secret = secrets.token_urlsafe(32)
    k = CmBiometricKey(user_id=user.id, name=(body.name or "").strip()[:80] or "Téléphone", secret_hash=_hash(secret))
    db.add(k)
    # Sans code de secours, perdre le téléphone fermerait le compte : on en donne à la première activation.
    codes = None
    if not user.twofa_recovery:
        codes, hashed = tf.new_recovery_codes()
        user.twofa_recovery = hashed
    await db.commit()
    await db.refresh(k)
    return {**_out(k), "secret": secret, "recovery_codes": codes}


@router.get("/keys")
async def list_keys(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [_out(k) for k in await _active(db, user.id)]


@router.delete("/keys/{key_id}")
async def delete_key(key_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await db.get(CmBiometricKey, key_id)
    if k is None or k.user_id != user.id or k.revoked_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Empreinte introuvable.")
    k.revoked_at = utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/login", response_model=UserOut)
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user, challenge_key = await _user_by_challenge(db, body.challenge)
    await _enforce_2fa_verify(request, user.id, challenge_key)
    k = await db.get(CmBiometricKey, body.key_id)
    ok = k is not None and k.user_id == user.id and k.revoked_at is None \
        and hmac.compare_digest(k.secret_hash, _hash(body.secret))
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Empreinte non reconnue pour ce compte : réactivez-la dans Réglages.")
    k.last_used_at = utcnow()
    await _consume_challenge(challenge_key)
    await _reset_2fa_counters(request, user.id, challenge_key)
    return await _issue_dashboard(db, user, response)
