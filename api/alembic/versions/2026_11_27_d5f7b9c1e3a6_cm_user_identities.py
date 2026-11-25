"""cm : informations d'inscription de l'app mobile (nom, date de naissance, conditions acceptées)

Revision ID: d5f7b9c1e3a6
Revises: c4e6a8b0d2f4
Create Date: 2026-11-27 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd5f7b9c1e3a6'
down_revision: Union[str, None] = 'c4e6a8b0d2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_user_identities',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('first_name', sa.String(length=80), nullable=False),
        sa.Column('last_name', sa.String(length=80), nullable=False),
        sa.Column('birth_date', sa.Date(), nullable=False),
        sa.Column('terms_version', sa.String(length=20), nullable=False),
        sa.Column('terms_accepted_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('cm_user_identities')
