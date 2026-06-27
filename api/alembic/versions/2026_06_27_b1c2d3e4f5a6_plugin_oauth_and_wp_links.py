"""OAuth « plugin » (device flow) + lien bot<->WordPress

Revision ID: b1c2d3e4f5a6
Revises: d6e7f8a9b0c1
Create Date: 2026-06-27 09:00:00.000000

Crée :
- oauth_device_authorizations : appairage device flow (RFC 8628) du plugin.
- oauth_tokens                : refresh tokens opaques (rotation / anti-rejeu).
- billing_wordpress_links     : lien canonique bot <-> site WordPress (1 par bot).

Reflète api/src/models/oauth.py + billing.BillingWordPressLink. upgrade/downgrade
symétriques (convention repo). down_revision = head unique d6e7f8a9b0c1.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'd6e7f8a9b0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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

    op.create_table(
        'oauth_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('refresh_token_hash', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False, server_default=sa.text("'plugin'")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('replaced_by_id', sa.Integer(), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['replaced_by_id'], ['oauth_tokens.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_oauth_tokens_user_id', 'oauth_tokens', ['user_id'])
    op.create_index('ix_oauth_tokens_refresh_token_hash', 'oauth_tokens',
                    ['refresh_token_hash'], unique=True)

    op.create_table(
        'billing_wordpress_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.Integer(), nullable=False),
        sa.Column('wordpress_site_url', sa.String(), nullable=False),
        sa.Column('wordpress_post_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['bot_id'], ['bots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_billing_wordpress_links_bot_id', 'billing_wordpress_links',
                    ['bot_id'], unique=True)
    op.create_index('ix_billing_wordpress_links_wordpress_site_url',
                    'billing_wordpress_links', ['wordpress_site_url'])


def downgrade() -> None:
    op.drop_index('ix_billing_wordpress_links_wordpress_site_url', table_name='billing_wordpress_links')
    op.drop_index('ix_billing_wordpress_links_bot_id', table_name='billing_wordpress_links')
    op.drop_table('billing_wordpress_links')

    op.drop_index('ix_oauth_tokens_refresh_token_hash', table_name='oauth_tokens')
    op.drop_index('ix_oauth_tokens_user_id', table_name='oauth_tokens')
    op.drop_table('oauth_tokens')

    op.drop_index('ix_oauth_device_authorizations_user_id', table_name='oauth_device_authorizations')
    op.drop_index('ix_oauth_device_authorizations_user_code', table_name='oauth_device_authorizations')
    op.drop_index('ix_oauth_device_authorizations_device_code_hash', table_name='oauth_device_authorizations')
    op.drop_table('oauth_device_authorizations')
