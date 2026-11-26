"""TikTok : étiquette « Généré par IA » (post_info.is_aigc)

Revision ID: f4b6d8a0c2e3
Revises: e3a5c7e9f1b2
Create Date: 2026-12-05 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f4b6d8a0c2e3'
down_revision: Union[str, None] = 'e3a5c7e9f1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tiktok_posts', sa.Column('is_aigc', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('tiktok_posts', 'is_aigc')
