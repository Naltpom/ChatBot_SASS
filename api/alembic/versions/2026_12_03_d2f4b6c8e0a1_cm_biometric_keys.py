"""cm : empreinte gérée par l'app mobile (clé dans la puce sécurisée), à la place du code de double authentification

Revision ID: d2f4b6c8e0a1
Revises: c1e3a5b7d9f2
Create Date: 2026-12-03 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd2f4b6c8e0a1'
down_revision: Union[str, None] = 'c1e3a5b7d9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_biometric_keys',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=True),
        sa.Column('secret_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_cm_biometric_keys_user_id', 'cm_biometric_keys', ['user_id'])


def downgrade() -> None:
    op.drop_table('cm_biometric_keys')
