"""demo_generations.source_text (contexte du chat IA de la demo, V2)

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-06-26

Colonne TEXT nullable : conserve le texte scrape de la page pour alimenter le
chat IA de la demo (/api/public/demo-chat) sans re-scraper a chaque message.
NULL pour les lignes pre-V2 -> backfill paresseux au 1er chat cote service.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('demo_generations', sa.Column('source_text', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('demo_generations', 'source_text')
