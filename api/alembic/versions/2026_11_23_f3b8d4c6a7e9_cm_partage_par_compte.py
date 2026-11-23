"""cm : partage par compte (cm_member_roles.account_keys)

Revision ID: f3b8d4c6a7e9
Revises: e2a7c3b5f6d8
Create Date: 2026-11-23 23:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f3b8d4c6a7e9'
down_revision: Union[str, None] = 'e2a7c3b5f6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cm_member_roles', sa.Column('account_keys', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('cm_member_roles', 'account_keys')
