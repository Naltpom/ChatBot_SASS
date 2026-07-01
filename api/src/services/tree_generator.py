"""Génération d'un arbre de décision par IA, à partir d'un texte (FAQ, doc
d'aide collé) ou d'une URL de page d'aide.

Utilisé côté DASHBOARD (config-time, clé managée du SaaS) — jamais par le
widget. Accessible à tous ; le treegen_limiter Redis (10/24h/org) côté router
borne le COÛT provider (anti-abus), ce n'est pas un gating de plan.
"""
import json
import logging
import re
from typing import Optional

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

# Règle de TON PAR DÉFAUT (aucun brief propriétaire) : ton chaleureux figé,
# comportement historique. Le brief, s'il en fournit un, prime (voir _build_system_prompt).
_TONE_RULE_DEFAULT = (
    "- Ids de nœuds courts en snake_case. Messages concis (2-3 phrases max), "
    "ton chaleureux, en français."
)
# Règle de TON quand un brief est fourni : le ton suit les INSTRUCTIONS
# PRIORITAIRES DU PROPRIÉTAIRE (bloc injecté plus bas), chaleureux à défaut.
_TONE_RULE_BRIEF = (
    "- Ids de nœuds courts en snake_case. Messages concis (2-3 phrases max), "
    "en français, dans le TON imposé par les INSTRUCTIONS PRIORITAIRES DU "
    "PROPRIÉTAIRE ci-dessous (ton chaleureux à défaut)."
)

# Règle « type » STRICTE (aucun brief) : aucun nœud typé, root = menu d'accueil.
_TYPE_RULE_STRICT = (
    '- N\'ajoute JAMAIS de clé "type" aux nœuds : ce sont tous des messages avec '
    'options. Le nœud "root" est TOUJOURS un menu d\'accueil (jamais une mise en '
    "relation/un formulaire)."
)
# Règle « type » ASSOUPLIE (brief présent) : la racine reste un menu sans "type",
# mais des nœuds ENFANTS handoff/lead sont autorisés SI le brief les justifie.
_TYPE_RULE_BRIEF = (
    '- Le nœud "root" est TOUJOURS un menu d\'accueil, SANS clé "type" (jamais '
    "lui-même une mise en relation ni un formulaire). Les autres nœuds sont par "
    "défaut de simples messages avec options. EXCEPTION, UNIQUEMENT si les "
    "INSTRUCTIONS PRIORITAIRES DU PROPRIÉTAIRE ci-dessous le demandent : tu peux "
    'créer un nœud ENFANT de mise en relation {"type":"handoff","message":"…"} '
    "(pour parler à un conseiller humain en direct) et/ou un nœud de formulaire "
    'de contact {"type":"lead","fields":["email","message"],"message":"…"}, '
    "atteint depuis une option du menu. N'invente NI mise en relation NI "
    "formulaire si le propriétaire ne le demande pas."
)

SYSTEM_PROMPT = f"""Tu construis des arbres de décision pour des chatbots de sites web.
À partir du contenu fourni (FAQ, page d'aide, documentation), produis un arbre au format JSON STRICT :

{{
  "start": "root",
  "nodes": {{
    "root": {{"message": "<message d'accueil>", "options": [{{"label": "<bouton>", "next": "<id_noeud>"}}]}},
    "<id_noeud>": {{"message": "<réponse>", "options": [{{"label": "<bouton>", "next": "..."}}]}}
  }}
}}

Règles :
- Chaque option "next" est TOUJOURS un id de nœud existant, "root" (retour au menu) ou "__ai__" (bascule vers l'IA). JAMAIS une URL : un lien externe se met dans le "message" en markdown [libellé](https://…), jamais dans "next".
{_TONE_RULE_DEFAULT} Markdown LÉGER autorisé (**gras**, *italique*, [libellé](https://…), sauts de ligne) ; pas de titres, pas de HTML, pas d'emoji.
- Regroupe les sujets en 3 à 6 choix racine maximum. Ajoute une option "Autre question" -> "__ai__" sur le nœud racine.
{_TYPE_RULE_STRICT}
- Les nœuds terminaux proposent une option de retour vers "root".
- Réponds UNIQUEMENT avec le JSON, sans markdown, sans commentaire."""

# Bloc « instructions propriétaire » injecté APRÈS les règles quand un brief est
# fourni. `.format(brief=…)` : les accolades JSON littérales sont doublées ({{ }}),
# seul {brief} est substitué.
_OWNER_BRIEF_BLOCK = (
    "INSTRUCTIONS PRIORITAIRES DU PROPRIÉTAIRE (elles PRIMENT sur le ton par "
    "défaut et sur le contenu du site ; ce sont des consignes de CONSTRUCTION, "
    "PAS du texte à recopier tel quel dans l'arbre) :\n"
    "<<<\n{brief}\n>>>\n"
    "À appliquer :\n"
    "- TON / PERSONA : si ces instructions précisent un ton, une personnalité ou "
    "un univers (ex. médiéval/chevaleresque, formel, décontracté, humoristique…), "
    "TOUS les messages de l'arbre — accueil compris — l'adoptent fidèlement et de "
    "façon cohérente. Sinon, garde un ton chaleureux.\n"
    "- MISE EN RELATION : si le propriétaire veut qu'on puisse contacter / parler "
    "à un humain / un conseiller en direct, AJOUTE un nœud enfant "
    '{{"type":"handoff","message":"…"}} et une option du menu racine qui y mène '
    '(ex. « Parler à un conseiller »). Le "message" du nœud annonce la mise en '
    "relation, dans le ton demandé.\n"
    "- FORMULAIRE DE CONTACT : si le propriétaire veut recueillir les coordonnées "
    "du visiteur (ou une prise de rendez-vous), AJOUTE un nœud "
    '{{"type":"lead","fields":["email","message"],"message":"…"}} accessible depuis '
    'le menu. La clé "fields" vaut EXACTEMENT ["email","message"] (ne mets pas de '
    "libellés en français ni d'autres champs).\n"
    '- N\'utilise JAMAIS de nœud {{"type":"appointment"}} : tu ne connais pas l\'URL '
    "du calendrier (elle se configure ailleurs). Pour une prise de rendez-vous, "
    'utilise un nœud {{"type":"lead"}} comme ci-dessus.\n'
    '- Le nœud "root" RESTE un menu d\'accueil sans clé "type" : la mise en relation '
    "et le formulaire sont des nœuds ENFANTS atteints par une option."
)


