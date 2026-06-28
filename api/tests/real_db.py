"""Harness pytest sur une VRAIE base Postgres jetable (PR-10).

Pourquoi
--------
La suite historique tourne sur `FakeSession` (cf. docstring de `conftest.py`) :
une fausse `AsyncSession` en mémoire qui NEUTRALISE silencieusement tout ce
qu'elle ne sait pas faire — `with_for_update` est un no-op, les opérateurs
WHERE autres que `==`/`in_` (`>=`, `LIKE`, …) deviennent un prédicat NEUTRE
(« vrai »), et il n'y a NI jointure NI agrégation SQL. Couverture en trompe-
l'œil : un filtre cassé passe, un verrou jamais pris passe, l'isolation tenant
n'est jamais prouvée.

Ce module fournit un harness RÉUTILISABLE (futures PR OAuth/2FA/actions/widget/
isolation tenant) qui exécute le code contre un vrai Postgres :

- Base DÉDIÉE jetable `chatbot_saas_test`, créée à la volée si absente, à partir
  d'une URL dérivée de `settings.DATABASE_URL` (mêmes host/user/pwd, seul le nom
  de base change). On ne touche JAMAIS à la base de dev `chatbot_saas`.
- Schéma posé par `Base.metadata.create_all` (tous les modèles sont importés via
  `import src.main`, qui couvre AUSSI les modèles absents de `src/models/__init__`
  comme `billing.py`). Les prérequis que seules les migrations posent d'ordinaire
  (extension `vector`, extension `unaccent` + configuration FTS `french_unaccent`
  pour la colonne générée `kb_chunks.tsv`) sont recréés ici de façon idempotente
  AVANT le `create_all`.
- Isolation par test : **TRUNCATE … RESTART IDENTITY CASCADE** de toutes les
  tables, AVANT et APRÈS chaque test. Choix assumé plutôt que le pattern
  « transaction externe + SAVEPOINT redémarré » : le code sous test appelle
  `db.commit()` très fréquemment et l'imbrication SAVEPOINT/`begin_nested` reste
  fragile sous asyncpg (réutilisation de connexion, loop par test) ; TRUNCATE est
  simple, robuste et indépendant de l'ordre des tests.
- **Skip gracieux** : si le Postgres est INJOIGNABLE (réseau down, base de test
  inexistante, etc.), les fixtures appellent `pytest.skip` — la suite FakeSession
  unitaire continue de tourner partout. Le diagnostic est mis en cache (un seul
  essai par session). En revanche, toute AUTRE erreur (schéma/extension/modèle,
  alors que la DB répond) REMONTE bruyamment : c'est un vrai bug, pas une DB
  absente, et un faux-vert CI serait inacceptable.
- **Opt-in CI** : si l'env `REQUIRE_REAL_DB` est vrai, une indisponibilité de DB
  devient un ÉCHEC DUR (`pytest.fail`) au lieu d'un skip — la CI peut ainsi
  GARANTIR que les tests real_db s'exécutent (sinon rouge).

Marqueur : décorer les tests DB réelle avec `@pytest.mark.real_db`
(déclaré dans `pytest.ini`).
"""
from __future__ import annotations

import os
import socket
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings
from src.core.database import Base
# `import src.main` enregistre TOUS les modèles dans Base.metadata, y compris
# ceux ABSENTS de src/models/__init__.py (ex. billing.py) : create_all/TRUNCATE
# couvrent ainsi toutes les tables même en usage standalone (sans conftest).
import src.main  # noqa: F401

# Erreurs signalant une DB réellement INJOIGNABLE / la base de test absente :
# elles seules produisent un skip gracieux. Toute autre exception (schéma,
# extension, mapping ORM) remonte — c'est un bug, pas une DB manquante.
_UNAVAILABLE_ERRORS: tuple[type[BaseException], ...] = (
    ConnectionError,
    OSError,                              # inclut socket.gaierror, ConnectionRefusedError
    socket.gaierror,
    asyncpg.exceptions.CannotConnectNowError,
    asyncpg.exceptions.InvalidCatalogNameError,        # base inexistante
    asyncpg.exceptions.InvalidAuthorizationSpecificationError,
    asyncpg.exceptions.InsufficientPrivilegeError,     # droits CREATE DATABASE/EXTENSION
)


def _real_db_required() -> bool:
    """`REQUIRE_REAL_DB` vrai => une indisponibilité doit FAIRE ÉCHOUER (CI)."""
    return os.getenv("REQUIRE_REAL_DB", "").strip().lower() in ("1", "true", "yes", "on")

# Base de test dédiée, jetable. JAMAIS la base de dev.
TEST_DB_NAME = "chatbot_saas_test"

# Diagnostic mis en cache : on ne retente pas la connexion à chaque test.
#   checked  : le bootstrap a-t-il déjà été tenté ?
#   ok       : a-t-il réussi ?
#   reason   : message de skip si échec.
_state: dict[str, object] = {"checked": False, "ok": False, "reason": ""}


def _swap_db(url: str, dbname: str) -> str:
    """Renvoie `url` avec le nom de base remplacé par `dbname` (schéma conservé)."""
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{dbname}"))


