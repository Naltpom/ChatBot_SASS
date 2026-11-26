"""cm : brouillons préparés par l'assistant (réglages par compte, origine)

Revision ID: c7e9a1b3d5f6
Revises: b6d8f0a2c4e5
Create Date: 2026-12-08 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c7e9a1b3d5f6'
down_revision: Union[str, None] = 'b6d8f0a2c4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_proposals', sa.Column('options', sa.JSON(), nullable=True))
    op.add_column('cm_proposals', sa.Column('origin', sa.String(length=12), nullable=True))


def downgrade() -> None:
    op.drop_column('cm_proposals', 'origin')
    op.drop_column('cm_proposals', 'options')
