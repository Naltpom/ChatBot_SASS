"""table prospects (outil de prospection commerciale admin)

Revision ID: c0d1e2f3a4b5
Revises: b8c9d0e1f2a3
Create Date: 2026-06-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c0d1e2f3a4b5'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'prospects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('siren', sa.String(), nullable=True),
        sa.Column('siret', sa.String(), nullable=True),
        sa.Column('company_name', sa.String(), nullable=False),
        sa.Column('naf_code', sa.String(), nullable=True),
        sa.Column('sector_label', sa.String(), nullable=True),
        sa.Column('city', sa.String(), nullable=True),
        sa.Column('postal_code', sa.String(), nullable=True),
        sa.Column('contact_name', sa.String(), nullable=True),
        sa.Column('website', sa.String(), nullable=True),
        sa.Column('contact_email', sa.String(), nullable=True),
        sa.Column('site_summary', sa.Text(), nullable=True),
        sa.Column('has_existing_chatbot', sa.Boolean(), nullable=True),
        sa.Column('email_subject', sa.Text(), nullable=True),
        sa.Column('email_body', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='found'),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_prospects_siren'), 'prospects', ['siren'], unique=True)
    op.create_index(op.f('ix_prospects_status'), 'prospects', ['status'], unique=False)
    op.create_index(op.f('ix_prospects_created_at'), 'prospects', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_prospects_created_at'), table_name='prospects')
    op.drop_index(op.f('ix_prospects_status'), table_name='prospects')
    op.drop_index(op.f('ix_prospects_siren'), table_name='prospects')
    op.drop_table('prospects')
