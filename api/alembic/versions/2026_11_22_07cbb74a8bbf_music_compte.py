"""Boutique : pseudo du compte et offre de rétention à la première résiliation

Revision ID: 07cbb74a8bbf
Revises: ece860514267
Create Date: 2026-11-22 20:00:00.000000

- users.nickname : pseudo affiché (facultatif) ;
- music_subscriptions.retention_offered_at / retention_accepted_at : l'offre « -50 % sur le prochain paiement »
  n'est proposée qu'une fois par compte, à la première demande de résiliation.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '07cbb74a8bbf'
down_revision: Union[str, None] = 'ece860514267'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('nickname', sa.String(length=40), nullable=True))
    op.add_column('music_subscriptions', sa.Column('retention_offered_at', sa.DateTime(), nullable=True))
    op.add_column('music_subscriptions', sa.Column('retention_accepted_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('music_subscriptions', 'retention_accepted_at')
    op.drop_column('music_subscriptions', 'retention_offered_at')
    op.drop_column('users', 'nickname')
