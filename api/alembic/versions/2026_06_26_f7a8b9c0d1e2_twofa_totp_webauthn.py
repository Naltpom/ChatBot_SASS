"""2FA : TOTP (authenticator) + WebAuthn (passkeys)

Revision ID: f7a8b9c0d1e2
Revises: b8c9d0e1f2a3
Create Date: 2026-06-26 12:00:00.000000

Ajoute à `users` les colonnes 2FA :
- totp_secret (String, NULLABLE)            : secret base32 chiffré (Fernet).
- totp_enabled (Boolean, NOT NULL, def false): TOTP confirmé et actif.
- twofa_recovery (JSON, NULLABLE)           : hashs des codes de secours.
- webauthn_challenge (String, NULLABLE)     : challenge de cérémonie transitoire.
- webauthn_challenge_at (DateTime, NULLABLE): horodatage du challenge (expiration).

Crée la table `webauthn_credentials` (passkeys par user). Reflète
api/src/models/user.py (User.* + WebAuthnCredential). upgrade/downgrade
symétriques (convention repo).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('totp_secret', sa.String(), nullable=True))
    op.add_column(
        'users',
        sa.Column('totp_enabled', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
    )
    op.add_column('users', sa.Column('twofa_recovery', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('webauthn_challenge', sa.String(), nullable=True))
    op.add_column('users', sa.Column('webauthn_challenge_at', sa.DateTime(), nullable=True))

    op.create_table(
        'webauthn_credentials',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('credential_id', sa.String(), nullable=False),
        sa.Column('public_key', sa.String(), nullable=False),
        sa.Column('sign_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('transports', sa.JSON(), nullable=True),
        sa.Column('name', sa.String(), nullable=False, server_default=sa.text("'Passkey'")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_webauthn_credentials_user_id', 'webauthn_credentials', ['user_id'])
    op.create_index('ix_webauthn_credentials_credential_id', 'webauthn_credentials',
                    ['credential_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_webauthn_credentials_credential_id', table_name='webauthn_credentials')
    op.drop_index('ix_webauthn_credentials_user_id', table_name='webauthn_credentials')
    op.drop_table('webauthn_credentials')
    op.drop_column('users', 'webauthn_challenge_at')
    op.drop_column('users', 'webauthn_challenge')
    op.drop_column('users', 'twofa_recovery')
    op.drop_column('users', 'totp_enabled')
    op.drop_column('users', 'totp_secret')
