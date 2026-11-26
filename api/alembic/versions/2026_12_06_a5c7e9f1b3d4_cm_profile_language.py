"""cm : langue de l'interface (site et app), comme le thème

Revision ID: a5c7e9f1b3d4
Revises: f4b6d8a0c2e3
Create Date: 2026-12-06 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a5c7e9f1b3d4'
down_revision: Union[str, None] = 'f4b6d8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_profiles', sa.Column('language', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('cm_profiles', 'language')
