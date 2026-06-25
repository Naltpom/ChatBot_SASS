"""billing_subscriptions + billing_products + billing_webhook_events

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-20 10:15:00.000000

M4 (spec §1.5 / §1.4) — TÊTE FINALE de la chaîne billing. Création des trois
tables de pilotage :
- billing_subscriptions : miroir local des subscriptions Stripe (multi-sub sous
                          1 customer = le User). UNIQUE(stripe_subscription_id).
- billing_products      : catalogue piloté en base (plus de STRIPE_PRICE_* en
                          .env). UNIQUE(code), index stripe_price_id.
- billing_webhook_events: idempotence webhook (UNIQUE stripe_event_id).

Reflète EXACTEMENT api/src/models/billing.py (BillingSubscription,
BillingProduct, BillingWebhookEvent).
Conventions repo : DateTime SANS timezone, server_default=sa.text(...) pour les
NOT NULL booléens ; upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'billing_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('stripe_subscription_id', sa.String(), nullable=False),
        sa.Column('grouping', sa.String(), nullable=False),
        sa.Column('scope_kind', sa.String(), nullable=False),
        sa.Column('scope_bot_id', sa.Integer(), nullable=True),
        sa.Column('scope_org_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('current_period_start', sa.DateTime(), nullable=True),
        sa.Column('current_period_end', sa.DateTime(), nullable=True),
        sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column('raw_items', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scope_bot_id'], ['bots.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scope_org_id'], ['organizations.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_billing_subscriptions_user_id'),
        'billing_subscriptions',
        ['user_id'],
    )
    op.create_index(
        op.f('ix_billing_subscriptions_stripe_subscription_id'),
        'billing_subscriptions',
        ['stripe_subscription_id'],
        unique=True,
    )
    op.create_index(
        op.f('ix_billing_subscriptions_scope_bot_id'),
        'billing_subscriptions',
        ['scope_bot_id'],
    )
    op.create_index(
        op.f('ix_billing_subscriptions_scope_org_id'),
        'billing_subscriptions',
        ['scope_org_id'],
    )

    op.create_table(
        'billing_products',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('included_replies', sa.Integer(), nullable=True),
        sa.Column('stripe_product_id', sa.String(), nullable=True),
        sa.Column('stripe_price_id', sa.String(), nullable=True),
        sa.Column('unit_amount', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False),
        sa.Column('interval', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_billing_products_code'),
        'billing_products',
        ['code'],
        unique=True,
    )
    op.create_index(
        op.f('ix_billing_products_stripe_price_id'),
        'billing_products',
        ['stripe_price_id'],
    )

    op.create_table(
        'billing_webhook_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('stripe_event_id', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('received_at', sa.DateTime(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_billing_webhook_events_stripe_event_id'),
        'billing_webhook_events',
        ['stripe_event_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_billing_webhook_events_stripe_event_id'),
        table_name='billing_webhook_events',
    )
    op.drop_table('billing_webhook_events')

    op.drop_index(op.f('ix_billing_products_stripe_price_id'), table_name='billing_products')
    op.drop_index(op.f('ix_billing_products_code'), table_name='billing_products')
    op.drop_table('billing_products')

    op.drop_index(op.f('ix_billing_subscriptions_scope_org_id'), table_name='billing_subscriptions')
    op.drop_index(op.f('ix_billing_subscriptions_scope_bot_id'), table_name='billing_subscriptions')
    op.drop_index(
        op.f('ix_billing_subscriptions_stripe_subscription_id'),
        table_name='billing_subscriptions',
    )
    op.drop_index(op.f('ix_billing_subscriptions_user_id'), table_name='billing_subscriptions')
    op.drop_table('billing_subscriptions')
