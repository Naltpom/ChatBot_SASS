"""cm : Assistant Chapote CM, mode « mes données » (accord IA, permissions par compte, audit)

Revision ID: c1e3a5b7d9f2
Revises: b9d1f3a5c7e0
Create Date: 2026-12-02
"""
import sqlalchemy as sa
from alembic import op

revision = "c1e3a5b7d9f2"
down_revision = "b9d1f3a5c7e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cm_ai_consents",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("policy_version", sa.String(20), nullable=True),
        sa.Column("provider", sa.String(40), nullable=True),
        sa.Column("rev", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stats", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("planning", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("captions", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("excluded_accounts", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "cm_ai_consent_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("policy_version", sa.String(20), nullable=True),
        sa.Column("provider", sa.String(40), nullable=True),
        sa.Column("change", sa.JSON(), nullable=False),
    )
    op.create_table(
        "cm_account_ai_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("stats", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("planning", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("captions", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("uq_cm_account_ai_permissions", "cm_account_ai_permissions", ["platform", "account_id"], unique=True)
    op.create_table(
        "cm_assistant_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("tool", sa.String(40), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error_code", sa.String(40), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("items", sa.Integer(), nullable=True),
        sa.Column("categories", sa.JSON(), nullable=True),
        sa.Column("jti_hash", sa.String(16), nullable=True),
    )
    op.add_column("conversations", sa.Column("data_mode", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("conversations", sa.Column("user_hash", sa.String(32), nullable=True))
    op.create_index("ix_conversations_user_hash", "conversations", ["user_hash"])


def downgrade() -> None:
    op.drop_index("ix_conversations_user_hash", table_name="conversations")
    op.drop_column("conversations", "user_hash")
    op.drop_column("conversations", "data_mode")
    op.drop_table("cm_assistant_audit")
    op.drop_index("uq_cm_account_ai_permissions", table_name="cm_account_ai_permissions")
    op.drop_table("cm_account_ai_permissions")
    op.drop_table("cm_ai_consent_events")
    op.drop_table("cm_ai_consents")
