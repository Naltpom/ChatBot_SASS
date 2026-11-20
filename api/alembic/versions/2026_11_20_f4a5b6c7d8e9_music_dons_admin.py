"""Boutique : partitions offertes par un administrateur

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-11-20 21:00:00.000000

- music_orders.granted_by_user_id : commande à 0 € créée par un administrateur pour donner une partition
  (publique ou privée) à une personne ; elle compte comme un achat (accès, « Mes partitions », téléchargement).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('music_orders', sa.Column('granted_by_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_music_orders_granted_by', 'music_orders', 'users', ['granted_by_user_id'], ['id'],
                          ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_music_orders_granted_by', 'music_orders', type_='foreignkey')
    op.drop_column('music_orders', 'granted_by_user_id')
