"""prospecting_profiles : profil cible persistant du superadmin

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-06-26 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'prospecting_profiles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('web_query', sa.String(), nullable=True),
        sa.Column('sector', sa.String(), nullable=True),
        sa.Column('departement', sa.String(), nullable=True),
        sa.Column('code_postal', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_prospecting_profiles_user_id'), 'prospecting_profiles', ['user_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_prospecting_profiles_user_id'), table_name='prospecting_profiles')
    op.drop_table('prospecting_profiles')
