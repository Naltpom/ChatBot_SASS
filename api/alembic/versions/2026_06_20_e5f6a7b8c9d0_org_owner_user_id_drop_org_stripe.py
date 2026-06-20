"""org owner_user_id + drop org stripe columns

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-20 10:05:00.000000

M2 (spec §1.5 / §1.2) — Owner d'org = payeur des bots d'équipe (décision D5).
On introduit `organizations.owner_user_id` (FK users), NOT NULL après backfill =
l'admin le plus ancien de chaque org (DISTINCT ON ... ORDER BY id ASC). Les orgs
orphelines (aucun admin) restent NULL — en base dev/quasi-vide il n'y en a pas.

On retire le Customer Stripe de `organizations` : il a migré vers le User (M1).
Facturation DORMANTE (config.py) ⇒ toutes les colonnes Stripe d'org sont à NULL,
aucun cus_/sub_ réel à migrer : le drop est sans perte.

Conventions repo : upgrade/downgrade symétriques ; le backfill inverse (downgrade)
n'est pas reconstituable (l'info admin-le-plus-ancien n'est pas une donnée
Stripe) — le downgrade se contente de réinstaller les colonnes telles qu'avant M2.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) owner_user_id nullable -> backfill -> NOT NULL + index
    op.add_column(
        'organizations',
        sa.Column(
            'owner_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id'),
            nullable=True,
        ),
    )
    op.execute("""
        UPDATE organizations o SET owner_user_id = sub.user_id
        FROM (
            SELECT DISTINCT ON (organization_id) organization_id, user_id
            FROM memberships WHERE role = 'admin'
            ORDER BY organization_id, id ASC
        ) sub
        WHERE sub.organization_id = o.id
    """)
    op.alter_column('organizations', 'owner_user_id', nullable=False)
    op.create_index(
        op.f('ix_organizations_owner_user_id'),
        'organizations',
        ['owner_user_id'],
    )

    # 2) drop des colonnes Stripe d'org (migrées vers users en M1)
    op.drop_index(op.f('ix_organizations_stripe_customer_id'), table_name='organizations')
    op.drop_column('organizations', 'stripe_subscription_id')
    op.drop_column('organizations', 'stripe_customer_id')


def downgrade() -> None:
    # Réinstalle les colonnes Stripe d'org telles qu'avant M2.
    op.add_column('organizations', sa.Column('stripe_customer_id', sa.String(), nullable=True))
    op.add_column('organizations', sa.Column('stripe_subscription_id', sa.String(), nullable=True))
    op.create_index(
        op.f('ix_organizations_stripe_customer_id'),
        'organizations',
        ['stripe_customer_id'],
        unique=False,
    )

    op.drop_index(op.f('ix_organizations_owner_user_id'), table_name='organizations')
    op.drop_column('organizations', 'owner_user_id')
