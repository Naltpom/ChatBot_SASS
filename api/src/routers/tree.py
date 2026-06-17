"""Génération d'arbre par IA à partir de SOURCES (URLs + PDF), pour le wizard
de création de bot du dashboard.

Deux surfaces :
- POST /api/tree/validate-url     : sonde un statut HTTP (anti-SSRF via
  safe_probe), répond TOUJOURS 200 avec {ok, status, reason} pour que le front
  affiche un voyant sans gérer d'erreur réseau.
- POST /api/tree/generate-from-sources : agrège URLs + PDF en un texte source
  (via tree_jobs.build_source_text, partagé avec le flux SSE) puis appelle
  tree_generator.generate_tree. Le front retombe sur le preset sur TOUT non-200.

Rate-limit par UTILISATEUR (treegen_limiter, clé scoping user.id) : protection
coût provider, pas un gating de plan.
"""
import asyncio
import json
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.core.security import get_current_user
from src.models.user import User
from src.services import tree_jobs
from src.services.kb_service import MAX_PDF_BYTES
from src.services.rate_limit import treegen_limiter
from src.services.safe_fetch import FetchError, safe_probe
from src.services.tree_generator import TreeGenerationError, generate_tree

router = APIRouter(prefix="/api/tree", tags=["tree"])

MAX_SOURCES = 5
MAX_PDFS = 2
ALLOWED_TYPES = {"site", "contact", "aide", "qr", "autre"}


class ValidateUrlRequest(BaseModel):
    url: str


@router.post("/validate-url")
async def validate_url(body: ValidateUrlRequest, user: User = Depends(get_current_user)):
    """Sonde le statut HTTP d'une URL (sans suivre les redirections, anti-SSRF).
    Répond TOUJOURS 200 avec {ok, status, reason}. ok=true UNIQUEMENT sur 200."""
    try:
        code = await safe_probe(body.url.strip())
    except FetchError:
        # https manquant rejeté par resolve_public_ip -> on distingue le motif
        # pour le front (voyant "doit être en https") des vrais injoignables.
        reason = "not_https" if not body.url.strip().lower().startswith("https://") else "unreachable"
        return {"ok": False, "status": None, "reason": reason}

    if code == 200:
        return {"ok": True, "status": 200, "reason": None}
    if 300 <= code < 400:
        return {"ok": False, "status": code, "reason": "redirect"}
    if code >= 400:
        return {"ok": False, "status": code, "reason": "http_error"}
    # 1xx/2xx non-200 : traité comme une erreur de récupération
    return {"ok": False, "status": code, "reason": "http_error"}


def _parse_sources(sources: str) -> list[dict]:
    """JSON array -> liste [{url, type}] validée (<=5, type toléré -> 'autre')."""
    try:
        raw = json.loads(sources)
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sources invalides (JSON attendu)")
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Sources invalides (liste attendue)")
    if len(raw) > MAX_SOURCES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"{MAX_SOURCES} sources maximum")
    parsed: list[dict] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("url"), str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Chaque source doit avoir une 'url'")
        stype = item.get("type")
        if stype not in ALLOWED_TYPES:
            stype = "autre"
        parsed.append({"url": item["url"].strip(), "type": stype})
    return parsed


async def _read_pdfs(files: list[UploadFile]) -> list[bytes]:
    """Lit et valide les PDF (<=2, <=MAX_PDF_BYTES, magic %PDF-)."""
    if len(files) > MAX_PDFS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"{MAX_PDFS} fichiers PDF maximum")
    out: list[bytes] = []
    for f in files:
        data = await f.read(MAX_PDF_BYTES + 1)
        if len(data) > MAX_PDF_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                "PDF trop volumineux (10 Mo max)")
        if not data.startswith(b"%PDF-"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Fichier PDF attendu")
        out.append(data)
    return out


@router.post("/generate-from-sources")
async def generate_from_sources(
    sources: str = Form(...),
    context: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
):
    """Multipart : agrège les URLs + PDF en un texte source (tree_jobs.
    build_source_text, partagé avec le flux SSE) puis génère l'arbre. 422 si rien
    d'exploitable ou IA en échec, 413 si PDF trop gros, 429 si quota atteint."""
    # Rate-limit par utilisateur AVANT tout fetch/appel IA (coût provider)
    if not await treegen_limiter.check(f"treegen:user:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations d'arbre atteinte pour aujourd'hui — réessayez demain")

    parsed = _parse_sources(sources)
    pdf_blobs = await _read_pdfs(files)
    try:
        combined = await tree_jobs.build_source_text(parsed, pdf_blobs, context)
        tree = await generate_tree(combined)
    except TreeGenerationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return {"tree_json": tree}


# ---------------------------------------------------------------------------
# Variante ASYNCHRONE (flux SSE) : POST /jobs démarre la génération en tâche de
# fond et rend un job_id ; GET /jobs/{id}/stream diffuse la progression réelle
# (Récupération -> Construction -> Terminé) et l'arbre final. Permet au wizard
# d'afficher un avancement temps réel et d'enchaîner dès que l'arbre est prêt.
@router.post("/jobs")
async def create_job(
    sources: str = Form(...),
    context: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
):
    """Démarre un job de génération. Mêmes garde-fous que /generate-from-sources
    (rate-limit user, <=5 URLs, <=2 PDF) AVANT de lancer la tâche de fond."""
    if not await treegen_limiter.check(f"treegen:user:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations d'arbre atteinte pour aujourd'hui — réessayez demain")
    parsed = _parse_sources(sources)
    pdf_blobs = await _read_pdfs(files)  # lecture des octets DANS la requête (UploadFile fermé après)
    job_id = await tree_jobs.create(user.id)
    tree_jobs.spawn(tree_jobs.run_generation(job_id, parsed, context, pdf_blobs))
    return {"job_id": job_id}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/jobs/{job_id}/stream")
async def stream_job(
    job_id: str,
    user: User = Depends(get_current_user),
):
    """Flux SSE de la progression d'un job (poll ~0,4 s de l'état partagé).
    Émet des events {type:'progress',stage,pct} puis {type:'done',tree_json} ou
    {type:'error',message}, et ferme le flux. 404 si le job n'est pas à cet
    utilisateur."""
    job = await tree_jobs.get(job_id)
    if job is None or job.get("user_id") != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Génération introuvable")

    async def gen():
        last = None
        deadline = time.monotonic() + 150  # garde-fou : jamais de flux infini
        while time.monotonic() < deadline:
            cur = await tree_jobs.get(job_id)
            if cur is None:
                yield _sse({"type": "error", "message": "Génération expirée"})
                return
            snap = (cur.get("status"), cur.get("stage"), cur.get("pct"))
            if snap != last:
                last = snap
                state = cur.get("status")
                if state == "done":
                    yield _sse({"type": "done", "tree_json": cur.get("tree_json")})
                    return
                if state == "error":
                    yield _sse({"type": "error", "message": cur.get("error") or "Échec de la génération"})
                    return
                yield _sse({"type": "progress", "stage": cur.get("stage"), "pct": cur.get("pct")})
            await asyncio.sleep(0.4)
        yield _sse({"type": "error", "message": "Délai dépassé"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # désactive le buffering nginx (SSE temps réel)
    })
