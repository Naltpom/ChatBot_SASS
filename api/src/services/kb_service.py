"""Base de connaissances : extraction, chunking, ingestion, recherche hybride.

Ingestion = tache de fond (asyncio.create_task depuis routers/kb.py) qui ouvre
SA PROPRE session DB. En multi-worker prod la tache vit dans le worker qui a
recu la requete : acceptable (statut persiste en base, le polling du dashboard
fonctionne quel que soit le worker interroge).

Recherche HYBRIDE : cosine pgvector (top 10) + FTS websearch_to_tsquery
french_unaccent (top 10 — config unaccent+french_stem creee par la migration,
« telephone » matche « téléphone »), fusion RRF. Degradation propre en FTS
seul si le modele d'embeddings est indisponible.
"""
import asyncio
import html
import logging
import re
import xml.etree.ElementTree as ET
from io import BytesIO
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import delete, func, select, text

from src.core.database import AsyncSessionLocal
from src.models.kb import KbChunk, KbSource
from src.services.embeddings import embed_passages, embed_query, to_pgvector
from src.services.safe_fetch import FetchError, safe_get

logger = logging.getLogger(__name__)

CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
MIN_CHUNK_CHARS = 40
MAX_SITEMAP_PAGES = 30
MAX_PDF_PAGES = 100
MAX_PDF_BYTES = 10_000_000
MAX_CHUNKS_PER_BOT = 1000
MAX_FETCH_BYTES = 2_000_000
MAX_SOURCES_PER_BOT = 20


# --- Chunking ---

def _normalize(raw: str) -> str:
    """Espaces horizontaux ecrases, lignes vides consecutives reduites."""
    raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def chunk_text(raw: str) -> list[str]:
    """Fenetre glissante ~CHUNK_SIZE chars avec recul au dernier separateur
    naturel (paragraphe > ligne > phrase > espace) dans les 200 derniers
    chars, overlap CHUNK_OVERLAP. Les fragments < MIN_CHUNK_CHARS sont
    ignores."""
    cleaned = _normalize(raw)
    n = len(cleaned)
    chunks: list[str] = []
    start = 0
    while start < n:
        end = min(start + CHUNK_SIZE, n)
        if end < n:
            window_start = max(start + 1, end - 200)
            window = cleaned[window_start:end]
            for sep in ("\n\n", "\n", ". ", " "):
                pos = window.rfind(sep)
                if pos > 0:
                    end = window_start + pos + len(sep)
                    break
        piece = cleaned[start:end].strip()
        if len(piece) >= MIN_CHUNK_CHARS:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


# --- Extraction ---

def html_to_text(page: str) -> str:
    """HTML -> texte brut : memes regex que tree_generator (strip script/style
    puis balises) mais SANS son fetch laxiste ; entites decodees."""
    page = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", page)
    stripped = re.sub(r"(?s)<[^>]+>", "\n", page)
    return _normalize(html.unescape(stripped))


def _local_name(tag: str) -> str:
    """Local-name d'un tag ElementTree ('{ns}loc' -> 'loc')."""
    return tag.rsplit("}", 1)[-1]


def parse_sitemap_urls(xml_content: str, sitemap_url: str) -> tuple[bool, list[str]]:
    """(is_index, urls) : <loc> du sitemap, restreints au host du sitemap
    (anti-pivot), cap MAX_SITEMAP_PAGES. is_index=True si la racine est un
    <sitemapindex> (WordPress/Yoast) : les urls sont alors des SOUS-sitemaps.

    Local-name EXACT 'loc' sous un parent <url>/<sitemap> direct : exclut
    image:loc / video:loc (imbriques plus profond, autre namespace).
    Defense XML sans defusedxml (dep non autorisee) : contenu borne a 2 Mo,
    DOCTYPE/ENTITY rejetes explicitement (XXE/billion laughs), et l'expat de
    Python 3.11 ne resout pas les entites externes."""
    if re.search(r"<!\s*(DOCTYPE|ENTITY)", xml_content, re.IGNORECASE):
        return False, []
    sitemap_host = urlparse(sitemap_url).hostname
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return False, []
    root_name = _local_name(root.tag)
    if root_name == "sitemapindex":
        is_index, parent_name = True, "sitemap"
    elif root_name == "urlset":
        is_index, parent_name = False, "url"
    else:
        return False, []
    urls: list[str] = []
    for parent in root:
        if _local_name(parent.tag) != parent_name:
            continue
        for el in parent:
            if _local_name(el.tag) != "loc" or not (el.text or "").strip():
                continue
            loc = el.text.strip()
            parsed = urlparse(loc)
            if parsed.scheme != "https" or parsed.hostname != sitemap_host:
                continue
            # Dans un urlset, un .xml est presque surement un sitemap imbrique
            # mal declare : on ne l'ingere pas comme une page HTML
            if not is_index and parsed.path.lower().endswith(".xml"):
                continue
            if loc not in urls:
                urls.append(loc)
        if len(urls) >= MAX_SITEMAP_PAGES:
            break
    return is_index, urls[:MAX_SITEMAP_PAGES]


