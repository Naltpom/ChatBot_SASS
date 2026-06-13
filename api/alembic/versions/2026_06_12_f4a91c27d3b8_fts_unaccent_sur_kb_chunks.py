"""fts unaccent sur kb_chunks

FTS insensible aux accents : extension unaccent + config french_unaccent
(COPY de french, mapping unaccent puis french_stem) et recreation de la
colonne generee kb_chunks.tsv (+ index GIN) sur cette config. Sans elle,
« telephone » ne matche pas « téléphone » — penalise surtout le mode degrade
FTS seul et la moitie FTS de la fusion RRF.
Revision ECRITE A LA MAIN. NB : to_tsvector(regconfig, text) a 2 arguments
est IMMUTABLE, donc valide en colonne generee meme avec le filtre unaccent.

Revision ID: f4a91c27d3b8
Revises: 00b96197eb23
Create Date: 2026-06-12 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a91c27d3b8'
down_revision: Union[str, None] = '00b96197eb23'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE TEXT SEARCH CONFIGURATION french_unaccent (COPY = french)")
    op.execute(
        "ALTER TEXT SEARCH CONFIGURATION french_unaccent "
        "ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem"
    )
    # Colonne generee : DROP recrée (l'expression d'une colonne GENERATED ne
    # s'altere pas en place) — l'index GIN tombe avec la colonne
    op.execute("ALTER TABLE kb_chunks DROP COLUMN tsv")
    op.execute(
        "ALTER TABLE kb_chunks ADD COLUMN tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('french_unaccent', content)) STORED"
    )
    op.create_index("ix_kb_chunks_tsv", "kb_chunks", ["tsv"], postgresql_using="gin")


def downgrade() -> None:
    op.execute("ALTER TABLE kb_chunks DROP COLUMN tsv")
    op.execute(
        "ALTER TABLE kb_chunks ADD COLUMN tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('french', content)) STORED"
    )
    op.create_index("ix_kb_chunks_tsv", "kb_chunks", ["tsv"], postgresql_using="gin")
    op.execute("DROP TEXT SEARCH CONFIGURATION french_unaccent")
    # On ne droppe PAS l'extension unaccent (d'autres objets pourraient en dependre)
