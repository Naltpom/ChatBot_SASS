"""cm : un dossier Drive n'est relié qu'une fois (doublons créés par deux détections simultanées)

Revision ID: a4d0f6b8c9e1
Revises: f3b8d4c6a7e9
Create Date: 2026-11-23 17:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a4d0f6b8c9e1'
down_revision: Union[str, None] = 'f3b8d4c6a7e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Doublons actifs : on garde le plus ancien ; les publications pointant vers une vidéo d'un
    # doublon sont rattachées à la même vidéo (même fichier Drive) du dossier gardé.
    op.execute("""
        WITH keep AS (
            SELECT folder_id, MIN(id) AS keep_id FROM cm_sources WHERE revoked_at IS NULL
            GROUP BY folder_id HAVING COUNT(*) > 1
        ), dup AS (
            SELECT s.id, k.keep_id FROM cm_sources s JOIN keep k ON k.folder_id = s.folder_id
            WHERE s.revoked_at IS NULL AND s.id <> k.keep_id
        )
        UPDATE cm_posts p SET asset_id = ka.id
        FROM cm_assets da JOIN dup ON dup.id = da.source_id
        JOIN cm_assets ka ON ka.source_id = dup.keep_id AND ka.file_id = da.file_id
        WHERE p.asset_id = da.id
    """)
    op.execute("""
        UPDATE cm_sources s SET revoked_at = now()
        WHERE s.revoked_at IS NULL AND EXISTS (
            SELECT 1 FROM cm_sources o WHERE o.folder_id = s.folder_id AND o.revoked_at IS NULL AND o.id < s.id)
    """)
    op.create_index('uq_cm_sources_folder_active', 'cm_sources', ['folder_id'], unique=True,
                    postgresql_where='revoked_at IS NULL')


def downgrade() -> None:
    op.drop_index('uq_cm_sources_folder_active', table_name='cm_sources')
