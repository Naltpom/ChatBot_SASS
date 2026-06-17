"""drop organizations.plan

Revision ID: a1b2c3d4e5f6
Revises: 960e241f162a
Create Date: 2026-06-16 10:00:00.000000

Suppression de la notion de plan : l'application devient entierement gratuite
et ouverte. Le code provider Stripe reste dormant (colonnes
stripe_customer_id / stripe_subscription_id conservees).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '960e241f162a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('organizations', 'plan')


def downgrade() -> None:
    op.add_column('organizations',
                  sa.Column('plan', sa.String(), nullable=False, server_default='free'))
