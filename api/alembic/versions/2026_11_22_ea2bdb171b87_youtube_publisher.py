"""YouTube « Chapote Publisher » : youtube_accounts + youtube_posts

Revision ID: ea2bdb171b87
Revises: 3ee7fc8426c1
Create Date: 2026-11-22 18:00:00.000000

Module YouTube (Shorts) de l'Espace client, sur le modèle du module TikTok :
mêmes règles de tenant (organisation XOR espace perso), jetons Google chiffrés.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ea2bdb171b87'
down_revision: Union[str, None] = '3ee7fc8426c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'youtube_accounts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), nullable=True),
        sa.Column('connected_by_user_id', sa.Integer(), nullable=True),
        sa.Column('channel_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('handle', sa.String(), nullable=True),
        sa.Column('thumbnail_url', sa.Text(), nullable=True),
        sa.Column('scopes', sa.Text(), nullable=True),
        sa.Column('access_token_enc', sa.Text(), nullable=True),
        sa.Column('refresh_token_enc', sa.Text(), nullable=True),
        sa.Column('access_token_expires_at', sa.DateTime(), nullable=True),
        sa.Column('needs_reconnect', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)',
                           name='ck_youtube_accounts_owner_xor_org'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_youtube_accounts_organization_id', 'youtube_accounts', ['organization_id'])
    op.create_index('ix_youtube_accounts_owner_user_id', 'youtube_accounts', ['owner_user_id'])
    op.create_index('uq_youtube_accounts_org_channel', 'youtube_accounts', ['organization_id', 'channel_id'],
                    unique=True, postgresql_where=sa.text('organization_id IS NOT NULL'))
    op.create_index('uq_youtube_accounts_user_channel', 'youtube_accounts', ['owner_user_id', 'channel_id'],
                    unique=True, postgresql_where=sa.text('owner_user_id IS NOT NULL'))

    op.create_table(
        'youtube_posts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), nullable=True),
        sa.Column('youtube_account_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('category_id', sa.String(), nullable=True),
        sa.Column('default_language', sa.String(), nullable=True),
        sa.Column('privacy_status', sa.String(), nullable=False),
        sa.Column('publish_at', sa.DateTime(), nullable=True),
        sa.Column('made_for_kids', sa.Boolean(), nullable=False),
        sa.Column('synthetic_media', sa.Boolean(), nullable=False),
        sa.Column('notify_subscribers', sa.Boolean(), nullable=False),
        sa.Column('file_name', sa.String(), nullable=True),
        sa.Column('mime_type', sa.String(), nullable=True),
        sa.Column('video_size', sa.BigInteger(), nullable=False),
        sa.Column('received_bytes', sa.BigInteger(), nullable=False),
        sa.Column('duration_sec', sa.Float(), nullable=True),
        sa.Column('tmp_path', sa.String(), nullable=True),
        sa.Column('video_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('upload_status', sa.String(), nullable=True),
        sa.Column('final_privacy', sa.String(), nullable=True),
        sa.Column('fail_reason', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)',
                           name='ck_youtube_posts_owner_xor_org'),
        sa.CheckConstraint("privacy_status IN ('public', 'unlisted', 'private')",
                           name='ck_youtube_posts_privacy'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['youtube_account_id'], ['youtube_accounts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_youtube_posts_organization_id', 'youtube_posts', ['organization_id'])
    op.create_index('ix_youtube_posts_owner_user_id', 'youtube_posts', ['owner_user_id'])
    op.create_index('ix_youtube_posts_youtube_account_id', 'youtube_posts', ['youtube_account_id'])
    op.create_index('ix_youtube_posts_video_id', 'youtube_posts', ['video_id'])
    op.create_index('ix_youtube_posts_status', 'youtube_posts', ['status'])


def downgrade() -> None:
    op.drop_table('youtube_posts')
    op.drop_table('youtube_accounts')
