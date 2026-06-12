"""Organisations : usage du plan, equipe & permissions par bot, invitations,
conversion perso -> entreprise.

Roles : admin (tout) / member (permissions fines par bot). La gestion d'equipe
est reservee aux admins de l'org (et au staff superadmin).
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user, require_org_access, require_org_admin
from src.models.user import BOT_PERMS, PLANS, Invitation, Membership, Organization, User
from src.services import stripe_service
from src.services.stripe_service import StripeError
from src.services.usage_service import (
    count_ai_messages_this_month,
    count_bots,
    plan_change_problems,
    plan_limits,
)

router = APIRouter(prefix="/api/orgs", tags=["organizations"])


class MemberAdd(BaseModel):
    email: EmailStr
    role: str = Field("member", pattern="^(admin|member)$")


class MemberPatch(BaseModel):
    role: Optional[str] = Field(None, pattern="^(admin|member)$")
    permissions: Optional[dict[str, Any]] = None


class OrgPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = Field(None, pattern="^(perso|entreprise)$")


class PlanChange(BaseModel):
    plan: str  # validé dans l'endpoint pour renvoyer un detail FR exploitable


class OrgCreate(BaseModel):
    name: str
    type: str = Field("entreprise", pattern="^(perso|entreprise)$")


def _clean_permissions(perms: dict[str, Any]) -> dict[str, list[str]]:
    return {
        str(bot_id): [p for p in plist if p in BOT_PERMS]
        for bot_id, plist in perms.items()
        if isinstance(plist, list)
    }


async def _get_org(db: AsyncSession, org_id: int) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    return org


@router.post("")
async def create_org(body: OrgCreate, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """Creation d'une organisation supplementaire (plan free par defaut),
    le createur en devient admin — meme pattern que le register."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom d'organisation requis")
    org = Organization(name=name[:120], type=body.type)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role="admin", permissions={}))
    await db.commit()
    return {"id": org.id, "name": org.name, "type": org.type, "plan": org.plan, "role": "admin"}


