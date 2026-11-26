"""TikTok : miniature choisie par un instant de la vidéo (post_info.video_cover_timestamp_ms)

Revision ID: e3a5c7e9f1b2
Revises: d2f4b6c8e0a1
Create Date: 2026-12-04 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e3a5c7e9f1b2'
down_revision: Union[str, None] = 'd2f4b6c8e0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tiktok_posts', sa.Column('cover_timestamp_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('tiktok_posts', 'cover_timestamp_ms')
