"""cm : adresses Google associées (relier automatiquement les dossiers Drive partagés)

Revision ID: d1f6b2a4e5c7
Revises: c9e5a1f3d4b6
Create Date: 2026-11-23 20:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd1f6b2a4e5c7'
down_revision: Union[str, None] = 'c9e5a1f3d4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_google_identities',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('google_sub', sa.String(length=100), nullable=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_google_identities_user_id', 'cm_google_identities', ['user_id'])
    op.create_index('uq_cm_google_identities_email', 'cm_google_identities', ['email'], unique=True)


def downgrade() -> None:
    op.drop_table('cm_google_identities')
