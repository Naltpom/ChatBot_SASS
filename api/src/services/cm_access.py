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
    CmGroupShare,
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
    restricted = row is not None and (row.group_ids is not None or row.account_keys is not None)
    if restricted and tenant.cm_role != "admin":
        ids = [int(g) for g in (row.group_ids or [])]
        valid = list((await db.execute(select(CmGroup.id).where(
            CmGroup.id.in_(ids or [-1]), CmGroup.organization_id == tenant.org_id))).scalars())
        tenant.group_ids = valid
        allowed = {(p, a) for p, a in (await db.execute(select(CmGroupAccount.platform, CmGroupAccount.account_id)
                                                        .where(CmGroupAccount.group_id.in_(valid or [-1])))).all()}
        for key in row.account_keys or []:
            p, _, a = str(key).partition(":")
            if p in MODELS and a.isdigit():
                allowed.add((p, int(a)))
        tenant.allowed = allowed
    # Partages par groupe acceptés : rôle par compte (le plus haut des groupes qui le contiennent).
    shares = (await db.execute(select(CmGroupShare.role, CmGroupAccount.platform, CmGroupAccount.account_id)
                               .join(CmGroup, CmGroup.id == CmGroupShare.group_id)
                               .join(CmGroupAccount, CmGroupAccount.group_id == CmGroup.id)
                               .where(CmGroup.organization_id == tenant.org_id, CmGroupShare.status == "accepted",
                                      CmGroupShare.email == (user.email or "").lower()))).all()
    group_roles = dict((await db.execute(select(CmGroupShare.group_id, CmGroupShare.role)
                                         .join(CmGroup, CmGroup.id == CmGroupShare.group_id)
                                         .where(CmGroup.organization_id == tenant.org_id, CmGroupShare.status == "accepted",
                                                CmGroupShare.email == (user.email or "").lower()))).all())
    if group_roles:
        tenant.group_roles = group_roles
    if shares and tenant.cm_role != "admin":
        roles: dict = {}
        for role, p, a in shares:
            if LEVEL.get(role, 0) > LEVEL.get(roles.get((p, a)), -1):
                roles[(p, a)] = role
        tenant.account_roles = roles
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


def role_for(tenant, platform: str, account_id: int) -> str:
    """Rôle effectif sur un compte : celui du partage de groupe s'il y en a un, sinon le rôle dans l'équipe."""
    roles = getattr(tenant, "account_roles", None)
    if roles and (platform, account_id) in roles:
        return roles[(platform, account_id)]
    return getattr(tenant, "cm_role", "admin")


def require_account(tenant, platform: str, account_id: int, need: str = "edit") -> None:
    """Comme require(), pour un compte précis (rôle par groupe : « Lecture seule » ici, « Peut publier » là)."""
    role = role_for(tenant, platform, account_id)
    if LEVEL.get(role, 0) < (2 if need == "admin" else 1):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Votre rôle sur ce compte ({ROLE_LABEL.get(role, role)}) ne permet pas de {NEED_LABEL[need]}.")


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



# --------------------------------------------------------------------------
# Périmètre combiné (paramètre `scope`) : plusieurs espaces, groupes et comptes à la fois, en lecture
# --------------------------------------------------------------------------

from contextvars import ContextVar  # noqa: E402

# Périmètre demandé par la requête en cours (`?scope=` des routes cm, posé par routers/cm._capture_account_scope).
SCOPE: ContextVar = ContextVar("cm_scope", default=None)


class MultiTenant:
    """Se comporte comme un Tenant pour les lectures : `where()` couvre tous les espaces du périmètre, `allowed`
    liste exactement les comptes visibles. Jamais d'écriture : `cm_role` = viewer (les écritures passent par
    l'espace du compte, avec son org_id)."""

    def __init__(self, user_id: int, tenants: list, allowed: set):
        self.tenants = tenants
        self.org_id = None
        self.owner_user_id = user_id
        self.user_id = user_id
        self.role = None
        self.cm_role = "viewer"
        self.cm_explicit = True
        self.group_ids = None
        self.allowed = allowed
        self.multi = True

    @property
    def key(self) -> str:
        return "multi:" + ",".join(sorted(t.key for t in self.tenants))

    def where(self, model):
        from sqlalchemy import false, or_
        conds = [t.where(model) for t in self.tenants]
        return or_(*conds) if conds else false()


async def _all_tenants(db: AsyncSession, user) -> list:
    from src.models.user import Membership
    from src.routers.tiktok import _tenant
    out = [await _tenant(db, user, None)]
    for oid in (await db.execute(select(Membership.organization_id).where(Membership.user_id == user.id)
                                 .order_by(Membership.organization_id))).scalars():
        out.append(await _tenant(db, user, oid))
    return out


async def _visible(db: AsyncSession, tenant) -> set:
    rows = set()
    for platform, model in MODELS.items():
        for rid in (await db.execute(select(model.id).where(tenant.where(model), model.revoked_at.is_(None)))).scalars():
            if account_allowed(tenant, platform, rid):
                rows.add((platform, rid))
    return rows


