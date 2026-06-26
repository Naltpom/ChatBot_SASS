"""table demo_generations (cache de la demo publique 1 URL -> chatbot)

Revision ID: a8b9c0d1e2f3
Revises: e2f3a4b5c6d7
Create Date: 2026-06-26

Cache url->arbre de la page publique /demo : une URL deja generee resert
l'arbre sans rappeler l'IA (dans la limite du TTL). url_hash unique = cle de
cache / deduplication.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'demo_generations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('url_hash', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('tree_json', sa.JSON(), nullable=False),
        sa.Column('hits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_demo_generations_url_hash'), 'demo_generations',
                    ['url_hash'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_demo_generations_url_hash'), table_name='demo_generations')
    op.drop_table('demo_generations')
