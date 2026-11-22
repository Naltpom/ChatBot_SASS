"""Boutique : prix publics 2,49 € la partition et 3,79 € le lot (1,99 € / 2,99 € avec INSTA20)

Revision ID: de965d03a8e8
Revises: caf9f3ece6eb
Create Date: 2026-11-22 23:00:00.000000

Ne change que les valeurs encore à l'ancien défaut (199 / 299) : un prix déjà réglé dans l'admin est gardé.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'de965d03a8e8'
down_revision: Union[str, None] = 'caf9f3ece6eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE music_settings SET unit_price_cents = 249 WHERE unit_price_cents = 199")
    op.execute("UPDATE music_settings SET bundle_price_cents = 379 WHERE bundle_price_cents = 299")


def downgrade() -> None:
    op.execute("UPDATE music_settings SET unit_price_cents = 199 WHERE unit_price_cents = 249")
    op.execute("UPDATE music_settings SET bundle_price_cents = 299 WHERE bundle_price_cents = 379")
