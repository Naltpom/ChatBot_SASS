"""Module YouTube « Chapote Publisher » (Espace client) : chaînes et Shorts.

Même modèle que le module TikTok (models/tiktok.py) : ownership polymorphe
(organisation XOR espace perso, CHECK), accès toujours scopé par tenant dans
routers/youtube.py.

- YouTubeAccount : une chaîne YouTube connectée par un tenant (unique par
  tenant + channel_id). Jetons OAuth Google CHIFFRÉS (Fernet) : ils ne sortent
  jamais de l'API. Déconnexion = révocation Google + jetons effacés +
  `revoked_at` (la ligne reste pour l'historique).
- YouTubePost : une vidéo (Short) envoyée par l'upload « resumable » de
  l'API YouTube Data v3. Garde le fichier temporaire le temps de l'envoi,
  puis suit le traitement de YouTube (uploadStatus).
"""
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    text,
)

from src.core.database import Base
from src.core.time import utcnow

# Statuts d'une publication. Côté Chapote : RECEIVING (vidéo en cours d'envoi
# vers Chapote), QUEUED (validée, envoi YouTube planifié), UPLOADING (envoi
# vers YouTube). Ensuite : PROCESSING (YouTube traite la vidéo), PUBLISHED
# (uploadStatus « processed »), FAILED.
POST_RECEIVING = "RECEIVING"
POST_QUEUED = "QUEUED"
POST_UPLOADING = "UPLOADING"
POST_PROCESSING = "PROCESSING"
POST_PUBLISHED = "PUBLISHED"
POST_FAILED = "FAILED"
POST_ACTIVE = (POST_RECEIVING, POST_QUEUED, POST_UPLOADING)

PRIVACY_STATUSES = ("public", "unlisted", "private")


class YouTubeAccount(Base):
    __tablename__ = "youtube_accounts"
    __table_args__ = (
        CheckConstraint("(owner_user_id IS NULL) <> (organization_id IS NULL)",
                        name="ck_youtube_accounts_owner_xor_org"),
        Index("uq_youtube_accounts_org_channel", "organization_id", "channel_id", unique=True,
              postgresql_where=text("organization_id IS NOT NULL")),
        Index("uq_youtube_accounts_user_channel", "owner_user_id", "channel_id", unique=True,
              postgresql_where=text("owner_user_id IS NOT NULL")),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    connected_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    channel_id = Column(String, nullable=False)
    title = Column(String, nullable=True)
    handle = Column(String, nullable=True)            # @pseudo (snippet.customUrl)
    thumbnail_url = Column(Text, nullable=True)
    scopes = Column(Text, nullable=True)              # séparés par des espaces (format Google)
    access_token_enc = Column(Text, nullable=True)
    refresh_token_enc = Column(Text, nullable=True)
    access_token_expires_at = Column(DateTime, nullable=True)
    # Refresh refusé (invalid_grant : révoqué, mot de passe changé, app « en
    # test » au-delà de 7 jours…) : l'UI affiche « À reconnecter ».
    needs_reconnect = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    # cm : n'accepter que des œuvres du domaine public sur cette chaîne (refus 422 rights_protected sinon).
    public_domain_only = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class YouTubePost(Base):
    __tablename__ = "youtube_posts"
    __table_args__ = (
        CheckConstraint("(owner_user_id IS NULL) <> (organization_id IS NULL)",
                        name="ck_youtube_posts_owner_xor_org"),
        CheckConstraint("privacy_status IN ('public', 'unlisted', 'private')",
                        name="ck_youtube_posts_privacy"),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    youtube_account_id = Column(Integer, ForeignKey("youtube_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Métadonnées YouTube (snippet + status)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    category_id = Column(String, nullable=True)
    default_language = Column(String, nullable=True)
    privacy_status = Column(String, nullable=False)
    publish_at = Column(DateTime, nullable=True)       # mise en ligne programmée (privée jusque-là)
    made_for_kids = Column(Boolean, nullable=False, default=False)
    synthetic_media = Column(Boolean, nullable=False, default=False)   # contenu modifié ou synthétique
    notify_subscribers = Column(Boolean, nullable=False, default=True)
    # Vidéo (fichier temporaire, supprimé après l'envoi à YouTube)
    file_name = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    video_size = Column(BigInteger, nullable=False)
    received_bytes = Column(BigInteger, nullable=False, default=0)
    duration_sec = Column(Float, nullable=True)
    tmp_path = Column(String, nullable=True)
    # YouTube
    video_id = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default=POST_RECEIVING, index=True)
    upload_status = Column(String, nullable=True)      # uploaded | processed | failed | rejected | deleted
    final_privacy = Column(String, nullable=True)      # privacyStatus relu chez YouTube
    fail_reason = Column(String, nullable=True)        # code YouTube ou interne
    error_message = Column(Text, nullable=True)        # message FR affiché
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
