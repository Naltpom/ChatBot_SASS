"""billing_products.intro_percent / intro_coupon_id : remise d'intro 1er mois éditable

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-06-25 12:00:00.000000

Sort la remise d'intro (1er mois remisé) du CODE vers la BASE (éditable depuis
l'admin catalogue) :
- billing_products.intro_percent (Integer, NULLABLE) : % de remise du 1er mois,
  porté par les paliers IA (ai_*) et par 'base' (= défaut IA off / BYOK). NULL
  ailleurs (pas de remise).
- billing_products.intro_coupon_id (String, NULLABLE) : id du coupon Stripe
  `duration:once` correspondant (rotation à chaque changement de %).

NULLABLE => pas de server_default. upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('billing_products', sa.Column('intro_percent', sa.Integer(), nullable=True))
    op.add_column('billing_products', sa.Column('intro_coupon_id', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('billing_products', 'intro_coupon_id')
    op.drop_column('billing_products', 'intro_percent')
