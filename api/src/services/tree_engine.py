"""Moteur d'arbre de decision.

Format du tree_json (exportable/importable en fichier) :
{
  "start": "root",
  "nodes": {
    "root": {
      "message": "Bonjour !",
      "options": [
        {"label": "Tarifs", "next": "pricing"},
        {"label": "Parler à l'IA", "next": "__ai__"}
      ]
    }
  }
}

`next: "__ai__"` est un noeud special : la conversation bascule en mode IA
(texte libre). Les reponses tree n'appellent aucun provider IA (zero cout).
"""
import copy
from typing import Any, Optional

from src.core.constants import MODULE_ACTIONS, MODULE_AI, MODULE_INBOX

AI_NODE = "__ai__"

# Mapping noeud -> module d'entitlement DÉRIVÉ de l'arbre (onboarding guidé WP).
# handoff (mise en relation conseiller) exige le module Inbox ; lead (formulaire
# de capture de contact) exige le module Actions. appointment reste du SOCLE.
# L'option `next=='__ai__'` implique le module IA (traité à part, ce n'est pas un
# type de noeud). Source UNIQUE, partagée par la recommandation et l'élagage.
NODE_TYPE_TO_MODULE = {"handoff": MODULE_INBOX, "lead": MODULE_ACTIONS}

# Types de noeuds. Sans `type` = noeud message classique (retro-compat des
# arbres existants). appointment = URL de calendrier (Calendly/Cal.com) rendue
# en overlay par le widget. lead = formulaire de contact dans le widget.
# handoff = demande de conseiller humain (le widget enchaine POST /widget/handoff,
# le `message` du noeud sert de texte d'intro — aucun champ supplementaire).
NODE_TYPES = ("message", "appointment", "lead", "handoff")
LEAD_FIELDS = ("email", "phone", "name", "message")


class TreeError(ValueError):
    pass


def validate_tree(tree: dict[str, Any]) -> None:
    """Leve TreeError si l'arbre est invalide (appele a la sauvegarde dashboard)."""
    nodes = tree.get("nodes")
    start = tree.get("start")
    if not isinstance(nodes, dict) or not nodes:
        raise TreeError("L'arbre doit contenir un objet 'nodes' non vide")
    if start not in nodes:
        raise TreeError(f"Le noeud de départ '{start}' n'existe pas dans 'nodes'")
    for key, node in nodes.items():
        if not isinstance(node.get("message"), str) or not node["message"].strip():
            raise TreeError(f"Le noeud '{key}' doit avoir un 'message' non vide")
        ntype = node.get("type")
        if ntype is not None and ntype not in NODE_TYPES:
            raise TreeError(f"Le noeud '{key}' a un type inconnu '{ntype}'")
        if ntype == "appointment":
            url = node.get("url")
            if not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
                raise TreeError(f"Le noeud '{key}' (rendez-vous) doit avoir une 'url' https:// valide")
        if ntype == "lead":
            fields = node.get("fields", ["email", "message"])
            if (not isinstance(fields, list) or "email" not in fields
                    or any(f not in LEAD_FIELDS for f in fields)):
                raise TreeError(f"Le noeud '{key}' (contact) a des 'fields' invalides — email obligatoire, choix : {', '.join(LEAD_FIELDS)}")
        for opt in node.get("options", []):
            if not opt.get("label"):
                raise TreeError(f"Une option du noeud '{key}' n'a pas de 'label'")
            target = opt.get("next")
            if target != AI_NODE and target not in nodes:
                raise TreeError(f"L'option '{opt['label']}' du noeud '{key}' pointe vers un noeud inconnu '{target}'")
    # Un depart sans option = widget mort en mode tree
    if not nodes[start].get("options"):
        raise TreeError("Le nœud de départ doit proposer au moins un choix")


def get_node(tree: dict[str, Any], node_id: Optional[str] = None) -> tuple[str, dict[str, Any]]:
    """Retourne (node_id, node). Sans node_id -> noeud de depart.

    Noeud inconnu (arbre modifie en cours de session) -> retombe sur le depart
    plutot que de casser la conversation.
    """
    nodes = tree.get("nodes", {})
    start = tree.get("start", "root")
    if node_id and node_id in nodes:
        rid, node = node_id, nodes[node_id]
    else:
        rid, node = start, nodes.get(start, {"message": "Bonjour !", "options": []})
    # Le noeud de DEPART est toujours un menu d'entree : on neutralise un type
    # TERMINAL (handoff/lead/appointment) qui declencherait une action des
    # l'ouverture du chat (ex. arbre genere par IA ayant halluciné
    # "type":"handoff" sur la racine -> mise en relation conseiller immediate).
    # Read-only : on sert une copie nettoyee, la donnee stockee n'est pas touchee.
    if rid == start and isinstance(node, dict) and node.get("type") in ("handoff", "lead", "appointment"):
        node = {k: v for k, v in node.items() if k not in ("type", "url", "fields")}
    return rid, node


def format_node_response(node_id: str, node: dict[str, Any]) -> dict[str, Any]:
    out = {
        "source": "tree",
        "node_id": node_id,
        "message": node["message"],
        "options": [
            {"label": o["label"], "next": o["next"]}
            for o in node.get("options", [])
        ],
    }
    # Noeuds types (rendez-vous / contact) : re-sanitisation au service, en
    # plus de validate_tree a la sauvegarde et du widget (defense en couches).
    ntype = node.get("type")
    if ntype == "appointment" and isinstance(node.get("url"), str) and node["url"].startswith("https://"):
        out["type"] = "appointment"
        out["url"] = node["url"][:500]
    elif ntype == "lead":
        out["type"] = "lead"
        out["fields"] = [f for f in node.get("fields", ["email", "message"]) if f in LEAD_FIELDS] or ["email"]
    elif ntype == "handoff":
        # Opt-in strict : les reponses sans type restent identiques (contrat
        # e2e). Le serveur ne change PAS le statut ici — c'est le POST
        # /widget/handoff enchaine par le widget qui fait la transition.
        out["type"] = "handoff"
    return out


