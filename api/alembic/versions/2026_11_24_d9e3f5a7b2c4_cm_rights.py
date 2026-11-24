"""cm : droits d'auteur par publication, chaîne YouTube « domaine public seulement »

Revision ID: d9e3f5a7b2c4
Revises: c7d1e9f3a2b4
Create Date: 2026-11-24 18:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd9e3f5a7b2c4'
down_revision: Union[str, None] = 'c7d1e9f3a2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_posts', sa.Column('rights', sa.String(length=16), nullable=True))
    op.add_column('cm_posts', sa.Column('rights_note', sa.String(length=300), nullable=True))
    op.add_column('youtube_accounts', sa.Column('public_domain_only', sa.Boolean(), nullable=False,
                                                server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('youtube_accounts', 'public_domain_only')
    op.drop_column('cm_posts', 'rights_note')
    op.drop_column('cm_posts', 'rights')
