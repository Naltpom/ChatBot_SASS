"""cm : couverture personnalisée d'une publication

Revision ID: d7a3c9e1f2b4
Revises: c6f2b8d0e1a3
Create Date: 2026-11-23 20:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd7a3c9e1f2b4'
down_revision: Union[str, None] = 'c6f2b8d0e1a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_posts', sa.Column('cover_path', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('cm_posts', 'cover_path')