# --------------------------------------------------------------------------
# Onboarding guidé WP : modules dérivés de l'arbre + élagage par modules
# --------------------------------------------------------------------------

def required_modules_for_tree(tree: dict[str, Any]) -> set[str]:
    """Modules d'entitlement IMPOSÉS par la structure de l'arbre (pur, testable) :
    un noeud `handoff` -> Inbox ; un noeud `lead` -> Actions ; une option
    `next == '__ai__'` -> IA. Le noeud `appointment` reste du socle (aucun module).
    Tolérant aux arbres malformés (retourne un set, jamais d'exception)."""
    required: set[str] = set()
    nodes = (tree or {}).get("nodes")
    if not isinstance(nodes, dict):
        return required
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        mod = NODE_TYPE_TO_MODULE.get(node.get("type"))
        if mod:
            required.add(mod)
        for opt in node.get("options") or []:
            if isinstance(opt, dict) and opt.get("next") == AI_NODE:
                required.add(MODULE_AI)
    return required


def _prune_tree(tree: dict[str, Any], kept_modules: set[str]) -> tuple[dict[str, Any], list[str]]:
    """Cœur de l'élagage (retourne (arbre, removed_node_ids)). Voir
    prune_tree_for_modules. Idempotent et NON mutant (copie profonde)."""
    # Import paresseux (comme bots.py) : evite de charger models.bot au simple
    # import de tree_engine (importe largement, dont par le widget).
    from src.models.bot import DEFAULT_TREE

    work = copy.deepcopy(tree) if isinstance(tree, dict) else {}
    nodes = work.get("nodes")
    start = work.get("start")
    # Arbre dégénéré d'entrée : on rend l'arbre par défaut (jamais un widget mort).
    if not isinstance(nodes, dict) or not nodes or start not in nodes:
        return copy.deepcopy(DEFAULT_TREE), []

    ai_kept = MODULE_AI in kept_modules

    # 1. Noeuds à retirer = module dérivé hors `kept`. JAMAIS le start : on
    #    neutralise seulement son type terminal (il reste un menu d'accueil).
    removed: set[str] = set()
    for nid, node in nodes.items():
        if nid == start:
            if isinstance(node, dict) and node.get("type") in ("handoff", "lead", "appointment"):
                for k in ("type", "url", "fields"):
                    node.pop(k, None)
            continue
        mod = NODE_TYPE_TO_MODULE.get(node.get("type")) if isinstance(node, dict) else None
        if mod is not None and mod not in kept_modules:
            removed.add(nid)
    for nid in removed:
        nodes.pop(nid, None)

    # 2. Rebranche toute option vers un noeud supprimé/inexistant OU vers `__ai__`
    #    (si IA non gardée) -> retour au start. Déduplique (label, next).
    for node in nodes.values():
        if not isinstance(node, dict) or not isinstance(node.get("options"), list):
            continue
        new_opts: list[dict] = []
        seen: set[tuple] = set()
        for opt in node["options"]:
            if not isinstance(opt, dict) or not opt.get("label"):
                continue
            nxt = opt.get("next")
            if nxt == AI_NODE:
                if not ai_kept:
                    nxt = start
            elif nxt not in nodes:
                nxt = start
            key = (opt.get("label"), nxt)
            if key in seen:
                continue
            seen.add(key)
            new_opts.append({**opt, "next": nxt})
        node["options"] = new_opts

    # 3. BFS depuis le start : retire les noeuds devenus orphelins.
    reachable: set[str] = set()
    queue = [start]
    while queue:
        cur = queue.pop()
        if cur in reachable or cur not in nodes:
            continue
        reachable.add(cur)
        for opt in nodes[cur].get("options") or []:
            nxt = opt.get("next")
            if nxt != AI_NODE and nxt in nodes and nxt not in reachable:
                queue.append(nxt)
    orphans = set(nodes) - reachable
    for nid in orphans:
        nodes.pop(nid, None)
    removed |= orphans

    # 4. Garde-fou : un arbre élagué invalide/dégénéré -> arbre par défaut.
    try:
        validate_tree(work)
    except TreeError:
        return copy.deepcopy(DEFAULT_TREE), sorted(removed)
    return work, sorted(removed)


def prune_tree_for_modules(tree: dict[str, Any], kept_modules: set[str]) -> dict[str, Any]:
    """Copie élaguée de l'arbre, ne conservant que les noeuds dont le module
    dérivé appartient à `kept_modules` (le SOCLE — lead/appointment, menus — est
    toujours conservé). Les options pointant vers un noeud supprimé ou vers
    `__ai__` (IA exclue) sont rebranchées vers le start ; les orphelins sont
    retirés. Idempotent, NON mutant. Un résultat invalide retombe sur
    Bot.DEFAULT_TREE (jamais de widget mort)."""
    pruned, _removed = _prune_tree(tree, set(kept_modules))
    return pruned


def prune_tree_with_removed(tree: dict[str, Any], kept_modules: set[str]) -> tuple[dict[str, Any], list[str]]:
    """Variante de prune_tree_for_modules qui renvoie AUSSI la liste triée des ids
    de noeuds retirés (pour l'endpoint /tree/prune, qui montre le diff sans
    sauvegarder)."""
    return _prune_tree(tree, set(kept_modules))
