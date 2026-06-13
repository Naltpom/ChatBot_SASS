"""analytics et growth

Analytics et growth : rating CSAT sur messages, variante A/B sur conversations
et bots (tree_variant_json + ab_split_pct), triggers proactifs (triggers_json),
table tree_events (funnel par noeud servi) et table insights_reports (rapports
IA « questions sans reponse »). conversations.id est un String (uuid hex)
-> FK String, SET NULL a la purge. server_default sur les colonnes NOT NULL
= backfill des lignes existantes. Revision ECRITE A LA MAIN (stub rempli,
pas d'autogenerate).

Revision ID: 960e241f162a
Revises: 0a25919f448f
Create Date: 2026-06-12 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '960e241f162a'
down_revision: Union[str, None] = '0a25919f448f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("rating", sa.SmallInteger(), nullable=True))
    op.add_column("conversations", sa.Column("variant", sa.String(), nullable=True))
    op.add_column("bots", sa.Column("tree_variant_json", sa.JSON(), nullable=True))
    op.add_column("bots", sa.Column("ab_split_pct", sa.Integer(), server_default=sa.text("'0'"), nullable=False))
    op.add_column("bots", sa.Column("triggers_json", sa.JSON(), server_default=sa.text("'[]'"), nullable=False))
    op.create_table(
        "tree_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bot_id", sa.Integer(), sa.ForeignKey("bots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("node_key", sa.String(80), nullable=False),
        sa.Column("variant", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_tree_events_bot_id", "tree_events", ["bot_id"])
    op.create_index("ix_tree_events_conversation_id", "tree_events", ["conversation_id"])
    op.create_index("ix_tree_events_created_at", "tree_events", ["created_at"])
    op.create_table(
        "insights_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bot_id", sa.Integer(), sa.ForeignKey("bots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_json", sa.JSON(), nullable=False),
        sa.Column("message_count", sa.Integer(), server_default=sa.text("'0'"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_insights_reports_bot_id", "insights_reports", ["bot_id"])


def downgrade() -> None:
    op.drop_index("ix_insights_reports_bot_id", table_name="insights_reports")
    op.drop_table("insights_reports")
    op.drop_index("ix_tree_events_created_at", table_name="tree_events")
    op.drop_index("ix_tree_events_conversation_id", table_name="tree_events")
    op.drop_index("ix_tree_events_bot_id", table_name="tree_events")
    op.drop_table("tree_events")
    op.drop_column("bots", "triggers_json")
    op.drop_column("bots", "ab_split_pct")
    op.drop_column("bots", "tree_variant_json")
    op.drop_column("conversations", "variant")
    op.drop_column("messages", "rating")
