"""cm : partage par groupe (rôle par groupe, invitations) et nom de l'espace perso

Revision ID: a7c9e1f3b5d2
Revises: f3a5b7c9d1e2
Create Date: 2026-11-25 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a7c9e1f3b5d2'
down_revision: Union[str, None] = 'f3a5b7c9d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_group_shares',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('cm_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='editor'),
        sa.Column('status', sa.String(length=12), nullable=False, server_default='pending'),
        sa.Column('invited_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('responded_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_cm_group_shares_group_id', 'cm_group_shares', ['group_id'])
    op.create_index('ix_cm_group_shares_email', 'cm_group_shares', ['email'])
    op.create_index('uq_cm_group_shares', 'cm_group_shares', ['group_id', 'email'], unique=True)
    op.create_table(
        'cm_profiles',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('perso_name', sa.String(length=80), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('cm_profiles')
    op.drop_index('uq_cm_group_shares', table_name='cm_group_shares')
    op.drop_index('ix_cm_group_shares_email', table_name='cm_group_shares')
    op.drop_index('ix_cm_group_shares_group_id', table_name='cm_group_shares')
    op.drop_table('cm_group_shares')
