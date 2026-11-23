"""cm.chapote.fr : index cm_videos (compte, date de publication)

Revision ID: b8d4f0e2c3a5
Revises: a7c3e9d1b2f4
Create Date: 2026-11-23 20:00:00.000000

Le calendrier, les statistiques et la liste paginée des vidéos filtrent par compte
et trient ou bornent par date de publication.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b8d4f0e2c3a5'
down_revision: Union[str, None] = 'a7c3e9d1b2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_cm_videos_account_published', 'cm_videos', ['platform', 'account_id', 'published_at'])


def downgrade() -> None:
    op.drop_index('ix_cm_videos_account_published', table_name='cm_videos')