async def resolve_scope(db: AsyncSession, user, scope: str) -> MultiTenant:
    """`scope` : « all » (ou vide) | liste « perso », « org:12 », « org:12/group:3 » (ou « group:3 »),
    « acc:tiktok:7 », séparés par des virgules. Chaque élément est vérifié : 404 s'il n'est pas visible."""
    tenants = await _all_tenants(db, user)
    by_key = {t.org_id: t for t in tenants}
    visible = {t.key: await _visible(db, t) for t in tenants}
    picked, allowed = {}, set()
    tokens = [x.strip() for x in (scope or "").split(",") if x.strip()]
    if not tokens or tokens == ["all"]:
        for t in tenants:
            picked[t.key] = t
            allowed |= visible[t.key]
        return MultiTenant(user.id, list(picked.values()), allowed)
    for tok in tokens:
        org_id, group_id, acc = None, None, None
        parts = tok.split("/")
        try:
            for part in parts:
                kind, _, val = part.partition(":")
                if kind == "perso" and not val:
                    org_id = None
                elif kind == "org":
                    org_id = int(val)
                elif kind == "group":
                    group_id = int(val)
                elif kind == "acc":
                    p, _, a = val.partition(":")
                    if p not in MODELS:
                        raise ValueError
                    acc = (p, int(a))
                else:
                    raise ValueError
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Périmètre invalide : « {tok} ».")
        if group_id is not None and org_id is None and not tok.startswith("perso"):
            g = await db.get(CmGroup, group_id)
            org_id = g.organization_id if g is not None else -1
        if acc is not None and "org:" not in tok and not tok.startswith("perso"):
            t = next((t for t in tenants if acc in visible[t.key]), None)
        else:
            t = by_key.get(org_id)
        if t is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Périmètre introuvable : « {tok} ».")
        items = visible[t.key]
        if group_id is not None:
            g = await db.get(CmGroup, group_id)
            if g is None or not _same_tenant(g, t):
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Groupe introuvable : « {tok} ».")
            items = items & await _group_accounts(db, group_id)
            if not items and not group_allowed(t, group_id):
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Groupe introuvable : « {tok} ».")
        if acc is not None:
            if acc not in items:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Compte introuvable : « {tok} ».")
            items = {acc}
        picked[t.key] = t
        allowed |= items
    return MultiTenant(user.id, list(picked.values()), allowed)


async def _group_accounts(db: AsyncSession, group_id: int) -> set:
    return {(p, a) for p, a in (await db.execute(select(CmGroupAccount.platform, CmGroupAccount.account_id)
                                                 .where(CmGroupAccount.group_id == group_id))).all()}


async def recompute_member(db: AsyncSession, org_id: int, email: str, removed: tuple = ()) -> None:
    """Après l'acceptation (ou le retrait) d'un partage de groupe : membre de l'équipe (en arrière-plan), limité aux
    groupes partagés acceptés, avec le plus haut de leurs rôles (le rôle exact est appliqué compte par compte)."""
    from src.models.user import Membership, User
    email = email.lower()
    groups = (await db.execute(select(CmGroupShare.group_id, CmGroupShare.role).join(CmGroup, CmGroup.id == CmGroupShare.group_id)
                               .where(CmGroup.organization_id == org_id, CmGroupShare.email == email,
                                      CmGroupShare.status == "accepted"))).all()
    member = (await db.execute(select(Membership).join(User, User.id == Membership.user_id).where(
        Membership.organization_id == org_id, func.lower(User.email) == email))).scalar_one_or_none()
    if member is not None and member.role == "admin":
        return                                   # administrateur de l'équipe : il voit déjà tout
    row = (await db.execute(select(CmMemberRole).where(CmMemberRole.organization_id == org_id,
                                                       CmMemberRole.email == email))).scalar_one_or_none()
    if not groups:
        if row is not None and row.group_ids is not None:
            managed = set((await db.execute(select(CmGroupShare.group_id).where(CmGroupShare.email == email))).scalars()) | set(removed)
            row.group_ids = sorted({int(x) for x in row.group_ids} - managed)
        return
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if member is None and user is not None:
        db.add(Membership(user_id=user.id, organization_id=org_id, role="member", permissions={}))
    if row is None:
        row = CmMemberRole(organization_id=org_id, email=email)
        db.add(row)
    row.role = max((r for _, r in groups), key=lambda r: LEVEL.get(r, 0))
    if row.group_ids is not None or row.account_keys is not None or member is None:
        # Groupes d'avant (partage par l'ancienne route) gardés ; ceux gérés par partage de groupe : seulement acceptés.
        managed = set((await db.execute(select(CmGroupShare.group_id).where(CmGroupShare.email == email))).scalars()) | set(removed)
        legacy = {int(x) for x in (row.group_ids or [])} - managed
        row.group_ids = sorted(legacy | {g for g, _ in groups})
        row.account_keys = list(row.account_keys or [])



async def _tenant_for_group(db: AsyncSession, user, g):
    from src.routers.tiktok import _tenant_of
    return await _tenant_of(db, user, g)


def role_for_group(tenant, group_id: int) -> str:
    """Rôle sur un groupe : admin de l'équipe, sinon le rôle du partage de ce groupe (via account_roles)."""
    return getattr(tenant, "group_roles", {}).get(group_id) or getattr(tenant, "cm_role", "viewer")
