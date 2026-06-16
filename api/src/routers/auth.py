"""Auth dashboard : inscription perso/entreprise (+ invitations), login
(intranet -> local), auto-login admin en dev, profil (nom, mot de passe)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    create_dashboard_token,
    get_current_user,
    hash_password,
    verify_password,
)
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
from src.services.rate_limit import auth_limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _check_auth_rate(request: Request) -> None:
    """Anti-bruteforce : limite les tentatives login/register par IP."""
    ip = request.client.host if request.client else "unknown"
    if not await auth_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives, réessayez dans quelques minutes")


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    """UserOut avec organisations + role + permissions par bot du user."""
    out = UserOut.model_validate(user)
    if user.is_superadmin:
        orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
        out.organizations = [
            OrgOut(id=o.id, name=o.name, role="admin", permissions={})
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
            OrgOut(id=o.id, name=o.name,
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
async def register(body: UserRegister, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_auth_rate(request)
    # Email normalise (lower) : evite doublons et invitations non consommees
    email = body.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Un compte existe déjà avec cet email")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mot de passe trop court (8 caractères minimum)")
    if body.account_type == "entreprise" and not (body.organization_name or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom d'entreprise requis")

    user = User(email=email, hashed_password=hash_password(body.password), name=body.name)
    db.add(user)
    await db.flush()

    # Perso = utilisateur SEUL (aucune org, aucun membership) : ses bots
    # appartiendront directement a lui (Bot.owner_user_id). Entreprise = une
    # organisation (equipe) creee avec le createur en admin + invitations.
    if body.account_type == "entreprise":
        org = Organization(name=(body.organization_name or "").strip()[:120])
        db.add(org)
        await db.flush()
        db.add(Membership(user_id=user.id, organization_id=org.id, role="admin", permissions={}))
        # Invitations : compte existant -> membre direct ; sinon invitation en
        # attente (consommee a l'inscription de la personne invitee)
        for inv in body.invites:
            inv_email = inv.email.lower().strip()
            if inv_email == user.email:
                continue
            target = (await db.execute(select(User).where(User.email == inv_email))).scalar_one_or_none()
            if target:
                db.add(Membership(user_id=target.id, organization_id=org.id,
                                  role=inv.role, permissions={}))
            else:
                db.add(Invitation(organization_id=org.id, email=inv_email, role=inv.role))

    # Un perso peut aussi avoir des invitations en attente vers des equipes :
    # consommees dans LES DEUX cas
    await _consume_invitations(db, user)
    await db.commit()
    await db.refresh(user)
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


@router.post("/login", response_model=TokenOut)
async def login(body: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_auth_rate(request)
    try:
        user = await authenticate(db, body.email.lower().strip(), body.password)
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


# ---------- Profil ----------

class MePatch(BaseModel):
    name: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.patch("/me", response_model=UserOut)
async def patch_me(body: MePatch, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    """Mise a jour du profil. L'email n'est PAS editable : c'est la cle
    d'identite (login, invitations en attente)."""
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom requis")
        user.name = name[:120]
        await db.commit()
    return await _user_out(db, user)


@router.post("/password")
async def change_password(body: PasswordChange, request: Request,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Changement de mot de passe des comptes LOCAUX uniquement : les comptes
    intranet sont reecrits (hashed_password compris) a chaque login intranet,
    un changement local serait ecrase.

    NB : les JWT deja emis restent valides jusqu'a expiration (tokens
    stateless, pas de revocation) — comportement documente, pas un bug."""
    await _check_auth_rate(request)  # anti-bruteforce du mot de passe actuel
    if user.auth_source != "local":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Compte géré par l'intranet : le mot de passe se modifie dans l'intranet")
    if not verify_password(body.current_password, user.hashed_password):
        # 403 et non 401 : cote front, 401 = token invalide (purge + /login).
        # Une faute de frappe ne doit pas deconnecter une session valide.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Mot de passe actuel incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Mot de passe trop court (8 caractères minimum)")
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"changed": True}
