"""cm : infos.json des vidéos du Drive (archives, réserves, programmées par l'API), référence des publications

Revision ID: a1b7d3e5f8c2
Revises: f9c5e1a3b4d6
Create Date: 2026-11-23 23:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a1b7d3e5f8c2'
down_revision: Union[str, None] = 'f9c5e1a3b4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_assets', sa.Column('meta', sa.JSON(), nullable=True))
    op.add_column('cm_assets', sa.Column('meta_file_id', sa.String(length=200), nullable=True))
    op.add_column('cm_assets', sa.Column('meta_modified_at', sa.DateTime(), nullable=True))
    op.add_column('cm_assets', sa.Column('origin_ref', sa.String(length=200), nullable=True))
    op.add_column('cm_assets', sa.Column('kind', sa.String(length=12), nullable=True))
    op.create_index('ix_cm_assets_origin_ref', 'cm_assets', ['origin_ref'])
    op.add_column('cm_posts', sa.Column('ref', sa.String(length=200), nullable=True))
    op.create_index('ix_cm_posts_ref', 'cm_posts', ['ref'])


def downgrade() -> None:
    op.drop_index('ix_cm_posts_ref', table_name='cm_posts')
    op.drop_column('cm_posts', 'ref')
    op.drop_index('ix_cm_assets_origin_ref', table_name='cm_assets')
    for c in ('kind', 'origin_ref', 'meta_modified_at', 'meta_file_id', 'meta'):
        op.drop_column('cm_assets', c)
