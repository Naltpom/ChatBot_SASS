"""prospects : opt-out RGPD (droit d'opposition à la prospection à froid)

Revision ID: a4b5c6d7e8f9
Revises: c7d8e9f0a1b2
Create Date: 2026-06-28 15:00:00.000000

RGPD prospection à froid (§4.4 / Sécurité audit, reporté de PR-07). Deux colonnes
sur `prospects` : `opt_out` (bool, défaut False) marque un prospect qui s'est
opposé à la prospection — il ne doit PLUS recevoir de cold email (garde-fou à
l'envoi) et ses PII sont purgeables immédiatement ; `opt_out_at` horodate
l'opposition. server_default 'false' pour les lignes héritées (jamais NULL).
Index sur opt_out (filtrage à l'envoi / purge). upgrade/downgrade symétriques.
down_revision = head unique c7d8e9f0a1b2.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('prospects', sa.Column(
        'opt_out', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('prospects', sa.Column('opt_out_at', sa.DateTime(), nullable=True))
    op.create_index(op.f('ix_prospects_opt_out'), 'prospects', ['opt_out'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_prospects_opt_out'), table_name='prospects')
    op.drop_column('prospects', 'opt_out_at')
    op.drop_column('prospects', 'opt_out')
