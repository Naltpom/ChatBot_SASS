"""cm : bibliothèque Google Drive (cm_sources, cm_assets, cm_posts.asset_id)

Revision ID: c9e5a1f3d4b6
Revises: b8d4f0e2c3a5
Create Date: 2026-11-23 18:00:00.000000

Dossiers Drive partagés avec le robot de Chapote (compte de service) et vidéos qu'ils
contiennent. Une publication peut partir d'une vidéo de la bibliothèque (asset_id) : le
fichier est téléchargé depuis le Drive à l'heure de la publication.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c9e5a1f3d4b6'
down_revision: Union[str, None] = 'b8d4f0e2c3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_sources',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('folder_id', sa.String(length=200), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.Column('drive_id', sa.String(length=200), nullable=True),
        sa.Column('role', sa.String(length=20), nullable=True),
        sa.Column('shared_by', sa.String(length=255), nullable=True),
        sa.Column('verified', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('cm_groups.id', ondelete='SET NULL'), nullable=True),
        sa.Column('move_published', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('published_folder_id', sa.String(length=200), nullable=True),
        sa.Column('last_scan_at', sa.DateTime(), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_sources_owner_xor_org'),
    )
    op.create_index('ix_cm_sources_organization_id', 'cm_sources', ['organization_id'])
    op.create_index('ix_cm_sources_owner_user_id', 'cm_sources', ['owner_user_id'])
    op.create_index('ix_cm_sources_folder_id', 'cm_sources', ['folder_id'])

    op.create_table(
        'cm_assets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_id', sa.Integer(), sa.ForeignKey('cm_sources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_id', sa.String(length=200), nullable=False),
        sa.Column('name', sa.String(length=500), nullable=False),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.BigInteger(), nullable=True),
        sa.Column('md5', sa.String(length=64), nullable=True),
        sa.Column('duration_sec', sa.Float(), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('folder_path', sa.String(length=500), nullable=True),
        sa.Column('parent_id', sa.String(length=200), nullable=True),
        sa.Column('thumbnail_link', sa.Text(), nullable=True),
        sa.Column('drive_created_at', sa.DateTime(), nullable=True),
        sa.Column('drive_modified_at', sa.DateTime(), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('caption_from', sa.String(length=10), nullable=True),
        sa.Column('sidecar_file_id', sa.String(length=200), nullable=True),
        sa.Column('sidecar_modified_at', sa.DateTime(), nullable=True),
        sa.Column('moved_published_at', sa.DateTime(), nullable=True),
        sa.Column('removed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_assets_source_id', 'cm_assets', ['source_id'])
    op.create_index('uq_cm_assets_source_file', 'cm_assets', ['source_id', 'file_id'], unique=True)

    op.add_column('cm_posts', sa.Column('asset_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_cm_posts_asset_id', 'cm_posts', 'cm_assets', ['asset_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_cm_posts_asset_id', 'cm_posts', ['asset_id'])


def downgrade() -> None:
    op.drop_index('ix_cm_posts_asset_id', table_name='cm_posts')
    op.drop_constraint('fk_cm_posts_asset_id', 'cm_posts', type_='foreignkey')
    op.drop_column('cm_posts', 'asset_id')
    op.drop_table('cm_assets')
    op.drop_table('cm_sources')
