"""cm : boîte de réception des commentaires

Revision ID: e8b4d0f2a3c5
Revises: d7a3c9e1f2b4
Create Date: 2026-11-23 21:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e8b4d0f2a3c5'
down_revision: Union[str, None] = 'd7a3c9e1f2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_comments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('media_id', sa.String(length=100), nullable=True),
        sa.Column('video_title', sa.String(length=300), nullable=True),
        sa.Column('video_url', sa.Text(), nullable=True),
        sa.Column('external_id', sa.String(length=100), nullable=False),
        sa.Column('parent_external_id', sa.String(length=100), nullable=True),
        sa.Column('author', sa.String(length=150), nullable=True),
        sa.Column('author_id', sa.String(length=100), nullable=True),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('like_count', sa.Integer(), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False, server_default='new'),
        sa.Column('reply_text', sa.Text(), nullable=True),
        sa.Column('replied_at', sa.DateTime(), nullable=True),
        sa.Column('replied_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('private_replied_at', sa.DateTime(), nullable=True),
        sa.Column('pending_action', sa.JSON(), nullable=True),
        sa.Column('action_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_comments_owner_xor_org'),
    )
    op.create_index('ix_cm_comments_organization_id', 'cm_comments', ['organization_id'])
    op.create_index('ix_cm_comments_owner_user_id', 'cm_comments', ['owner_user_id'])
    op.create_index('ix_cm_comments_status', 'cm_comments', ['status'])
    op.create_index('uq_cm_comments_ext', 'cm_comments', ['platform', 'account_id', 'external_id'], unique=True)
    op.create_index('ix_cm_comments_inbox', 'cm_comments', ['platform', 'account_id', 'status', 'published_at'])
    op.execute("CREATE INDEX IF NOT EXISTS ix_cm_comments_text_trgm ON cm_comments USING gin (text gin_trgm_ops)")


def downgrade() -> None:
    op.drop_table('cm_comments')
