"""cm.chapote.fr : groupes de comptes (cm_groups, cm_group_accounts)

Revision ID: a7c3e9d1b2f4
Revises: f1a2b3c4d5e6
Create Date: 2026-11-23 18:00:00.000000

Un groupe réunit plusieurs comptes (TikTok, YouTube, Instagram) d'un même
tenant ; un compte peut être dans plusieurs groupes. Mêmes règles de tenant
que les autres tables cm (organisation XOR espace perso).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a7c3e9d1b2f4'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True),
        sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('(owner_user_id IS NULL) <> (organization_id IS NULL)', name='ck_cm_groups_owner_xor_org'),
    )
    op.create_index('ix_cm_groups_organization_id', 'cm_groups', ['organization_id'])
    op.create_index('ix_cm_groups_owner_user_id', 'cm_groups', ['owner_user_id'])

    op.create_table(
        'cm_group_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('cm_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_group_accounts_group_id', 'cm_group_accounts', ['group_id'])
    op.create_index('uq_cm_group_accounts', 'cm_group_accounts', ['group_id', 'platform', 'account_id'], unique=True)


def downgrade() -> None:
    op.drop_index('uq_cm_group_accounts', table_name='cm_group_accounts')
    op.drop_index('ix_cm_group_accounts_group_id', table_name='cm_group_accounts')
    op.drop_table('cm_group_accounts')
    op.drop_index('ix_cm_groups_owner_user_id', table_name='cm_groups')
    op.drop_index('ix_cm_groups_organization_id', table_name='cm_groups')
    op.drop_table('cm_groups')
