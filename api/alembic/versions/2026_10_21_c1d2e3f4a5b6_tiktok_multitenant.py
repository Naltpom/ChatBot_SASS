"""TikTok multi-tenant : tiktok_accounts scopés par tenant + tiktok_posts

Revision ID: c1d2e3f4a5b6
Revises: a9b0c1d2e3f4
Create Date: 2026-10-21 10:00:00.000000

Le module TikTok passe d'un outil réservé au superadmin à un module de
l'Espace client. Les anciennes tables (sans tenant) sont SUPPRIMÉES : les
comptes existants sont reconnectés via le nouveau flux OAuth (aucune reprise
de jetons). Même ownership polymorphe que `bots` (organisation XOR perso).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_tiktok_publishes_open_id', table_name='tiktok_publishes')
    op.drop_index('ix_tiktok_publishes_publish_id', table_name='tiktok_publishes')
    op.drop_table('tiktok_publishes')
    op.drop_index('ix_tiktok_accounts_open_id', table_name='tiktok_accounts')
    op.drop_table('tiktok_accounts')

    op.create_table(
        'tiktok_accounts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), nullable=True),
        sa.Column('connected_by_user_id', sa.Integer(), nullable=True),
        sa.Column('open_id', sa.String(), nullable=False),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('avatar_url', sa.Text(), nullable=True),
        sa.Column('scopes', sa.String(), nullable=True),
        sa.Column('access_token_enc', sa.Text(), nullable=True),
        sa.Column('refresh_token_enc', sa.Text(), nullable=True),
        sa.Column('access_token_expires_at', sa.DateTime(), nullable=True),
        sa.Column('refresh_token_expires_at', sa.DateTime(), nullable=True),
        sa.Column('needs_reconnect', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)',
                           name='ck_tiktok_accounts_owner_xor_org'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tiktok_accounts_organization_id', 'tiktok_accounts', ['organization_id'])
    op.create_index('ix_tiktok_accounts_owner_user_id', 'tiktok_accounts', ['owner_user_id'])
    op.create_index('uq_tiktok_accounts_org_open_id', 'tiktok_accounts', ['organization_id', 'open_id'],
                    unique=True, postgresql_where=sa.text('organization_id IS NOT NULL'))
    op.create_index('uq_tiktok_accounts_user_open_id', 'tiktok_accounts', ['owner_user_id', 'open_id'],
                    unique=True, postgresql_where=sa.text('owner_user_id IS NOT NULL'))

    op.create_table(
        'tiktok_posts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), nullable=True),
        sa.Column('tiktok_account_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('privacy_level', sa.String(), nullable=True),
        sa.Column('disable_comment', sa.Boolean(), nullable=False),
        sa.Column('disable_duet', sa.Boolean(), nullable=False),
        sa.Column('disable_stitch', sa.Boolean(), nullable=False),
        sa.Column('brand_organic', sa.Boolean(), nullable=False),
        sa.Column('brand_content', sa.Boolean(), nullable=False),
        sa.Column('file_name', sa.String(), nullable=True),
        sa.Column('mime_type', sa.String(), nullable=True),
        sa.Column('video_size', sa.BigInteger(), nullable=False),
        sa.Column('received_bytes', sa.BigInteger(), nullable=False),
        sa.Column('duration_sec', sa.Float(), nullable=True),
        sa.Column('tmp_path', sa.String(), nullable=True),
        sa.Column('publish_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('fail_reason', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('post_ids', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)',
                           name='ck_tiktok_posts_owner_xor_org'),
        sa.CheckConstraint("mode IN ('direct', 'draft')", name='ck_tiktok_posts_mode'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tiktok_account_id'], ['tiktok_accounts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tiktok_posts_organization_id', 'tiktok_posts', ['organization_id'])
    op.create_index('ix_tiktok_posts_owner_user_id', 'tiktok_posts', ['owner_user_id'])
    op.create_index('ix_tiktok_posts_tiktok_account_id', 'tiktok_posts', ['tiktok_account_id'])
    op.create_index('ix_tiktok_posts_publish_id', 'tiktok_posts', ['publish_id'])
    op.create_index('ix_tiktok_posts_status', 'tiktok_posts', ['status'])


def downgrade() -> None:
    # Retour au schéma « outil privé » (vide : les données multi-tenant ne se
    # projettent pas sur l'ancien modèle).
    op.drop_table('tiktok_posts')
    op.drop_table('tiktok_accounts')
    op.create_table(
        'tiktok_accounts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('open_id', sa.String(), nullable=False),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('avatar_url', sa.Text(), nullable=True),
        sa.Column('scope', sa.String(), nullable=True),
        sa.Column('access_token_enc', sa.Text(), nullable=False),
        sa.Column('refresh_token_enc', sa.Text(), nullable=False),
        sa.Column('access_expires_at', sa.DateTime(), nullable=False),
        sa.Column('refresh_expires_at', sa.DateTime(), nullable=False),
        sa.Column('connected_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['connected_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tiktok_accounts_open_id', 'tiktok_accounts', ['open_id'], unique=True)
    op.create_table(
        'tiktok_publishes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('publish_id', sa.String(), nullable=False),
        sa.Column('open_id', sa.String(), nullable=False),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('privacy_level', sa.String(), nullable=False),
        sa.Column('upload_url_enc', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(), nullable=False),
        sa.Column('video_size', sa.BigInteger(), nullable=False),
        sa.Column('chunk_size', sa.BigInteger(), nullable=False),
        sa.Column('total_chunk_count', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default=sa.text("'UPLOADING'")),
        sa.Column('fail_reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['open_id'], ['tiktok_accounts.open_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tiktok_publishes_publish_id', 'tiktok_publishes', ['publish_id'], unique=True)
    op.create_index('ix_tiktok_publishes_open_id', 'tiktok_publishes', ['open_id'])
