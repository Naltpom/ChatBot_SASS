"""Logique de la demo publique « 1 URL -> chatbot » (page /demo, sans auth).

Responsabilites (les aspects HTTP — captcha, rate-limit, codes d'erreur — restent
dans le routeur public) :
  - normaliser/valider l'URL fournie par un visiteur anonyme (cle de cache stable) ;
  - lire/ecrire le cache DB demo_generations (une URL deja vue ne rappelle PAS l'IA) ;
  - generer l'arbre en REUTILISANT le pipeline existant (build_source_text -> safe_get
    anti-SSRF + html_to_text, puis generate_tree -> Gemini / MOCK_TREE).
"""
import hashlib
import logging
import re
from datetime import timedelta
from urllib.parse import urlparse, urlunparse

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.time import utcnow
from src.models.demo import DemoGeneration
from src.services.tree_generator import TreeGenerationError, generate_tree
from src.services.tree_jobs import build_source_text

logger = logging.getLogger(__name__)

MAX_URL_CHARS = 2000


def normalize_url(raw: str) -> str:
    """Nettoie l'URL d'un visiteur en une forme canonique (cle de cache stable).

    - prefixe https:// si le schema manque (saisie « exemple.fr ») ;
    - exige https (le fetch anti-SSRF n'accepte que https de toute facon) ;
    - host en minuscule, sans port par defaut, sans fragment, sans / final.
    Leve ValueError (message FR montrable) si l'entree n'est pas exploitable.
    """
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Indiquez l'adresse de votre site.")
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ValueError("Indiquez une URL en https:// (http non supporté).")
    host = (parsed.hostname or "").lower()
    if not host or "." not in host:
        raise ValueError("Adresse de site invalide.")
    netloc = host if (not parsed.port or parsed.port == 443) else f"{host}:{parsed.port}"
    path = parsed.path.rstrip("/")
    norm = urlunparse(("https", netloc, path, "", parsed.query, ""))
    return norm[:MAX_URL_CHARS]


def url_hash(url_norm: str) -> str:
    return hashlib.sha256(url_norm.encode("utf-8")).hexdigest()


def is_fresh(row: DemoGeneration, ttl_days: int) -> bool:
    """True si l'entree de cache est encore dans sa fenetre de fraicheur (TTL)."""
    if row.created_at is None:
        return False
    return row.created_at >= utcnow() - timedelta(days=ttl_days)


async def get_row(db: AsyncSession, h: str) -> DemoGeneration | None:
    return (
        await db.execute(select(DemoGeneration).where(DemoGeneration.url_hash == h))
    ).scalar_one_or_none()


async def build_demo_source(url_norm: str) -> str:
    """URL -> texte source borne (fetch SSRF-safe via safe_get + extraction texte).

    Une seule source de type 'site'. Leve TreeGenerationError (message FR) si la
    page est injoignable/privee/vide. SEPARE de l'appel IA (generate_tree) a
    DESSEIN : le routeur ne decompte les quotas (IP/jour, plafond global) qu'APRES
    avoir confirme un contenu exploitable, pour qu'un site mort ne brule NI le
    quota du visiteur NI le coupe-circuit de cout — qui ne compte ainsi que de
    vraies generations IA. Le volume de fetch reste borne en amont par l'anti-flood
    IP + le captcha (cote routeur)."""
    return await build_source_text([{"url": url_norm, "type": "site"}], [], None)


async def upsert(db: AsyncSession, h: str, url_norm: str, tree: dict,
                 existing: DemoGeneration | None) -> None:
    """Ecrit/rafraichit l'entree de cache. Reset de l'horloge TTL (created_at).

    Gere la course d'insertion concurrente (url_hash unique) : sur IntegrityError
    on relit la ligne posee par l'autre requete et on la met a jour.
    """
    if existing is not None:
        existing.tree_json = tree
        existing.created_at = utcnow()  # rearme le TTL
        await db.commit()
        return
    db.add(DemoGeneration(url_hash=h, url=url_norm, tree_json=tree))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        row = await get_row(db, h)
        if row is not None:
            row.tree_json = tree
            row.created_at = utcnow()
            await db.commit()


__all__ = [
    "TreeGenerationError", "generate_tree", "normalize_url", "url_hash",
    "is_fresh", "get_row", "build_demo_source", "upsert",
]
