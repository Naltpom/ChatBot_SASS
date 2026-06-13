"""Base de connaissances (RAG) d'un bot : sources, ingestion, recherche.

Acces : meme gabarit que routers/bots.py — membre de l'org du bot avec la
permission 'context' (admins d'org et superadmins passent toujours).
L'ingestion part en tache de fond (asyncio.create_task) : la requete repond
immediatement avec status='pending', le front poll GET /kb/sources.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Coroutine

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user
from src.models.kb import KbSearchRequest, KbSource, KbSourceCreate, KbSourceOut
from src.models.user import User
from src.routers.bots import _check_bot_perm, _get_accessible_bot
from src.services.kb_service import (
    MAX_PDF_BYTES,
    MAX_SOURCES_PER_BOT,
    ingest_source,
    search_chunks,
)

router = APIRouter(prefix="/api", tags=["kb"])

# Une source pending plus vieille que ce delai = tache d'ingestion morte
# (restart/--reload du process) : basculee en error au prochain GET /kb/sources
STALE_PENDING_MINUTES = 30
STALE_PENDING_ERROR = "Ingestion interrompue (redémarrage du serveur) — supprimez puis recréez la source"

# References FORTES sur les taches d'ingestion : l'event loop ne garde qu'une
# weakref, une tache longue (sitemap 30 pages) pourrait etre ramassee par le
# GC en plein vol (pitfall documente asyncio).
_ingest_tasks: set[asyncio.Task] = set()


def _spawn_ingest(coro: Coroutine) -> None:
    task = asyncio.create_task(coro)
    _ingest_tasks.add(task)
    task.add_done_callback(_ingest_tasks.discard)


async def _check_sources_cap(db: AsyncSession, bot_id: int) -> None:
    total = (await db.execute(
        select(func.count(KbSource.id)).where(KbSource.bot_id == bot_id)
    )).scalar() or 0
    if total >= MAX_SOURCES_PER_BOT:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"{MAX_SOURCES_PER_BOT} sources maximum par bot")


@router.post("/bots/{bot_id}/kb/sources", response_model=KbSourceOut)
async def create_source(
    bot_id: int,
    body: KbSourceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Source url | sitemap | text (le PDF passe par l'endpoint multipart)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    await _check_sources_cap(db, bot.id)

    text_content = None
    if body.type in ("url", "sitemap"):
        ref = (body.ref or "").strip()
        if not ref.startswith("https://"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "URL invalide (https:// requis)")
    else:  # text
        text_content = (body.content or "").strip()
        if not text_content:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Le texte de la source est vide")
        ref = (body.title or "").strip() or text_content[:80]

    source = KbSource(bot_id=bot.id, type=body.type, ref=ref, status="pending")
    db.add(source)
    await db.commit()
    await db.refresh(source)

    # Tache de fond : session DB dediee, le payload texte reste en memoire
    _spawn_ingest(ingest_source(source.id, text_content=text_content))
    return source


@router.post("/bots/{bot_id}/kb/sources/pdf", response_model=KbSourceOut)
async def create_pdf_source(
    bot_id: int,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload PDF (multipart). Le fichier n'est JAMAIS persiste sur disque :
    les octets partent en memoire vers la tache d'ingestion."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    await _check_sources_cap(db, bot.id)

    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            "PDF trop volumineux (10 Mo max)")
    # Magic en tete : l'extension seule est forgeable
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Fichier PDF attendu")

    source = KbSource(bot_id=bot.id, type="pdf",
                      ref=(file.filename or "document.pdf")[:200], status="pending")
    db.add(source)
    await db.commit()
    await db.refresh(source)

    _spawn_ingest(ingest_source(source.id, pdf_bytes=data))
    return source


@router.get("/bots/{bot_id}/kb/sources")
async def list_sources(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Liste + statuts (sert au polling d'ingestion cote dashboard).

    Rattrapage des orphelins ICI (pas de sweep au lifespan : en multi-worker
    le demarrage d'un worker marquerait en erreur les ingestions en vol des
    autres) : un pending trop ancien ne changera plus jamais d'etat, on le
    bascule en error pour que le dashboard arrete de poller."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    rows = (await db.execute(
        select(KbSource).where(KbSource.bot_id == bot.id)
        .order_by(KbSource.created_at.desc(), KbSource.id.desc())
    )).scalars().all()
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_PENDING_MINUTES)
    stale = [r for r in rows if r.status == "pending" and r.created_at < cutoff]
    if stale:
        for row in stale:
            row.status = "error"
            row.error = STALE_PENDING_ERROR
        await db.commit()
    return {"total": len(rows),
            "sources": [KbSourceOut.model_validate(row) for row in rows]}


@router.delete("/bots/{bot_id}/kb/sources/{source_id}")
async def delete_source(
    bot_id: int,
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    source = await db.get(KbSource, source_id)
    if source is None or source.bot_id != bot.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source introuvable")
    await db.delete(source)  # kb_chunks purges par la FK CASCADE
    await db.commit()
    return {"deleted": True}


@router.post("/bots/{bot_id}/kb/search")
async def search(
    bot_id: int,
    body: KbSearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Test de recherche hybride (aussi le smoke sans IA) : toujours 200,
    results vide si le bot n'a aucun extrait."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    mode, results = await search_chunks(db, bot.id, body.query, k=5)
    return {"mode": mode, "results": results}
