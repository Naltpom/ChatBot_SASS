"""Taux de change indicatifs (Banque centrale européenne, publication quotidienne).

Servent seulement à afficher un équivalent « ≈ » à côté du prix en euros sur
music.chapote.fr ; le montant réellement payé est fixé par Stripe (Adaptive Pricing).
Cache mémoire de 6 h ; en cas d'échec, on garde les derniers taux connus.
"""
from __future__ import annotations

import logging
import time
import xml.etree.ElementTree as ET

import httpx

logger = logging.getLogger(__name__)

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
TTL_SECONDS = 6 * 3600
RETRY_SECONDS = 15 * 60

_cache: dict = {"date": None, "rates": {}, "fetched": 0.0, "tried": 0.0}


def parse_ecb(xml_text: str) -> tuple[str | None, dict[str, float]]:
    root = ET.fromstring(xml_text)
    date, rates = None, {}
    for el in root.iter():
        if not el.tag.endswith("Cube"):
            continue
        if "time" in el.attrib:
            date = el.attrib["time"]
        cur, rate = el.attrib.get("currency"), el.attrib.get("rate")
        if cur and rate:
            try:
                value = float(rate)
            except ValueError:
                continue
            if value > 0 and len(cur) == 3 and cur.isalpha():
                rates[cur.upper()] = value
    return date, rates


async def get_rates() -> dict:
    now = time.time()
    fresh = _cache["rates"] and now - _cache["fetched"] < TTL_SECONDS
    if not fresh and now - _cache["tried"] > (RETRY_SECONDS if _cache["rates"] else 30):
        _cache["tried"] = now
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(ECB_URL)
                resp.raise_for_status()
            date, rates = parse_ecb(resp.text)
            if rates:
                _cache.update(date=date, rates=rates, fetched=now)
        except Exception as exc:  # réseau, XML : on garde l'ancien cache
            logger.warning("Taux BCE indisponibles : %s", exc)
    return {"base": "EUR", "date": _cache["date"], "rates": dict(_cache["rates"])}
