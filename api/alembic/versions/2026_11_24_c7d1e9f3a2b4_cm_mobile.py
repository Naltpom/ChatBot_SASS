"""cm : application mobile (appareils connectés, notifications envoyées)

Revision ID: c7d1e9f3a2b4
Revises: b2c8e4f6a9d1
Create Date: 2026-11-24 18:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c7d1e9f3a2b4'
down_revision: Union[str, None] = 'b2c8e4f6a9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_mobile_devices',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=True),
        sa.Column('platform', sa.String(length=20), nullable=True),
        sa.Column('push_token', sa.String(length=255), nullable=True),
        sa.Column('push_prefs', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
    )
    op.create_index('uq_cm_mobile_devices_token', 'cm_mobile_devices', ['token_hash'], unique=True)
    op.create_index('ix_cm_mobile_devices_user_id', 'cm_mobile_devices', ['user_id'])
    op.create_index('ix_cm_mobile_devices_push_token', 'cm_mobile_devices', ['push_token'])
    op.create_table(
        'cm_push_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('ref_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('uq_cm_push_events_key', 'cm_push_events', ['kind', 'ref_id'], unique=True)


def downgrade() -> None:
    op.drop_index('uq_cm_push_events_key', table_name='cm_push_events')
    op.drop_table('cm_push_events')
    op.drop_index('ix_cm_mobile_devices_push_token', table_name='cm_mobile_devices')
    op.drop_index('ix_cm_mobile_devices_user_id', table_name='cm_mobile_devices')
    op.drop_index('uq_cm_mobile_devices_token', table_name='cm_mobile_devices')
    op.drop_table('cm_mobile_devices')
