"""cm : réponses aux questions courtes de l'app mobile (abandon)

Revision ID: f7b9d1e3a5c8
Revises: e6a8c0d2f4b7
Create Date: 2026-11-29 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f7b9d1e3a5c8'
down_revision: Union[str, None] = 'e6a8c0d2f4b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cm_feedback',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('context', sa.String(length=40), nullable=False),
        sa.Column('reason', sa.String(length=40), nullable=True),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_cm_feedback_user_id', 'cm_feedback', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_cm_feedback_user_id', table_name='cm_feedback')
    op.drop_table('cm_feedback')