def _asyncpg_dsn(url: str) -> str:
    """URL SQLAlchemy (`postgresql+asyncpg://…`) -> DSN asyncpg (`postgresql://…`)."""
    parts = urlsplit(url)
    scheme = parts.scheme.split("+", 1)[0]  # postgresql+asyncpg -> postgresql
    return urlunsplit(parts._replace(scheme=scheme))


def test_database_url() -> str:
    """URL SQLAlchemy async de la base de TEST (dérivée de DATABASE_URL)."""
    return _swap_db(settings.DATABASE_URL, TEST_DB_NAME)


async def _create_database_if_absent() -> None:
    """Crée `chatbot_saas_test` si absente, via une connexion « maintenance ».

    On se connecte à la base de dev existante (`chatbot_saas`) — dont l'user a
    forcément les droits — plutôt qu'à `postgres` (pas toujours accessible).
    CREATE DATABASE ne peut pas tourner dans une transaction : asyncpg exécute
    en autocommit hors transaction explicite, ce qui convient."""
    maint_dsn = _asyncpg_dsn(settings.DATABASE_URL)  # base de dev = maintenance
    conn = await asyncpg.connect(maint_dsn)
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB_NAME
        )
        if not exists:
            # Nom de base non paramétrable : c'est une constante du module (pas
            # d'entrée utilisateur), aucune injection possible.
            await conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    finally:
        await conn.close()


async def _bootstrap_schema() -> None:
    """Pose extensions + config FTS puis le schéma (`create_all`) sur la base de test.

    Réplique les prérequis que les migrations posent et que `create_all` ne
    connaît pas : extension `vector` (colonne `kb_chunks.embedding`), extension
    `unaccent` + configuration `french_unaccent` (colonne générée
    `kb_chunks.tsv`). Idempotent : ré-exécutable sans erreur."""
    engine = create_async_engine(test_database_url(), future=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
            # CREATE TEXT SEARCH CONFIGURATION n'a pas d'IF NOT EXISTS : garde
            # idempotente via un bloc DO qui teste pg_ts_config.
            await conn.execute(text(
                "DO $$ BEGIN "
                "  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'french_unaccent') THEN "
                "    CREATE TEXT SEARCH CONFIGURATION french_unaccent (COPY = french); "
                "    ALTER TEXT SEARCH CONFIGURATION french_unaccent "
                "      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem; "
                "  END IF; "
                "END $$;"
            ))
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


async def _ensure_test_db() -> bool:
    """Garantit base + schéma. Renvoie False (raison cachée) si DB INDISPONIBLE.

    Seules les erreurs d'INDISPONIBILITÉ (`_UNAVAILABLE_ERRORS` : connexion
    impossible, base absente, droits) produisent un skip gracieux. Toute autre
    exception (échec `create_all`/`CREATE EXTENSION`/mapping ORM alors que la DB
    RÉPOND) REMONTE telle quelle : faux-vert CI exclu. Le résultat est mémorisé
    (un seul essai par session)."""
    if _state["checked"]:
        return bool(_state["ok"])
    _state["checked"] = True
    try:
        await _create_database_if_absent()
        await _bootstrap_schema()
        _state["ok"] = True
    except _UNAVAILABLE_ERRORS as exc:  # DB injoignable/absente -> skip gracieux.
        _state["ok"] = False
        _state["reason"] = f"DB de test indisponible ({type(exc).__name__}: {exc})"
    # NB : aucune autre exception n'est attrapée — un bug de schéma/extension
    # remonte et fait ÉCHOUER les tests real_db (et non un skip silencieux).
    return bool(_state["ok"])


def _skip_or_fail_unavailable() -> None:
    """DB indisponible : `pytest.fail` si `REQUIRE_REAL_DB`, sinon `pytest.skip`."""
    reason = str(_state["reason"]) or "DB de test indisponible"
    if _real_db_required():
        pytest.fail(f"REQUIRE_REAL_DB=1 mais {reason}")
    pytest.skip(reason)


async def _truncate_all(conn) -> None:
    """Vide TOUTES les tables du métadata (RESTART IDENTITY CASCADE)."""
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    if tables:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest_asyncio.fixture
async def pg_engine():
    """Engine async sur la base de test, table rase avant ET après le test.

    Engine créé par test (et non session-scopé) : pytest-asyncio donne une
    boucle d'événements par test, et un engine asyncpg est lié à SA boucle —
    le recréer évite tout « attached to a different loop ». Le bootstrap base/
    schéma reste, lui, fait une seule fois (cache `_state`)."""
    if not await _ensure_test_db():
        _skip_or_fail_unavailable()
    engine = create_async_engine(test_database_url(), future=True)
    async with engine.begin() as conn:
        await _truncate_all(conn)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await _truncate_all(conn)
        await engine.dispose()


@pytest_asyncio.fixture
async def pg_session(pg_engine) -> AsyncSession:
    """`AsyncSession` branchée sur la base de test jetable.

    Pour les tests de CONCURRENCE (verrous), demander aussi `pg_engine` et
    ouvrir des sessions supplémentaires (connexions distinctes)."""
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
