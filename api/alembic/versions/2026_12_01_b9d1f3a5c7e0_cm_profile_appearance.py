"""cm : apparence partagée site / app (couleur, clair-sombre, numéro de version) sur cm_profiles

Revision ID: b9d1f3a5c7e0
Revises: a8c0e2f4b6d9
Create Date: 2026-12-01
"""
import sqlalchemy as sa
from alembic import op

revision = "b9d1f3a5c7e0"
down_revision = "a8c0e2f4b6d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cm_profiles", sa.Column("palette", sa.String(10), nullable=True))
    op.add_column("cm_profiles", sa.Column("theme", sa.String(10), nullable=True))
    op.add_column("cm_profiles", sa.Column("prefs_rev", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("cm_profiles", "prefs_rev")
    op.drop_column("cm_profiles", "theme")
    op.drop_column("cm_profiles", "palette")
