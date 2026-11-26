"""Application mobile de cm.chapote.fr : appareils connectés et notifications envoyées.

- `CmMobileDevice` : un téléphone connecté. Il garde un jeton longue durée (seulement son empreinte
  SHA-256 est stockée) qui lui donne des sessions courtes (cookie `chapote_session` d'une heure),
  révocable à tout moment, et, si l'utilisateur l'accepte, son jeton de notifications Expo.
- `CmPushEvent` : une notification déjà envoyée (vidéo publiée, échec, brouillon, commentaire) pour
  ne jamais l'envoyer deux fois, quel que soit le nombre de workers.
"""
from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Index, Integer, PrimaryKeyConstraint, String, Text

from src.core.database import Base
from src.core.time import utcnow


class CmMobileDevice(Base):
    __tablename__ = "cm_mobile_devices"
    __table_args__ = (
        Index("uq_cm_mobile_devices_token", "token_hash", unique=True),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False)
    name = Column(String(120), nullable=True)            # « iPhone de Nathan » (donné par l'app)
    platform = Column(String(20), nullable=True)         # ios | android
    push_token = Column(String(255), nullable=True, index=True)  # ExponentPushToken[…]
    push_prefs = Column(JSON, nullable=True)             # {published, failed, draft, comments} : booléens
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)


class CmPushEvent(Base):
    __tablename__ = "cm_push_events"
    __table_args__ = (
        Index("uq_cm_push_events_key", "kind", "ref_id", unique=True),
    )

    id = Column(Integer, primary_key=True)
    kind = Column(String(20), nullable=False)            # published | failed | draft | comment
    ref_id = Column(Integer, nullable=False)             # id de la cible ou du commentaire
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmUserIdentity(Base):
    """Informations données à l'inscription dans l'app : prénom, nom, date de naissance (âge minimum), et
    acceptation des conditions (CGU, CGV, confidentialité) avec leur version. La date de naissance ne se
    change plus ensuite (erreur : par le contact)."""
    __tablename__ = "cm_user_identities"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    first_name = Column(String(80), nullable=False)
    last_name = Column(String(80), nullable=False)
    birth_date = Column(Date, nullable=False)
    terms_version = Column(String(20), nullable=False)
    terms_accepted_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, nullable=False)


class CmGroupInviteLink(Base):
    """Lien d'invitation à un groupe (à envoyer par message), avec un rôle. Valable 7 jours, révocable.
    Seule l'empreinte SHA-256 du jeton est stockée."""
    __tablename__ = "cm_group_invite_links"
    __table_args__ = (Index("uq_cm_group_invite_links_token", "token_hash", unique=True),)

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("cm_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    uses = Column(Integer, nullable=False, default=0)


class CmAppOpen(Base):
    """Jour où une personne a ouvert l'app mobile (une ligne par jour) : pour mesurer les retours (J1, J3, J7)."""
    __tablename__ = "cm_app_opens"
    __table_args__ = (PrimaryKeyConstraint("user_id", "day"),)

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    day = Column(Date, nullable=False)


class CmFeedback(Base):
    """Réponse à une question courte posée dans l'app au moment d'un abandon (ex. « Qu'est-ce qui vous a arrêté ? »
    en quittant une nouvelle publication sans la programmer)."""
    __tablename__ = "cm_feedback"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    context = Column(String(40), nullable=False)       # ex. new_post_abandon
    reason = Column(String(40), nullable=True)          # choix proposé
    text = Column(Text, nullable=True)                  # « Autre » : texte libre (500 caractères au plus)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmAccountRequest(Base):
    """Demande de reprise d'un compte relié à l'espace de quelqu'un d'autre. La personne a prouvé qu'elle
    contrôle le compte (elle vient de s'y connecter chez la plateforme), mais le compte ne bouge que si
    un administrateur de l'espace actuel accepte. Refus ou silence : réclamation possible auprès du support."""
    __tablename__ = "cm_account_requests"

    id = Column(Integer, primary_key=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    requester_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    dest_organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    # Espace où était le compte au moment de la demande (si le compte a bougé depuis, la demande tombe).
    from_organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    from_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    message = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending")   # pending | accepted | declined | cancelled | expired
    expires_at = Column(DateTime, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    disputed_at = Column(DateTime, nullable=True)
    dispute_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmBiometricKey(Base):
    """Empreinte gérée par l'app : une clé secrète tirée au sort par le serveur, rangée dans la puce sécurisée
    du téléphone et protégée par l'empreinte (ou le visage). Elle remplace le code de double authentification
    à la connexion. Seule son empreinte SHA-256 est gardée ici ; on peut la retirer à tout moment."""
    __tablename__ = "cm_biometric_keys"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(80), nullable=True)                 # « Galaxy S24 de Nathan » (donné par l'app)
    secret_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
