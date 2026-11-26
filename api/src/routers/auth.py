"""Auth dashboard : inscription perso/entreprise (+ invitations), login local,
SSO Google, auto-login admin en dev, profil (nom, mdp), vérification souple de
l'email + réinitialisation de mot de passe."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    account_fingerprint,
    clear_auth_cookie,
    create_dashboard_token,
    create_password_reset_token,
    create_twofa_challenge_token,
    create_verify_email_token,
    decode_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    user_has_2fa,
    verify_password,
)
from src.models.user import (
    Invitation,
    Membership,
    Organization,
    OrgOut,
    User,
    UserLogin,
    UserOut,
    WebAuthnCredential,
    UserRegister,
)
from src.core.time import utcnow
from src.services.auth_service import AuthenticationError, authenticate
from src.services.avatar import fetch_and_store_avatar
from src.services.email_service import (
    HELLO_EMAIL,
    HELLO_FROM,
    build_password_changed_email,
    build_reset_email,
    build_verify_email,
    build_welcome_email,
    email_languages,
    send_account_email,
    send_org_member_email,
)
from src.i18n import LANG
from src.services.google_oauth import GoogleAuthError, verify_google_id_token
from src.services.org_service import consume_invitations
from src.services.rate_limit import auth_limiter, password_reset_email_limiter
from src.services.stripe_service import billing_enabled
from src.services.user_apps import app_from_request, client_ip, record_app

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Longueur minimale du mot de passe — partagée par /register, /password/reset et
# le changement de mot de passe (même règle de robustesse partout).
PASSWORD_MIN_LENGTH = 8

def _request_lang() -> str:
    """Langue des e-mails envoyés à la personne qui fait la requête : celle demandée par
    Chapote CM (en-tête X-Chapote-Lang, posé dans src.i18n.LANG) ; chapote.fr : français."""
    return LANG.get()


def _send_verify_email(user: User) -> None:
    """Construit le lien de confirmation et envoie le mail brandé
    (fire-and-forget)."""
    token = create_verify_email_token(user.id, user.email)
    link = f"{settings.APP_URL}/verify-email?token={token}"
    lang = _request_lang()
    subject, body = build_verify_email(user, link, lang)
    send_account_email([user.email], subject, body, kind="verify", lang=lang,
                       error_label="Envoi e-mail auth échoué")


def _send_password_changed(user: User) -> None:
    """Notif de sécurité (fire-and-forget) après un changement de mot de passe.
    Partagée par /password (changement) et /password/reset (réinitialisation)."""
    lang = _request_lang()
    subject, mail_body = build_password_changed_email(user, settings.APP_URL, lang)
    send_account_email([user.email], subject, mail_body, kind="password_changed", lang=lang,
                       error_label="Envoi e-mail sécurité échoué")


async def _check_auth_rate(request: Request) -> None:
    """Anti-bruteforce : limite les tentatives login/register par IP."""
    ip = client_ip(request)
    if not await auth_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de tentatives, réessayez dans quelques minutes")


async def _user_out(db: AsyncSession, user: User) -> UserOut:
    """UserOut avec organisations + role + permissions par bot du user.

    Pose aussi les champs facturation (spec §1.3) :
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


async def _issue_session(db: AsyncSession, user: User, response: Response,
                         request: Optional[Request] = None, signup: bool = False) -> UserOut:
    """Connexion réussie : pose le JWT dashboard dans le cookie httpOnly (le token
    ne quitte JAMAIS le cookie) et renvoie l'UserOut pour hydrater le front.
    `request` : note le service utilisé (en-tête X-Chapote-App : chapote, music…)
    et, à l'inscription (`signup`), le service d'inscription du compte."""
    if request is not None:
        await record_app(db, user, app_from_request(request), signup=signup)
        await db.commit()
    set_auth_cookie(response, create_dashboard_token(user.id))
    return await _user_out(db, user)


@router.post("/register", response_model=UserOut)
async def register(body: UserRegister, request: Request, response: Response,
                   db: AsyncSession = Depends(get_db)):
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

    # Mails d'invitation/ajout à envoyer APRÈS commit (email, role, existing).
    org_member_mails: list[tuple[str, str, str, bool]] = []

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
                org_member_mails.append((inv_email, org.name, inv.role, True))
            else:
                db.add(Invitation(organization_id=org.id, email=inv_email, role=inv.role))
                org_member_mails.append((inv_email, org.name, inv.role, False))

    # Un perso peut aussi avoir des invitations en attente vers des equipes :
    # consommees dans LES DEUX cas
    await consume_invitations(db, user)
    await db.commit()
    await db.refresh(user)
    # Vérification souple : le compte est déjà actif. On envoie le mail de
    # confirmation en fire-and-forget — l'inscription ne bloque pas et n'échoue
    # jamais si l'envoi (ou le SMTP) échoue.
    _send_verify_email(user)
    # Notifie les personnes invitées/ajoutées à la nouvelle équipe (fire-and-forget).
    # Langue : compte existant -> sa préférence Chapote CM ; sinon celle de la requête.
    prefs = await email_languages(db, [m[0] for m in org_member_mails if m[3]])
    for inv_email, org_name, role, existing in org_member_mails:
        lang = prefs.get(inv_email.lower()) if existing else _request_lang()
        send_org_member_email(inv_email, org_name, role, lang=lang,
                              existing=existing, app_url=settings.APP_URL)
    return await _issue_session(db, user, response, request, signup=True)


