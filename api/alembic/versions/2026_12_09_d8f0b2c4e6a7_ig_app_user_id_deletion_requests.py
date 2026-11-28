"""cm : ID « app-scoped » Instagram (rappels Meta) et suivi des demandes de suppression des données

Revision ID: d8f0b2c4e6a7
Revises: c7e9a1b3d5f6
Create Date: 2026-12-09 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd8f0b2c4e6a7'
down_revision: Union[str, None] = 'c7e9a1b3d5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('instagram_accounts', sa.Column('ig_app_user_id', sa.String(), nullable=True))
    op.create_index('ix_instagram_accounts_ig_app_user_id', 'instagram_accounts', ['ig_app_user_id'])
    op.create_table(
        'ig_deletion_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('accounts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='received'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_ig_deletion_requests_code', 'ig_deletion_requests', ['code'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_ig_deletion_requests_code', table_name='ig_deletion_requests')
    op.drop_table('ig_deletion_requests')
    op.drop_index('ix_instagram_accounts_ig_app_user_id', table_name='instagram_accounts')
    op.drop_column('instagram_accounts', 'ig_app_user_id')
