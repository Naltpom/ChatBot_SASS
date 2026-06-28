"""Parité du catalogue de facturation — VOLET BACKEND (clés canoniques).

Contexte (audit §3.1, source unique) : le catalogue (prix, % remise intro,
plafonds, libellés, liste de modules) est servi par UNE seule source —
GET /api/billing/catalog (`_catalog_payload`), construite depuis
`core/constants.py` (MODULE_KEYS / CODE_TO_MODULE) + Stripe (billing_products).
Le front et le plugin WordPress ne dupliquent plus aucun PRIX : ils consomment ce
catalogue. Ne subsistent en copie que les CLÉS de module (typage front + allowlist
de sanitisation PHP), couvertes par le test de parité.

Ce module pytest verrouille la cohérence INTERNE des sources canoniques backend
(sans DB, exécutable dans le conteneur api). La parité CROSS-SURFACE (front
`MODULE_KEYS` + type `ModuleKey` + allowlist PHP vs backend) est vérifiée par
`e2e/tests/billing-catalog-parity.spec.ts`, qui LIT les fichiers front/PHP réels
(le conteneur api n'a pas accès à app/ ni integrations/).

Ce que ce test GARANTIT :
  - impossible d'ajouter/retirer un module dans CODE_TO_MODULE sans l'ajouter à
    MODULE_KEYS (et inversement) : toute dérive casse `test_code_module_keys_align` ;
  - le module IA reste dans MODULE_KEYS et porte deux codes catalogue (managé +
    BYOK) ;
  - aucune clé de module en double (l'ordre de MODULE_KEYS est la vérité figée
    consommée par /api/meta/billing-catalog et le front).
"""
from src.core.constants import (
    CODE_TO_MODULE,
    MODULE_AI,
    MODULE_KEYS,
)


def test_module_keys_unique_and_canonical():
    """MODULE_KEYS = clés uniques, IA incluse (source figée du contrat catalogue)."""
    assert len(MODULE_KEYS) == len(set(MODULE_KEYS)), "MODULE_KEYS contient un doublon"
    assert MODULE_AI in MODULE_KEYS


def test_code_module_keys_align():
    """Tout code catalogue (CODE_TO_MODULE) pointe vers une clé de MODULE_KEYS, et
    toute clé de MODULE_KEYS est atteignable par au moins un code. C'est ce lien
    qui permet à `_catalog_payload` de n'exposer QUE des modules de MODULE_KEYS
    (garde de parité D4) — une dérive d'une des deux constantes casse ici."""
    mapped = set(CODE_TO_MODULE.values())
    assert mapped == set(MODULE_KEYS), (
        "Dérive entre CODE_TO_MODULE et MODULE_KEYS : "
        f"sans code={set(MODULE_KEYS) - mapped}, "
        f"sans clé={mapped - set(MODULE_KEYS)}"
    )


def test_ai_has_managed_and_byok_codes():
    """L'IA est exposée comme module avec DEUX codes (plan managé + variante BYOK)
    — invariant consommé par `_catalog_payload` (module 'ai' + byok_price_cents)."""
    ai_codes = {c for c, m in CODE_TO_MODULE.items() if m == MODULE_AI}
    assert ai_codes == {"mod_ai", "mod_ai_byok"}
