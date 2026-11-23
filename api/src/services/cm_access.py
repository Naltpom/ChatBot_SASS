"""Droits dans cm.chapote.fr : rôles d'équipe, limitation par groupes, comptes uniques, transferts.

Rôles (dans une équipe ; l'espace perso est toujours « admin ») :
- admin  : connecte / retire les comptes et dossiers, gère groupes et membres. Un admin de
           l'équipe chapote.fr (Membership.role = admin) est toujours admin ici.
- editor : programme, modifie, annule, édite la bibliothèque (rôle par défaut d'un membre).
- viewer : voit planning, statistiques et bibliothèque, sans rien modifier.
Un editor / viewer peut être limité à des groupes de comptes : il ne voit que leurs comptes
(et les dossiers Drive rattachés à ces groupes).

Un compte TikTok / YouTube / Instagram n'est connecté que dans UN espace Chapote. Pour le
déplacer : transfert par un admin de son espace (immédiat vers un de ses espaces, sinon
accepté par le destinataire), ou reprise par preuve (la personne vient de se connecter au
compte lui-même chez la plateforme : jeton signé, 15 min, usage unique).
"""
import json
import logging
import os
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.security import _encode
from src.core.time import utcnow
from src.models.cm import (
    T_FINAL,
    CmGroupAccount,
    CmGroup,
    CmMemberRole,
    CmPost,
    CmTarget,
    InstagramAccount,
)
from src.models.tiktok import TikTokAccount
from src.models.youtube import YouTubeAccount
from src.services.crypto import decrypt_secret, encrypt_secret
from src.services.rate_limit import SingleUseTokens

logger = logging.getLogger(__name__)

LEVEL = {"viewer": 0, "editor": 1, "admin": 2}
NEED_LABEL = {"edit": "modifier le planning", "admin": "gérer les comptes de l'équipe"}
CLAIM_SCOPE = "cm_claim"
CLAIM_TTL = timedelta(minutes=15)
claim_store = SingleUseTokens("rl:cmclaim:", int(CLAIM_TTL.total_seconds()))

MODELS = {"tiktok": TikTokAccount, "youtube": YouTubeAccount, "instagram": InstagramAccount}
EXT_KEY = {"tiktok": "open_id", "youtube": "channel_id", "instagram": "ig_user_id"}
LABEL = {"tiktok": "Ce compte TikTok", "youtube": "Cette chaîne YouTube", "instagram": "Ce compte Instagram"}


# --------------------------------------------------------------------------
# Rôle et périmètre
# --------------------------------------------------------------------------

async def enrich(db: AsyncSession, tenant, user, membership_role: Optional[str]):
    """Ajoute au tenant : user_id, cm_role, group_ids (None = tous), allowed (None = tous)."""
    tenant.user_id = user.id
    tenant.cm_role, tenant.group_ids, tenant.allowed = "admin", None, None
    tenant.cm_explicit = False
    if not tenant.org_id or membership_role == "admin":
        return tenant
    row = (await db.execute(select(CmMemberRole).where(
        CmMemberRole.organization_id == tenant.org_id, CmMemberRole.email == (user.email or "").lower()))).scalar_one_or_none()
    tenant.cm_role = row.role if row and row.role in LEVEL else "editor"
    tenant.cm_explicit = row is not None
    ids = [int(g) for g in (row.group_ids or [])] if row else []
    if ids and tenant.cm_role != "admin":
        valid = list((await db.execute(select(CmGroup.id).where(
            CmGroup.id.in_(ids), CmGroup.organization_id == tenant.org_id))).scalars())
        tenant.group_ids = valid
        tenant.allowed = {(p, a) for p, a in (await db.execute(select(CmGroupAccount.platform, CmGroupAccount.account_id)
                                                               .where(CmGroupAccount.group_id.in_(valid or [-1])))).all()}
    return tenant


def require(tenant, need: str, *, explicit_only: bool = False) -> None:
    """need : « edit » (editor ou admin) ou « admin ». `explicit_only` (modules TikTok / YouTube de
    l'Espace client) : seulement pour un membre à qui un rôle cm a été donné explicitement."""
    if explicit_only and not getattr(tenant, "cm_explicit", False):
        return
    role = getattr(tenant, "cm_role", "admin")
    if LEVEL.get(role, 0) < (2 if need == "admin" else 1):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Votre rôle dans l'équipe ({ROLE_LABEL.get(role, role)}) ne permet pas de {NEED_LABEL[need]}. "
                            "Demandez à un administrateur de l'équipe.")


ROLE_LABEL = {"admin": "administrateur", "editor": "éditeur", "viewer": "lecteur"}


def account_allowed(tenant, platform: str, account_id: int) -> bool:
    allowed = getattr(tenant, "allowed", None)
    return allowed is None or (platform, account_id) in allowed


def group_allowed(tenant, group_id: Optional[int]) -> bool:
    ids = getattr(tenant, "group_ids", None)
    return ids is None or (group_id is not None and group_id in ids)


# --------------------------------------------------------------------------
# Un compte = un seul espace
# --------------------------------------------------------------------------

def _same_tenant(row, tenant) -> bool:
    if tenant.org_id:
        return row.organization_id == tenant.org_id
    return row.owner_user_id == tenant.owner_user_id


async def taken_elsewhere(db: AsyncSession, platform: str, ext_id: Optional[str], tenant, *, username: Optional[str] = None):
    """Compte actif identique dans UN AUTRE espace (ou None)."""
    model = MODELS[platform]
    if platform == "instagram" and username and not ext_id:
        cond = func.lower(model.username) == username.lower()
    elif ext_id:
        cond = getattr(model, EXT_KEY[platform]) == ext_id
    else:
        return None
    rows = (await db.execute(select(model).where(cond, model.revoked_at.is_(None)))).scalars().all()
    return next((r for r in rows if not _same_tenant(r, tenant)), None)


