"""2FA : TOTP (authenticator) + codes de secours + cérémonies WebAuthn (passkeys).

Encapsule les libs `pyotp` et `webauthn` (py_webauthn) pour que les routeurs
restent déclaratifs. Les secrets TOTP sont chiffrés (Fernet) AVANT la base via
crypto.encrypt_secret ; ce module ne manipule que du clair. Les codes de secours
sont stockés HASHÉS (bcrypt) — seul leur affichage initial est en clair.
"""
import secrets
from typing import Optional

import pyotp
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from src.core.config import settings
from src.core.security import hash_password, verify_password

# ------------------------------------------------------------------ TOTP -----

def new_totp_secret() -> str:
    """Nouveau secret base32 (clair). À chiffrer avant stockage."""
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    """URI otpauth:// à encoder en QR côté front (Google Authenticator, Authy…)."""
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.TWOFA_ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    """Vérifie un code à 6 chiffres (tolérance ±1 fenêtre de 30 s pour le drift)."""
    if not secret or not code:
        return False
    return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)


# --------------------------------------------------------- Codes de secours --

RECOVERY_CODE_COUNT = 10


def _fmt_code(raw: str) -> str:
    # 10 hex -> "abcde-fghij" (lisible, sans ambiguïté de casse à la saisie).
    return f"{raw[:5]}-{raw[5:10]}"


def new_recovery_codes() -> tuple[list[str], list[str]]:
    """Retourne (codes_en_clair, codes_hashés). Le clair n'est montré qu'une fois."""
    plain = [_fmt_code(secrets.token_hex(5)) for _ in range(RECOVERY_CODE_COUNT)]
    hashed = [hash_password(c) for c in plain]
    return plain, hashed


def consume_recovery_code(hashed: Optional[list], code: str) -> tuple[bool, list]:
    """Si `code` correspond à un hash non consommé, le retire et renvoie (True, reste).
    Sinon (False, liste inchangée). Normalise la casse/espaces de la saisie."""
    norm = (code or "").strip().lower().replace(" ", "")
    remaining = list(hashed or [])
    for i, h in enumerate(remaining):
        if verify_password(norm, h):
            remaining.pop(i)
            return True, remaining
    return False, remaining


# -------------------------------------------------------------- WebAuthn -----

def _descriptors(creds) -> list[PublicKeyCredentialDescriptor]:
    """Construit les descriptors (exclude/allow) depuis des WebAuthnCredential."""
    out = []
    for c in creds:
        out.append(PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id)))
    return out


def registration_options(user, existing_creds) -> tuple[str, str]:
    """(options_json, challenge_base64url) pour navigator.credentials.create.
    `existing_creds` exclut les passkeys déjà enregistrées (évite les doublons)."""
    options = generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=str(user.id).encode(),
        user_name=user.email,
        user_display_name=user.name or user.email,
        exclude_credentials=_descriptors(existing_creds),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    return options_to_json(options), bytes_to_base64url(options.challenge)


def verify_registration(credential_json: str, challenge_b64: str) -> tuple[str, str, int]:
    """Vérifie l'attestation. Retourne (credential_id_b64, public_key_b64, sign_count)."""
    v = verify_registration_response(
        credential=credential_json,
        expected_challenge=base64url_to_bytes(challenge_b64),
        expected_origin=settings.webauthn_origin,
        expected_rp_id=settings.webauthn_rp_id,
    )
    return (
        bytes_to_base64url(v.credential_id),
        bytes_to_base64url(v.credential_public_key),
        v.sign_count,
    )


def authentication_options(allow_creds) -> tuple[str, str]:
    """(options_json, challenge_base64url) pour navigator.credentials.get."""
    options = generate_authentication_options(
        rp_id=settings.webauthn_rp_id,
        allow_credentials=_descriptors(allow_creds),
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    return options_to_json(options), bytes_to_base64url(options.challenge)


def verify_authentication(credential_json: str, challenge_b64: str,
                          public_key_b64: str, current_sign_count: int) -> int:
    """Vérifie l'assertion ; retourne le nouveau sign_count (anti-rejeu)."""
    v = verify_authentication_response(
        credential=credential_json,
        expected_challenge=base64url_to_bytes(challenge_b64),
        expected_rp_id=settings.webauthn_rp_id,
        expected_origin=settings.webauthn_origin,
        credential_public_key=base64url_to_bytes(public_key_b64),
        credential_current_sign_count=current_sign_count,
    )
    return v.new_sign_count


def credential_id_from_assertion(credential_json: str) -> str:
    """Extrait le credential id (base64url) d'une assertion JSON brute (pour
    retrouver la passkey en base avant vérification)."""
    import json
    data = json.loads(credential_json) if isinstance(credential_json, str) else credential_json
    return data.get("id") or data.get("rawId")
