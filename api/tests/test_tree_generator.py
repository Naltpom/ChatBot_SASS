"""Tests unitaires du générateur d'arbre (services/tree_generator.py).

Cible le sanitizer _sanitize_tree, qui répare les arbres « presque valides »
produits par l'IA AVANT validate_tree — pour qu'une seule option fautive (URL
dans "next", cas observé en prod) ne fasse plus échouer toute la génération.

Lancement : pytest tests/test_tree_generator.py -q  (depuis api/).
"""
from src.services.tree_engine import validate_tree
from src.services.tree_generator import _sanitize_tree


def test_url_in_next_folded_into_message_and_option_dropped():
    tree = {
        "start": "root",
        "nodes": {
            "root": {
                "message": "Bonjour !",
                "options": [
                    {"label": "Voir la démo", "next": "https://chapote.fr/demo"},
                    {"label": "Autre question", "next": "__ai__"},
                ],
            },
        },
    }
    out = _sanitize_tree(tree)
    # L'arbre réparé passe désormais la validation (avant : TreeError).
    validate_tree(out)
    root = out["nodes"]["root"]
    # Le lien externe est replié dans le message en markdown…
    assert "[Voir la démo](https://chapote.fr/demo)" in root["message"]
    # …et l'option fautive est retirée ; les options valides survivent.
    assert root["options"] == [{"label": "Autre question", "next": "__ai__"}]


def test_option_to_unknown_node_is_dropped():
    tree = {
        "start": "root",
        "nodes": {
            "root": {
                "message": "Menu",
                "options": [
                    {"label": "Cassée", "next": "noeud_fantome"},
                    {"label": "Services", "next": "services"},
                ],
            },
            "services": {"message": "Nos services.", "options": [{"label": "Retour", "next": "root"}]},
        },
    }
    out = _sanitize_tree(tree)
    validate_tree(out)
    assert out["nodes"]["root"]["options"] == [{"label": "Services", "next": "services"}]


def test_valid_tree_is_left_untouched():
    tree = {
        "start": "root",
        "nodes": {
            "root": {"message": "Bonjour !", "options": [{"label": "Aide", "next": "__ai__"}]},
        },
    }
    out = _sanitize_tree(tree)
    validate_tree(out)
    assert out["nodes"]["root"]["message"] == "Bonjour !"
    assert out["nodes"]["root"]["options"] == [{"label": "Aide", "next": "__ai__"}]
