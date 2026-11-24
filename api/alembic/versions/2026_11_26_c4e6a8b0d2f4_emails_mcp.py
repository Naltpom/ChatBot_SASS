"""emails.chapote.fr : boîtes mail, clients et jetons OAuth du serveur MCP, journal d'audit

Revision ID: c4e6a8b0d2f4
Revises: a7c9e1f3b5d2
Create Date: 2026-11-26 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c4e6a8b0d2f4'
down_revision: Union[str, None] = 'a7c9e1f3b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mailboxes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('slug', sa.String(length=40), nullable=False, unique=True),
        sa.Column('address', sa.String(length=255), nullable=False),
        sa.Column('label', sa.String(length=120), nullable=True),
        sa.Column('preset', sa.String(length=30), nullable=True),
        sa.Column('imap_host', sa.String(length=255), nullable=False),
        sa.Column('imap_port', sa.Integer(), nullable=False),
        sa.Column('imap_tls', sa.String(length=10), nullable=False),
        sa.Column('smtp_host', sa.String(length=255), nullable=False),
        sa.Column('smtp_port', sa.Integer(), nullable=False),
        sa.Column('smtp_tls', sa.String(length=10), nullable=False),
        sa.Column('username', sa.String(length=255), nullable=False),
        sa.Column('password_encrypted', sa.Text(), nullable=False),
        sa.Column('allow_send', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('allow_delete', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('save_sent', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('last_check_at', sa.DateTime(), nullable=True),
        sa.Column('last_check_ok', sa.Boolean(), nullable=True),
        sa.Column('last_check_error', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'mcp_oauth_clients',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_id', sa.String(length=64), nullable=False, unique=True),
        sa.Column('client_secret_hash', sa.String(length=64), nullable=True),
        sa.Column('client_name', sa.String(length=200), nullable=True),
        sa.Column('redirect_uris', sa.JSON(), nullable=False),
        sa.Column('token_endpoint_auth_method', sa.String(length=30), nullable=False),
        sa.Column('created_ip', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
    )
    op.create_table(
        'mcp_oauth_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code_hash', sa.String(length=64), nullable=False, unique=True),
        sa.Column('client_pk', sa.Integer(), sa.ForeignKey('mcp_oauth_clients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('redirect_uri', sa.Text(), nullable=False),
        sa.Column('code_challenge', sa.String(length=128), nullable=False),
        sa.Column('scope', sa.String(length=100), nullable=False),
        sa.Column('resource', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_mcp_oauth_codes_client_pk', 'mcp_oauth_codes', ['client_pk'])
    op.create_table(
        'mcp_oauth_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_pk', sa.Integer(), sa.ForeignKey('mcp_oauth_clients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('family_id', sa.String(length=32), nullable=False),
        sa.Column('code_id', sa.Integer(), sa.ForeignKey('mcp_oauth_codes.id', ondelete='SET NULL'), nullable=True),
        sa.Column('access_hash', sa.String(length=64), nullable=False, unique=True),
        sa.Column('access_expires_at', sa.DateTime(), nullable=False),
        sa.Column('refresh_hash', sa.String(length=64), nullable=True, unique=True),
        sa.Column('refresh_expires_at', sa.DateTime(), nullable=True),
        sa.Column('scope', sa.String(length=100), nullable=False),
        sa.Column('resource', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('rotated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_mcp_oauth_tokens_client_pk', 'mcp_oauth_tokens', ['client_pk'])
    op.create_index('ix_mcp_oauth_tokens_user_id', 'mcp_oauth_tokens', ['user_id'])
    op.create_index('ix_mcp_oauth_tokens_family', 'mcp_oauth_tokens', ['family_id'])
    op.create_table(
        'mcp_audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('client_pk', sa.Integer(), sa.ForeignKey('mcp_oauth_clients.id', ondelete='SET NULL'), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('tool', sa.String(length=40), nullable=False),
        sa.Column('mailbox_slug', sa.String(length=40), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('error_code', sa.String(length=40), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('items', sa.Integer(), nullable=True),
    )
    op.create_index('ix_mcp_audit_log_created_at', 'mcp_audit_log', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_mcp_audit_log_created_at', table_name='mcp_audit_log')
    op.drop_table('mcp_audit_log')
    op.drop_index('ix_mcp_oauth_tokens_family', table_name='mcp_oauth_tokens')
    op.drop_index('ix_mcp_oauth_tokens_user_id', table_name='mcp_oauth_tokens')
    op.drop_index('ix_mcp_oauth_tokens_client_pk', table_name='mcp_oauth_tokens')
    op.drop_table('mcp_oauth_tokens')
    op.drop_index('ix_mcp_oauth_codes_client_pk', table_name='mcp_oauth_codes')
    op.drop_table('mcp_oauth_codes')
    op.drop_table('mcp_oauth_clients')
    op.drop_table('mailboxes')