async def _space_label(db: AsyncSession, row, user) -> Optional[str]:
    """Nom de l'autre espace SEULEMENT s'il appartient à l'utilisateur (perso ou équipe dont il est membre)."""
    from src.models.user import Membership, Organization
    if row.owner_user_id is not None:
        return "votre espace perso" if row.owner_user_id == user.id else None
    m = (await db.execute(select(Organization.name).join(Membership, Membership.organization_id == Organization.id)
                          .where(Membership.user_id == user.id, Organization.id == row.organization_id))).scalar_one_or_none()
    return f"l'équipe « {m} »" if m else None


def make_claim_token(user_id: int, platform: str, account_id: int, tokens: dict) -> str:
    return _encode({"sub": str(user_id), "scope": CLAIM_SCOPE, "p": platform, "a": account_id,
                    "t": encrypt_secret(json.dumps(tokens)), "jti": uuid.uuid4().hex}, CLAIM_TTL)


async def read_claim_token(token: str, user_id: int) -> tuple[str, int, dict]:
    try:
        c = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        c = {}
    if c.get("scope") != CLAIM_SCOPE or c.get("sub") != str(user_id) or not c.get("jti"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien de reprise invalide ou expiré : reconnectez le compte.")
    if not await claim_store.claim(c["jti"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien de reprise déjà utilisé : reconnectez le compte.")
    try:
        tokens = json.loads(decrypt_secret(c["t"]) or "{}")
    except ValueError:
        tokens = {}
    return c["p"], int(c["a"]), tokens


async def refuse_taken(db: AsyncSession, platform: str, row, user, claim_tokens: Optional[dict] = None):
    """409 « déjà connecté ». Avec `claim_tokens` (l'utilisateur vient de prouver qu'il contrôle
    le compte chez la plateforme) : jeton de reprise joint."""
    where = await _space_label(db, row, user)
    msg = (f"{LABEL[platform]} est déjà connecté dans {where} : transférez-le depuis cet espace (Comptes → Transférer)."
           if where else
           f"{LABEL[platform]} est déjà connecté à Chapote par une autre personne. Rapprochez-vous de la personne en "
           "charge (ou de l'administrateur de votre équipe) pour qu'elle vous le transfère.")
    detail = {"code": "account_taken", "message": msg, "own_space": bool(where)}
    if claim_tokens is not None and not where:
        detail["claim_token"] = make_claim_token(user.id, platform, row.id, claim_tokens)
    raise HTTPException(status.HTTP_409_CONFLICT, detail)


# --------------------------------------------------------------------------
# Déplacer un compte (transfert, reprise)
# --------------------------------------------------------------------------

def _link_or_copy(src: str) -> Optional[str]:
    if not src or not os.path.exists(src):
        return None
    dest = os.path.join(os.path.dirname(src), f"{uuid.uuid4().hex}{os.path.splitext(src)[1] or '.mp4'}")
    try:
        os.link(src, dest)            # même fichier, suppressions indépendantes
    except OSError:
        import shutil
        shutil.copyfile(src, dest)
    return dest


async def move_account(db: AsyncSession, platform: str, acc, dest, by_user_id: int) -> dict:
    """Déplace le compte vers `dest` avec son planning À VENIR. L'historique (publications
    terminées) reste dans l'ancien espace ; chiffres et vidéos suivent le compte."""
    old_org, old_owner = acc.organization_id, acc.owner_user_id
    acc.organization_id = dest.org_id
    acc.owner_user_id = None if dest.org_id else dest.owner_user_id
    if hasattr(acc, "connected_by_user_id"):
        acc.connected_by_user_id = by_user_id
    # Groupes de l'ancien espace : le compte en sort.
    await db.execute(delete(CmGroupAccount).where(CmGroupAccount.platform == platform, CmGroupAccount.account_id == acc.id))

    moved = 0
    pending = (await db.execute(select(CmTarget).where(
        CmTarget.platform == platform, CmTarget.account_id == acc.id, CmTarget.status.not_in(T_FINAL)))).scalars().all()
    by_post: dict[int, list[CmTarget]] = {}
    for t in pending:
        by_post.setdefault(t.post_id, []).append(t)
    for post_id, targets in by_post.items():
        post = await db.get(CmPost, post_id)
        if post is None:
            continue
        others = (await db.execute(select(func.count()).select_from(CmTarget).where(
            CmTarget.post_id == post.id, CmTarget.id.not_in([t.id for t in targets])))).scalar() or 0
        if not others:
            post.organization_id = dest.org_id
            post.owner_user_id = None if dest.org_id else dest.owner_user_id
        else:
            clone = CmPost(organization_id=dest.org_id, owner_user_id=None if dest.org_id else dest.owner_user_id,
                           user_id=by_user_id, title=post.title, caption=post.caption, file_name=post.file_name,
                           mime_type=post.mime_type, video_size=post.video_size, received_bytes=post.received_bytes,
                           duration_sec=post.duration_sec, media_path=_link_or_copy(post.media_path),
                           asset_id=post.asset_id, status=post.status)
            db.add(clone)
            await db.flush()
            for t in targets:
                t.post_id = clone.id
        moved += len(targets)
    await db.commit()
    logger.info("cm : compte %s %s déplacé (org %s / perso %s -> org %s / perso %s), %s publications à venir",
                platform, acc.id, old_org, old_owner, dest.org_id, dest.owner_user_id, moved)
    return {"moved_targets": moved}
