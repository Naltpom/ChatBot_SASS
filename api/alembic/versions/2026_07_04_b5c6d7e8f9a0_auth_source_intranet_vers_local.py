"""users : auth_source 'intranet' -> 'local' (retrait du SSO intranet Kertios)

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-07-04 12:00:00.000000

Le SSO intranet Kertios est supprimé du SaaS (il ne reste que l'auth locale et
le SSO Google). Migration de DONNÉES uniquement : les comptes créés via
l'intranet repassent en auth locale (leur hashed_password était maintenu à
chaque login intranet, la connexion par mot de passe reste donc possible).
Ils conservent is_superadmin. downgrade = no-op (on ne sait pas re-distinguer
les comptes ex-intranet, et la voie d'auth n'existe plus).
down_revision = head unique a4b5c6d7e8f9.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b5c6d7e8f9a0'
down_revision: Union[str, None] = 'a4b5c6d7e8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET auth_source = 'local' WHERE auth_source = 'intranet'")


def downgrade() -> None:
    # No-op : la valeur 'intranet' n'existe plus dans l'application.
    pass
