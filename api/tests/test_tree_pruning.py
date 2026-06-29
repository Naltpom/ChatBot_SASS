"""Unitaires PURS de l'élagage d'arbre par modules (services/tree_engine.py).

Onboarding guidé WP : `required_modules_for_tree` dérive les modules imposés par
l'arbre (handoff->inbox, option __ai__->ai ; lead/appointment = socle) et
`prune_tree_for_modules` / `prune_tree_with_removed` retirent les noeuds dont le
module n'est pas conservé, en rebranchant proprement vers le start (jamais de
widget mort). Aucune base de données : fonctions pures.

Lancement : pytest tests/test_tree_pruning.py -q  (depuis api/).
"""
import copy

from src.core.constants import MODULE_AI, MODULE_INBOX
from src.models.bot import DEFAULT_TREE
from src.services.tree_engine import (
    prune_tree_for_modules,
    prune_tree_with_removed,
    required_modules_for_tree,
    validate_tree,
)


# --- required_modules_for_tree --------------------------------------------

def test_handoff_node_requires_inbox():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Conseiller", "next": "h"}]},
        "h": {"message": "Mise en relation", "type": "handoff", "options": []},
    }}
    assert required_modules_for_tree(tree) == {MODULE_INBOX}


def test_ai_option_requires_ai():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Poser une question", "next": "__ai__"}]},
    }}
    assert required_modules_for_tree(tree) == {MODULE_AI}


def test_lead_and_appointment_require_no_module():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [
            {"label": "Contact", "next": "l"}, {"label": "RDV", "next": "a"}]},
        "l": {"message": "Vos coordonnées", "type": "lead", "fields": ["email"], "options": []},
        "a": {"message": "Prenez RDV", "type": "appointment",
              "url": "https://cal.com/x", "options": []},
    }}
    assert required_modules_for_tree(tree) == set()


def test_required_modules_tolerates_garbage():
    assert required_modules_for_tree({}) == set()
    assert required_modules_for_tree({"nodes": "nope"}) == set()


# --- prune_tree_for_modules -----------------------------------------------

def _handoff_tree():
    return {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [
            {"label": "Conseiller", "next": "h"},
            {"label": "Services", "next": "svc"}]},
        "h": {"message": "Mise en relation", "type": "handoff", "options": []},
        "svc": {"message": "Nos services", "options": [{"label": "Retour", "next": "root"}]},
    }}


def test_prune_drops_handoff_and_rebranches_to_start():
    tree = _handoff_tree()
    pruned, removed = prune_tree_with_removed(tree, {MODULE_AI})  # inbox EXCLU
    validate_tree(pruned)  # arbre élagué toujours valide (pas de widget mort)
    assert "h" in removed and "h" not in pruned["nodes"]
    opts = {(o["label"], o["next"]) for o in pruned["nodes"]["root"]["options"]}
    # L'option vers le noeud supprimé est rebranchée vers le start (root).
    assert ("Conseiller", "root") in opts
    assert ("Services", "svc") in opts


def test_prune_is_idempotent_and_non_mutating():
    tree = _handoff_tree()
    original = copy.deepcopy(tree)
    p1 = prune_tree_for_modules(tree, {MODULE_AI})
    p2 = prune_tree_for_modules(p1, {MODULE_AI})
    assert p1 == p2          # idempotent
    assert tree == original  # entrée non mutée


def test_prune_rebranches_ai_option_when_ai_excluded():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [
            {"label": "IA", "next": "__ai__"},
            {"label": "Services", "next": "svc"}]},
        "svc": {"message": "Nos services", "options": [{"label": "Retour", "next": "root"}]},
    }}
    pruned = prune_tree_for_modules(tree, {MODULE_INBOX})  # ai EXCLU
    validate_tree(pruned)
    nexts = [o["next"] for o in pruned["nodes"]["root"]["options"]]
    assert "__ai__" not in nexts      # l'option IA ne pointe plus vers l'IA
    assert "root" in nexts            # rebranchée vers le start


def test_prune_removes_orphans():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Conseiller", "next": "h"}]},
        "h": {"message": "Relation", "type": "handoff",
              "options": [{"label": "Détail", "next": "orphan"}]},
        "orphan": {"message": "Atteignable seulement via h",
                   "options": [{"label": "Retour", "next": "root"}]},
    }}
    pruned, removed = prune_tree_with_removed(tree, {MODULE_AI})  # inbox EXCLU
    validate_tree(pruned)
    # h supprimé (module inbox) ET orphan devenu inatteignable -> retiré aussi.
    assert "h" in removed and "orphan" in removed
    assert set(pruned["nodes"].keys()) == {"root"}


def test_prune_preserves_socle_lead_node():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [{"label": "Contact", "next": "l"}]},
        "l": {"message": "Vos coordonnées", "type": "lead", "fields": ["email"],
              "options": [{"label": "Retour", "next": "root"}]},
    }}
    pruned = prune_tree_for_modules(tree, set())  # rien conservé
    validate_tree(pruned)
    assert "l" in pruned["nodes"]  # lead = socle, jamais supprimé


def test_prune_neutralizes_terminal_type_on_start():
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "type": "handoff",
                 "options": [{"label": "IA", "next": "__ai__"}]},
    }}
    pruned = prune_tree_for_modules(tree, {MODULE_AI})
    validate_tree(pruned)
    # Le start n'est JAMAIS supprimé : seul son type terminal est neutralisé.
    assert "type" not in pruned["nodes"]["root"]


def test_prune_degenerate_falls_back_to_default_tree():
    # start sans option -> arbre élagué invalide -> Bot.DEFAULT_TREE.
    pruned = prune_tree_for_modules(
        {"start": "root", "nodes": {"root": {"message": "Hi", "options": []}}}, {MODULE_AI})
    assert pruned == DEFAULT_TREE


def test_prune_invalid_input_falls_back_to_default_tree():
    assert prune_tree_for_modules({"nodes": {}}, {MODULE_AI}) == DEFAULT_TREE
    assert prune_tree_for_modules({}, {MODULE_AI}) == DEFAULT_TREE


def test_prune_dedupes_rebranched_options():
    # Deux options de même label pointant vers des noeuds supprimés -> rebranchées
    # vers start puis dédupliquées (label, next).
    tree = {"start": "root", "nodes": {
        "root": {"message": "Menu", "options": [
            {"label": "Aide", "next": "h1"},
            {"label": "Aide", "next": "h2"},
            {"label": "Services", "next": "svc"}]},
        "h1": {"message": "x", "type": "handoff", "options": []},
        "h2": {"message": "y", "type": "handoff", "options": []},
        "svc": {"message": "Nos services", "options": [{"label": "Retour", "next": "root"}]},
    }}
    pruned = prune_tree_for_modules(tree, {MODULE_AI})  # inbox EXCLU
    validate_tree(pruned)
    opts = pruned["nodes"]["root"]["options"]
    # Les deux "Aide" -> root fusionnent en une seule.
    assert sum(1 for o in opts if o["label"] == "Aide") == 1
