"""billing_presets : présélections du configurateur pilotées en base (éditable admin)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-25 12:30:00.000000

Sort les présélections (bundles Vitrine / Service client / Volume) du CODE
(`_PRESETS`) vers une table éditable depuis l'admin catalogue :
- key (unique), label, tagline
- ai_tier_id (code du palier IA, NULLABLE)
- modules (JSON : liste de clés de module)
- recommended (bool), sort_order (ordre d'affichage), is_active (bool)

upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'billing_presets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('tagline', sa.String(), nullable=False, server_default=''),
        sa.Column('ai_tier_id', sa.String(), nullable=True),
        sa.Column('modules', sa.JSON(), nullable=True),
        sa.Column('recommended', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('key', name='uq_billing_presets_key'),
    )
    op.create_index('ix_billing_presets_key', 'billing_presets', ['key'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_billing_presets_key', table_name='billing_presets')
    op.drop_table('billing_presets')
