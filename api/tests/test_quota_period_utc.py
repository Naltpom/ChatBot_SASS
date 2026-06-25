"""Frontière de période du quota IA = mois CALENDAIRE UTC (spec D8/F1).

Le même calcul `utcnow().strftime("%Y-%m")` doit être utilisé des DEUX côtés :
- `quota_service.quota_period()` (clé Redis) ;
- `usage_service.count_ai_messages_month` via `_month_start(period)` (borne SQL).

On mocke l'horloge pour exercer la bascule de mois et vérifier qu'un instant
juste AVANT minuit UTC le 1er du mois tombe dans le mois précédent, et juste
APRÈS dans le nouveau (jamais de décalage de fuseau local).
"""
from datetime import datetime

import pytest

from src.services import quota_service as qs
from src.services import usage_service as us


def test_quota_period_format_utc():
    """quota_period(now) = 'YYYY-MM' de l'instant fourni (UTC naïf)."""
    assert qs.quota_period(datetime(2026, 6, 20, 12, 0, 0)) == "2026-06"
    assert qs.quota_period(datetime(2026, 1, 1, 0, 0, 0)) == "2026-01"
    assert qs.quota_period(datetime(2026, 12, 31, 23, 59, 59)) == "2026-12"


def test_quota_period_utilise_utcnow(monkeypatch):
    """Sans argument, quota_period lit utcnow() (UTC naïf du repo)."""
    monkeypatch.setattr(qs, "utcnow", lambda: datetime(2027, 3, 15, 8, 0, 0))
    assert qs.quota_period() == "2027-03"


def test_bascule_de_mois_frontiere_utc(monkeypatch):
    """23:59:59 UTC le 30/06 -> '2026-06' ; 00:00:00 UTC le 01/07 -> '2026-07'.

    La frontière est strictement à minuit UTC : pas de glissement dû à un
    fuseau local (qui ferait basculer plus tôt/plus tard)."""
    monkeypatch.setattr(qs, "utcnow", lambda: datetime(2026, 6, 30, 23, 59, 59))
    assert qs.quota_period() == "2026-06"

    monkeypatch.setattr(qs, "utcnow", lambda: datetime(2026, 7, 1, 0, 0, 0))
    assert qs.quota_period() == "2026-07"


def test_month_start_coherent_avec_period():
    """count_ai_messages_month borne au 1er du mois UTC, naïf (colonnes sans tz).

    _month_start(period) doit renvoyer minuit du 1er jour du mois demandé."""
    assert us._month_start("2026-06") == datetime(2026, 6, 1, 0, 0, 0)
    assert us._month_start("2026-01") == datetime(2026, 1, 1, 0, 0, 0)
    assert us._month_start("2026-12") == datetime(2026, 12, 1, 0, 0, 0)


def test_month_start_courant_via_utcnow(monkeypatch):
    """_month_start(None) = 1er du mois courant via utcnow()."""
    monkeypatch.setattr(us, "utcnow", lambda: datetime(2026, 6, 20, 15, 30, 0))
    assert us._month_start() == datetime(2026, 6, 1, 0, 0, 0)


def test_period_et_month_start_meme_mois(monkeypatch):
    """Cohérence des deux côtés : la période Redis et la borne SQL pointent le
    MÊME mois pour un instant donné (jamais de divergence au changement de mois)."""
    instant = datetime(2026, 7, 1, 0, 0, 1)  # 1 s après la bascule
    monkeypatch.setattr(qs, "utcnow", lambda: instant)
    monkeypatch.setattr(us, "utcnow", lambda: instant)
    period = qs.quota_period()
    assert period == "2026-07"
    # La borne SQL du même `period` est bien le 1er juillet (pas le 1er juin).
    assert us._month_start(period) == datetime(2026, 7, 1, 0, 0, 0)
