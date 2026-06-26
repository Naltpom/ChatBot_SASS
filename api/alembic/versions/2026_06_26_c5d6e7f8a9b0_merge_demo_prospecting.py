"""merge heads : demo_generations (a8b9c0d1e2f3) + prospecting_profile (b4c5d6e7f8a9)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9, a8b9c0d1e2f3
Create Date: 2026-06-26

Les PR #22 (prospection 100% auto) et #23 (démo publique) ont chacune ajouté
une migration enfant du head e2f3a4b5c6d7 -> deux heads coexistent sur master.
Cette migration de MERGE (sans DDL) réunifie le graphe en un seul head pour
qu'`alembic upgrade head` (lancé au démarrage de l'API) reste linéaire.
"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = ('b4c5d6e7f8a9', 'a8b9c0d1e2f3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
