"""Merge des deux têtes : prospection (PR #18) + 2FA (master).

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6, f7a8b9c0d1e2
Create Date: 2026-06-26 14:00:00.000000

La branche prospection (c0d1e2f3a4b5 -> d1e2f3a4b5c6) et la branche 2FA
(f7a8b9c0d1e2) partent toutes deux de b8c9d0e1f2a3 : deux têtes Alembic
après merge des branches Git. Cette révision les réunit (aucun DDL) pour
qu'`alembic upgrade head` reste linéaire, quel que soit l'état de la base
(fraîche, ou prod déjà à l'une des deux têtes).
"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = ('d1e2f3a4b5c6', 'f7a8b9c0d1e2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
