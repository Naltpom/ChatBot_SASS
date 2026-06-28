"""OAuth plugin : access_jti sur oauth_tokens (révocation stateful de l'access)

Revision ID: c7d8e9f0a1b2
Revises: f5a6b7c8d9e0
Create Date: 2026-06-28 13:00:00.000000

Révocation des tokens plugin (§3.4 audit, PR-05) : l'access JWT scope='plugin'
porte désormais un `jti` (uuid4) stocké ici (access_jti) sur la ligne refresh du
même pair. require_oauth_token charge la ligne par ce jti et rejette l'access si
is_revoked -> déconnexion (revoke) et rotation (rotate_refresh) coupent l'access
IMMÉDIATEMENT (sans attendre l'expiration du JWT, TTL réduit à 30 min).

Colonne nullable (lignes héritées : access pré-durcissement sans jti -> rejetés,
refreshés par le plugin). Index pour le lookup par jti. upgrade/downgrade
symétriques (convention repo). down_revision = head unique f5a6b7c8d9e0.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'f5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('oauth_tokens', sa.Column('access_jti', sa.String(), nullable=True))
    op.create_index('ix_oauth_tokens_access_jti', 'oauth_tokens', ['access_jti'])


def downgrade() -> None:
    op.drop_index('ix_oauth_tokens_access_jti', table_name='oauth_tokens')
    op.drop_column('oauth_tokens', 'access_jti')
