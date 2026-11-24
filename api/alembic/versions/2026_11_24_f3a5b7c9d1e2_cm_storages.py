"""cm : plusieurs stockages par espace (nom, ordre, attribution à des comptes ou groupes)

Revision ID: f3a5b7c9d1e2
Revises: e2f4a6c8d0b1
Create Date: 2026-11-24 23:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f3a5b7c9d1e2'
down_revision: Union[str, None] = 'e2f4a6c8d0b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('uq_cm_drive_links_user', table_name='cm_drive_links')
    op.drop_index('uq_cm_drive_links_org', table_name='cm_drive_links')
    op.add_column('cm_drive_links', sa.Column('name', sa.String(length=80), nullable=True))
    op.add_column('cm_drive_links', sa.Column('position', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cm_drive_links', sa.Column('assign', sa.JSON(), nullable=True))
    op.create_index('ix_cm_drive_links_org', 'cm_drive_links', ['organization_id'])
    op.create_index('ix_cm_drive_links_user', 'cm_drive_links', ['owner_user_id'])


def downgrade() -> None:
    op.drop_index('ix_cm_drive_links_user', table_name='cm_drive_links')
    op.drop_index('ix_cm_drive_links_org', table_name='cm_drive_links')
    for c in ('assign', 'position', 'name'):
        op.drop_column('cm_drive_links', c)
    op.create_index('uq_cm_drive_links_org', 'cm_drive_links', ['organization_id'], unique=True,
                    postgresql_where=sa.text('revoked_at IS NULL AND organization_id IS NOT NULL'))
    op.create_index('uq_cm_drive_links_user', 'cm_drive_links', ['owner_user_id'], unique=True,
                    postgresql_where=sa.text('revoked_at IS NULL AND organization_id IS NULL'))
