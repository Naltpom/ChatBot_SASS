"""Boutique de partitions (music.chapote.fr) : catalogue, prix, codes promo, commandes

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-11-20 15:30:00.000000

Tables indépendantes du reste de Chapote (aucune clé vers users/organizations) :
les acheteurs n'ont pas de compte. La ligne unique de `music_settings` (id = 1)
porte les prix par défaut : 1,99 € la partition, 2,99 € le lot d'un morceau.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'music_sheets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_ref', sa.String(length=200), nullable=False),
        sa.Column('piece_slug', sa.String(length=160), nullable=False),
        sa.Column('piece_title', sa.String(length=300), nullable=False),
        sa.Column('composer', sa.String(length=200), nullable=True),
        sa.Column('instrument', sa.String(length=40), nullable=False),
        sa.Column('instrument_label', sa.String(length=60), nullable=False),
        sa.Column('title', sa.String(length=400), nullable=False),
        sa.Column('rights', sa.String(length=80), nullable=True),
        sa.Column('public_domain', sa.Boolean(), nullable=False),
        sa.Column('published', sa.Boolean(), nullable=False),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('pages', sa.Integer(), nullable=False),
        sa.Column('reel_url', sa.Text(), nullable=True),
        sa.Column('has_cover', sa.Boolean(), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=True),
        sa.Column('released_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_ref'),
    )
    op.create_index('ix_music_sheets_piece_slug', 'music_sheets', ['piece_slug'])

    op.create_table(
        'music_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('unit_price_cents', sa.Integer(), nullable=False),
        sa.Column('bundle_price_cents', sa.Integer(), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "INSERT INTO music_settings (id, unit_price_cents, bundle_price_cents, currency, updated_at) "
        "VALUES (1, 199, 299, 'eur', now())"
    )

    op.create_table(
        'music_promo_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('uses', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )

    op.create_table(
        'music_orders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('public_id', sa.String(length=40), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('lang', sa.String(length=5), nullable=False),
        sa.Column('subtotal_cents', sa.Integer(), nullable=False),
        sa.Column('discount_cents', sa.Integer(), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('promo_code_id', sa.Integer(), nullable=True),
        sa.Column('promo_code', sa.String(length=40), nullable=True),
        sa.Column('stripe_session_id', sa.String(length=255), nullable=True),
        sa.Column('stripe_payment_intent', sa.String(length=255), nullable=True),
        sa.Column('consent_at', sa.DateTime(), nullable=False),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('emailed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['promo_code_id'], ['music_promo_codes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('public_id'),
        sa.UniqueConstraint('stripe_session_id'),
    )
    op.create_index('ix_music_orders_status_created', 'music_orders', ['status', 'created_at'])

    op.create_table(
        'music_order_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('sheet_id', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=500), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=False),
        sa.Column('downloads', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['order_id'], ['music_orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sheet_id'], ['music_sheets.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_music_order_items_order_id', 'music_order_items', ['order_id'])
    op.create_index('ix_music_order_items_sheet_id', 'music_order_items', ['sheet_id'])


def downgrade() -> None:
    op.drop_index('ix_music_order_items_sheet_id', table_name='music_order_items')
    op.drop_index('ix_music_order_items_order_id', table_name='music_order_items')
    op.drop_table('music_order_items')
    op.drop_index('ix_music_orders_status_created', table_name='music_orders')
    op.drop_table('music_orders')
    op.drop_table('music_promo_codes')
    op.drop_table('music_settings')
    op.drop_index('ix_music_sheets_piece_slug', table_name='music_sheets')
    op.drop_table('music_sheets')
