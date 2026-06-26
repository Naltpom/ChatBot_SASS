"""prospects : scoring IA + feedback operateur (fit_score, decision, decouverte)

Revision ID: a3b4c5d6e7f8
Revises: e2f3a4b5c6d7
Create Date: 2026-06-26 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('prospects', sa.Column('fit_score', sa.Integer(), nullable=True))
    op.add_column('prospects', sa.Column('decision', sa.String(), nullable=True))
    op.add_column('prospects', sa.Column('decision_reason', sa.Text(), nullable=True))
    op.add_column('prospects', sa.Column('decision_at', sa.DateTime(), nullable=True))
    op.add_column('prospects', sa.Column('discovery_query', sa.String(), nullable=True))
    op.create_index(op.f('ix_prospects_fit_score'), 'prospects', ['fit_score'], unique=False)
    op.create_index(op.f('ix_prospects_decision'), 'prospects', ['decision'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_prospects_decision'), table_name='prospects')
    op.drop_index(op.f('ix_prospects_fit_score'), table_name='prospects')
    op.drop_column('prospects', 'discovery_query')
    op.drop_column('prospects', 'decision_at')
    op.drop_column('prospects', 'decision_reason')
    op.drop_column('prospects', 'decision')
    op.drop_column('prospects', 'fit_score')
