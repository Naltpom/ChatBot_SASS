"""user stripe customer & billing fields

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-20 10:00:00.000000

M1 (spec §1.5) — Le Customer Stripe = le User (décision D0/§1.1). On ajoute sur
`users` :
- stripe_customer_id (cus_..., index UNIQUE : 1 customer <-> 1 user, anti-doublon
  webhook) ;
- billing_grouping (per_bot | total | per_org ; server_default 'total') ;
- billing_email (défaut applicatif = user.email).

Facturation DORMANTE aujourd'hui (clés Stripe absentes ⇒ billing_enabled()==False) :
ces colonnes restent NULL/par défaut et n'altèrent en rien le comportement gratuit.

Conventions repo : DateTime SANS timezone, server_default=sa.text(...) pour les
colonnes NOT NULL ajoutées (table non vide), upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('stripe_customer_id', sa.String(), nullable=True))
    op.add_column(
        'users',
        sa.Column(
            'billing_grouping',
            sa.String(),
            nullable=False,
            server_default=sa.text("'total'"),
        ),
    )
    op.add_column('users', sa.Column('billing_email', sa.String(), nullable=True))
    op.create_index(
        op.f('ix_users_stripe_customer_id'),
        'users',
        ['stripe_customer_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_users_stripe_customer_id'), table_name='users')
    op.drop_column('users', 'billing_email')
    op.drop_column('users', 'billing_grouping')
    op.drop_column('users', 'stripe_customer_id')
