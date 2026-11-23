"""TikTok : pseudo du compte (nom lisible « tiktok:@pseudo » dans cm)

Revision ID: f9c5e1a3b4d6
Revises: e8b4d0f2a3c5
Create Date: 2026-11-23 22:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f9c5e1a3b4d6'
down_revision: Union[str, None] = 'e8b4d0f2a3c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tiktok_accounts', sa.Column('username', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('tiktok_accounts', 'username')
