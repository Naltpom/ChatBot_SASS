"""cm : archivage des publications dans le Drive de l'espace (connexion drive.file)

Revision ID: b2c8e4f6a9d1
Revises: a1b7d3e5f8c2
Create Date: 2026-11-24 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b2c8e4f6a9d1'
down_revision: Union[str, None] = 'a1b7d3e5f8c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_sources', sa.Column('can_upload', sa.Boolean(), nullable=True))
    op.add_column('cm_posts', sa.Column('archive_state', sa.String(length=12), nullable=True))
    op.add_column('cm_posts', sa.Column('archive', sa.JSON(), nullable=True))
    op.add_column('cm_posts', sa.Column('archive_synced_at', sa.DateTime(), nullable=True))
    op.create_index('ix_cm_posts_archive_state', 'cm_posts', ['archive_state'])
    op.create_index('ix_cm_posts_ref_pattern', 'cm_posts', ['ref'], postgresql_ops={'ref': 'varchar_pattern_ops'})
    op.create_table(
        'cm_drive_links',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('connected_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('refresh_token_enc', sa.Text(), nullable=False),
        sa.Column('root_folder_id', sa.String(length=200), nullable=True),
        sa.Column('source_id', sa.Integer(), sa.ForeignKey('cm_sources.id', ondelete='SET NULL'), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_drive_links_owner_xor_org'),
    )
    op.create_index('uq_cm_drive_links_org', 'cm_drive_links', ['organization_id'], unique=True,
                    postgresql_where=sa.text('revoked_at IS NULL AND organization_id IS NOT NULL'))
    op.create_index('uq_cm_drive_links_user', 'cm_drive_links', ['owner_user_id'], unique=True,
                    postgresql_where=sa.text('revoked_at IS NULL AND organization_id IS NULL'))


def downgrade() -> None:
    op.drop_index('uq_cm_drive_links_user', table_name='cm_drive_links')
    op.drop_index('uq_cm_drive_links_org', table_name='cm_drive_links')
    op.drop_table('cm_drive_links')
    op.drop_index('ix_cm_posts_ref_pattern', table_name='cm_posts')
    op.drop_index('ix_cm_posts_archive_state', table_name='cm_posts')
    for c in ('archive_synced_at', 'archive', 'archive_state'):
        op.drop_column('cm_posts', c)
    op.drop_column('cm_sources', 'can_upload')
