"""connecteur mcp par bot

Connecteur MCP generique : bots.mcp_servers_json (max 2 serveurs
{name, url, auth_token_encrypted}, jetons Fernet write-only, EXCLU de
config.json). server_default '[]' backfille les lignes existantes.
Revision ECRITE A LA MAIN (stub rempli, pas d'autogenerate).

Revision ID: 0a25919f448f
Revises: f4a91c27d3b8
Create Date: 2026-06-12 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a25919f448f'
down_revision: Union[str, None] = 'f4a91c27d3b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bots", sa.Column("mcp_servers_json", sa.JSON(), server_default=sa.text("'[]'"), nullable=False))


def downgrade() -> None:
    op.drop_column("bots", "mcp_servers_json")
