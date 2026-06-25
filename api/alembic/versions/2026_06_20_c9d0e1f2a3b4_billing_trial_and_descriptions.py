"""billing : essai (bot_entitlements.trial_end) + descriptions (billing_products.description)

Revision ID: c9d0e1f2a3b4
Revises: a7b8c9d0e1f2
Create Date: 2026-06-20 11:00:00.000000

Modèle d'essai 7 j AVEC carte (Checkout) + catalogue avec descriptions commerciales :
- bot_entitlements.trial_end (DateTime, NULLABLE) : fin de l'essai (status='trialing',
  carte posée au Checkout). Au-delà de trial_end -> GATE (resolver) si non débité.
  NULL hors essai. NULLABLE => pas de server_default.
- billing_products.description (String, NULLABLE) : texte commercial poussé sur le
  Product Stripe. NULLABLE => pas de server_default.

Reflète api/src/models/billing.py (BotEntitlement.trial_end, BillingProduct.description).
Conventions repo : DateTime SANS timezone ; upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'bot_entitlements',
        sa.Column('trial_end', sa.DateTime(), nullable=True),
    )
    op.add_column(
        'billing_products',
        sa.Column('description', sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('billing_products', 'description')
    op.drop_column('bot_entitlements', 'trial_end')
