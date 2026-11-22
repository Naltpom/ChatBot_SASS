"""Boutique : trois formules d'abonnement (semaine, mois, an) et essai porté par un code de réduction

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-11-22 18:00:00.000000

- music_settings : sub_weekly_cents passe à 499, + sub_monthly_cents (799) et sub_yearly_cents (4999) ;
- music_subscriptions.plan (week | month | year) ;
- music_promo_codes.trial_days : un code de réduction peut aussi ouvrir un essai d'abonnement ;
  INSTA20 = -20 % sur une partition et 48 h d'essai sur un abonnement.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('music_settings', sa.Column('sub_monthly_cents', sa.Integer(), nullable=False, server_default='799'))
    op.add_column('music_settings', sa.Column('sub_yearly_cents', sa.Integer(), nullable=False, server_default='4999'))
    op.execute("UPDATE music_settings SET sub_weekly_cents = 499 WHERE sub_weekly_cents = 1400")
    op.add_column('music_subscriptions', sa.Column('plan', sa.String(length=10), nullable=False, server_default='week'))
    op.add_column('music_promo_codes', sa.Column('trial_days', sa.Integer(), nullable=True))
    op.execute("UPDATE music_promo_codes SET trial_days = 2 WHERE code = 'INSTA20'")


def downgrade() -> None:
    op.drop_column('music_promo_codes', 'trial_days')
    op.drop_column('music_subscriptions', 'plan')
    op.drop_column('music_settings', 'sub_yearly_cents')
    op.drop_column('music_settings', 'sub_monthly_cents')
