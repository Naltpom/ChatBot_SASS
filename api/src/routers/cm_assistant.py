"""Assistant Chapote CM, mode « mes données » : routes de cm.chapote.fr (docs/CM_MCP.md).

Toutes sous /api/cm/assistant (déjà relayé par le nginx de cm), cookie de session obligatoire
(jamais le jeton de service de la routine). 404 si le drapeau est éteint.

- GET  /status                          accord, prestataire, comptes et leurs permissions
- PUT  /consent                         donner, modifier ou retirer son accord (historisé)
- PUT  /accounts/{platform}/{id}/permissions   tableau de permissions (possesseur seulement)
- GET  /token                           jeton court (5 min) + alias -> vrais noms (pour l'affichage)
- POST /conversations/erase             efface ses conversations « mes données » sur chapote.fr
"""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user
from src.models.cm_assistant import CmAccountAiPermission
from src.models.conversation import Conversation
from src.models.user import User
from src.services import cm_assistant as ca

router = APIRouter(prefix="/api/cm/assistant", tags=["cm-assistant"])


def _feature() -> None:
    if not ca.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assistant IA indisponible")


async def _old_enough(db: AsyncSession, user: User) -> bool:
    """15 ans au moins (CM_MIN_AGE). Date de naissance connue seulement si donnée dans l'app mobile ;
    sinon on s'appuie sur l'âge minimum des conditions d'utilisation de cm."""
    from src.models.cm_mobile import CmUserIdentity
    ident = await db.get(CmUserIdentity, user.id)
    if ident is None or ident.birth_date is None:
        return True
    today = date.today()
    b = ident.birth_date
    age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
    return age >= settings.CM_MIN_AGE


async def _status(db: AsyncSession, user: User) -> dict:
    c = await db.get(ca.CmAiConsent, user.id)
    current = await ca.provider(db)
    view = ca.consent_view(c)
    refs = await ca.account_scope(db, user)
    return {
        "provider": current,
        "policy_version": settings.CM_AI_POLICY_VERSION,
        "consent": view,
        "active": ca.consent_active(c, current),
        # Accord donné pour une autre version de la politique ou un autre prestataire : à revoir.
        "needs_review": bool(c and c.enabled and not ca.consent_active(c, current)),
        "old_enough": await _old_enough(db, user),
        "platforms": sorted(ca.platforms()),
        "accounts": [{
            "key": r.key, "platform": r.platform, "alias": r.alias, "name": r.name, "owner": r.owner,
            "role": r.role, "groups": r.groups,
            "permissions": ({k: getattr(r.perm, k) for k in ca.KINDS} if r.perm is not None else None),
            "excluded": r.key in view["excluded_accounts"],
        } for r in refs],
    }


@router.get("/public")
async def assistant_public(db: AsyncSession = Depends(get_db)):
    """Sans connexion (inscription, page Politique IA) : la fonction est-elle proposée, et chez quel
    prestataire d'IA (celui du bot assistant sur chapote.fr) ?"""
    if not ca.enabled():
        return {"enabled": False}
    return {"enabled": True, "provider": await ca.provider(db), "policy_version": settings.CM_AI_POLICY_VERSION,
            "retention_days": settings.CM_ASSISTANT_RETENTION_DAYS, "min_age": settings.CM_MIN_AGE}


@router.get("/status")
async def assistant_status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _feature()
    return await _status(db, user)


class ConsentIn(BaseModel):
    enabled: Optional[bool] = None
    stats: Optional[bool] = None
    planning: Optional[bool] = None
    captions: Optional[bool] = None
    excluded_accounts: Optional[list[str]] = Field(None, max_length=500)
    source: Literal["inscription", "profil", "chat", "mobile"] = "profil"


@router.put("/consent")
async def put_consent(body: ConsentIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _feature()
    change = body.model_dump(exclude_unset=True, exclude={"source"})
    if change.get("enabled") and not await _old_enough(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"L'assistant IA sur vos données est réservé aux personnes de {settings.CM_MIN_AGE} ans et plus.")
    if change.get("enabled") and not await ca.provider(db):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Assistant IA indisponible pour le moment.")
    await ca.set_consent(db, user, change, body.source)
    await db.commit()
    return await _status(db, user)


class PermissionsIn(BaseModel):
    stats: bool
    planning: bool
    captions: bool


@router.put("/accounts/{platform}/{account_id}/permissions")
async def put_permissions(platform: Literal["tiktok", "youtube", "instagram"], account_id: int, body: PermissionsIn,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Tableau de permissions d'un compte : SEUL son possesseur (administrateur de l'espace qui le
    contient) le modifie. Les invités le voient (GET /status) sans pouvoir le changer."""
    _feature()
    ref = next((r for r in await ca.account_scope(db, user) if r.platform == platform and r.id == account_id), None)
    if ref is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compte introuvable")
    if not ref.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Seul le possesseur du compte (administrateur de l'espace) règle ce qui peut être envoyé à l'IA.")
    perm = (await db.execute(select(CmAccountAiPermission).where(
        CmAccountAiPermission.platform == platform, CmAccountAiPermission.account_id == account_id))).scalar_one_or_none()
    if perm is None:
        perm = CmAccountAiPermission(platform=platform, account_id=account_id)
        db.add(perm)
    perm.stats, perm.planning, perm.captions, perm.updated_by = body.stats, body.planning, body.captions, user.id
    await db.commit()
    return await _status(db, user)


@router.get("/token")
async def get_token(response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Jeton court pour le widget, seulement si l'accord est actif (sinon 204 : mode public).
    `aliases` : table alias -> vrai nom, pour l'AFFICHAGE dans la page ; elle ne part jamais vers l'IA."""
    if not ca.enabled():
        response.status_code = status.HTTP_204_NO_CONTENT
        return None
    c = await db.get(ca.CmAiConsent, user.id)
    if not ca.consent_active(c, await ca.provider(db)):
        response.status_code = status.HTTP_204_NO_CONTENT
        return None
    token, exp = ca.issue_token(user.id, c.rev)
    response.headers["Cache-Control"] = "no-store"
    refs = await ca.account_scope(db, user)
    aliases = {r.alias: r.name for r in refs if r.name}
    return {"token": token, "expires_at": exp, "aliases": aliases}


@router.post("/conversations/erase")
async def erase_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """« Effacer mes conversations avec l'assistant » : supprime sur chapote.fr toutes les conversations
    « mes données » liées à cet utilisateur (par empreinte, jamais par id)."""
    _feature()
    res = await db.execute(delete(Conversation).where(Conversation.user_hash == ca.user_hash(user.id),
                                                      Conversation.data_mode.is_(True)))
    await db.commit()
    return {"deleted": res.rowcount or 0}
