"""Clés d'apparence du widget ajoutées pour les sites à plusieurs couleurs (sanitize_design).

Absentes ou invalides -> valeur historique : les widgets existants ne changent pas.
"""
from src.routers.widget_helpers import sanitize_design


def test_launcher_badge():
    assert sanitize_design({})["launcherBadge"] is True
    assert sanitize_design({"launcherBadge": "no"})["launcherBadge"] is True
    assert sanitize_design({"launcherBadge": False})["launcherBadge"] is False


def test_on_primary_and_surface_tone():
    d = sanitize_design({})
    assert d["onPrimary"] is None and d["surfaceTone"] == "classic"
    bad = sanitize_design({"onPrimary": "red;background:url(x)", "surfaceTone": "neon"})
    assert bad["onPrimary"] is None and bad["surfaceTone"] == "classic"
    ok = sanitize_design({"onPrimary": "#1a0e08", "surfaceTone": "neutral"})
    assert ok["onPrimary"] == "#1a0e08" and ok["surfaceTone"] == "neutral"
