"""PR-05 — révocation des tokens plugin (audit §3.4).

L'access JWT scope='plugin' était stateless + valide 24h : un access volé survivait
24h à toute déconnexion. Durcissement :
- TTL réduit à 30 min (OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES).
- L'access porte un `jti` (uuid4) lié à la ligne OAuthToken du pair (access_jti).
  require_oauth_token charge cette ligne et rejette l'access si is_revoked OU
  absente OU si le token n'a pas de jti (ancien format). Effet : revoke()
  (déconnexion) et rotate_refresh() (rotation) coupent l'access IMMÉDIATEMENT.

On teste require_oauth_token en l'appelant DIRECTEMENT (gabarit FakeSession du
conftest) avec des credentials Bearer forgés : pas besoin d'une route HTTP réelle.
"""
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from src.core import security
from src.core.security import (
    OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES,
    create_oauth_token,
    decode_token,
    require_oauth_token,
)
from src.models.oauth import OAuthToken
from src.models.user import User
from src.services import oauth_service as svc


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


# --------------------------------------------------------------------------
# 1. Forme du JWT plugin : jti présent + TTL court (<= 30 min)
# --------------------------------------------------------------------------

def test_oauth_token_carries_jti():
    token, jti = create_oauth_token(7)
    payload = decode_token(token, expected_scope="plugin")
    assert payload["jti"] == jti
    assert payload["sub"] == "7"


def test_oauth_token_ttl_is_short():
    assert OAUTH_PLUGIN_ACCESS_EXPIRE_MINUTES == 30
    token, _ = create_oauth_token(1)
    payload = decode_token(token, expected_scope="plugin")
    # exp - iat = TTL exact ; borne haute 30 min.
    assert 0 < payload["exp"] - payload["iat"] <= 30 * 60


# --------------------------------------------------------------------------
# 2. require_oauth_token : la ligne access_jti gouverne l'acceptation
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_require_oauth_token_nominal(db):
    """Ligne présente, non révoquée -> renvoie le User."""
    token, jti = create_oauth_token(1)
    db.seed(User(id=1, is_active=True))
    db.seed(OAuthToken(user_id=1, client_id="chapote_wp",
                       refresh_token_hash="h1", access_jti=jti, is_revoked=False))
    user = await require_oauth_token(credentials=_creds(token), db=db)
    assert user.id == 1


@pytest.mark.asyncio
async def test_require_oauth_token_revoked_rejected(db):
    """Ligne is_revoked=True (déconnexion / rotation) -> 401."""
    token, jti = create_oauth_token(1)
    db.seed(User(id=1, is_active=True))
    db.seed(OAuthToken(user_id=1, client_id="chapote_wp",
                       refresh_token_hash="h1", access_jti=jti, is_revoked=True))
    with pytest.raises(HTTPException) as exc:
        await require_oauth_token(credentials=_creds(token), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_require_oauth_token_unknown_jti_rejected(db):
    """jti valide cryptographiquement mais AUCUNE ligne -> 401."""
    token, _ = create_oauth_token(1)
    db.seed(User(id=1, is_active=True))  # user OK, mais pas de ligne OAuthToken
    with pytest.raises(HTTPException) as exc:
        await require_oauth_token(credentials=_creds(token), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_require_oauth_token_legacy_no_jti_rejected(db):
    """Ancien format d'access (sans claim jti) -> 401 (sera refreshé par le plugin)."""
    from datetime import timedelta

    legacy = security._encode({"sub": "1", "scope": "plugin"}, timedelta(minutes=30))
    db.seed(User(id=1, is_active=True))
    with pytest.raises(HTTPException) as exc:
        await require_oauth_token(credentials=_creds(legacy), db=db)
    assert exc.value.status_code == 401


# --------------------------------------------------------------------------
# 3. Bout-en-bout : revoke() coupe l'access du même pair
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revoke_rejects_access_of_same_pair(db):
    """Après revoke() du refresh (déconnexion), l'access du MÊME pair est rejeté."""
    db.seed(User(id=1, is_active=True))
    access, refresh, _ = await svc._issue_token_pair(db, 1)
    # Avant déconnexion : l'access passe.
    user = await require_oauth_token(credentials=_creds(access), db=db)
    assert user.id == 1
    # Déconnexion : révoque le refresh -> la ligne portant l'access_jti est révoquée.
    await svc.revoke(db, refresh)
    with pytest.raises(HTTPException) as exc:
        await require_oauth_token(credentials=_creds(access), db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rotate_rejects_old_access(db):
    """Après rotate_refresh(), l'ancien access (ligne marquée is_revoked) est rejeté,
    le NOUVEL access passe."""
    db.seed(User(id=1, is_active=True))
    old_access, refresh, _ = await svc._issue_token_pair(db, 1)
    new_access, _new_refresh, _ = await svc.rotate_refresh(db, refresh)
    # L'ancien access : sa ligne a été marquée is_revoked par la rotation -> 401.
    with pytest.raises(HTTPException) as exc:
        await require_oauth_token(credentials=_creds(old_access), db=db)
    assert exc.value.status_code == 401
    # Le nouvel access passe.
    user = await require_oauth_token(credentials=_creds(new_access), db=db)
    assert user.id == 1
