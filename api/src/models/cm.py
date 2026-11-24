"""Gestion des réseaux sociaux (cm.chapote.fr) : comptes Instagram, planning, statistiques.

Mêmes règles de tenant que les modules TikTok et YouTube (organisation XOR espace
perso, CHECK ; accès toujours scopé dans routers/cm.py).

- InstagramAccount : un compte Instagram professionnel du tenant. Deux modes :
  « api » (connexion officielle Instagram, jeton CHIFFRÉ de 60 jours, rafraîchi)
  et « routine » (pas de jeton : la routine Claude publie et envoie les chiffres
  avec CM_SERVICE_TOKEN).
- CmPost : une vidéo à publier sur un ou plusieurs comptes. Le fichier est gardé
  dans CM_MEDIA_DIR jusqu'à ce que toutes ses cibles soient terminées.
- CmTarget : une publication sur UN compte (TikTok, YouTube ou Instagram), avec
  son heure (maintenant ou programmée), ses options et son statut. À l'heure dite,
  une cible TikTok/YouTube crée une publication du module correspondant
  (tiktok_posts / youtube_posts), qui fait l'envoi ; Instagram est publié ici.
- CmVideo : vidéos récentes de chaque compte et leurs chiffres (vues, j'aime…).
- CmAccountStat : relevé quotidien d'un compte (abonnés, vues, j'aime, vidéos).
"""
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
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

PLATFORMS = ("tiktok", "youtube", "instagram")

IG_MODE_API = "api"
IG_MODE_ROUTINE = "routine"

# Publication (fichier) : RECEIVING (vidéo en cours d'envoi vers Chapote), READY
# (reçue et validée : ses cibles vivent leur vie), CANCELLED.
POST_RECEIVING = "RECEIVING"
POST_READY = "READY"
POST_CANCELLED = "CANCELLED"

# Cible : DRAFT (vidéo pas encore reçue), SCHEDULED (attend son heure),
# DISPATCHING (envoi en préparation), PUBLISHING (chez la plateforme),
# AWAITING_ROUTINE (Instagram géré par la routine : à publier), ROUTINE_CLAIMED
# (pris en charge par la routine). Fins : PUBLISHED, INBOX (brouillon TikTok
# envoyé dans l'app), FAILED, CANCELLED.
T_DRAFT = "DRAFT"
T_SCHEDULED = "SCHEDULED"
T_DISPATCHING = "DISPATCHING"
T_PUBLISHING = "PUBLISHING"
T_AWAITING_ROUTINE = "AWAITING_ROUTINE"
T_ROUTINE_CLAIMED = "ROUTINE_CLAIMED"
T_PUBLISHED = "PUBLISHED"
T_INBOX = "INBOX"
T_FAILED = "FAILED"
T_CANCELLED = "CANCELLED"
T_FINAL = (T_PUBLISHED, T_INBOX, T_FAILED, T_CANCELLED)
T_EDITABLE = (T_DRAFT, T_SCHEDULED, T_AWAITING_ROUTINE)


def _tenant_check(table: str):
    return CheckConstraint("(owner_user_id IS NULL) <> (organization_id IS NULL)",
                           name=f"ck_{table}_owner_xor_org")


