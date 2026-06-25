"""billing metering pipeline : meter columns + overage_cap

Revision ID: b8c9d0e1f2a3
Revises: f2a3b4c5d6e7
Create Date: 2026-06-25 14:00:00.000000

M5 (spec §D1 / §6.3 / checklist 12) — Pipeline de DÉPASSEMENT IA MÉTRÉ (Stripe
Billing Meters). Ajoute les colonnes nécessaires au câblage du métrage :

- billing_products.stripe_meter_id   (String, NULLABLE) : id du Meter Stripe
  (mtr_...) créé au seed métré pour la ligne kind='metered' (mtr_ai).
- billing_products.meter_event_name  (String, NULLABLE) : event_name unique du
  Meter (= METER_EVENT_NAME "ai_reply_overage"), référencé par le Price métré et
  par les meter_events rapportés.
- bot_entitlements.overage_cap       (Integer, NULLABLE) : plafond de sécurité du
  dépassement (réponses facturées max/mois). NULL = défaut OVERAGE_CAP_DEFAULT.

`reported_overage` existe déjà sur bot_usage_counters (migration M3
f6a7b8c9d0e1). NULLABLE => pas de server_default. upgrade/downgrade symétriques.

NB chaîne : down_revision = f2a3b4c5d6e7 (TÊTE réelle de la branche billing au
2026-06-25 : a7b8c9d0e1f2 -> c9d0e1f2a3b4 -> d0e1f2a3b4c5 -> e1f2a3b4c5d6 ->
f2a3b4c5d6e7). On chaîne linéairement, jamais de branche Alembic.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('billing_products',
                  sa.Column('stripe_meter_id', sa.String(), nullable=True))
    op.add_column('billing_products',
                  sa.Column('meter_event_name', sa.String(), nullable=True))
    op.add_column('bot_entitlements',
                  sa.Column('overage_cap', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('bot_entitlements', 'overage_cap')
    op.drop_column('billing_products', 'meter_event_name')
    op.drop_column('billing_products', 'stripe_meter_id')
