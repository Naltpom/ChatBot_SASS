"""tiktok_accounts + tiktok_publishes (outil privé « Chapote Publisher »)

Revision ID: a9b0c1d2e3f4
Revises: b5c6d7e8f9a0
Create Date: 2026-10-15 12:00:00.000000

Comptes TikTok connectés (jetons OAuth chiffrés) et publications Direct Post
en cours (upload_url pré-signée chiffrée + plan de découpage en chunks).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, None] = 'b5c6d7e8f9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index('ix_tiktok_publishes_open_id', table_name='tiktok_publishes')
    op.drop_index('ix_tiktok_publishes_publish_id', table_name='tiktok_publishes')
    op.drop_table('tiktok_publishes')
    op.drop_index('ix_tiktok_accounts_open_id', table_name='tiktok_accounts')
    op.drop_table('tiktok_accounts')
