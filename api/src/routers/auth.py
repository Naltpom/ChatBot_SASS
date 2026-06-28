"""Auth dashboard : inscription perso/entreprise (+ invitations), login
(intranet -> local), SSO Google, auto-login admin en dev, profil (nom, mdp),
vérification souple de l'email + réinitialisation de mot de passe."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    account_fingerprint,
    create_dashboard_token,
    create_password_reset_token,
    create_twofa_challenge_token,
    create_verify_email_token,
    decode_token,
    get_current_user,
    hash_password,
    user_has_2fa,
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
    WebAuthnCredential,
    UserRegister,
)
from src.core.time import utcnow
from src.services.auth_service import AuthenticationError, authenticate
from src.services.avatar import fetch_and_store_avatar
from src.services.background import spawn_background
from src.services.email_service import (
    SUPPORT_EMAIL,
    build_reset_email,
    build_verify_email,
    send_email,
)
from src.services.google_oauth import GoogleAuthError, verify_google_id_token
from src.services.org_service import consume_invitations
from src.services.rate_limit import auth_limiter, password_reset_email_limiter
from src.services.stripe_service import billing_enabled

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Longueur minimale du mot de passe — partagée par /register, /password/reset et
# le changement de mot de passe (même règle de robustesse partout).
PASSWORD_MIN_LENGTH = 8

def _send_verify_email(user: User) -> None:
    """Construit le lien de confirmation et envoie le mail (fire-and-forget via
    le helper partagé services/background)."""
    token = create_verify_email_token(user.id, user.email)
    link = f"{settings.APP_URL}/verify-email?token={token}"
    subject, body = build_verify_email(user, link)
    spawn_background(send_email([user.email], subject, body, reply_to=SUPPORT_EMAIL),
                     error_label="Envoi e-mail auth échoué")


async def _check_auth_rate(request: Request) -> None:
    """Anti-bruteforce : limite les tentatives login/register par IP."""
    ip = request.client.host if request.client else "unknown"
    if not await auth_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives, réessayez dans quelques minutes")


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    """UserOut avec organisations + role + permissions par bot du user.

    Pose aussi les champs facturation (spec §1.3, corrige C2) :
    - `is_owner` par org (`org.owner_user_id == user.id`) ;
    - `owned_org_ids` (orgs possedees, derivees des `is_owner`) ;
    - `billing_enabled` (calcule serveur, pilote l'affichage front)."""
    out = UserOut.model_validate(user)
    if user.is_superadmin:
        orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
        out.organizations = [
            OrgOut(id=o.id, name=o.name, role="admin", permissions={},
                   is_owner=(o.owner_user_id == user.id))
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
                   role=m.role, permissions=m.permissions or {},
                   is_owner=(o.owner_user_id == user.id))
            for o, m in rows
        ]
    out.owned_org_ids = [o.id for o in out.organizations if o.is_owner]
    out.billing_enabled = billing_enabled()
    # 2FA : obligatoire pour le staff ; `enabled` si TOTP OU au moins une passkey.
    out.twofa_required = user.is_superadmin
    out.twofa_enabled = await user_has_2fa(db, user)
    return out


async def _twofa_challenge_or_none(db: AsyncSession, user: User):
    """Si la 2FA est active pour ce user, renvoie la réponse *challenge* (à
    échanger contre un token via /api/auth/2fa/login/*). Sinon None (le login
    peut émettre directement un token dashboard)."""
    if not await user_has_2fa(db, user):
        return None
    has_pk = (await db.execute(
        select(WebAuthnCredential.id).where(WebAuthnCredential.user_id == user.id).limit(1)
    )).first() is not None
    return JSONResponse({
        "twofa_required": True,
        "challenge": create_twofa_challenge_token(user.id),
        "methods": {
            "totp": user.totp_enabled,
            "passkey": has_pk,
            "recovery": bool(user.twofa_recovery),
        },
    })