@router.post("/{org_id}/leave")
async def leave_org(org_id: int, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Quitter une organisation (les members aussi : pas de require_org_admin).
    404 sans membership (anti-enumeration) — un superadmin non membre recoit
    donc 404, le front lui masque le bouton."""
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user.id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")
    if membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible de quitter l'organisation : vous en êtes le dernier admin — nommez d'abord un autre admin")
    await db.delete(membership)
    await db.commit()
    return {"left": True}


@router.get("/{org_id}/usage")
async def org_usage(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_access(org_id, user, db)
    org = await _get_org(db, org_id)
    limits = plan_limits(org)
    return {
        "plan": org.plan,
        "plan_price": limits["price"],
        "type": org.type,
        "ai_messages_used": await count_ai_messages_this_month(db, org_id),
        "ai_messages_quota": limits["ai_messages"],
        "bots_used": await count_bots(db, org_id),
        "bots_quota": limits["max_bots"],
        "tree_only": limits.get("tree_only", False),
        "max_tree_nodes": limits.get("max_tree_nodes"),
        "byok": limits.get("byok", False),
        "billing_enabled": stripe_service.billing_enabled(),
        "stripe_subscription": bool(org.stripe_subscription_id),
    }


@router.patch("/{org_id}")
async def patch_org(org_id: int, body: OrgPatch, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Renommer l'org, ou convertir perso -> entreprise (jamais l'inverse :
    une entreprise peut avoir plusieurs membres)."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("type") == "perso" and org.type == "entreprise":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Une entreprise ne peut pas repasser en compte personnel")
    if "name" in data and data["name"]:
        org.name = data["name"].strip()
    if "type" in data and data["type"]:
        org.type = data["type"]
    await db.commit()
    return {"id": org.id, "name": org.name, "type": org.type}


# ---------- Facturation / plan ----------

@router.post("/{org_id}/plan")
async def change_plan(org_id: int, body: PlanChange,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Changement de plan self-serve par un admin de l'organisation
    (superadmin passe). Miroir client du PATCH superadmin de admin.py, avec
    des garde-fous de downgrade plus stricts : le nouveau plan doit pouvoir
    contenir les bots EXISTANTS (nombre, mode, taille d'arbre, BYOK).

    Flux Stripe (si la config STRIPE_* est complete) :
    - cible payante sans abonnement -> checkout_url (le webhook
      checkout.session.completed appliquera le plan apres paiement)
    - abonnement existant -> portal_url EPINGLE sur le plan demande (flow
      subscription_update_confirm) ou sur la resiliation (cible free) : le
      portail ne permet pas de basculer vers un autre plan que celui valide
      par les garde-fous
    - cible free sans abonnement, ou billing desactive -> application
      immediate (comportement historique). Les garde-fous sont TOUJOURS
      verifies avant de renvoyer une URL de paiement.

    Verrou : les verifs et l'application immediate se font sous FOR UPDATE,
    mais le verrou est LIBERE avant tout appel httpx vers Stripe (timeout
    20 s) — pattern verrou court -> commit -> httpx -> transaction courte.
    """
    await require_org_admin(org_id, user, db)
    # Fetch verrouille : serialise les changements de plan concurrents de la
    # meme org (les garde-fous comptent les bots existants)
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id).with_for_update()
    )).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")

    if body.plan not in PLANS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Plan inconnu : {body.plan}")
    if body.plan == org.plan:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"L'organisation est déjà sur le plan {org.plan}")

    problems = await plan_change_problems(db, org_id, body.plan)
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Changement de plan impossible : " + " ; ".join(problems))

    new_price = PLANS[body.plan]["price"]
    billing = stripe_service.billing_enabled()

    if not billing or (new_price == 0 and not org.stripe_subscription_id):
        # Billing desactive, ou cible free sans abonnement : application
        # immediate (historique), sous le verrou — aucun appel reseau ici
        org.plan = body.plan
        await db.commit()
        return {"id": org.id, "name": org.name, "type": org.type, "plan": org.plan,
                "applied": True, "billing_enabled": billing}

    # Chemins Stripe : capturer l'etat puis liberer le row lock AVANT les
    # appels httpx (sinon create_bot / patch admin / webhook de la meme org
    # bloquent jusqu'a 20 s sur le verrou)
    customer_id = org.stripe_customer_id
    subscription_id = org.stripe_subscription_id
    await db.commit()

    try:
        if subscription_id:
            if new_price == 0:
                # Retour au free = resiliation : portail epingle sur le flow
                # d'annulation, le webhook subscription.deleted appliquera le plan
                url = await stripe_service.create_cancel_portal_session(customer_id, subscription_id)
            else:
                # Changement de plan : portail epingle sur LE plan valide par
                # les garde-fous (pas de bascule libre vers un autre plan)
                url = await stripe_service.create_update_portal_session(
                    customer_id, subscription_id, body.plan)
            return {"applied": False, "billing_enabled": True, "portal_url": url}

        if not customer_id:
            customer_id = await stripe_service.create_customer(org, user.email)
            # Transaction courte de persistance : si un concurrent a deja pose
            # un customer, on garde le sien (le notre reste orphelin, sans effet)
            locked = (await db.execute(
                select(Organization).where(Organization.id == org_id).with_for_update()
            )).scalar_one_or_none()
            if locked is not None:
                if locked.stripe_customer_id:
                    customer_id = locked.stripe_customer_id
                else:
                    locked.stripe_customer_id = customer_id
            await db.commit()

        # Anti double abonnement : une seule session de checkout payable a la
        # fois (deux onglets / retry apres webhook lent -> l'ancienne expire)
        await stripe_service.expire_open_checkout_sessions(customer_id)
        url = await stripe_service.create_checkout_session(customer_id, body.plan, org_id)
        return {"applied": False, "billing_enabled": True, "checkout_url": url}
    except StripeError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Le service de paiement est momentanément indisponible, réessayez")


