"""Assistant Chapote CM : consignes et connaissances du dépôt remises sur le bot au démarrage, seulement si elles changent."""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from scripts import create_cm_assistant as m
from src.models.bot import Bot
from src.models.kb import KbSource
from src.models.user import User


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_sync_only_when_changed(pg_engine, pg_session, monkeypatch):
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(m, "AsyncSessionLocal", Session)
    ingested = []

    async def fake_ingest(sid, text_content=None):
        ingested.append(sid)
    monkeypatch.setattr(m, "ingest_source", fake_ingest)

    # Aucun bot : rien n'est créé.
    await m.sync_on_startup()
    assert (await pg_session.execute(select(Bot))).first() is None

    owner = User(email="staff@t.dev", name="Staff", hashed_password="x", is_superadmin=True)
    pg_session.add(owner)
    await pg_session.flush()
    bot = Bot(owner_user_id=owner.id, name=m.BOT_NAME, system_prompt="ancien", is_active=True)
    pg_session.add(bot)
    await pg_session.flush()
    pg_session.add(KbSource(bot_id=bot.id, type="text", ref="Ancien titre", status="ready"))
    await pg_session.commit()

    await m.sync_on_startup()
    n = len(m._kb_files())
    refs = (await pg_session.execute(select(KbSource.ref).where(KbSource.bot_id == bot.id))).scalars().all()
    assert len(refs) == n and "Ancien titre" not in refs and len(ingested) == n
    await pg_session.refresh(bot)
    assert bot.system_prompt.startswith("Tu es « Assistant Chapote CM »")
    assert bot.mode == "hybrid" and bot.tree_json["nodes"]["root"]["message"] == "Bonjour ! Comment puis-je vous aider ?"

    # Rien n'a changé : aucune nouvelle ingestion.
    await m.sync_on_startup()
    assert len(ingested) == n