@router.post("/register", response_model=TokenOut)
async def register(body: UserRegister, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_auth_rate(request)
    # Email normalise (lower) : evite doublons et invitations non consommees
    email = body.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Un compte existe déjà avec cet email")
    if len(body.password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Mot de passe trop court ({PASSWORD_MIN_LENGTH} caractères minimum)")
    if body.account_type == "entreprise" and not (body.organization_name or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nom d'entreprise requis")

    user = User(email=email, hashed_password=hash_password(body.password), name=body.name)
    db.add(user)
    await db.flush()

    # Perso = utilisateur SEUL (aucune org, aucun membership) : ses bots
    # appartiendront directement a lui (Bot.owner_user_id). Entreprise = une
    # organisation (equipe) creee avec le createur en admin + invitations.
    if body.account_type == "entreprise":
        # Owner d'org = createur (payeur des bots d'equipe, spec §1.2 a). Il est
        # TOUJOURS membre admin (invariant §1.2 d, pose juste apres le flush).
        org = Organization(name=(body.organization_name or "").strip()[:120],
                           owner_user_id=user.id)
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
    await consume_invitations(db, user)
    await db.commit()
    await db.refresh(user)
    # Vérification souple : le compte est déjà actif. On envoie le mail de
    # confirmation en fire-and-forget — l'inscription ne bloque pas et n'échoue
    # jamais si l'envoi (ou le SMTP) échoue.
    _send_verify_email(user)
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


@router.post("/login", response_model=TokenOut)
async def login(body: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    await _check_auth_rate(request)
    try:
        user = await authenticate(db, body.email.lower().strip(), body.password)
    except AuthenticationError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))
    # 2FA active -> on n'émet PAS de token : un challenge à valider (2nd facteur).
    challenge = await _twofa_challenge_or_none(db, user)
    if challenge is not None:
        return challenge
    return TokenOut(access_token=create_dashboard_token(user.id), user=await _user_out(db, user))


class GoogleAuthPayload(BaseModel):
    credential: str  # ID token JWT renvoyé par Google Identity Services (front)


@router.post("/google", response_model=TokenOut)
async def google_login(body: GoogleAuthPayload, request: Request,
                       db: AsyncSession = Depends(get_db)):
    """SSO Google (flux ID token). Connecte un compte existant (rapprochement
    par email) ou en crée un PERSO (sans organisation), comme une inscription
    perso. Désactivé (401) tant que GOOGLE_CLIENT_ID n'est pas configuré."""
    await _check_auth_rate(request)
    try:
        claims = await verify_google_id_token(body.credential)
    except GoogleAuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))

    email = claims["email"].lower().strip()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        # Création perso : aucune org, aucun membership (cf. register perso). Pas
        # de mot de passe utilisable -> on hash un secret aléatoire (la colonne
        # est NOT NULL ; la connexion par mot de passe reste donc impossible).
        name = (claims.get("name") or email.split("@")[0]).strip()[:120] or email
        avatar = await fetch_and_store_avatar(claims.get("picture"))
        # email_verified=True : Google a déjà vérifié l'adresse (verify_google_id_token
        # rejette un email non vérifié) -> pas de bannière de confirmation inutile.
        user = User(email=email, hashed_password=hash_password(secrets.token_urlsafe(32)),
                    name=name, auth_source="google", avatar_url=avatar, email_verified=True)
        db.add(user)
        await db.flush()
        # Un nouvel arrivant peut avoir des invitations d'équipe en attente.
        await consume_invitations(db, user)
    elif not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Compte désactivé")
    elif not user.avatar_url:
        # Backfill ponctuel : on récupère la photo une seule fois (compte créé
        # avant cette feature, ou avatar vide). Pas à chaque login -> évite
        # d'accumuler des fichiers orphelins. Une photo Google modifiée plus
        # tard ne se propage donc pas (compromis v1 assumé).
        user.avatar_url = await fetch_and_store_avatar(claims.get("picture"))

    user.last_login = utcnow()
    await db.commit()
    await db.refresh(user)
    # 2FA active (même via SSO Google) -> challenge avant émission du token.
    challenge = await _twofa_challenge_or_none(db, user)
    if challenge is not None:
        return challenge
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
    if len(body.new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Mot de passe trop court ({PASSWORD_MIN_LENGTH} caractères minimum)")
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"changed": True}


