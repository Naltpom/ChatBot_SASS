"""users.avatar_url : photo de profil (SSO Google, hébergée localement)

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-24 10:00:00.000000

- users.avatar_url (String, NULLABLE) : URL de la photo de profil servie depuis
  /uploads/* (téléchargée à la connexion Google). NULL = aucune photo (fallback
  initiales côté front). NULLABLE => pas de server_default.

Reflète api/src/models/user.py (User.avatar_url). Conventions repo :
upgrade/downgrade symétriques.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('avatar_url', sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'avatar_url')