@router.post("/login", response_model=UserOut)
async def login(body: UserLogin, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)):
    await _check_auth_rate(request)
    try:
        user = await authenticate(db, body.email.lower().strip(), body.password)
    except AuthenticationError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))
    # 2FA active -> on ne pose PAS de cookie : un challenge à valider (2nd facteur).
    challenge = await _twofa_challenge_or_none(db, user)
    if challenge is not None:
        return challenge
    return await _issue_session(db, user, response, request)


class GoogleAuthPayload(BaseModel):
    credential: str  # ID token JWT renvoyé par Google Identity Services (front)


@router.post("/google", response_model=UserOut)
async def google_login(body: GoogleAuthPayload, request: Request, response: Response,
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
    created = user is None
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
    else:
        if user.auth_source != "google":
            # Anti pre-hijacking : un attaquant a pu créer ce compte avec l'email
            # de la victime + SON mot de passe avant qu'elle ne se connecte.
            # Google vient de prouver que l'appelant contrôle la boîte mail ->
            # on adopte le compte en SSO Google et on invalide la connexion par
            # mot de passe (remplacé par un secret aléatoire : l'éventuel mot de
            # passe posé par l'attaquant cesse de fonctionner).
            user.auth_source = "google"
            user.hashed_password = hash_password(secrets.token_urlsafe(32))
        if not user.avatar_url:
            # Backfill ponctuel : on récupère la photo une seule fois (compte créé
            # avant cette feature, ou avatar vide). Pas à chaque login -> évite
            # d'accumuler des fichiers orphelins. Une photo Google modifiée plus
            # tard ne se propage donc pas (compromis v1 assumé).
            user.avatar_url = await fetch_and_store_avatar(claims.get("picture"))

    user.last_login = utcnow()
    await db.commit()
    await db.refresh(user)
    # 2FA active (même via SSO Google) -> challenge avant pose du cookie.
    challenge = await _twofa_challenge_or_none(db, user)
    if challenge is not None:
        return challenge
    return await _issue_session(db, user, response, request, signup=created)


@router.post("/dev-login", response_model=UserOut)
async def dev_login(response: Response, db: AsyncSession = Depends(get_db)):
    """Auto-login superadmin SANS credentials — uniquement ENV=dev +
    AUTO_LOGIN_ADMIN_DEV=true. Le frontend l'appelle au chargement."""
    if settings.is_production or not settings.AUTO_LOGIN_ADMIN_DEV:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    result = await db.execute(select(User).where(User.email == settings.ADMIN_EMAIL))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin dev non initialisé")
    return await _issue_session(db, user, response)


@router.post("/logout")
async def logout(response: Response):
    """Déconnexion : efface le cookie de session. Idempotent (aucune session
    requise) : un client sans cookie reçoit aussi 200, le cookie est juste
    invalidé côté navigateur. Les JWT déjà émis restent valides jusqu'à
    expiration (stateless), mais ne sont plus présentés par le navigateur."""
    clear_auth_cookie(response)
    return {"ok": True}


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
    SSO (Google) n'ont pas de mot de passe utilisable (secret aléatoire), il
    n'y a rien à changer ici.

    NB : les JWT deja emis restent valides jusqu'a expiration (tokens
    stateless, pas de revocation) — comportement documente, pas un bug."""
    await _check_auth_rate(request)  # anti-bruteforce du mot de passe actuel
    if user.auth_source != "local":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Compte géré par Google : la connexion passe par Google, sans mot de passe local")
    if not verify_password(body.current_password, user.hashed_password):
        # 403 et non 401 : cote front, 401 = token invalide (purge + /login).
        # Une faute de frappe ne doit pas deconnecter une session valide.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Mot de passe actuel incorrect")
    if len(body.new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Mot de passe trop court ({PASSWORD_MIN_LENGTH} caractères minimum)")
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    _send_password_changed(user)
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
        # Bienvenue : envoyé UNE SEULE fois, à la transition False->True (jamais à
        # l'inscription ni sur un confirm idempotent déjà vérifié).
        # Langue : celle de la requête, sinon la préférence Chapote CM (le lien de
        # confirmation s'ouvre souvent sur une page qui n'envoie pas X-Chapote-Lang).
        lang = _request_lang()
        if lang != "en":
            lang = (await email_languages(db, [user.email])).get(user.email.lower())
        subject, body = build_welcome_email(user, settings.APP_URL, lang)
        # Email relationnel -> expéditeur hello@ (meilleur placement Gmail).
        send_account_email([user.email], subject, body, kind="welcome", lang=lang,
                           from_addr=HELLO_FROM,
                           reply_to=HELLO_EMAIL,
                           error_label="Envoi e-mail bienvenue échoué")
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
    # Comptes SSO (Google) : le mot de passe local n'est pas la source de
    # vérité (secret aléatoire inutilisé) -> on n'envoie pas de lien, mais la
    # réponse reste neutre (pas d'énumération du type de compte non plus).
    # Plafond PAR DESTINATAIRE (anti email-bombing : le limiteur par IP ne protège
    # pas la victime d'un attaquant multi-IP). Vérifié uniquement quand un envoi
    # est dû -> ne révèle rien (réponse neutre identique quoi qu'il arrive).
    if (user is not None and user.is_active and user.auth_source == "local"
            and await password_reset_email_limiter.check(email)):
        token = create_password_reset_token(user.id, user.hashed_password)
        link = f"{settings.APP_URL}/reset-password?token={token}"
        lang = _request_lang()
        subject, mail_body = build_reset_email(user, link, lang)
        send_account_email([user.email], subject, mail_body, kind="reset", lang=lang,
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
    _send_password_changed(user)
    return {"changed": True}
