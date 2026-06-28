"""Vérification souple de l'email : colonne users.email_verified

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-06-28 10:00:00.000000

Migration PUREMENT ADDITIVE : ajoute users.email_verified (Boolean, NOT NULL,
server_default false). La vérification est SOUPLE — le compte reste actif dès
l'inscription, ce drapeau ne pilote qu'une bannière non bloquante côté front et
passe à True via le lien de confirmation (token signé). Aucun backfill : tous
les comptes existants démarrent à False (non vérifié) puis confirment via le
lien. down_revision = head unique d3e4f5a6b7c8.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('email_verified', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
    )


def downgrade() -> None:
    op.drop_column('users', 'email_verified')
