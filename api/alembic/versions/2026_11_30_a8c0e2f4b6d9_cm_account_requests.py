"""cm : demandes de reprise d'un compte (accord de l'espace actuel, ou réclamation au support)

Revision ID: a8c0e2f4b6d9
Revises: f7b9d1e3a5c8
Create Date: 2026-11-30 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a8c0e2f4b6d9'
down_revision: Union[str, None] = 'f7b9d1e3a5c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_account_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('requester_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('dest_organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('from_organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('from_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('disputed_at', sa.DateTime(), nullable=True),
        sa.Column('dispute_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_account_requests_requester_user_id', 'cm_account_requests', ['requester_user_id'])
    op.create_index('ix_cm_account_requests_from_organization_id', 'cm_account_requests', ['from_organization_id'])
    op.create_index('ix_cm_account_requests_from_user_id', 'cm_account_requests', ['from_user_id'])


def downgrade() -> None:
    op.drop_table('cm_account_requests')
