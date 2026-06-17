"""Analyse « questions sans réponse » : clusterise les messages visiteurs
adressés à l'IA (30 derniers jours, échantillonnés côté router) en thèmes
récurrents, avec suggestion de bulle d'arbre pour chacun.

Utilisé côté DASHBOARD (config-time, clé managée du SaaS, UN appel par
génération) — jamais par le widget. Accessible à tous ; l'insights_limiter
Redis (3/jour/org) côté router, vérifié AVANT tout appel, borne le COÛT
provider (anti-abus), ce n'est pas un gating de plan.
"""
import json
import logging
import re

import httpx

from src.core.anthropic import call_messages
from src.core.config import settings
from src.core.constants import TREE_INSIGHTS_MODEL

logger = logging.getLogger(__name__)

MAX_TOKENS = 2048
# Bornes de validation du rapport produit par le modele
_MAX_CLUSTERS = 10
_MAX_EXAMPLES = 3
_INVALID_MSG = "L'IA a produit un rapport invalide, relancez la génération"

SYSTEM_PROMPT = """Tu analyses les questions posées par des visiteurs au chatbot d'un site web.
Regroupe-les en thèmes récurrents qui ne semblent PAS couverts par le bot, pour aider le client à compléter son arbre de réponses.
Réponds au format JSON STRICT :

{"clusters": [{"theme": "<thème court>", "count": <nombre de questions du thème>, "examples": ["<question reprise telle quelle>"], "suggested_bubble": "<texte de bulle d'arbre suggéré>"}]}

Règles :
- 8 clusters maximum, du plus fréquent au moins fréquent. 3 exemples maximum par cluster.
- Textes courts en français, en texte brut : pas de markdown, pas d'emoji.
- Réponds UNIQUEMENT avec le JSON, sans markdown, sans commentaire."""


class InsightsError(Exception):
    pass


def _mock_report(messages: list[str]) -> dict:
    """MOCK_AI : rapport deterministe, aucun provider appele."""
    return {"clusters": [{
        "theme": "Démonstration (mode mock)",
        "count": len(messages),
        "examples": [m[:200] for m in messages[:3]],
        "suggested_bubble": "Activez une clé IA pour une vraie analyse.",
    }]}


def _validate_report(raw: dict) -> dict:
    """Validation stricte de la sortie modele -> rapport re-projete sur les
    seules cles attendues (rien d'autre ne sort vers le dashboard)."""
    if not isinstance(raw, dict):
        raise InsightsError(_INVALID_MSG)
    clusters = raw.get("clusters")
    if not isinstance(clusters, list) or len(clusters) > _MAX_CLUSTERS:
        raise InsightsError(_INVALID_MSG)
    out = []
    for cluster in clusters:
        if not isinstance(cluster, dict):
            raise InsightsError(_INVALID_MSG)
        theme = cluster.get("theme")
        if not isinstance(theme, str) or not 1 <= len(theme.strip()) <= 120:
            raise InsightsError(_INVALID_MSG)
        count = cluster.get("count")
        if isinstance(count, bool) or not isinstance(count, int):
            raise InsightsError(_INVALID_MSG)
        examples = cluster.get("examples")
        if (not isinstance(examples, list) or len(examples) > _MAX_EXAMPLES
                or not all(isinstance(e, str) for e in examples)):
            raise InsightsError(_INVALID_MSG)
        bubble = cluster.get("suggested_bubble")
        if not isinstance(bubble, str):
            raise InsightsError(_INVALID_MSG)
        out.append({
            "theme": theme.strip(),
            "count": count,
            "examples": [e[:300] for e in examples],
            "suggested_bubble": bubble[:300],
        })
    return {"clusters": out}


async def generate_insights(messages: list[str]) -> dict:
    """Questions visiteurs (deja echantillonnees, <=200) -> rapport valide."""
    if settings.MOCK_AI:
        return _mock_report(messages)

    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise InsightsError("Analyse indisponible : aucune clé IA configurée côté serveur")

    numbered = "\n".join(f"{i + 1}. {m[:300]}" for i, m in enumerate(messages))
    try:
        result = await call_messages(
            api_key=api_key,
            model=TREE_INSIGHTS_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": f"Questions des visiteurs :\n\n{numbered}\n\nGénère le rapport JSON.",
            }],
        )
    except httpx.HTTPError as e:
        logger.error("Insights : erreur API %s", e)
        raise InsightsError("Le service IA est momentanément indisponible, réessayez") from e

    raw = result.text
    # Tolère un éventuel bloc markdown malgré la consigne (regex tree_generator)
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        report = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Insights : sortie non-JSON : %.300s", raw)
        raise InsightsError(_INVALID_MSG) from e
    return _validate_report(report)
