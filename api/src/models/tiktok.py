"""Module TikTok « Chapote Publisher » (Espace client) : comptes et publications.

Multi-tenant, même ownership polymorphe que `Bot` : une ligne appartient SOIT à
une organisation (`organization_id`), SOIT à un espace perso (`owner_user_id`),
jamais aux deux (CHECK). Tout accès passe par routers/tiktok.py qui scope par
tenant (membre de l'org / propriétaire de l'espace perso).

- TikTokAccount : un compte TikTok connecté par un tenant (unique par tenant +
  open_id). Jetons OAuth CHIFFRÉS (Fernet, services/crypto.py) : ils ne sortent
  jamais de l'API. Déconnexion = révocation TikTok + jetons effacés +
  `revoked_at` (la ligne reste pour l'historique des publications).
- TikTokPost : une publication (Direct Post ou brouillon « inbox »). Garde le
  fichier temporaire le temps de l'envoi, puis le statut TikTok.
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
# vers Chapote), QUEUED (validée, envoi TikTok planifié), UPLOADING (envoi vers
# TikTok). Ensuite, statuts TikTok (post/publish/status/fetch).
POST_RECEIVING = "RECEIVING"
POST_QUEUED = "QUEUED"
POST_UPLOADING = "UPLOADING"
POST_PROCESSING = "PROCESSING_UPLOAD"
POST_INBOX = "SEND_TO_USER_INBOX"
POST_COMPLETE = "PUBLISH_COMPLETE"
POST_FAILED = "FAILED"
POST_ACTIVE = (POST_RECEIVING, POST_QUEUED, POST_UPLOADING)


class TikTokAccount(Base):
    __tablename__ = "tiktok_accounts"
    __table_args__ = (
        CheckConstraint("(owner_user_id IS NULL) <> (organization_id IS NULL)",
                        name="ck_tiktok_accounts_owner_xor_org"),
        Index("uq_tiktok_accounts_org_open_id", "organization_id", "open_id", unique=True,
              postgresql_where=text("organization_id IS NOT NULL")),
        Index("uq_tiktok_accounts_user_open_id", "owner_user_id", "open_id", unique=True,
              postgresql_where=text("owner_user_id IS NOT NULL")),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    connected_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    open_id = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    username = Column(String, nullable=True)          # @pseudo (creator_info), pour le nom lisible du compte
    avatar_url = Column(Text, nullable=True)
    scopes = Column(String, nullable=True)
    access_token_enc = Column(Text, nullable=True)
    refresh_token_enc = Column(Text, nullable=True)
    access_token_expires_at = Column(DateTime, nullable=True)
    refresh_token_expires_at = Column(DateTime, nullable=True)
    # Refresh en échec (révoqué côté TikTok, expiré…) : l'UI affiche « À reconnecter ».
    needs_reconnect = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class TikTokPost(Base):
    __tablename__ = "tiktok_posts"
    __table_args__ = (
        CheckConstraint("(owner_user_id IS NULL) <> (organization_id IS NULL)",
                        name="ck_tiktok_posts_owner_xor_org"),
        CheckConstraint("mode IN ('direct', 'draft')", name="ck_tiktok_posts_mode"),
    )

    id = Column(Integer, primary_key=True)
    # Tenant recopié du compte : scoping direct des listes d'historique.
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    tiktok_account_id = Column(Integer, ForeignKey("tiktok_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    mode = Column(String, nullable=False)                 # direct | draft
    title = Column(Text, nullable=True)
    privacy_level = Column(String, nullable=True)         # direct uniquement
    disable_comment = Column(Boolean, nullable=False, default=True)
    disable_duet = Column(Boolean, nullable=False, default=True)
    disable_stitch = Column(Boolean, nullable=False, default=True)
    brand_organic = Column(Boolean, nullable=False, default=False)   # « Votre marque »
    brand_content = Column(Boolean, nullable=False, default=False)   # « Contenu de marque »
    cover_timestamp_ms = Column(Integer, nullable=True)   # miniature : instant de la vidéo (direct uniquement)
    # Vidéo (fichier temporaire, supprimé après l'envoi à TikTok)
    file_name = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    video_size = Column(BigInteger, nullable=False)
    received_bytes = Column(BigInteger, nullable=False, default=0)
    duration_sec = Column(Float, nullable=True)
    tmp_path = Column(String, nullable=True)
    # TikTok
    publish_id = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default=POST_RECEIVING, index=True)
    fail_reason = Column(String, nullable=True)           # code TikTok ou interne
    error_message = Column(Text, nullable=True)           # message FR affiché
    post_ids = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
