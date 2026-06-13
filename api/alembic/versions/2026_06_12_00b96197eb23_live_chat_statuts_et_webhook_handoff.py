"""live chat statuts et webhook handoff

Live chat (handoff conseiller) : cycle de vie des conversations
(ai -> human_requested -> human -> closed) + horodatages, index composite
pour l'inbox staff, et URL de webhook de notification par bot.
Revision ECRITE A LA MAIN (stub rempli, pas d'autogenerate). Le
server_default 'ai' backfille les conversations existantes.
Message.source='human' est une convention applicative : aucune migration.

Revision ID: 00b96197eb23
Revises: e2c624608aa0
Create Date: 2026-06-12 03:37:46.439788

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '00b96197eb23'
down_revision: Union[str, None] = 'e2c624608aa0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("status", sa.String(), server_default=sa.text("'ai'"), nullable=False))
    op.add_column("conversations", sa.Column("human_requested_at", sa.DateTime(), nullable=True))
    op.add_column("conversations", sa.Column("human_taken_at", sa.DateTime(), nullable=True))
    op.add_column("conversations", sa.Column("closed_at", sa.DateTime(), nullable=True))
    op.create_index("ix_conversations_bot_status", "conversations", ["bot_id", "status"])
    op.add_column("bots", sa.Column("handoff_webhook_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("bots", "handoff_webhook_url")
    op.drop_index("ix_conversations_bot_status", table_name="conversations")
    op.drop_column("conversations", "closed_at")
    op.drop_column("conversations", "human_taken_at")
    op.drop_column("conversations", "human_requested_at")
    op.drop_column("conversations", "status")
