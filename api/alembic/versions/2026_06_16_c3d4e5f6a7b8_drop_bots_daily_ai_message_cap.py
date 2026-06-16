"""drop bots.daily_ai_message_cap

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-16 12:00:00.000000

Le plafond IA journalier (« mode degrade » : au-dela de N reponses IA/jour, le
widget repassait en arbre seul) n'est plus applique au runtime — l'application
est 100 % gratuite, aucun comptage/cap. La colonne ne servait plus a rien et
son UI etait trompeuse : on la retire. Le compteur informatif « reponses IA
aujourd'hui » (count_ai_messages_today) reste, ce n'est PAS un cap.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("bots", "daily_ai_message_cap")


def downgrade() -> None:
    op.add_column(
        "bots",
        sa.Column("daily_ai_message_cap", sa.Integer(), nullable=False, server_default="500"),
    )
