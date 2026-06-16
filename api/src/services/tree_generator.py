"""Génération d'un arbre de décision par IA, à partir d'un texte (FAQ, doc
d'aide collé) ou d'une URL de page d'aide.

Utilisé côté DASHBOARD (config-time, clé managée du SaaS) — jamais par le
widget. Accessible à tous ; le treegen_limiter Redis (10/24h/org) côté router
borne le COÛT provider (anti-abus), ce n'est pas un gating de plan.
"""
import json
import logging
import re

import httpx

from src.core.config import settings
from src.services.tree_engine import TreeError, validate_tree

logger = logging.getLogger(__name__)

GENERATION_MODEL = "claude-sonnet-4-6"
MAX_SOURCE_CHARS = 20_000

SYSTEM_PROMPT = """Tu construis des arbres de décision pour des chatbots de sites web.
À partir du contenu fourni (FAQ, page d'aide, documentation), produis un arbre au format JSON STRICT :

{
  "start": "root",
  "nodes": {
    "root": {"message": "<message d'accueil>", "options": [{"label": "<bouton>", "next": "<id_noeud>"}]},
    "<id_noeud>": {"message": "<réponse>", "options": [{"label": "<bouton>", "next": "..."}]}
  }
}

Règles :
- Chaque option "next" pointe vers un nœud existant, vers "root" (retour au menu), ou vers "__ai__" (bascule vers l'IA pour les questions libres).
- Ids de nœuds courts en snake_case. Messages concis (2-3 phrases max), ton chaleureux, en français, en texte brut : pas de markdown, pas d'emoji.
- Regroupe les sujets en 3 à 6 choix racine maximum. Ajoute une option "Autre question" -> "__ai__" sur le nœud racine.
- Les nœuds terminaux proposent une option de retour vers "root".
- Réponds UNIQUEMENT avec le JSON, sans markdown, sans commentaire."""

MOCK_TREE = {
    "start": "root",
    "nodes": {
        "root": {
            "message": "Bonjour ! (arbre de démonstration généré en mode mock) Comment puis-je vous aider ?",
            "options": [
                {"label": "Nos services", "next": "services"},
                {"label": "Autre question", "next": "__ai__"},
            ],
        },
        "services": {
            "message": "Voici un exemple de réponse générée. Activez une clé IA pour une vraie génération.",
            "options": [{"label": "Retour au menu", "next": "root"}],
        },
    },
}


class TreeGenerationError(Exception):
    pass


async def fetch_page_text(url: str) -> str:
    """Récupère une page d'aide et en extrait le texte brut (sans balises)."""
    if not url.startswith(("http://", "https://")):
        raise TreeGenerationError("URL invalide (http/https uniquement)")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Chapote TreeBuilder)"})
            resp.raise_for_status()
            html = resp.text
    except httpx.HTTPError as e:
        raise TreeGenerationError(f"Impossible de récupérer la page : {e}")

    # Extraction texte naïve : on retire scripts/styles puis toutes les balises
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 100:
        raise TreeGenerationError("La page ne contient pas assez de texte exploitable")
    return text[:MAX_SOURCE_CHARS]


async def generate_tree(source_text: str) -> dict:
    """Texte source -> tree_json validé."""
    source_text = source_text.strip()[:MAX_SOURCE_CHARS]
    if len(source_text) < 50:
        raise TreeGenerationError("Fournissez plus de contenu (FAQ, texte d'aide…) pour générer un arbre")

    if settings.MOCK_AI:
        return MOCK_TREE

    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise TreeGenerationError("Génération indisponible : aucune clé IA configurée côté serveur")

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": GENERATION_MODEL,
                    "max_tokens": 4096,
                    "system": SYSTEM_PROMPT,
                    "messages": [{
                        "role": "user",
                        "content": f"Contenu source :\n\n{source_text}\n\nGénère l'arbre de décision JSON.",
                    }],
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error("Génération d'arbre : erreur API %s", e)
        raise TreeGenerationError("Le service IA est momentanément indisponible, réessayez")

    raw = "".join(b.get("text", "") for b in data.get("content", []))
    # Tolère un éventuel bloc markdown malgré la consigne
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        tree = json.loads(raw)
        validate_tree(tree)
    except (json.JSONDecodeError, TreeError) as e:
        logger.error("Génération d'arbre : sortie invalide (%s) : %.300s", e, raw)
        raise TreeGenerationError("L'IA a produit un arbre invalide, relancez la génération")
    return tree
