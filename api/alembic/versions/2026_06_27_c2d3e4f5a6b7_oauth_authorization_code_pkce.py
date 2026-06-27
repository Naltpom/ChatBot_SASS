"""OAuth « plugin » : device flow -> Authorization Code + PKCE

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-06-27 11:00:00.000000

Remplace le device flow (RFC 8628) par Authorization Code + PKCE (RFC 7636) :
- DROP   oauth_device_authorizations (table d'appairage device flow).
- CREATE oauth_authorization_codes  : code d'autorisation one-time lié à un
  redirect_uri (page admin du plugin) + code_challenge PKCE (S256).

oauth_tokens et billing_wordpress_links (créés par b1c2d3e4f5a6) sont INCHANGÉS.
Reflète api/src/models/oauth.py. upgrade/downgrade symétriques (convention repo).
down_revision = head unique b1c2d3e4f5a6.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_oauth_device_authorizations_user_id', table_name='oauth_device_authorizations')
    op.drop_index('ix_oauth_device_authorizations_user_code', table_name='oauth_device_authorizations')
    op.drop_index('ix_oauth_device_authorizations_device_code_hash', table_name='oauth_device_authorizations')
    op.drop_table('oauth_device_authorizations')

    op.create_table(
        'oauth_authorization_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('redirect_uri', sa.String(), nullable=False),
        sa.Column('code_challenge', sa.String(), nullable=False),
        sa.Column('code_challenge_method', sa.String(), nullable=False, server_default=sa.text("'S256'")),
        sa.Column('scope', sa.String(), nullable=False, server_default=sa.text("'plugin'")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_oauth_authorization_codes_code_hash',
                    'oauth_authorization_codes', ['code_hash'], unique=True)
    op.create_index('ix_oauth_authorization_codes_user_id',
                    'oauth_authorization_codes', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_oauth_authorization_codes_user_id', table_name='oauth_authorization_codes')
    op.drop_index('ix_oauth_authorization_codes_code_hash', table_name='oauth_authorization_codes')
    op.drop_table('oauth_authorization_codes')

    op.create_table(
        'oauth_device_authorizations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('device_code_hash', sa.String(), nullable=False),
        sa.Column('user_code', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False, server_default=sa.text("'plugin'")),
        sa.Column('status', sa.String(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('site_url', sa.String(), nullable=True),
        sa.Column('interval_seconds', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('last_polled_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_oauth_device_authorizations_device_code_hash',
                    'oauth_device_authorizations', ['device_code_hash'], unique=True)
    op.create_index('ix_oauth_device_authorizations_user_code',
                    'oauth_device_authorizations', ['user_code'], unique=True)
    op.create_index('ix_oauth_device_authorizations_user_id',
                    'oauth_device_authorizations', ['user_id'])
