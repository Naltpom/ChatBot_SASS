"""bot_entitlements + bot_usage_counters

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-20 10:10:00.000000

M3 (spec §1.5 / §1.4) — Création des deux tables côté bot :
- bot_entitlements   : droits d'un bot, projetés depuis Stripe par le webhook
                       (1<->1 avec bots, index UNIQUE bot_id). Absence de ligne =
                       socle gratuit (resolver RÈGLE 2). Index sur
                       stripe_subscription_id.
- bot_usage_counters : report v2 UNIQUEMENT (D7) ; UNIQUE(bot_id, period).

Reflète EXACTEMENT api/src/models/billing.py (BotEntitlement, BotUsageCounter).
Conventions repo : DateTime SANS timezone, server_default=sa.text(...) pour les
NOT NULL ; upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bot_entitlements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.Integer(), nullable=False),
        sa.Column('modules', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('ai_monthly_quota', sa.Integer(), nullable=True),
        sa.Column('overage_mode', sa.String(), nullable=False, server_default=sa.text("'block'")),
        sa.Column('status', sa.String(), nullable=False, server_default=sa.text("'active'")),
        sa.Column('source', sa.String(), nullable=False, server_default=sa.text("'free'")),
        sa.Column('max_kb_sources', sa.Integer(), nullable=True),
        sa.Column('max_actions', sa.Integer(), nullable=True),
        sa.Column('max_mcp_servers', sa.Integer(), nullable=True),
        sa.Column('stripe_subscription_id', sa.String(), nullable=True),
        sa.Column('stripe_item_id', sa.String(), nullable=True),
        sa.Column('synced_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['bot_id'], ['bots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_bot_entitlements_bot_id'),
        'bot_entitlements',
        ['bot_id'],
        unique=True,
    )
    op.create_index(
        op.f('ix_bot_entitlements_stripe_subscription_id'),
        'bot_entitlements',
        ['stripe_subscription_id'],
    )

    op.create_table(
        'bot_usage_counters',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.Integer(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('reported_overage', sa.Integer(), nullable=False, server_default=sa.text("'0'")),
        sa.Column('period_start', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['bot_id'], ['bots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('bot_id', 'period', name='uq_bot_usage_bot_period'),
    )
    op.create_index(
        op.f('ix_bot_usage_counters_bot_id'),
        'bot_usage_counters',
        ['bot_id'],
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_bot_usage_counters_bot_id'), table_name='bot_usage_counters')
    op.drop_table('bot_usage_counters')

    op.drop_index(
        op.f('ix_bot_entitlements_stripe_subscription_id'),
        table_name='bot_entitlements',
    )
    op.drop_index(op.f('ix_bot_entitlements_bot_id'), table_name='bot_entitlements')
    op.drop_table('bot_entitlements')
