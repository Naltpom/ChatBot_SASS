"""cm : liens d'invitation de groupe, jours d'ouverture de l'app mobile

Revision ID: e6a8c0d2f4b7
Revises: d5f7b9c1e3a6
Create Date: 2026-11-28 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e6a8c0d2f4b7'
down_revision: Union[str, None] = 'd5f7b9c1e3a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_group_invite_links',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('cm_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('uses', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('uq_cm_group_invite_links_token', 'cm_group_invite_links', ['token_hash'], unique=True)
    op.create_index('ix_cm_group_invite_links_group_id', 'cm_group_invite_links', ['group_id'])
    op.create_table(
        'cm_app_opens',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'day'),
    )


def downgrade() -> None:
    op.drop_table('cm_app_opens')
    op.drop_index('ix_cm_group_invite_links_group_id', table_name='cm_group_invite_links')
    op.drop_index('uq_cm_group_invite_links_token', table_name='cm_group_invite_links')
    op.drop_table('cm_group_invite_links')
