"""Garde-fou CI : l'historique Alembic ne doit avoir QU'UNE seule head.

Plusieurs heads => `alembic upgrade head` échoue au démarrage (« Multiple head
revisions »). Piège déjà rencontré (merges démo/prospecting/2FA) ; ce test casse
la CI si une nouvelle migration oublie de chaîner sur la head courante ou crée une
branche non mergée."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_alembic_single_head():
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert len(heads) == 1, f"Plusieurs heads Alembic présentes : {heads}"
