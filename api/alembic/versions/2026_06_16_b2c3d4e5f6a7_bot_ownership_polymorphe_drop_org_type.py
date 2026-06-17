"""bot ownership polymorphe + drop org.type

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-16 11:00:00.000000

Ownership polymorphe du bot : un bot appartient SOIT a un USER (perso, tous
droits au createur) SOIT a une ORGANISATION (equipe). owner_user_id XOR
organization_id (check constraint). Le type d'org « perso » disparait : une
organisation est toujours une equipe. Base VIDE en dev/prod a cette etape
(0 bot, 0 org) -> migration purement schema, aucun backfill.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bots",
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_bots_owner_user_id", "bots", ["owner_user_id"])
    op.alter_column("bots", "organization_id", nullable=True)
    op.create_check_constraint(
        "ck_bots_owner_xor_org",
        "bots",
        "(owner_user_id IS NULL) <> (organization_id IS NULL)",
    )
    op.drop_column("organizations", "type")


def downgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("type", sa.String(), nullable=False, server_default="entreprise"),
    )
    op.drop_constraint("ck_bots_owner_xor_org", "bots", type_="check")
    op.alter_column("bots", "organization_id", nullable=False)
    op.drop_index("ix_bots_owner_user_id", table_name="bots")
    op.drop_column("bots", "owner_user_id")
