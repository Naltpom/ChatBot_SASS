"""Journal d'éligibilité des bots : table bot_status_history

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-06-27 14:00:00.000000

Migration PUREMENT ADDITIVE (zéro impact Stripe LIVE) :
- CREATE bot_status_history : journal d'audit du statut d'éligibilité d'un bot
  (qui/quand/comment/pourquoi). Alimenté par l'unique writer
  entitlement_service.set_bot_status (1 ligne quand le statut change).
- Backfill de GENÈSE : 1 ligne par bot_entitlements existant (old_status=NULL,
  new_status = statut courant, actor_kind='system', reason='backfill',
  created_at = COALESCE(synced_at, updated_at, created_at)) pour que l'audit ne
  démarre pas vide et que la 1re transition future ait un old_status cohérent.

AUCUN UPDATE des valeurs de bot_entitlements.status : les statuts existants
(active/trialing/past_due/canceled/inactive) restent inchangés ; 'suspended' est
une valeur NEUVE écrite uniquement par le blocage admin. down_revision = head
unique c2d3e4f5a6b7.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bot_status_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.Integer(), nullable=False),
        sa.Column('old_status', sa.String(), nullable=True),
        sa.Column('new_status', sa.String(), nullable=False),
        sa.Column('actor_kind', sa.String(), nullable=False),
        sa.Column('actor_user_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('stripe_event_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['bot_id'], ['bots.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_bot_status_history_bot_id', 'bot_status_history', ['bot_id'])

    # Genèse : 1 ligne par entitlement existant (audit non vide, old_status cohérent
    # pour la prochaine transition). Aucune modification des statuts.
    op.execute(
        """
        INSERT INTO bot_status_history
            (bot_id, old_status, new_status, actor_kind, reason, created_at)
        SELECT bot_id, NULL, status, 'system', 'backfill',
               COALESCE(synced_at, updated_at, created_at)
        FROM bot_entitlements
        """
    )


def downgrade() -> None:
    op.drop_index('ix_bot_status_history_bot_id', table_name='bot_status_history')
    op.drop_table('bot_status_history')
