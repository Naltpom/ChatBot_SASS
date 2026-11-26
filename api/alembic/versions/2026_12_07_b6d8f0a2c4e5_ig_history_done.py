"""cm : historique Instagram d'avant le 1er relevé récupéré (instagram_accounts.history_done)

Revision ID: b6d8f0a2c4e5
Revises: a5c7e9f1b3d4
Create Date: 2026-12-07 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b6d8f0a2c4e5'
down_revision: Union[str, None] = 'a5c7e9f1b3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('instagram_accounts', sa.Column('history_done', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('instagram_accounts', 'history_done')
