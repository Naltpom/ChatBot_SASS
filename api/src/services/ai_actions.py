"""Actions IA (tool-use) : selection des actions eligibles, construction des
schemas de tools (Anthropic/OpenAI), execution d'un tool et tool interne
search_docs (RAG).

Extrait de ai_service.py pour alleger ce dernier — comportement INCHANGE.
Ne JAMAIS importer ai_service ici (cycle) : les donnees (bot, db, history…)
sont passees en parametres. action_executor est importe normalement ;
kb_service / mcp_client sont importes paresseusement (lazy) la ou ils servent,
comme dans l'original.
"""
import json
import logging
from typing import Optional

from src.models.bot import Bot
from src.services.action_executor import ActionError, execute_action

logger = logging.getLogger(__name__)

# Boucle tool-use bornee : au-dela, on rend le dernier texte disponible.
# ATTENTION cout : chaque tour = un appel provider facture, pour UNE seule
# reponse rendue au visiteur (count des Message ai) — borne a 2 pour limiter
# le ratio appels/reponse a 2x maximum (documente).
# Decision RAG : 2 tours suffisent aussi a search_docs (recherche puis
# reponse). Au dernier tour autorise, les tool_use ne sont PAS executes :
# aucun effet de bord (lead, webhook) qui serait ensuite annonce en echec au
# visiteur — et pas de recherche dont le resultat serait jete.
MAX_TOOL_TURNS = 2
TOOL_EXHAUSTED_MESSAGE = "Je n'ai pas pu effectuer cette action, pouvez-vous reformuler votre demande ?"


# --- Actions IA (tool-use) ---

# Schema impose pour capture_lead : les champs configures cote dashboard sont
# ignores, le modele recoit toujours le quadruplet standard.
CAPTURE_LEAD_PROPS = {
    "email": {"type": "string", "description": "Adresse email du visiteur"},
    "name": {"type": "string", "description": "Nom du visiteur"},
    "phone": {"type": "string", "description": "Numéro de téléphone du visiteur"},
    "message": {"type": "string", "description": "Message ou demande du visiteur"},
}

# Schema impose pour create_ticket : memes regles que capture_lead (les champs
# configures cote dashboard sont ignores)
CREATE_TICKET_PROPS = {
    "subject": {"type": "string", "description": "Sujet court du ticket"},
    "summary": {"type": "string", "description": "Résumé détaillé de la demande du visiteur"},
    "email": {"type": "string", "description": "Email du visiteur s'il l'a communiqué"},
    "name": {"type": "string", "description": "Nom du visiteur"},
    "phone": {"type": "string", "description": "Téléphone du visiteur"},
}


def _action_schema(action: dict) -> tuple[dict, list[str]]:
    """(properties, required) du schema JSON d'une action configuree."""
    if action.get("type") == "capture_lead":
        return dict(CAPTURE_LEAD_PROPS), ["email"]
    if action.get("type") == "create_ticket":
        return dict(CREATE_TICKET_PROPS), ["subject", "summary"]
    if action.get("type") == "calendar_slots":
        # Aucun argument : l'executor calcule les 7 prochains jours, la
        # description du tool est celle redigee par le client sur l'action
        return {}, []
    props: dict = {}
    required: list[str] = []
    for field in action.get("fields") or []:
        props[field["name"]] = {
            "type": field.get("type", "string"),
            "description": field.get("description", ""),
        }
        if field.get("required"):
            required.append(field["name"])
    return props, required


def _object_schema(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required}


def _anthropic_tool(name: str, description: str, schema: dict) -> dict:
    """Enveloppe tool au format Anthropic (input_schema = schema JSON complet).
    Formateur par-entree utilise par ai_service (actions, search_docs ET MCP)."""
    return {"name": name, "description": description, "input_schema": schema}


def _openai_tool(name: str, description: str, schema: dict) -> dict:
    """Enveloppe tool au format OpenAI (parameters = schema JSON complet).
    Formateur par-entree utilise par ai_service (actions, search_docs ET MCP)."""
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": schema},
    }


async def _run_action(bot: Bot, name: Optional[str], args: dict,
                      db, conversation_id: Optional[str]):
    """Retrouve l'action configuree par son nom et l'execute."""
    for action in bot.actions_json or []:
        if action.get("name") == name:
            return await execute_action(action, args, bot, db=db,
                                        conversation_id=conversation_id)
    raise ActionError(f"Action inconnue : {name}")


def _eligible_actions(bot: Bot) -> list[dict]:
    """Actions exposables en tools au modele. Ecartees (heritage d'avant les
    reservations de noms, _check_actions ne revalide pas le stock existant) :
    homonyme du tool interne 'search_docs' (deux tools de meme nom rejetes par
    le provider) et prefixe 'mcp_' (le court-circuit MCP de la boucle tool-use
    intercepterait l'appel AVANT _run_action -> action inexecutable)."""
    out = []
    for action in bot.actions_json or []:
        name = str(action.get("name") or "")
        if name == "search_docs":
            continue
        if name.startswith("mcp_"):
            logger.info("Action héritée au nom réservé mcp_ ignorée (bot %s) : %s",
                        bot.id, name)
            continue
        out.append(action)
    return out


# --- Tool interne search_docs (base de connaissances RAG) ---
# Expose seulement si le bot a des extraits indexes (has_kb, calcule par
# routers/widget.py). JAMAIS resolu via actions_json : court-circuite avant
# _run_action ('search_docs' est un nom d'action interdit cote dashboard).

SEARCH_DOCS_TOOL = {
    "name": "search_docs",
    "description": "Recherche dans la documentation et la base de connaissances du site. "
                   "À utiliser pour toute question factuelle sur le site, ses produits ou services.",
    "properties": {"query": {"type": "string", "description": "Question ou mots-clés de recherche"}},
    "required": ["query"],
}


async def _run_search_docs(bot: Bot, args: dict, db) -> tuple[str, bool]:
    """(tool_result, is_error). Top 5 extraits {content, ref} en JSON borne."""
    if db is None:
        return "Recherche documentaire indisponible dans ce contexte", True
    from src.services.kb_service import search_chunks
    query = str((args or {}).get("query", ""))[:500]
    _, results = await search_chunks(db, bot.id, query, k=5)
    if not results:
        return "Aucun résultat dans la documentation", False
    payload = json.dumps(
        [{"content": r["content"][:600], "ref": r["ref"]} for r in results],
        ensure_ascii=False,
    )[:2000]
    return payload, False
