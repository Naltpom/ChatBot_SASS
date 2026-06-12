"""Environnement Alembic (async).

Réutilise la configuration de l'application : settings.DATABASE_URL comme URL
de connexion (postgresql+asyncpg) et Base.metadata comme cible de
l'autogénération. Les modules de modèles sont importés EXPLICITEMENT pour
enregistrer toutes les tables sur le metadata.

Compatible avec les deux modes d'exécution :
- CLI dans le conteneur : docker compose exec api alembic upgrade head
- programmatique au démarrage (src/main.py) : le lifespan appelle
  command.upgrade via asyncio.to_thread -> ce module tourne dans un thread
  SANS event loop, asyncio.run() y est donc légitime.
"""
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import create_async_engine

from src.core.config import settings
from src.core.database import Base

# Imports explicites : chaque module enregistre ses tables sur Base.metadata
# (indispensable pour l'autogénération ET pour valider le schéma cible).
import src.models.user  # noqa: F401
import src.models.bot  # noqa: F401
import src.models.conversation  # noqa: F401
import src.models.lead  # noqa: F401

config = context.config

# disable_existing_loggers=False : ne pas débrancher les loggers de l'app
# quand la migration est lancée depuis le lifespan FastAPI.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Mode offline : génère le SQL sans connexion (alembic upgrade --sql)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    # Verrou consultatif Postgres : en prod l'API tourne multi-worker
    # (--workers 2) et CHAQUE worker exécute le lifespan -> les `upgrade head`
    # concurrents sont sérialisés ici (le second ne voit plus rien à
    # appliquer). Verrou de session, libéré à la fermeture de la connexion.
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_lock(884217)"))
        # IMPORTANT : referme la transaction implicite ouverte par l'execute
        # ci-dessus (SQLAlchemy 2.0). Sinon context.begin_transaction() la
        # detecte et ne committe RIEN a la fin -> tout le DDL serait rollback
        # a la fermeture de la connexion. Le verrou est de niveau SESSION :
        # il survit au commit et n'est libere qu'a la deconnexion.
        connection.commit()
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # NullPool : une connexion le temps de la migration, rien ne survit
    # ensuite (l'engine applicatif a son propre pool).
    engine = create_async_engine(settings.DATABASE_URL, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
