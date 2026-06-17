"""Horloge UTC du projet — remplaçant non-déprécié de `datetime.utcnow()`.

Pourquoi un datetime NAÏF (sans tzinfo) ?
- Les colonnes des modèles sont des `DateTime` SQLAlchemy SANS `timezone=True`
  (cf. api/src/models/*.py : `created_at`, `started_at`, etc.). Elles stockent
  donc des datetimes naïfs ; y écrire un datetime aware ferait diverger les
  comparaisons (`started_at >= since`) et la sérialisation.
- Les schémas Pydantic `*Out` sérialisent ces valeurs SANS suffixe `Z` ni
  offset (`2026-06-16T12:34:56.789012`). Le frontend consomme ces chaînes
  telles quelles ; ajouter une timezone décalerait l'affichage côté client.

`datetime.utcnow()` est déprécié depuis Python 3.12. Cette fonction reproduit
EXACTEMENT son comportement (même instant, même absence de tzinfo) en passant
par l'API recommandée `datetime.now(timezone.utc)` puis en retirant la tzinfo.

Usage : remplacer `datetime.utcnow()` par `utcnow()` (import depuis ce module),
y compris comme `default=`/`onupdate=` de colonnes (la fonction est passée sans
parenthèses, comme `datetime.utcnow` l'était).
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Instant courant en UTC, en datetime NAÏF (tzinfo=None).

    Équivalent strict de `datetime.utcnow()` (déprécié) : même valeur, même
    absence de timezone, sans l'avertissement de dépréciation.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
