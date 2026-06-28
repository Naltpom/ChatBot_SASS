"""Démonstration du harness DB réelle (PR-10) : prouve ce que FakeSession MASQUE.

Chaque test ici tomberait dans le piège « vert à tort » sous FakeSession :
- `with_for_update` no-op  -> aucun verrou réellement pris ;
- opérateur `>=`/`LIKE` neutralisé -> le filtre laisse tout passer ;
- pas de jointure          -> un `.join(...)` ne renverrait rien de cohérent ;
- pas d'isolation prouvée  -> un filtre tenant pourrait fuiter.

Sur un vrai Postgres jetable, on observe le comportement RÉEL. Tests marqués
`real_db` : skip gracieux si la base de test est injoignable (cf. real_db.py).
"""
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.models.bot import Bot
from src.models.user import Organization, User

pytestmark = pytest.mark.real_db


# --- Helpers de seed -------------------------------------------------------

async def _mk_user(session: AsyncSession, email: str) -> User:
    u = User(email=email, hashed_password="x", name="Test")
    session.add(u)
    await session.flush()
    return u


async def _mk_org(session: AsyncSession, name: str, owner: User) -> Organization:
    org = Organization(name=name, owner_user_id=owner.id)
    session.add(org)
    await session.flush()
    return org


# --- 1. with_for_update : verrou RÉELLEMENT pris (no-op sous FakeSession) ---

@pytest.mark.asyncio
async def test_with_for_update_takes_a_real_lock(pg_engine):
    """SELECT … FOR UPDATE pose un vrai verrou ligne : une 2e session en
    FOR UPDATE NOWAIT échoue (lock_not_available, SQLSTATE 55P03). Sous
    FakeSession `with_for_update` est un no-op -> aucun verrou -> ce test
    serait impossible à écrire (rien à observer)."""
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        u = await _mk_user(s, "lock@test.dev")
        bot = Bot(name="locked", owner_user_id=u.id)
        s.add(bot)
        await s.commit()
        bot_id = bot.id

    # Session A garde le verrou ouvert (transaction non committée).
    async with Session() as a:
        await a.begin()
        locked = (
            await a.execute(select(Bot).where(Bot.id == bot_id).with_for_update())
        ).scalar_one()
        assert locked.id == bot_id

        # Session B (connexion distincte) : FOR UPDATE NOWAIT -> doit échouer.
        async with Session() as b:
            await b.begin()
            with pytest.raises(Exception) as ei:
                await b.execute(
                    select(Bot).where(Bot.id == bot_id).with_for_update(nowait=True)
                )
            # asyncpg LockNotAvailableError -> SQLSTATE 55P03 : preuve que le
            # verrou de A est bien réel (et non un no-op).
            assert getattr(ei.value.orig, "sqlstate", None) == "55P03"
            await b.rollback()
        await a.rollback()


# --- 2. Filtre non-`eq` : sous-ensemble CORRECT (neutralisé sous FakeSession) -

@pytest.mark.asyncio
async def test_non_eq_filters_select_correct_subset(pg_session: AsyncSession):
    """`>=` et `LIKE` renvoient le BON sous-ensemble. Sous FakeSession ces
    opérateurs sont neutralisés (prédicat « vrai ») -> tout passerait."""
    u = await _mk_user(pg_session, "filter@test.dev")
    for name, temp in [("alpha", 10), ("beta", 50), ("alphabet", 90)]:
        pg_session.add(Bot(name=name, owner_user_id=u.id, temperature=temp))
    await pg_session.commit()

    # >= : seules les températures 50 et 90.
    rows = (
        await pg_session.execute(select(Bot.temperature).where(Bot.temperature >= 50))
    ).scalars().all()
    assert sorted(rows) == [50, 90]

    # LIKE : "alpha%" matche alpha + alphabet, pas beta.
    names = (
        await pg_session.execute(
            select(Bot.name).where(Bot.name.like("alpha%")).order_by(Bot.name)
        )
    ).scalars().all()
    assert names == ["alpha", "alphabet"]


# --- 3. Jointure : résultat attendu (FakeSession ne joint pas) --------------

@pytest.mark.asyncio
async def test_join_returns_expected_rows(pg_session: AsyncSession):
    """`select(...).join(...)` corrèle deux tables. FakeSession n'a aucune
    notion de jointure."""
    owner = await _mk_user(pg_session, "owner@test.dev")
    acme = await _mk_org(pg_session, "Acme", owner)
    globex = await _mk_org(pg_session, "Globex", owner)
    pg_session.add(Bot(name="acme-bot", organization_id=acme.id))
    pg_session.add(Bot(name="globex-bot", organization_id=globex.id))
    await pg_session.commit()

    names = (
        await pg_session.execute(
            select(Bot.name)
            .join(Organization, Bot.organization_id == Organization.id)
            .where(Organization.name == "Acme")
        )
    ).scalars().all()
    assert names == ["acme-bot"]


# --- 4. Isolation tenant : aucune fuite entre organisations ----------------

@pytest.mark.asyncio
async def test_tenant_isolation_filters_by_org(pg_session: AsyncSession):
    """Une requête filtrée par organisation ne renvoie QUE les bots de cette
    org. Preuve d'isolation tenant sur DB réelle (jamais prouvée sous
    FakeSession où le filtrage est approximatif)."""
    owner = await _mk_user(pg_session, "tenant@test.dev")
    org_a = await _mk_org(pg_session, "OrgA", owner)
    org_b = await _mk_org(pg_session, "OrgB", owner)
    pg_session.add_all([
        Bot(name="a1", organization_id=org_a.id),
        Bot(name="a2", organization_id=org_a.id),
        Bot(name="b1", organization_id=org_b.id),
    ])
    await pg_session.commit()

    a_names = (
        await pg_session.execute(
            select(Bot.name).where(Bot.organization_id == org_a.id).order_by(Bot.name)
        )
    ).scalars().all()
    assert a_names == ["a1", "a2"]

    # Agrégation COUNT par org : 2 pour A, 1 pour B (SQL réel, pas FakeSession).
    count_b = await pg_session.scalar(
        select(func.count()).select_from(Bot).where(Bot.organization_id == org_b.id)
    )
    assert count_b == 1
