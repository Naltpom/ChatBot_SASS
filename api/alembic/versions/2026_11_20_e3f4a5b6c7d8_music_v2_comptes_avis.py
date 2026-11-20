"""Boutique v2 : comptes partagés (user_apps, signup_app), avis, likes Instagram, lecteur, pseudo Instagram

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-11-20 18:00:00.000000

- users.signup_app + table user_apps : un même compte pour chapote.fr et music.chapote.fr
  (et les outils à venir), avec le service d'inscription et les services utilisés.
- music_reviews : avis des acheteurs vérifiés.
- music_sheets : likes/commentaires du Reel, présence des notes du lecteur.
- music_orders : compte de l'acheteur, pseudo Instagram facultatif et état de l'envoi.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('signup_app', sa.String(length=30), nullable=True))
    op.create_table(
        'user_apps',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('app', sa.String(length=30), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'app', name='uq_user_apps_user_app'),
    )
    op.create_index('ix_user_apps_user_id', 'user_apps', ['user_id'])

    op.add_column('music_sheets', sa.Column('instagram_likes', sa.Integer(), nullable=True))
    op.add_column('music_sheets', sa.Column('instagram_comments', sa.Integer(), nullable=True))
    op.add_column('music_sheets', sa.Column('stats_updated_at', sa.DateTime(), nullable=True))
    op.add_column('music_sheets', sa.Column('has_notes', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('music_sheets', 'has_notes', server_default=None)

    op.add_column('music_orders', sa.Column('user_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_music_orders_user_id', 'music_orders', 'users', ['user_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_music_orders_user_id', 'music_orders', ['user_id'])
    op.add_column('music_orders', sa.Column('instagram_username', sa.String(length=60), nullable=True))
    op.add_column('music_orders', sa.Column('instagram_sent_at', sa.DateTime(), nullable=True))
    op.add_column('music_orders', sa.Column('instagram_status', sa.String(length=40), nullable=True))

    op.create_table(
        'music_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('sheet_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('hidden', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['sheet_id'], ['music_sheets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sheet_id', 'user_id', name='uq_music_reviews_sheet_user'),
    )
    op.create_index('ix_music_reviews_sheet_id', 'music_reviews', ['sheet_id'])
    op.create_index('ix_music_reviews_user_id', 'music_reviews', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_music_reviews_user_id', table_name='music_reviews')
    op.drop_index('ix_music_reviews_sheet_id', table_name='music_reviews')
    op.drop_table('music_reviews')
    op.drop_column('music_orders', 'instagram_status')
    op.drop_column('music_orders', 'instagram_sent_at')
    op.drop_column('music_orders', 'instagram_username')
    op.drop_index('ix_music_orders_user_id', table_name='music_orders')
    op.drop_constraint('fk_music_orders_user_id', 'music_orders', type_='foreignkey')
    op.drop_column('music_orders', 'user_id')
    op.drop_column('music_sheets', 'has_notes')
    op.drop_column('music_sheets', 'stats_updated_at')
    op.drop_column('music_sheets', 'instagram_comments')
    op.drop_column('music_sheets', 'instagram_likes')
    op.drop_index('ix_user_apps_user_id', table_name='user_apps')
    op.drop_table('user_apps')
    op.drop_column('users', 'signup_app')
