"""Auth dashboard : inscription perso/entreprise (+ invitations), login
(intranet Kertios -> local), auto-login admin en dev."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import create_dashboard_token, get_current_user, hash_password
from src.models.user import (
    Invitation,
    Membership,
    Organization,
    OrgOut,
    TokenOut,
    User,
    UserLogin,
    UserOut,
    UserRegister,
)
from src.services.auth_service import AuthenticationError, authenticate

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    """UserOut avec organisations + role + permissions par bot du user."""
    out = UserOut.model_validate(user)
    if user.is_superadmin:
        orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
        out.organizations = [
            OrgOut(id=o.id, name=o.name, type=o.type, plan=o.plan, role="admin", permissions={})
            for o in orgs
        ]
    else:
        rows = (await db.execute(
            select(Organization, Membership)
            .join(Membership, Membership.organization_id == Organization.id)
            .where(Membership.user_id == user.id, Organization.is_active.is_(True))
            .order_by(Organization.name)
        )).all()
        out.organizations = [
            OrgOut(id=o.id, name=o.name, type=o.type, plan=o.plan,
                   role=m.role, permissions=m.permissions or {})
            for o, m in rows
        ]
    return out


async def _consume_invitations(db: AsyncSession, user: User) -> None:
    """A l'inscription : les invitations en attente pour cet email deviennent
    des memberships."""
    invitations = (await db.execute(
        select(Invitation).where(Invitation.email == user.email)
    )).scalars().all()
    for inv in invitations:
        db.add(Membership(user_id=user.id, organization_id=inv.organization_id,
                          role=inv.role, permissions={}))
        await db.delete(inv)


@router.post("/register", response_model=TokenOut)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Un compte existe déjà avec cet email")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mot de passe trop court (8 caractères minimum)")
    if body.account_type == "entreprise" and not (body.organization_name or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom d'entreprise requis")

    user = User(email=body.email, hashed_password=hash_password(body.password), name=body.name)
    # Perso = meme architecture qu'une entreprise, type different, une seule personne
    org_name = (body.organization_name or "").strip() or f"Espace de {body.name}"
    org = Organization(name=org_name, type=body.account_type)
    db.add_all([user, org])
    await db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role="admin", permissions={}))

    # Invitations de l'inscription entreprise : compte existant -> membre
    # direct ; sinon invitation en attente (consommee a son inscription)
    if body.account_type == "entreprise":
        for inv in body.invites:
            email = inv.email.lower()
            if email == user.email.lower():
                continue
            target = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if target:
                db.add(Membership(user_id=target.id, organization_id=org.id,
                                  role=inv.role, permissions={}))
            else:
                db.add(Invitation(organization_id=org.id, email=email, role=inv.role))

    await _consume_invitations(db, user)
    await db.commit()
    await db.refresh(user)
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


@router.post("/login", response_model=TokenOut)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    try:
        user = await authenticate(db, body.email, body.password)
    except AuthenticationError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


@router.post("/dev-login", response_model=TokenOut)
async def dev_login(db: AsyncSession = Depends(get_db)):
    """Auto-login superadmin SANS credentials — uniquement ENV=dev +
    AUTO_LOGIN_ADMIN_DEV=true. Le frontend l'appelle au chargement."""
    if settings.is_production or not settings.AUTO_LOGIN_ADMIN_DEV:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin dev non initialisé")
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _user_out(db, user)