def _build_system_prompt(owner_brief: Optional[str]) -> str:
    """Prompt système Gemini selon la présence d'un brief propriétaire.

    Sans brief -> `SYSTEM_PROMPT` inchangé (ton chaleureux par défaut, aucun nœud
    typé : rétro-compat STRICTE). Avec brief -> ton/persona et mise en relation
    pilotés par le propriétaire : on assouplit la règle « type » (handoff/lead
    enfants autorisés, root toujours un menu) et on injecte les instructions
    prioritaires."""
    brief = (owner_brief or "").strip()
    if not brief:
        return SYSTEM_PROMPT
    relaxed = SYSTEM_PROMPT.replace(_TONE_RULE_DEFAULT, _TONE_RULE_BRIEF).replace(
        _TYPE_RULE_STRICT, _TYPE_RULE_BRIEF
    )
    return f"{relaxed}\n\n{_OWNER_BRIEF_BLOCK.format(brief=brief[:1200])}"

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
    """Récupère une page d'aide (fetch SSRF-safe, redirections suivies) et en
    extrait le texte brut.

    Délègue à `kb_service.fetch_user_url` (porte unique anti-SSRF : https imposé,
    rejet des IP non publiques, épinglage anti-rebinding, lecture bornée). Le
    `http://` et le fetch laxiste d'origine sont supprimés — une URL non https ou
    interne lève FetchError, traduite ici en TreeGenerationError (message FR)."""
    # Import local (comme bots.py) : évite de charger kb_service/embeddings au
    # simple import de tree_generator (importé largement, dont par la démo).
    from src.services.kb_service import FetchError, fetch_user_url
    try:
        text = await fetch_user_url(url)
    except FetchError as e:
        raise TreeGenerationError(f"Impossible de récupérer la page : {e}") from e
    if len(text) < 100:
        raise TreeGenerationError("La page ne contient pas assez de texte exploitable")
    return text[:MAX_SOURCE_CHARS]


async def generate_text_gemini(system_prompt: str, user_prompt: str,
                               max_tokens: int = 400) -> Optional[str]:
    """Appel Gemini REST -> TEXTE LIBRE (pas de JSON). Best-effort : renvoie None
    sur clé absente / MOCK_AI / toute erreur (l'appelant a toujours un repli).
    Sert aux petits textes générés (ex. explication personnalisée du plan)."""
    api_key = settings.GEMINI_API_KEY
    if not api_key or settings.MOCK_AI:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GEMINI_URL.format(model=GEMINI_TREE_MODEL),
                params={"key": api_key},
                json={
                    "system_instruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                    "generationConfig": {
                        "temperature": 0.4,
                        "maxOutputTokens": max_tokens,
                        "thinkingConfig": {"thinkingBudget": 0},
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.warning("generate_text_gemini: erreur API Gemini %s", e)
        return None
    cands = data.get("candidates") or []
    if not cands:
        return None
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
    return text or None


async def _generate_tree_gemini(source_text: str, system_prompt: str) -> str:
    """Appel Gemini REST direct (generateContent) -> texte brut (JSON attendu).

    Helper dedie : maxOutputTokens 4096 (un arbre depasse les 1024 de
    _call_gemini), responseMimeType JSON, temperature 0. `system_prompt` est
    l'instruction systeme assemblee (defaut ou augmentee du brief proprietaire).
    Toute httpx.HTTPError (statut, reseau, timeout) est traduite en
    TreeGenerationError FR."""
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        raise TreeGenerationError("Génération indisponible : aucune clé IA configurée côté serveur")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL.format(model=GEMINI_TREE_MODEL),
                params={"key": api_key},
                json={
                    "system_instruction": {"parts": [{"text": system_prompt}]},
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


async def generate_tree(source_text: str, owner_brief: Optional[str] = None) -> dict:
    """Texte source -> tree_json validé (Gemini uniquement).

    `owner_brief` (optionnel) = consignes PRIORITAIRES du propriétaire du bot
    (ton/persona voulu, demande de mise en relation conseiller en direct…),
    DISTINCTES du contenu du site. Fourni -> il façonne le ton de TOUS les
    messages et peut ajouter un nœud enfant handoff/lead (la racine reste un
    menu). Absent -> comportement historique inchangé (ton chaleureux, aucun
    nœud typé : rétro-compat stricte)."""
    source_text = source_text.strip()[:MAX_SOURCE_CHARS]
    if len(source_text) < 50:
        raise TreeGenerationError("Fournissez plus de contenu (FAQ, texte d'aide…) pour générer un arbre")

    if settings.MOCK_AI:
        return MOCK_TREE

    raw = await _generate_tree_gemini(source_text, _build_system_prompt(owner_brief))
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
