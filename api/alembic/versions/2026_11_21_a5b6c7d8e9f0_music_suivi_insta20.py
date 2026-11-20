"""Boutique : suivi des liens (?b=…) et code promo INSTA20

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-11-21 00:30:00.000000

- music_track_links : code de suivi donné à quelqu'un (pseudo Instagram, source, partition).
- music_track_events : parcours sur le site d'un visiteur arrivé par un lien suivi, après son accord.
- music_orders.track_code : lien d'arrivée de la commande.
- code promo INSTA20 (-20 %, actif, sans limite) créé s'il n'existe pas.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'music_track_links',
        sa.Column('code', sa.String(length=16), nullable=False),
        sa.Column('instagram_username', sa.String(length=60), nullable=True),
        sa.Column('source', sa.String(length=40), nullable=True),
        sa.Column('sheet_ref', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('code'),
    )
    op.create_table(
        'music_track_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=16), nullable=False),
        sa.Column('visit', sa.String(length=16), nullable=False),
        sa.Column('kind', sa.String(length=40), nullable=False),
        sa.Column('path', sa.String(length=300), nullable=True),
        sa.Column('data', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_music_track_events_code_at', 'music_track_events', ['code', 'created_at'])
    op.add_column('music_orders', sa.Column('track_code', sa.String(length=16), nullable=True))
    op.create_index('ix_music_orders_track_code', 'music_orders', ['track_code'])
    op.execute(
        "INSERT INTO music_promo_codes (code, kind, value, active, max_uses, uses, expires_at, note, created_at) "
        "SELECT 'INSTA20', 'percent', 20, true, NULL, 0, NULL, 'Lien envoyé après « SHEET » sur Instagram', now() "
        "WHERE NOT EXISTS (SELECT 1 FROM music_promo_codes WHERE code = 'INSTA20')"
    )


def downgrade() -> None:
    op.drop_index('ix_music_orders_track_code', table_name='music_orders')
    op.drop_column('music_orders', 'track_code')
    op.drop_index('ix_music_track_events_code_at', table_name='music_track_events')
    op.drop_table('music_track_events')
    op.drop_table('music_track_links')
