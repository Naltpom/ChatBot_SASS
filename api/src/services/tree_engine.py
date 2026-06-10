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
(texte libre). Les reponses tree ne comptent pas dans le quota IA.
"""
from typing import Any, Optional

AI_NODE = "__ai__"


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
        return node_id, nodes[node_id]
    return start, nodes.get(start, {"message": "Bonjour !", "options": []})


def format_node_response(node_id: str, node: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "tree",
        "node_id": node_id,
        "message": node["message"],
        "options": [
            {"label": o["label"], "next": o["next"]}
            for o in node.get("options", [])
        ],
    }
