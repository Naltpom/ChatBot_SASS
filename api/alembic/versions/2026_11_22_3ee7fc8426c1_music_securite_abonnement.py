"""Boutique : sécurité de l'abonnement (audit du 22/11/2026)

Revision ID: 3ee7fc8426c1
Revises: de965d03a8e8
Create Date: 2026-11-22 23:50:00.000000

- music_promo_codes.applies_to : sheet | sub | both (INSTA20 = both, codes d'essai = sub, autres = sheet) ;
- music_subscriptions.trial_requested (essai demandé, compté même avant le webhook) et card_fingerprint
  (une carte ne sert qu'à un seul essai).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '3ee7fc8426c1'
down_revision: Union[str, None] = 'de965d03a8e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('music_promo_codes', sa.Column('applies_to', sa.String(length=10), nullable=False, server_default='sheet'))
    op.execute("UPDATE music_promo_codes SET applies_to = 'both' WHERE code = 'INSTA20'")
    op.execute("UPDATE music_promo_codes SET applies_to = 'sub' WHERE kind = 'trial'")
    op.add_column('music_subscriptions', sa.Column('trial_requested', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('music_subscriptions', sa.Column('card_fingerprint', sa.String(length=64), nullable=True))
    op.create_index('ix_music_subscriptions_card_fingerprint', 'music_subscriptions', ['card_fingerprint'])


def downgrade() -> None:
    op.drop_index('ix_music_subscriptions_card_fingerprint', table_name='music_subscriptions')
    op.drop_column('music_subscriptions', 'card_fingerprint')
    op.drop_column('music_subscriptions', 'trial_requested')
    op.drop_column('music_promo_codes', 'applies_to')
