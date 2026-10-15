"""TikTok « Chapote Publisher » : comptes TikTok connectés et publications.

Outil PRIVÉ du superadmin (publication de ses propres vidéos via la Content
Posting API, Direct Post). Sans lien avec le chatbot.

- TikTokAccount : un compte TikTok autorisé (clé = open_id). Les jetons OAuth
  sont CHIFFRÉS (Fernet, services/crypto.py) ; ils ne sortent jamais de l'API.
- TikTokPublish : une publication en cours/terminée. Garde l'upload_url (URL
  pré-signée TikTok, chiffrée) et le plan de découpage, pour que les chunks
  envoyés par le navigateur soient relayés vers TikTok côté serveur.
"""
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text

from src.core.database import Base
from src.core.time import utcnow


class TikTokAccount(Base):
    __tablename__ = "tiktok_accounts"

    id = Column(Integer, primary_key=True)
    open_id = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=True)
    avatar_url = Column(Text, nullable=True)
    scope = Column(String, nullable=True)
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=False)
    access_expires_at = Column(DateTime, nullable=False)
    refresh_expires_at = Column(DateTime, nullable=False)
    connected_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class TikTokPublish(Base):
    __tablename__ = "tiktok_publishes"

    id = Column(Integer, primary_key=True)
    publish_id = Column(String, unique=True, nullable=False, index=True)
    open_id = Column(String, ForeignKey("tiktok_accounts.open_id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(Text, nullable=True)
    privacy_level = Column(String, nullable=False)
    upload_url_enc = Column(Text, nullable=False)
    mime_type = Column(String, nullable=False)
    video_size = Column(BigInteger, nullable=False)
    chunk_size = Column(BigInteger, nullable=False)
    total_chunk_count = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="UPLOADING")
    fail_reason = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
