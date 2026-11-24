"""cm : stockage Drive obligatoire (quota, conservation, alertes)

Revision ID: e2f4a6c8d0b1
Revises: d9e3f5a7b2c4
Create Date: 2026-11-24 21:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e2f4a6c8d0b1'
down_revision: Union[str, None] = 'd9e3f5a7b2c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_drive_links', sa.Column('quota_gb', sa.Integer(), nullable=True))
    op.add_column('cm_drive_links', sa.Column('retention', sa.String(length=24), nullable=False, server_default='keep'))
    op.add_column('cm_drive_links', sa.Column('delete_after_days', sa.Integer(), nullable=True))
    op.add_column('cm_drive_links', sa.Column('drive_limit', sa.BigInteger(), nullable=True))
    op.add_column('cm_drive_links', sa.Column('drive_usage', sa.BigInteger(), nullable=True))
    op.add_column('cm_drive_links', sa.Column('drive_checked_at', sa.DateTime(), nullable=True))
    op.add_column('cm_drive_links', sa.Column('storage_alert', sa.String(length=16), nullable=True))
    op.add_column('cm_drive_links', sa.Column('storage_alert_seq', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cm_drive_links', sa.Column('storage_alert_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    for c in ('storage_alert_at', 'storage_alert_seq', 'storage_alert', 'drive_checked_at', 'drive_usage',
              'drive_limit', 'delete_after_days', 'retention', 'quota_gb'):
        op.drop_column('cm_drive_links', c)