@router.post("/{org_id}/billing/portal")
async def billing_portal(org_id: int,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Portail client Stripe (moyens de paiement, factures, resiliation).
    Un changement de plan effectue ici sans passer par change_plan est
    reconcilie par le webhook (mise en conformite forcee, cf. billing.py)."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    if not stripe_service.billing_enabled():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "La facturation en ligne n'est pas configurée")
    if not org.stripe_customer_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Aucun abonnement Stripe pour cette organisation")
    try:
        url = await stripe_service.create_portal_session(org.stripe_customer_id)
    except StripeError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Le service de paiement est momentanément indisponible, réessayez")
    return {"portal_url": url}


@router.get("/{org_id}/invoices")
async def org_invoices(org_id: int,
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Factures Stripe de l'org, lues a la demande (pas de table locale).
    Admins d'org uniquement (pas les members)."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    if not stripe_service.billing_enabled():
        return {"billing_enabled": False, "invoices": []}
    if not org.stripe_customer_id:
        return {"billing_enabled": True, "invoices": []}
    try:
        invoices = await stripe_service.list_invoices(org.stripe_customer_id)
    except StripeError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Le service de paiement est momentanément indisponible, réessayez")
    return {"billing_enabled": True, "invoices": invoices}


# ---------- Équipe ----------

@router.get("/{org_id}/members")
async def list_members(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_access(org_id, user, db)
    rows = (await db.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.organization_id == org_id)
        .order_by(Membership.created_at)
    )).all()
    invitations = (await db.execute(
        select(Invitation).where(Invitation.organization_id == org_id).order_by(Invitation.created_at)
    )).scalars().all()
    return {
        "members": [
            {"id": u.id, "name": u.name, "email": u.email, "role": m.role,
             "permissions": m.permissions or {}, "you": u.id == user.id}
            for u, m in rows
        ],
        "invitations": [
            {"id": i.id, "email": i.email, "role": i.role} for i in invitations
        ],
    }


@router.post("/{org_id}/members")
async def invite_member(org_id: int, body: MemberAdd, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Compte existant -> membre direct ; sinon invitation en attente,
    consommee quand la personne cree son compte avec cet email."""
    await require_org_admin(org_id, user, db)
    org = await _get_org(db, org_id)
    if org.type == "perso":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Compte personnel : convertissez l'espace en entreprise pour inviter")

    email = body.email.lower()
    target = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if target:
        existing = await db.execute(select(Membership).where(
            Membership.user_id == target.id, Membership.organization_id == org_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status.HTTP_409_CONFLICT, "Déjà membre de cette organisation")
        db.add(Membership(user_id=target.id, organization_id=org_id, role=body.role, permissions={}))
        await db.commit()
        return {"joined": True, "user_id": target.id}

    existing_inv = await db.execute(select(Invitation).where(
        Invitation.email == email, Invitation.organization_id == org_id))
    if existing_inv.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Invitation déjà envoyée à cet email")
    db.add(Invitation(organization_id=org_id, email=email, role=body.role))
    await db.commit()
    return {"joined": False, "pending": True}


@router.patch("/{org_id}/members/{user_id}")
async def update_member(org_id: int, user_id: int, body: MemberPatch,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Changer le role ou les permissions par bot d'un membre (admin only)."""
    await require_org_admin(org_id, user, db)
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user_id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")

    data = body.model_dump(exclude_unset=True)
    if data.get("role") == "member" and membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible : il faut au moins un admin dans l'organisation")
    if "role" in data and data["role"]:
        membership.role = data["role"]
    if "permissions" in data and data["permissions"] is not None:
        membership.permissions = _clean_permissions(data["permissions"])
    await db.commit()
    return {"role": membership.role, "permissions": membership.permissions}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(org_id: int, user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_admin(org_id, user, db)
    membership = (await db.execute(select(Membership).where(
        Membership.user_id == user_id, Membership.organization_id == org_id))).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membre introuvable")
    if membership.role == "admin":
        admins = (await db.execute(
            select(func.count(Membership.id)).where(
                Membership.organization_id == org_id, Membership.role == "admin")
        )).scalar() or 0
        if admins <= 1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Impossible de retirer le dernier admin")
    await db.delete(membership)
    await db.commit()
    return {"removed": True}


@router.delete("/{org_id}/invitations/{invitation_id}")
async def cancel_invitation(org_id: int, invitation_id: int,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_admin(org_id, user, db)
    inv = await db.get(Invitation, invitation_id)
    if inv is None or inv.organization_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation introuvable")
    await db.delete(inv)
    await db.commit()
    return {"cancelled": True}
