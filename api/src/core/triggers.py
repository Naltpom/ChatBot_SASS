"""Triggers proactifs : source UNIQUE des bornes de validité par type.

Le PRÉDICAT pur `_trigger_value_valid` et les constantes `_TRIGGER_TYPES` /
`_MAX_TRIGGERS` étaient dupliqués entre :
  - routers/bots_helpers.py (`_check_triggers`, traitement = raise 422)
  - routers/widget_helpers.py (`_sanitize_triggers`, traitement = continue/ignore)

Seule la VALIDITÉ de la `value` selon le `type` est factorisée ici (lecture
seule, sans I/O) ; le TRAITEMENT (lever 422 vs ignorer silencieusement) reste
chez chaque appelant. Module feuille : aucun import projet (pas de cycle).
"""
from typing import Any

# Types de déclencheurs supportés (ordre stable).
_TRIGGER_TYPES: tuple[str, ...] = ("time_on_page", "scroll_depth", "exit_intent", "url_pattern")
# Nombre maximal de déclencheurs par bot.
_MAX_TRIGGERS: int = 5


def _trigger_value_valid(ttype: str, value: Any) -> bool:
    """True si `value` est valide pour le type `ttype` donné.
    value selon type : time_on_page = secondes 1-600, scroll_depth = % 1-100,
    url_pattern = motif 1-200 chars, exit_intent = sans value (toujours valide).
    bool est une sous-classe d'int : exclu explicitement des bornes int."""
    if ttype == "time_on_page":
        return not isinstance(value, bool) and isinstance(value, int) and 1 <= value <= 600
    if ttype == "scroll_depth":
        return not isinstance(value, bool) and isinstance(value, int) and 1 <= value <= 100
    if ttype == "url_pattern":
        return isinstance(value, str) and 1 <= len(value) <= 200
    # exit_intent (et tout type sans value) : pas de borne sur value
    return True