# ---------- Vérification email (souple) + réinitialisation mot de passe ----------

class TokenBody(BaseModel):
    token: str


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


@router.post("/verify-email/request")
async def request_email_verification(request: Request,
                                     user: User = Depends(get_current_user)):
    """(Re)envoie le mail de confirmation à l'utilisateur connecté. Idempotent :
    si l'email est déjà vérifié, on ne renvoie rien (200). Anti-abus : passe par
    le limiteur d'auth (par IP)."""
    await _check_auth_rate(request)
    if not user.email_verified:
        _send_verify_email(user)
    return {"sent": True}


@router.post("/verify-email/confirm")
async def confirm_email_verification(body: TokenBody, db: AsyncSession = Depends(get_db)):
    """Valide le token de confirmation et passe email_verified=True. Idempotent
    (déjà vérifié -> 200). Le token est lié à l'email courant : rejeté (401) s'il
    a changé depuis l'émission."""
    payload = decode_token(body.token, expected_scope="verify_email")
    user = await db.get(User, int(payload["sub"]))
    if user is None or payload.get("fp") != account_fingerprint(user.email):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Lien de confirmation invalide ou expiré")
    if not user.email_verified:
        user.email_verified = True
        await db.commit()
    return {"verified": True}


@router.post("/password/forgot")
async def forgot_password(body: ForgotPasswordBody, request: Request,
                          db: AsyncSession = Depends(get_db)):
    """Demande de réinitialisation. Réponse TOUJOURS neutre (200, même message)
    que le compte existe ou non : aucune énumération d'utilisateurs. Si le compte
    existe (et est un compte local actif), envoie le mail de réinitialisation."""
    await _check_auth_rate(request)
    email = body.email.lower().strip()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    # Comptes intranet/google : le mot de passe local n'est pas la source de
    # vérité (réécrit/inutilisé) -> on n'envoie pas de lien, mais la réponse reste
    # neutre (pas d'énumération du type de compte non plus).
    # Plafond PAR DESTINATAIRE (anti email-bombing : le limiteur par IP ne protège
    # pas la victime d'un attaquant multi-IP). Vérifié uniquement quand un envoi
    # est dû -> ne révèle rien (réponse neutre identique quoi qu'il arrive).
    if (user is not None and user.is_active and user.auth_source == "local"
            and await password_reset_email_limiter.check(email)):
        token = create_password_reset_token(user.id, user.hashed_password)
        link = f"{settings.APP_URL}/reset-password?token={token}"
        subject, mail_body = build_reset_email(user, link)
        spawn_background(send_email([user.email], subject, mail_body, reply_to=SUPPORT_EMAIL),
                         error_label="Envoi e-mail auth échoué")
    return {"message": "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé."}


@router.post("/password/reset")
async def reset_password(body: ResetPasswordBody, request: Request,
                         db: AsyncSession = Depends(get_db)):
    """Applique un nouveau mot de passe via un token de réinitialisation valide.
    Le token est lié au hash courant du mot de passe : changer le mot de passe
    l'invalide (usage unique de fait). Mêmes règles de robustesse qu'à
    l'inscription."""
    await _check_auth_rate(request)
    payload = decode_token(body.token, expected_scope="password_reset")
    user = await db.get(User, int(payload["sub"]))
    # is_active + auth_source revérifiés ici (et pas seulement à l'émission du
    # lien) : un compte désactivé entre-temps, ou non local, ne doit pas pouvoir
    # réinitialiser via un lien encore dans sa fenêtre de validité.
    if (user is None or not user.is_active or user.auth_source != "local"
            or payload.get("fp") != account_fingerprint(user.hashed_password)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Lien de réinitialisation invalide ou expiré")
    if len(body.new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Mot de passe trop court ({PASSWORD_MIN_LENGTH} caractères minimum)")
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"changed": True}