def pdf_to_text(data: bytes) -> tuple[str, int]:
    """(texte, pages lues). Cap MAX_PDF_PAGES : au-dela les pages sont
    ignorees, page_count = pages lues."""
    from pypdf import PdfReader  # import paresseux (dep optionnelle au runtime)
    try:
        reader = PdfReader(BytesIO(data))
        pages = reader.pages[:MAX_PDF_PAGES]
        parts = [(page.extract_text() or "") for page in pages]
    except Exception:
        raise FetchError("PDF illisible")
    return "\n\n".join(parts), len(pages)


async def _extract(source: KbSource, text_content: Optional[str],
                   pdf_bytes: Optional[bytes]) -> tuple[list[tuple[str, Optional[str]]], int]:
    """Liste de (texte, page_url) a chunker + page_count. Leve FetchError
    (message FR persiste dans source.error)."""
    if source.type == "text":
        return [(text_content or "", None)], 0
    if source.type == "pdf":
        # CPU pur (pypdf, plusieurs secondes sur 10 Mo) : to_thread obligatoire
        # sinon l'event loop entier (widget, poll, dashboard) est gele
        content, page_count = await asyncio.to_thread(pdf_to_text, pdf_bytes or b"")
        return [(content, None)], page_count
    if source.type == "url":
        try:
            page = await safe_get(source.ref, MAX_FETCH_BYTES)
        except FetchError as exc:
            raise FetchError(f"Page inaccessible : {exc}")
        return [(html_to_text(page), None)], 1
    if source.type == "sitemap":
        try:
            xml_content = await safe_get(source.ref, MAX_FETCH_BYTES)
        except FetchError as exc:
            raise FetchError(f"Sitemap inaccessible : {exc}")
        is_index, urls = parse_sitemap_urls(xml_content, source.ref)
        if is_index:
            # Sitemap INDEX (defaut WordPress/Yoast) : recursion d'UN seul
            # niveau — chaque sous-sitemap repasse par safe_get, un index
            # imbrique est ignore, cap global MAX_SITEMAP_PAGES conserve.
            page_urls: list[str] = []
            for sub_url in urls:
                if len(page_urls) >= MAX_SITEMAP_PAGES:
                    break
                try:
                    sub_xml = await safe_get(sub_url, MAX_FETCH_BYTES)
                except FetchError:
                    logger.warning("KB sitemap %s : sous-sitemap %s ignoré", source.id, sub_url)
                    continue
                sub_is_index, sub_urls = parse_sitemap_urls(sub_xml, sub_url)
                if sub_is_index:
                    continue
                for page_url in sub_urls:
                    if page_url not in page_urls:
                        page_urls.append(page_url)
                    if len(page_urls) >= MAX_SITEMAP_PAGES:
                        break
            urls = page_urls
        if not urls:
            raise FetchError("Sitemap invalide ou vide")
        results: list[tuple[str, Optional[str]]] = []
        for url in urls:
            # chaque page repasse par safe_get (re-validation IP) ; une page
            # en echec n'invalide pas le sitemap entier
            try:
                page = await safe_get(url, MAX_FETCH_BYTES)
            except FetchError:
                logger.warning("KB sitemap %s : page %s ignorée", source.id, url)
                continue
            results.append((html_to_text(page), url))
        if not results:
            raise FetchError("Sitemap invalide ou vide")
        return results, len(results)
    raise FetchError("Type de source inconnu")


# --- Ingestion (tache de fond) ---

