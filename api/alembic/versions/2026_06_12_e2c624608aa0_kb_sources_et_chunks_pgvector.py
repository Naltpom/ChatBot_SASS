"""kb sources et chunks pgvector

Base de connaissances RAG : extension vector, kb_sources (sources ingerees)
et kb_chunks (extraits avec embedding vector(384) + tsvector french generee).
Revision ECRITE A LA MAIN (pas d'autogenerate : Vector custom, colonne
GENERATED et index GIN/HNSW ne sont pas generables) et auto-suffisante
(aucun import de src.models).

Revision ID: e2c624608aa0
Revises: e5e1b937aba6
Create Date: 2026-06-12 03:24:38.011760

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2c624608aa0'
down_revision: Union[str, None] = 'e5e1b937aba6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "kb_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("bot_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),            # url | sitemap | pdf | text
        sa.Column("ref", sa.Text(), nullable=False),               # url / nom de fichier / titre
        sa.Column("status", sa.String(), server_default=sa.text("'pending'"), nullable=False),  # pending | ready | error
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("chunk_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("page_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["bot_id"], ["bots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kb_sources_bot_id"), "kb_sources", ["bot_id"])
    # kb_chunks : embedding + tsv generee — DDL brut (types inconnus d'Alembic)
    op.execute("""
CREATE TABLE kb_chunks (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
    bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page_url VARCHAR,
    embedding vector(384),
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('french', content)) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT now()
)""")
    op.create_index("ix_kb_chunks_bot_id", "kb_chunks", ["bot_id"])
    op.create_index("ix_kb_chunks_source_id", "kb_chunks", ["source_id"])
    op.create_index("ix_kb_chunks_tsv", "kb_chunks", ["tsv"], postgresql_using="gin")
    op.execute("CREATE INDEX ix_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    # Index inclus dans les DROP TABLE ; on ne droppe PAS l'extension vector
    # (securite donnees : d'autres objets pourraient en dependre).
    op.drop_table("kb_chunks")
    op.drop_index(op.f("ix_kb_sources_bot_id"), table_name="kb_sources")
    op.drop_table("kb_sources")
