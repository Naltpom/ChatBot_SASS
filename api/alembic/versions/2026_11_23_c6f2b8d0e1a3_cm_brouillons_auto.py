"""cm : brouillons automatiques depuis la bibliothèque (recette par dossier, propositions)

Revision ID: c6f2b8d0e1a3
Revises: b5e1a7c9d0f2
Create Date: 2026-11-23 19:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c6f2b8d0e1a3'
down_revision: Union[str, None] = 'b5e1a7c9d0f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_sources', sa.Column('recipe', sa.JSON(), nullable=True))
    op.add_column('cm_sources', sa.Column('auto_drafts', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('cm_sources', sa.Column('drafts_since', sa.DateTime(), nullable=True))
    op.add_column('cm_assets', sa.Column('cover_file_id', sa.String(length=200), nullable=True))
    op.create_table(
        'cm_proposals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('source_id', sa.Integer(), sa.ForeignKey('cm_sources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('asset_id', sa.Integer(), sa.ForeignKey('cm_assets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('scheduled_at', sa.DateTime(), nullable=True),
        sa.Column('when_from', sa.String(length=10), nullable=True),
        sa.Column('accounts', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=12), nullable=False, server_default='open'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_proposals_owner_xor_org'),
    )
    op.create_index('ix_cm_proposals_organization_id', 'cm_proposals', ['organization_id'])
    op.create_index('ix_cm_proposals_owner_user_id', 'cm_proposals', ['owner_user_id'])
    op.create_index('ix_cm_proposals_source_id', 'cm_proposals', ['source_id'])
    op.create_index('ix_cm_proposals_status', 'cm_proposals', ['status'])
    op.create_index('uq_cm_proposals_asset', 'cm_proposals', ['asset_id'], unique=True)


def downgrade() -> None:
    op.drop_table('cm_proposals')
    op.drop_column('cm_assets', 'cover_file_id')
    op.drop_column('cm_sources', 'drafts_since')
    op.drop_column('cm_sources', 'auto_drafts')
    op.drop_column('cm_sources', 'recipe')
