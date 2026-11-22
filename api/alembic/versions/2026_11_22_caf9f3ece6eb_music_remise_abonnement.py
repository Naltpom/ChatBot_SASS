"""Boutique : remise sur le premier paiement d'un abonnement (codes cumulés)

Revision ID: caf9f3ece6eb
Revises: 07cbb74a8bbf
Create Date: 2026-11-22 21:30:00.000000

- music_subscriptions.first_discount_pct : remise (%) à appliquer au premier paiement ; avec un essai, posée sur
  l'abonnement Stripe juste après sa création (pour viser le premier paiement, pas la facture d'essai à 0 €).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'caf9f3ece6eb'
down_revision: Union[str, None] = '07cbb74a8bbf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('music_subscriptions', sa.Column('first_discount_pct', sa.Integer(), nullable=True))
    op.add_column('music_subscriptions', sa.Column('first_discount_applied', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('music_subscriptions', 'first_discount_applied')
    op.drop_column('music_subscriptions', 'first_discount_pct')