class InstagramAccount(Base):
    __tablename__ = "instagram_accounts"
    __table_args__ = (_tenant_check("instagram_accounts"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    connected_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    mode = Column(String(20), nullable=False, default=IG_MODE_API)
    ig_user_id = Column(String, nullable=True)          # mode api
    username = Column(String, nullable=False)
    name = Column(String, nullable=True)
    profile_picture_url = Column(Text, nullable=True)
    account_type = Column(String, nullable=True)        # BUSINESS | MEDIA_CREATOR
    scopes = Column(Text, nullable=True)                # séparés par des virgules
    access_token_enc = Column(Text, nullable=True)
    access_token_expires_at = Column(DateTime, nullable=True)
    needs_reconnect = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmPost(Base):
    __tablename__ = "cm_posts"
    __table_args__ = (_tenant_check("cm_posts"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)          # nom interne + titre par défaut
    caption = Column(Text, nullable=True)                # légende par défaut
    file_name = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    video_size = Column(BigInteger, nullable=False)
    received_bytes = Column(BigInteger, nullable=False, default=0)
    duration_sec = Column(Float, nullable=True)
    media_path = Column(String, nullable=True)           # supprimé quand tout est terminé
    # Vidéo de la bibliothèque (dossier Drive) : téléchargée à l'heure de la 1re publication.
    asset_id = Column(Integer, ForeignKey("cm_assets.id", ondelete="SET NULL"), nullable=True, index=True)
    cover_path = Column(String(500), nullable=True)
    ref = Column(String(200), nullable=True, index=True)  # référence de l'outil (« compte/id »), dédoublonnage
    # Archivage dans le Drive de l'espace (cm_archive) : pending | ok | error ; null = pas d'archive.
    archive_state = Column(String(12), nullable=True, index=True)
    # Droits d'auteur de l'œuvre jouée : public_domain | protected | unknown (null = pas renseigné), note libre.
    rights = Column(String(16), nullable=True)
    rights_note = Column(String(300), nullable=True)
    archive = Column(JSON, nullable=True)                 # ids Drive (dossier, vidéo, légende, couverture, infos), conte
    archive_synced_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default=POST_RECEIVING, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmTarget(Base):
    __tablename__ = "cm_targets"
    __table_args__ = (
        Index("ix_cm_targets_due", "status", "scheduled_at"),
    )

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("cm_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)         # id dans tiktok_accounts / youtube_accounts / instagram_accounts
    scheduled_at = Column(DateTime, nullable=False)      # UTC ; = création pour « maintenant »
    options = Column(JSON, nullable=False, default=dict)
    status = Column(String, nullable=False, default=T_DRAFT, index=True)
    tiktok_post_id = Column(Integer, ForeignKey("tiktok_posts.id", ondelete="SET NULL"), nullable=True)
    youtube_post_id = Column(Integer, ForeignKey("youtube_posts.id", ondelete="SET NULL"), nullable=True)
    ig_container_id = Column(String, nullable=True)
    external_id = Column(String, nullable=True)          # id de la vidéo publiée
    url = Column(Text, nullable=True)
    fail_reason = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    notice = Column(Text, nullable=True)                 # remarque non bloquante (vidéo gardée privée…)
    attempts = Column(Integer, nullable=False, default=0)
    claimed_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmVideo(Base):
    __tablename__ = "cm_videos"
    __table_args__ = (
        Index("uq_cm_videos_account_external", "platform", "account_id", "external_id", unique=True),
        # Calendrier, statistiques, liste des vidéos : filtre par compte, tri / bornes par date.
        Index("ix_cm_videos_account_published", "platform", "account_id", "published_at"),
    )

    id = Column(Integer, primary_key=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    external_id = Column(String, nullable=False)
    target_id = Column(Integer, ForeignKey("cm_targets.id", ondelete="SET NULL"), nullable=True)
    title = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    published_at = Column(DateTime, nullable=True)
    duration_sec = Column(Float, nullable=True)
    views = Column(BigInteger, nullable=True)
    likes = Column(BigInteger, nullable=True)
    comments = Column(BigInteger, nullable=True)
    shares = Column(BigInteger, nullable=True)
    saves = Column(BigInteger, nullable=True)
    stats_updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmAccountStat(Base):
    __tablename__ = "cm_account_stats"
    __table_args__ = (
        Index("uq_cm_account_stats_day", "platform", "account_id", "day", unique=True),
    )

    id = Column(Integer, primary_key=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    day = Column(Date, nullable=False)
    followers = Column(BigInteger, nullable=True)
    views = Column(BigInteger, nullable=True)            # total du compte (ou des vidéos relevées)
    likes = Column(BigInteger, nullable=True)
    videos = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)                  # dernier relevé en échec
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmGroup(Base):
    """Groupe de comptes d'un tenant (ex. « Ghost Hands », « Clients musique »).

    Un groupe contient plusieurs comptes, toutes plateformes confondues, et un
    compte peut appartenir à plusieurs groupes (cm_group_accounts). Les groupes
    servent de filtre (tableau de bord, planning, statistiques) et de sélection
    rapide dans la nouvelle publication.
    """
    __tablename__ = "cm_groups"
    __table_args__ = (_tenant_check("cm_groups"),)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(60), nullable=False)
    color = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmGroupAccount(Base):
    __tablename__ = "cm_group_accounts"
    __table_args__ = (
        Index("uq_cm_group_accounts", "group_id", "platform", "account_id", unique=True),
    )

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("cm_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmSource(Base):
    """Dossier Google Drive relié à un tenant (bibliothèque de vidéos).

    Le dossier est partagé par l'utilisateur avec le robot de Chapote (compte de service) :
    `role` = rôle du robot sur le dossier (reader | writer). Un dossier n'est relié qu'à un
    seul tenant à la fois. `verified` : la personne qui a partagé (ou le propriétaire) est
    l'utilisateur qui relie, ou un membre de son équipe.
    """
    __tablename__ = "cm_sources"
    __table_args__ = (
        _tenant_check("cm_sources"),
        # Un dossier n'est relié qu'une fois (deux détections simultanées créaient un doublon).
        Index("uq_cm_sources_folder_active", "folder_id", unique=True, postgresql_where=text("revoked_at IS NULL")),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    provider = Column(String(20), nullable=False, default="gdrive")
    folder_id = Column(String(200), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    drive_id = Column(String(200), nullable=True)        # Drive partagé (Workspace)
    role = Column(String(20), nullable=True)             # reader | writer
    shared_by = Column(String(255), nullable=True)       # e-mail de qui a partagé (ou propriétaire)
    verified = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    group_id = Column(Integer, ForeignKey("cm_groups.id", ondelete="SET NULL"), nullable=True)
    move_published = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    published_folder_id = Column(String(200), nullable=True)
    # Le robot peut-il déposer des fichiers ici ? (essai réel une fois : null = pas essayé ; Google refuse
    # en général à un compte de service hors Drive partagé, même Éditeur). Archivage direct si vrai.
    can_upload = Column(Boolean, nullable=True)
    # Brouillons automatiques : « recette » qui lit le rangement du dossier (voir cm_recipe).
    recipe = Column(JSON, nullable=True)
    auto_drafts = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    drafts_since = Column(DateTime, nullable=True)       # vidéos ajoutées après (NULL = toutes)
    last_scan_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmAsset(Base):
    """Vidéo d'un dossier relié. Le fichier reste dans le Drive ; cm garde ses informations,
    son titre et sa légende (fichier .txt du même nom, ou saisie dans cm)."""
    __tablename__ = "cm_assets"
    __table_args__ = (
        Index("uq_cm_assets_source_file", "source_id", "file_id", unique=True),
    )

    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("cm_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id = Column(String(200), nullable=False)
    name = Column(String(500), nullable=False)
    mime_type = Column(String(100), nullable=True)
    size = Column(BigInteger, nullable=True)
    md5 = Column(String(64), nullable=True)
    duration_sec = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    folder_path = Column(String(500), nullable=True)     # sous-dossier dans le dossier relié
    parent_id = Column(String(200), nullable=True)
    thumbnail_link = Column(Text, nullable=True)
    drive_created_at = Column(DateTime, nullable=True)
    drive_modified_at = Column(DateTime, nullable=True)
    title = Column(String(200), nullable=True)
    caption = Column(Text, nullable=True)
    caption_from = Column(String(10), nullable=True)     # txt | user
    sidecar_file_id = Column(String(200), nullable=True)
    sidecar_modified_at = Column(DateTime, nullable=True)
    cover_file_id = Column(String(200), nullable=True)   # image du même dossier (couverture)
    # infos.json posé à côté par l'outil de l'équipe (ex. claude-cloud) : compte, id, statut, liens.
    meta = Column(JSON, nullable=True)
    meta_file_id = Column(String(200), nullable=True)
    meta_modified_at = Column(DateTime, nullable=True)
    origin_ref = Column(String(200), nullable=True, index=True)   # « compte/id » de l'outil
    kind = Column(String(12), nullable=True)             # published | routine | reserve | waiting (jamais « à valider »)
    moved_published_at = Column(DateTime, nullable=True)
    removed_at = Column(DateTime, nullable=True)         # disparue du dossier
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmProposal(Base):
    """Brouillon proposé automatiquement pour une vidéo de la bibliothèque, à valider.

    Rien ne part sans validation : « Valider » ouvre le composeur pré-rempli (mêmes règles qu'une
    publication à la main, dont les choix TikTok faits par l'utilisateur). `accounts` : clés
    "plateforme:id" ; `when_from` : path (date lue dans le nom) | auto (heure par défaut)."""
    __tablename__ = "cm_proposals"
    __table_args__ = (
        _tenant_check("cm_proposals"),
        Index("uq_cm_proposals_asset", "asset_id", unique=True),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    source_id = Column(Integer, ForeignKey("cm_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("cm_assets.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=True)
    caption = Column(Text, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)        # UTC
    when_from = Column(String(10), nullable=True)
    accounts = Column(JSON, nullable=False, default=list)
    status = Column(String(12), nullable=False, default="open", index=True)   # open | used | dismissed
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmComment(Base):
    """Commentaire reçu sous une vidéo (boîte de réception centralisée).

    Rempli par l'API officielle (Instagram avec la permission « commentaires », YouTube) ou remonté par
    la routine (comptes Instagram gérés par la routine). `pending_action` : réponse / masquage / réponse
    privée demandés dans cm et exécutés par la routine pour ses comptes.
    status : new | replied | hidden | ignored | contacted."""
    __tablename__ = "cm_comments"
    __table_args__ = (
        _tenant_check("cm_comments"),
        Index("uq_cm_comments_ext", "platform", "account_id", "external_id", unique=True),
        Index("ix_cm_comments_inbox", "platform", "account_id", "status", "published_at"),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    media_id = Column(String(100), nullable=True)
    video_title = Column(String(300), nullable=True)
    video_url = Column(Text, nullable=True)
    external_id = Column(String(100), nullable=False)
    parent_external_id = Column(String(100), nullable=True)
    author = Column(String(150), nullable=True)
    author_id = Column(String(100), nullable=True)
    text = Column(Text, nullable=True)
    like_count = Column(Integer, nullable=True)
    published_at = Column(DateTime, nullable=True)
    status = Column(String(12), nullable=False, default="new", index=True)
    reply_text = Column(Text, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    replied_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    private_replied_at = Column(DateTime, nullable=True)
    pending_action = Column(JSON, nullable=True)
    action_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmGoogleIdentity(Base):
    """Adresse Google associée à un compte Chapote, PROUVÉE par une connexion Google (ID token).

    Sert à relier automatiquement les dossiers Drive partagés avec le robot : un dossier
    partagé depuis cette adresse va dans l'espace choisi (`organization_id`, vide = espace
    perso). Une adresse n'est associée qu'à un seul compte Chapote.
    """
    __tablename__ = "cm_google_identities"
    __table_args__ = (
        Index("uq_cm_google_identities_email", "email", unique=True),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    google_sub = Column(String(100), nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


CM_ROLES = ("admin", "editor", "viewer")


class CmMemberRole(Base):
    """Rôle cm d'un membre d'équipe (par adresse e-mail : vaut aussi pour une invitation en
    attente). Sans ligne : « editor ». Un admin de l'équipe (Membership.role = admin) est
    toujours admin dans cm. `group_ids` : limité à ces groupes de comptes (vide = tous)."""
    __tablename__ = "cm_member_roles"
    __table_args__ = (
        Index("uq_cm_member_roles_org_email", "organization_id", "email", unique=True),
    )

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="editor")
    group_ids = Column(JSON, nullable=True)
    # Comptes partagés un par un (« tiktok:12 »). Accès restreint dès que group_ids ou account_keys
    # n'est pas NULL (listes vides = rien) ; NULL partout = tous les comptes de l'espace.
    account_keys = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CmTransfer(Base):
    """Transfert d'un compte (TikTok, YouTube, Instagram) vers une autre personne : en attente
    jusqu'à ce qu'elle l'accepte dans un de ses espaces (14 jours)."""
    __tablename__ = "cm_transfers"

    id = Column(Integer, primary_key=True)
    platform = Column(String(20), nullable=False)
    account_id = Column(Integer, nullable=False)
    from_organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    from_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    to_email = Column(String(255), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending")   # pending | accepted | declined | cancelled
    expires_at = Column(DateTime, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class CmDriveLink(Base):
    """Drive de l'espace pour l'archivage (connexion Google au nom de l'utilisateur, droit « drive.file » :
    cm ne voit que les fichiers qu'il a créés). Un seul lien actif par espace."""
    __tablename__ = "cm_drive_links"
    __table_args__ = (_tenant_check("cm_drive_links"),)    # plusieurs stockages par espace (ordre, attribution)

    id = Column(Integer, primary_key=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    connected_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email = Column(String(255), nullable=True)
    refresh_token_enc = Column(Text, nullable=False)
    root_folder_id = Column(String(200), nullable=True)
    source_id = Column(Integer, ForeignKey("cm_sources.id", ondelete="SET NULL"), nullable=True)
    error = Column(Text, nullable=True)                   # dernière erreur (ex. accès retiré chez Google)
    # Stockage (cm_storage) : Go réservés à Chapote (null = tout l'espace libre du Drive), conservation des fichiers.
    quota_gb = Column(Integer, nullable=True)
    name = Column(String(80), nullable=True)               # nom affiché (« Drive principal », « Kiwi »…)
    position = Column(Integer, nullable=False, default=0, server_default="0")   # ordre de remplissage
    # Attribution : {"accounts": [["instagram", 3], …], "groups": [12, …]} ; null = tous les comptes (dans l'ordre).
    assign = Column(JSON, nullable=True)
    retention = Column(String(24), nullable=False, default="keep", server_default="keep")
    delete_after_days = Column(Integer, nullable=True)
    drive_limit = Column(BigInteger, nullable=True)       # storageQuota du Drive (null = illimité), relu ≤ 10 min
    drive_usage = Column(BigInteger, nullable=True)
    drive_checked_at = Column(DateTime, nullable=True)
    storage_alert = Column(String(16), nullable=True)     # dernier seuil notifié : almost_full | full
    storage_alert_seq = Column(Integer, nullable=False, default=0, server_default="0")
    storage_alert_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
