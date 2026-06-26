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
from src.services.tree_engine import AI_NODE, TreeError, validate_tree

logger = logging.getLogger(__name__)

MAX_SOURCE_CHARS = 20_000

# Gemini REST (generateContent) — meme forme que ai_service._call_gemini mais
# helper dedie : maxOutputTokens releve (un arbre depasse 1024), pas d'objet
# bot requis, sortie forcee en JSON.
# gemini-2.5-flash est un modele "thinking" : thinkingBudget=0 desactive le
# raisonnement interne (sinon il consomme le budget de tokens et tronque le
# JSON). gemini-2.0-flash a ete retire de l'API (404 "no longer available").
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_TREE_MODEL = "gemini-2.5-flash"

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
- Chaque option "next" est TOUJOURS un id de nœud existant, "root" (retour au menu) ou "__ai__" (bascule vers l'IA). JAMAIS une URL : un lien externe se met dans le "message" en markdown [libellé](https://…), jamais dans "next".
- Ids de nœuds courts en snake_case. Messages concis (2-3 phrases max), ton chaleureux, en français. Markdown LÉGER autorisé (**gras**, *italique*, [libellé](https://…), sauts de ligne) ; pas de titres, pas de HTML, pas d'emoji.
- Regroupe les sujets en 3 à 6 choix racine maximum. Ajoute une option "Autre question" -> "__ai__" sur le nœud racine.
- N'ajoute JAMAIS de clé "type" aux nœuds : ce sont tous des messages avec options. Le nœud "root" est TOUJOURS un menu d'accueil (jamais une mise en relation/un formulaire).
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


_URL_RE = re.compile(r"^https?://", re.I)


def _sanitize_tree(tree: dict) -> dict:
    """Répare les arbres « presque valides » produits par l'IA avant validation.

    Cas observé en prod : l'IA met parfois une URL externe dans le "next" d'une
    option (ex. bouton « Voir la démo » -> https://…) au lieu d'un id de nœud.
    validate_tree rejette alors TOUT l'arbre pour une seule option fautive et la
    génération retombe sur l'ébauche par défaut. On replie plutôt ces liens dans
    le message du nœud (markdown) et on retire les options pointant vers un nœud
    inexistant — une génération par ailleurs correcte n'est plus jetée.
    """
    nodes = tree.get("nodes")
    if not isinstance(nodes, dict):
        return tree
    for node in nodes.values():
        if not isinstance(node, dict) or not isinstance(node.get("options"), list):
            continue
        kept, links = [], []
        for opt in node["options"]:
            if not isinstance(opt, dict):
                continue
            target, label = opt.get("next"), opt.get("label")
            # next = URL externe -> lien markdown dans le message, option retirée
            if isinstance(target, str) and _URL_RE.match(target):
                if label:
                    links.append(f"[{label}]({target})")
                continue
            # next pointant vers un nœud inexistant (hors __ai__) : option retirée
            if target != AI_NODE and target not in nodes:
                continue
            kept.append(opt)
        if links:
            msg = (node.get("message") or "").rstrip()
            node["message"] = (msg + "\n\n" + " · ".join(links)).strip()
        node["options"] = kept
    return tree


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
        raise TreeGenerationError(f"Impossible de récupérer la page : {e}") from e

    # Extraction texte naïve : on retire scripts/styles puis toutes les balises
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 100:
        raise TreeGenerationError("La page ne contient pas assez de texte exploitable")
    return text[:MAX_SOURCE_CHARS]


async def _generate_tree_gemini(source_text: str) -> str:
    """Appel Gemini REST direct (generateContent) -> texte brut (JSON attendu).

    Helper dedie : maxOutputTokens 4096 (un arbre depasse les 1024 de
    _call_gemini), responseMimeType JSON, temperature 0. Toute httpx.HTTPError
    (statut, reseau, timeout) est traduite en TreeGenerationError FR."""
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        raise TreeGenerationError("Génération indisponible : aucune clé IA configurée côté serveur")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL.format(model=GEMINI_TREE_MODEL),
                params={"key": api_key},
                json={
                    "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                    "contents": [{
                        "role": "user",
                        "parts": [{"text": f"Contenu source :\n\n{source_text}\n\nGénère l'arbre de décision JSON."}],
                    }],
                    "generationConfig": {
                        "temperature": 0,
                        "maxOutputTokens": 4096,
                        "responseMimeType": "application/json",
                        # thinking off : tout le budget va au JSON (sinon tronque)
                        "thinkingConfig": {"thinkingBudget": 0},
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error("Génération d'arbre : erreur API Gemini %s", e)
        raise TreeGenerationError("Le service IA est momentanément indisponible, réessayez") from e

    # Extraction defensive : structure candidates[0].content.parts attendue
    # mais une reponse tronquee/filtree peut omettre des niveaux.
    candidates = data.get("candidates") or []
    if not candidates:
        raise TreeGenerationError("L'IA a produit un arbre invalide, relancez la génération")
    parts = candidates[0].get("content", {}).get("parts", []) or []
    return "".join(p.get("text", "") for p in parts)


async def generate_tree(source_text: str) -> dict:
    """Texte source -> tree_json validé (Gemini uniquement)."""
    source_text = source_text.strip()[:MAX_SOURCE_CHARS]
    if len(source_text) < 50:
        raise TreeGenerationError("Fournissez plus de contenu (FAQ, texte d'aide…) pour générer un arbre")

    if settings.MOCK_AI:
        return MOCK_TREE

    raw = await _generate_tree_gemini(source_text)
    # Tolère un éventuel bloc markdown malgré la consigne
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        tree = json.loads(raw)
        tree = _sanitize_tree(tree)
        validate_tree(tree)
    except (json.JSONDecodeError, TreeError) as e:
        logger.error("Génération d'arbre : sortie invalide (%s) : %.300s", e, raw)
        raise TreeGenerationError("L'IA a produit un arbre invalide, relancez la génération")

    # Garde-fou : le nœud de départ doit être un MENU (jamais terminal). L'IA
    # ajoute parfois un "type" parasite sur la racine -> handoff/formulaire dès
    # l'ouverture. On le retire à la source (en plus du garde-fou au service).
    start = tree.get("start", "root")
    snode = (tree.get("nodes") or {}).get(start)
    if isinstance(snode, dict) and snode.get("type") in ("handoff", "lead", "appointment"):
        for k in ("type", "url", "fields"):
            snode.pop(k, None)
    return tree
