"""Boutique : abonnement « toutes les partitions » (test A/B) et code d'essai ESSAI48

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-11-22 16:00:00.000000

- music_subscriptions, music_sub_downloads ;
- music_settings.sub_weekly_cents (1400 = 14 €/semaine) ;
- music_track_links.variant (sheet | sub) ;
- code ESSAI48 (essai de 2 jours, seulement pour l'abonnement).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'b6c7d8e9f0a1'
down_revision: Union[str, None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('music_settings', sa.Column('sub_weekly_cents', sa.Integer(), nullable=False, server_default='1400'))
    op.add_column('music_track_links', sa.Column('variant', sa.String(length=10), nullable=True))
    op.create_table(
        'music_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('stripe_subscription_id', sa.String(length=255), nullable=True),
        sa.Column('stripe_customer_id', sa.String(length=255), nullable=True),
        sa.Column('stripe_session_id', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('weekly_cents', sa.Integer(), nullable=False),
        sa.Column('trial_end', sa.DateTime(), nullable=True),
        sa.Column('current_period_end', sa.DateTime(), nullable=True),
        sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('promo_code', sa.String(length=40), nullable=True),
        sa.Column('track_code', sa.String(length=16), nullable=True),
        sa.Column('consent_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stripe_subscription_id'),
        sa.UniqueConstraint('stripe_session_id'),
    )
    op.create_index('ix_music_subscriptions_user_id', 'music_subscriptions', ['user_id'])
    op.create_index('ix_music_subscriptions_track_code', 'music_subscriptions', ['track_code'])
    op.create_table(
        'music_sub_downloads',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subscription_id', sa.Integer(), nullable=False),
        sa.Column('sheet_id', sa.Integer(), nullable=False),
        sa.Column('in_trial', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['subscription_id'], ['music_subscriptions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sheet_id'], ['music_sheets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('subscription_id', 'sheet_id', name='uq_music_sub_downloads'),
    )
    op.create_index('ix_music_sub_downloads_subscription_id', 'music_sub_downloads', ['subscription_id'])
    op.execute(
        "INSERT INTO music_promo_codes (code, kind, value, active, max_uses, uses, expires_at, note, created_at) "
        "SELECT 'ESSAI48', 'trial', 2, true, NULL, 0, NULL, 'Essai de 48 h de l''abonnement (liens du test A/B)', now() "
        "WHERE NOT EXISTS (SELECT 1 FROM music_promo_codes WHERE code = 'ESSAI48')"
    )


def downgrade() -> None:
    op.drop_index('ix_music_sub_downloads_subscription_id', table_name='music_sub_downloads')
    op.drop_table('music_sub_downloads')
    op.drop_index('ix_music_subscriptions_track_code', table_name='music_subscriptions')
    op.drop_index('ix_music_subscriptions_user_id', table_name='music_subscriptions')
    op.drop_table('music_subscriptions')
    op.drop_column('music_track_links', 'variant')
    op.drop_column('music_settings', 'sub_weekly_cents')
