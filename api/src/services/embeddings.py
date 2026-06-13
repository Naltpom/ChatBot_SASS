"""Embeddings 100 % locaux (fastembed / ONNX CPU) pour la base de connaissances.

Init PARESSEUSE : le modele (download ~100-400 Mo au premier usage, cache
persistant FASTEMBED_CACHE_PATH) n'est JAMAIS charge au startup — premiere
demande seulement, dans asyncio.to_thread sous lock. Echec de chargement
(reseau coupe, modele inconnu de la version fastembed) -> log UNE fois,
_failed jusqu'au prochain restart du process, les appelants degradent en
FTS seul (embeddings NULL).
"""
import asyncio
import logging
from typing import Optional

from src.core.config import settings

logger = logging.getLogger(__name__)

_model = None
_failed = False
_lock = asyncio.Lock()

_BATCH_SIZE = 64

# Prefixes "query: " / "passage: " requis par les modeles e5 UNIQUEMENT
# (fastembed generique ne les ajoute pas — verifie sur la 0.8 : query_embed
# delegue a embed sans prefixe). Le defaut MiniLM n'en utilise pas.
_USE_E5_PREFIXES = "e5" in settings.EMBEDDINGS_MODEL.lower()


async def _get_model():
    """Singleton paresseux, protege contre les inits concurrentes."""
    global _model, _failed
    if _model is not None:
        return _model
    if _failed:
        return None
    async with _lock:
        if _model is not None or _failed:
            return _model
        try:
            from fastembed import TextEmbedding  # import paresseux (dep lourde)
            _model = await asyncio.to_thread(
                TextEmbedding,
                model_name=settings.EMBEDDINGS_MODEL,
                cache_dir=settings.FASTEMBED_CACHE_PATH,
            )
            logger.info("Modèle d'embeddings %s chargé", settings.EMBEDDINGS_MODEL)
        except Exception:
            logger.exception(
                "Modèle d'embeddings %s indisponible — recherche en FTS seul "
                "jusqu'au prochain redémarrage", settings.EMBEDDINGS_MODEL)
            _failed = True
            return None
    return _model


async def embed_passages(texts: list[str]) -> Optional[list[list[float]]]:
    """Vecteurs des extraits a indexer, par lots. None = modele indisponible."""
    model = await _get_model()
    if model is None:
        return None
    inputs = [f"passage: {t}" for t in texts] if _USE_E5_PREFIXES else texts
    out: list[list[float]] = []
    for i in range(0, len(inputs), _BATCH_SIZE):
        batch = inputs[i:i + _BATCH_SIZE]
        vectors = await asyncio.to_thread(
            lambda b=batch: [v.tolist() for v in model.embed(b)])
        out.extend(vectors)
    return out


async def embed_query(text: str) -> Optional[list[float]]:
    """Vecteur d'une requete de recherche. None = modele indisponible."""
    model = await _get_model()
    if model is None:
        return None
    query = f"query: {text}" if _USE_E5_PREFIXES else text
    vectors = await asyncio.to_thread(
        lambda: [v.tolist() for v in model.embed([query])])
    return vectors[0]


def to_pgvector(vec: list[float]) -> str:
    """Format texte pgvector ('[0.1,0.2,...]'), passe en parametre str +
    CAST(:e AS vector) — evite tout codec asyncpg dedie."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
