"""cm : rôles des membres d'équipe et transferts de comptes

Revision ID: e2a7c3b5f6d8
Revises: d1f6b2a4e5c7
Create Date: 2026-11-23 22:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e2a7c3b5f6d8'
down_revision: Union[str, None] = 'd1f6b2a4e5c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_member_roles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('group_ids', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_member_roles_organization_id', 'cm_member_roles', ['organization_id'])
    op.create_index('uq_cm_member_roles_org_email', 'cm_member_roles', ['organization_id', 'email'], unique=True)

    op.create_table(
        'cm_transfers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('from_organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('from_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('to_email', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_transfers_to_email', 'cm_transfers', ['to_email'])


def downgrade() -> None:
    op.drop_table('cm_transfers')
    op.drop_table('cm_member_roles')
