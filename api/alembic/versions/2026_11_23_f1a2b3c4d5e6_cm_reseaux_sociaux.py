"""cm.chapote.fr : instagram_accounts, cm_posts, cm_targets, cm_videos, cm_account_stats

Revision ID: f1a2b3c4d5e6
Revises: ea2bdb171b87
Create Date: 2026-11-23 09:00:00.000000

Gestion des réseaux sociaux : comptes Instagram (connexion officielle ou gérés
par la routine), publications programmées sur plusieurs comptes, vidéos et
relevés quotidiens des comptes. Mêmes règles de tenant que TikTok / YouTube.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'ea2bdb171b87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tenant_cols():
    return [
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'instagram_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        *_tenant_cols(),
        sa.Column('connected_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('mode', sa.String(length=20), nullable=False),
        sa.Column('ig_user_id', sa.String(), nullable=True),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('profile_picture_url', sa.Text(), nullable=True),
        sa.Column('account_type', sa.String(), nullable=True),
        sa.Column('scopes', sa.Text(), nullable=True),
        sa.Column('access_token_enc', sa.Text(), nullable=True),
        sa.Column('access_token_expires_at', sa.DateTime(), nullable=True),
        sa.Column('needs_reconnect', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)',
                           name='ck_instagram_accounts_owner_xor_org'),
    )
    op.create_index('ix_instagram_accounts_organization_id', 'instagram_accounts', ['organization_id'])
    op.create_index('ix_instagram_accounts_owner_user_id', 'instagram_accounts', ['owner_user_id'])

    op.create_table(
        'cm_posts',
        sa.Column('id', sa.Integer(), primary_key=True),
        *_tenant_cols(),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('file_name', sa.String(), nullable=True),
        sa.Column('mime_type', sa.String(), nullable=True),
        sa.Column('video_size', sa.BigInteger(), nullable=False),
        sa.Column('received_bytes', sa.BigInteger(), nullable=False),
        sa.Column('duration_sec', sa.Float(), nullable=True),
        sa.Column('media_path', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_posts_owner_xor_org'),
    )
    op.create_index('ix_cm_posts_organization_id', 'cm_posts', ['organization_id'])
    op.create_index('ix_cm_posts_owner_user_id', 'cm_posts', ['owner_user_id'])
    op.create_index('ix_cm_posts_status', 'cm_posts', ['status'])

    op.create_table(
        'cm_targets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('post_id', sa.Integer(), sa.ForeignKey('cm_posts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(), nullable=False),
        sa.Column('options', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('tiktok_post_id', sa.Integer(), sa.ForeignKey('tiktok_posts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('youtube_post_id', sa.Integer(), sa.ForeignKey('youtube_posts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('ig_container_id', sa.String(), nullable=True),
        sa.Column('external_id', sa.String(), nullable=True),
        sa.Column('url', sa.Text(), nullable=True),
        sa.Column('fail_reason', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('notice', sa.Text(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('claimed_at', sa.DateTime(), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_targets_post_id', 'cm_targets', ['post_id'])
    op.create_index('ix_cm_targets_status', 'cm_targets', ['status'])
    op.create_index('ix_cm_targets_due', 'cm_targets', ['status', 'scheduled_at'])

    op.create_table(
        'cm_videos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('external_id', sa.String(), nullable=False),
        sa.Column('target_id', sa.Integer(), sa.ForeignKey('cm_targets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('url', sa.Text(), nullable=True),
        sa.Column('thumbnail_url', sa.Text(), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('duration_sec', sa.Float(), nullable=True),
        sa.Column('views', sa.BigInteger(), nullable=True),
        sa.Column('likes', sa.BigInteger(), nullable=True),
        sa.Column('comments', sa.BigInteger(), nullable=True),
        sa.Column('shares', sa.BigInteger(), nullable=True),
        sa.Column('saves', sa.BigInteger(), nullable=True),
        sa.Column('stats_updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('uq_cm_videos_account_external', 'cm_videos', ['platform', 'account_id', 'external_id'],
                    unique=True)

    op.create_table(
        'cm_account_stats',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('followers', sa.BigInteger(), nullable=True),
        sa.Column('views', sa.BigInteger(), nullable=True),
        sa.Column('likes', sa.BigInteger(), nullable=True),
        sa.Column('videos', sa.Integer(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('uq_cm_account_stats_day', 'cm_account_stats', ['platform', 'account_id', 'day'], unique=True)


def downgrade() -> None:
    op.drop_table('cm_account_stats')
    op.drop_table('cm_videos')
    op.drop_table('cm_targets')
    op.drop_table('cm_posts')
    op.drop_table('instagram_accounts')
