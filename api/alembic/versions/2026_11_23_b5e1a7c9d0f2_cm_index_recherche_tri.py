"""cm : index pour la recherche et les tris (millions de vidéos)

- pg_trgm : recherche « contient » (ILIKE '%…%') sur titres, noms, légendes, dossiers ;
- index d'expression identiques aux clés de tri de cm_paging.nulls_last (ordre décroissant,
  le plus courant) : vues, j'aime, commentaires, partages, date de publication ;
- bibliothèque (dossier + date) ; planning par compte.

Revision ID: b5e1a7c9d0f2
Revises: a4d0f6b8c9e1
Create Date: 2026-11-23 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b5e1a7c9d0f2'
down_revision: Union[str, None] = 'a4d0f6b8c9e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRGM = [
    ("ix_cm_videos_title_trgm", "cm_videos", "title"),
    ("ix_cm_assets_name_trgm", "cm_assets", "name"),
    ("ix_cm_assets_title_trgm", "cm_assets", "title"),
    ("ix_cm_assets_folder_trgm", "cm_assets", "folder_path"),
    ("ix_cm_assets_caption_trgm", "cm_assets", "caption"),
    ("ix_cm_posts_title_trgm", "cm_posts", "title"),
    ("ix_cm_posts_caption_trgm", "cm_posts", "caption"),
]
SORTS = [
    ("ix_cm_videos_sort_views", "cm_videos", "COALESCE(views, (-1)::bigint) DESC, id DESC"),
    ("ix_cm_videos_sort_likes", "cm_videos", "COALESCE(likes, (-1)::bigint) DESC, id DESC"),
    ("ix_cm_videos_sort_comments", "cm_videos", "COALESCE(comments, (-1)::bigint) DESC, id DESC"),
    ("ix_cm_videos_sort_shares", "cm_videos", "COALESCE(shares, (-1)::bigint) DESC, id DESC"),
    ("ix_cm_videos_sort_recent", "cm_videos", "COALESCE(published_at, '1970-01-01'::timestamp) DESC, id DESC"),
    # Sens croissant et titre (mêmes expressions que cm_paging.nulls_last).
    ("ix_cm_videos_sort_views_asc", "cm_videos", "COALESCE(views, (4611686018427387904)::bigint), id"),
    ("ix_cm_videos_sort_recent_asc", "cm_videos", "COALESCE(published_at, '9999-12-31'::timestamp), id"),
    ("ix_cm_videos_sort_title", "cm_videos", "COALESCE(lower(title), chr(1114111)), id"),
    ("ix_cm_videos_sort_title_desc", "cm_videos", "COALESCE(lower(title), ''), id"),
    ("ix_cm_assets_source_created", "cm_assets",
     "source_id, COALESCE(drive_created_at, '1970-01-01'::timestamp) DESC, id DESC"),
    ("ix_cm_targets_account_time", "cm_targets", "platform, account_id, scheduled_at"),
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, col in TRGM:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({col} gin_trgm_ops)")
    for name, table, cols in SORTS:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})")


def downgrade() -> None:
    for name, _, _ in TRGM + SORTS:
        op.execute(f"DROP INDEX IF EXISTS {name}")
