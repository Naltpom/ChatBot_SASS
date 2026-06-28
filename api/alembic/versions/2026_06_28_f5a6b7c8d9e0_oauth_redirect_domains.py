"""OAuth plugin : allowlist des domaines redirect_uri enregistrés par user

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-06-28 12:00:00.000000

Anti-phishing de consentement OAuth (§3.2 audit, PR-02) : table
oauth_redirect_domains stockant l'hôte (domaine) du redirect_uri ENREGISTRÉ par
utilisateur pour le client public 'chapote_wp'. L'/authorize n'accepte un
redirect_uri que si son hôte y figure pour cet utilisateur (bootstrap au 1er
consentement, confirmation explicite pour tout domaine nouveau ensuite).

Reflète api/src/models/oauth.py (OAuthRedirectDomain). upgrade/downgrade
symétriques (convention repo). down_revision = head unique e4f5a6b7c8d9.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5a6b7c8d9e0'
down_revision: Union[str, None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'oauth_redirect_domains',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('domain', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'domain', name='uq_oauth_redirect_user_domain'),
    )
    op.create_index('ix_oauth_redirect_domains_user_id',
                    'oauth_redirect_domains', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_oauth_redirect_domains_user_id', table_name='oauth_redirect_domains')
    op.drop_table('oauth_redirect_domains')