async def ingest_source(source_id: int, *, text_content: Optional[str] = None,
                        pdf_bytes: Optional[bytes] = None) -> None:
    """Pipeline complet d'une source : extraction -> chunking -> embeddings
    locaux -> insertion. Session DB DEDIEE (jamais celle de la requete).
    Toute erreur attendue -> status='error' + message FR ; les chunks deja
    inseres pour CETTE source sont purges pour garder le critere « il existe
    des chunks » fiable."""
    async with AsyncSessionLocal() as db:
        source = await db.get(KbSource, source_id)
        if source is None:
            return  # supprimee entre-temps : abandon silencieux

        async def _fail(message: str) -> None:
            await db.execute(delete(KbChunk).where(KbChunk.source_id == source_id))
            source.status = "error"
            source.error = message
            await db.commit()

        try:
            try:
                documents, page_count = await _extract(source, text_content, pdf_bytes)
            except FetchError as exc:
                await _fail(str(exc))
                return

            # (chunk, page_url) dans l'ordre des documents
            pieces: list[tuple[str, Optional[str]]] = []
            for content, page_url in documents:
                pieces.extend((chunk, page_url) for chunk in chunk_text(content))
            if not pieces:
                await _fail("Aucun texte exploitable dans la source")
                return

            # Cap global par bot (toutes sources confondues)
            existing = (await db.execute(
                select(func.count(KbChunk.id)).where(KbChunk.bot_id == source.bot_id)
            )).scalar() or 0
            if existing >= MAX_CHUNKS_PER_BOT:
                await _fail("Limite de 1000 extraits atteinte pour ce bot — "
                            "supprimez des sources d'abord")
                return
            if existing + len(pieces) > MAX_CHUNKS_PER_BOT:
                logger.warning("KB source %s : troncature à %s extraits (cap bot %s)",
                               source_id, MAX_CHUNKS_PER_BOT - existing, MAX_CHUNKS_PER_BOT)
                pieces = pieces[:MAX_CHUNKS_PER_BOT - existing]

            vectors = await embed_passages([p[0] for p in pieces])
            if vectors is None:
                # Degradation propre : FTS seul (embedding NULL)
                logger.warning("KB source %s : embeddings indisponibles, indexation FTS seule",
                               source_id)

            rows = [
                {
                    "s": source_id, "b": source.bot_id, "i": index,
                    "c": piece, "p": page_url,
                    "e": to_pgvector(vectors[index]) if vectors else None,
                }
                for index, (piece, page_url) in enumerate(pieces)
            ]
            # SQL textuel : CAST(:e AS vector) evite tout binding de type
            # vector cote ORM/asyncpg ; tsv = colonne generee (rien a fournir)
            await db.execute(text(
                "INSERT INTO kb_chunks (source_id, bot_id, chunk_index, content, page_url, embedding) "
                "VALUES (:s, :b, :i, :c, :p, CAST(:e AS vector))"
            ), rows)

            source.status = "ready"
            source.error = None
            source.chunk_count = len(rows)
            source.page_count = page_count
            await db.commit()
        except Exception:
            # Source supprimee pendant l'ingestion (FK violee) ou imprevu :
            # rollback puis statut error si la source existe encore
            logger.exception("KB source %s : erreur interne d'ingestion", source_id)
            await db.rollback()
            source = await db.get(KbSource, source_id)
            if source is not None:
                await _fail("Erreur interne d'ingestion")


# --- Recherche hybride ---

_FTS_SQL = text("""
SELECT c.id, c.content, c.page_url, s.ref
FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
WHERE c.bot_id = :b AND c.tsv @@ websearch_to_tsquery('french_unaccent', :q)
ORDER BY ts_rank(c.tsv, websearch_to_tsquery('french_unaccent', :q)) DESC, c.id ASC
LIMIT 10
""")

_VEC_SQL = text("""
SELECT c.id, c.content, c.page_url, s.ref
FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
WHERE c.bot_id = :b AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> CAST(:e AS vector) ASC, c.id ASC
LIMIT 10
""")


async def search_chunks(db, bot_id: int, query: str, k: int = 5) -> tuple[str, list[dict]]:
    """(mode, resultats) : mode 'hybrid' (vecteur + FTS, fusion RRF) ou 'fts'
    (modele d'embeddings indisponible). Resultats tries par score RRF
    decroissant puis id croissant (determinisme), top k."""
    fts_rows = (await db.execute(_FTS_SQL, {"b": bot_id, "q": query})).fetchall()

    vec_rows: list = []
    mode = "fts"
    query_vec = await embed_query(query)
    if query_vec is not None:
        mode = "hybrid"
        vec_rows = (await db.execute(
            _VEC_SQL, {"b": bot_id, "e": to_pgvector(query_vec)})).fetchall()

    # Fusion RRF : score = somme des 1/(60 + rang) sur les deux classements
    scores: dict[int, float] = {}
    rows_by_id: dict[int, tuple] = {}
    for rows in (fts_rows, vec_rows):
        for rank, row in enumerate(rows):
            scores[row.id] = scores.get(row.id, 0.0) + 1.0 / (60 + rank + 1)
            rows_by_id[row.id] = row
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:k]
    results = [
        {
            "chunk_id": chunk_id,
            "content": rows_by_id[chunk_id].content,
            "ref": rows_by_id[chunk_id].page_url or rows_by_id[chunk_id].ref,
            "score": round(score, 6),
        }
        for chunk_id, score in ordered
    ]
    return mode, results
