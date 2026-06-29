"""Jobs éphémères de génération d'arbre (wizard) : progression temps réel pour
le flux SSE.

Cycle de vie = quelques dizaines de secondes (le temps de scraper les pages et
d'appeler l'IA). AUCUNE persistance DB. L'état est partagé entre workers via
Redis si REDIS_URL est définie (même client que rate_limit, decode_responses),
sinon dict mémoire process (repli mono-worker, comme les rate-limiters). La
tâche de fond ÉCRIT l'état ; l'endpoint SSE le LIT (poll ~0,4 s).

La collecte du texte source (URLs + PDF) est factorisée ici (build_source_text)
et réutilisée par l'endpoint synchrone /generate-from-sources ET par la tâche
de fond du flux SSE.
"""
import asyncio
import json
import logging
import uuid
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from src.services.kb_service import fetch_user_url, pdf_to_text
from src.services.rate_limit import _get_redis  # client redis.asyncio partagé (ou None)
from src.services.safe_fetch import FetchError
from src.services.tree_generator import MAX_SOURCE_CHARS, TreeGenerationError, generate_tree

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 600
_KEY = "treejob:"
# Repli mémoire (mono-worker / Redis absent). Clé = job_id.
_mem: dict[str, dict] = {}

# Strong refs sur les tâches de fond : l'event loop ne garde qu'une weakref,
# une tâche longue pourrait être ramassée par le GC en plein vol (cf. kb.py).
_tasks: set[asyncio.Task] = set()

# En-têtes de section FR injectées dans le texte source, par type de source.
_SECTION_HEADERS = {
    "site": "Site",
    "contact": "Contact",
    "aide": "Page d'aide",
    "qr": "Questions / réponses",
    "autre": "Autre",
}

# Callback de progression : (libellé FR, pourcentage 0-100) -> coroutine.
ProgressCb = Callable[[str, int], Awaitable[None]]


# ---------------------------------------------------------------------------
# Store (Redis si dispo, sinon mémoire process)
async def _save(job_id: str, state: dict) -> None:
    client = _get_redis()
    if client is not None:
        try:
            await client.set(_KEY + job_id, json.dumps(state), ex=JOB_TTL_SECONDS)
            return
        except Exception as exc:  # panne Redis : repli mémoire (fail-open)
            logger.warning("tree_jobs: Redis indisponible (%s) -> mémoire", exc)
    _mem[job_id] = state


async def get(job_id: str) -> Optional[dict]:
    client = _get_redis()
    if client is not None:
        try:
            raw = await client.get(_KEY + job_id)
            return json.loads(raw) if raw else None
        except Exception as exc:
            logger.warning("tree_jobs: lecture Redis impossible (%s) -> mémoire", exc)
    return _mem.get(job_id)


async def create(user_id: int, bot_id: Optional[int] = None) -> str:
    job_id = uuid.uuid4().hex
    await _save(job_id, {
        "status": "running", "stage": "Préparation…", "pct": 3,
        "tree_json": None, "error": None, "user_id": user_id,
        # bot_id : porté par les jobs de l'onboarding plugin (lié à un bot précis)
        # pour que generate-status n'autorise QUE le couple (user, bot). None pour
        # le wizard dashboard (autorisation par user_id seul, inchangée).
        "bot_id": bot_id,
    })
    return job_id


async def _update(job_id: str, **patch) -> None:
    state = await get(job_id)
    if state is None:  # job expiré entre-temps : on repart d'un socle minimal
        state = {"status": "running", "stage": "…", "pct": 0, "tree_json": None, "error": None, "user_id": None}
    state.update({k: v for k, v in patch.items() if v is not None})
    await _save(job_id, state)


def spawn(coro: Awaitable) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def public_status(job: dict) -> dict:
    """Projection PUBLIQUE d'un job pour le poll JSON (endpoints generate-status) :
    status/stage/pct/tree_json/error, SANS les champs d'ownership (user_id/bot_id)
    que l'appelant a déjà vérifiés. Partagée par les surfaces /api/account et
    /api/embed."""
    return {
        "status": job.get("status"),
        "stage": job.get("stage"),
        "pct": job.get("pct"),
        "tree_json": job.get("tree_json"),
        "error": job.get("error"),
    }


# ---------------------------------------------------------------------------
# Collecte du texte source (partagée endpoint sync + tâche SSE)
async def build_source_text(
    parsed: list[dict], pdf_blobs: list[bytes], context: Optional[str],
    on_progress: Optional[ProgressCb] = None,
) -> str:
    """URLs (fetch_user_url anti-SSRF) + PDF (pdf_to_text) -> texte source borné.

    `on_progress(libellé, pct)` est appelé avant chaque source (flux SSE) ; None
    pour l'appel synchrone. Une source en échec (DNS/3xx/4xx/SSRF/PDF illisible)
    est ignorée. Lève TreeGenerationError si rien d'exploitable (<50 c.)."""
    sections: list[tuple[str, str]] = []
    total = max(1, len(parsed) + len(pdf_blobs))
    done = 0

    def _pct() -> int:
        # Bande 10-65 % pour la phase de collecte (l'IA prend ensuite 78->100).
        return 10 + int(55 * done / total)

    for src in parsed:
        if on_progress:
            host = urlparse(src["url"]).hostname or src["url"]
            await on_progress(f"Lecture de {host}…", _pct())
        try:
            text = await fetch_user_url(src["url"])
            if text:
                sections.append((_SECTION_HEADERS.get(src["type"], "Autre"), text))
        except FetchError:
            pass  # source injoignable : ignorée
        except Exception as exc:  # robustesse : un parse foireux ne tue pas le job
            logger.warning("tree_jobs: fetch %s erreur inattendue %r", src["url"], exc)
        done += 1

    for blob in pdf_blobs:
        if on_progress:
            await on_progress("Lecture d'un document PDF…", _pct())
        try:
            text, _ = await asyncio.to_thread(pdf_to_text, blob)
            text = text.strip()
            if text:
                sections.append(("Document PDF", text))
        except FetchError:
            pass  # PDF illisible : ignoré
        done += 1

    body = "\n\n".join(f"=== {header} ===\n{text}" for header, text in sections).strip()
    if len(body) < 50:
        raise TreeGenerationError("Aucun contenu exploitable récupéré")

    combined = body
    if context and context.strip():
        combined = f"Contexte entreprise : {context.strip()[:500]}\n\n{body}"
    return combined[:MAX_SOURCE_CHARS]


# ---------------------------------------------------------------------------
# Tâche de fond : collecte -> génération, en publiant la progression
async def run_generation(
    job_id: str, parsed: list[dict], context: Optional[str], pdf_blobs: list[bytes],
    post_process: Optional[Callable[[dict], dict]] = None,
) -> None:
    """`post_process`, s'il est fourni, transforme l'arbre généré AVANT publication
    (ex. élagage par modules de l'onboarding plugin) ; None = arbre publié tel quel."""
    async def progress(stage: str, pct: int) -> None:
        await _update(job_id, stage=stage, pct=pct)

    try:
        combined = await build_source_text(parsed, pdf_blobs, context, on_progress=progress)
        await _update(job_id, stage="Construction de l'arbre par l'IA…", pct=78)
        tree = await generate_tree(combined)
        if post_process is not None:
            tree = post_process(tree)
        await _update(job_id, status="done", stage="Terminé", pct=100, tree_json=tree)
    except TreeGenerationError as exc:
        await _update(job_id, status="error", error=str(exc))
    except Exception:
        logger.exception("tree_jobs: échec inattendu du job %s", job_id)
        await _update(job_id, status="error", error="La génération a échoué, réessayez.")
