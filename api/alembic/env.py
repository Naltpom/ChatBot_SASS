"""Environnement Alembic (async).

Réutilise la configuration de l'application : settings.DATABASE_URL comme URL
de connexion (postgresql+asyncpg) et Base.metadata comme cible de
l'autogénération. Les modules de modèles sont importés EXPLICITEMENT pour
enregistrer toutes les tables sur le metadata.

Exécution : les migrations sont une ÉTAPE DE DÉPLOIEMENT DÉDIÉE (jamais dans le
boot applicatif). On lance toujours ce module via la CLI Alembic, hors runtime :
- prod : deploy.sh -> `docker compose run --rm api alembic upgrade head` (avant up)
- dev  : service one-shot `migrate` (docker-compose.yml) ou `make migrate`
La CLI tourne dans un process SANS event loop, asyncio.run() y est donc légitime.
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
import src.models.kb  # noqa: F401
import src.models.analytics  # noqa: F401
import src.models.billing  # noqa: F401   # BotEntitlement, BillingSubscription, BillingProduct, BillingWebhookEvent, BotUsageCounter
import src.models.demo  # noqa: F401   # DemoGeneration (cache demo publique)

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


# Délai max d'acquisition du verrou de migration (en secondes). Au-delà, on
# abandonne avec une erreur explicite plutôt que de figer le déploiement.
LOCK_ACQUIRE_TIMEOUT_S = 30
# Clé arbitraire du verrou consultatif (doit être stable entre tous les process).
MIGRATION_LOCK_KEY = 884217


def do_run_migrations(connection) -> None:
    # Verrou consultatif Postgres : si plusieurs process de migration se lancent
    # en parallèle (ex. déploiement concurrent), ils sont SÉRIALISÉS ici (le
    # second attend, puis ne voit plus rien à appliquer). Verrou de session,
    # libéré à la fermeture de la connexion.
    if connection.dialect.name == "postgresql":
        # Acquisition BORNÉE : `lock_timeout` de Postgres NE s'applique PAS aux
        # advisory locks, on borne donc via `statement_timeout` AUTOUR du SEUL
        # pg_advisory_lock (il interrompt l'attente d'acquisition). Sans cela,
        # en cas de contention l'acquisition bloque INDÉFINIMENT.
        connection.execute(text(f"SET statement_timeout = '{LOCK_ACQUIRE_TIMEOUT_S}s'"))
        try:
            connection.execute(text(f"SELECT pg_advisory_lock({MIGRATION_LOCK_KEY})"))
        except Exception as exc:  # statement_timeout -> acquisition abandonnée
            raise RuntimeError(
                f"Verrou de migration (pg_advisory_lock {MIGRATION_LOCK_KEY}) non "
                f"acquis en {LOCK_ACQUIRE_TIMEOUT_S}s : une autre migration est "
                "probablement en cours. Réessayer une fois celle-ci terminée."
            ) from exc
        # Verrou ACQUIS : on remet statement_timeout à 0 IMMÉDIATEMENT. Sinon il
        # resterait actif pendant le DDL de migration (potentiellement long) et
        # le tuerait à mi-parcours.
        connection.execute(text("SET statement_timeout = 0"))
        # IMPORTANT : referme la transaction implicite ouverte par les execute
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
