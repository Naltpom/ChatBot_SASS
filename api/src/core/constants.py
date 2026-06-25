"""Constantes partagées côté backend — sources visiteur comptabilisées et
identifiants de modèles IA aujourd'hui codés en dur à plusieurs endroits.

Ce module CENTRALISE des valeurs existantes (aucun changement de comportement) :
les appelants (stats, admin, usage_service, tree_generator, insights_service)
importent désormais ces constantes.
"""

# --- Sources de messages comptées comme « visiteur » ---------------------
#
# Un message `role="user"` n'est comptabilisé comme question de visiteur que si
# sa `source` appartient à cette whitelist. Cela exclut les marqueurs système
# (ex. `[lead]...`) qui gonfleraient artificiellement les compteurs.
#
# Valeur reproduite à l'identique de l'existant (in_(["ai", "tree"])) :
#   - api/src/routers/stats.py        (~47)
#   - api/src/routers/admin.py        (~55-56)
#   - api/src/services/usage_service.py (~56-57)
#
# Tuple (ordre stable, immuable) : à passer tel quel à `Message.source.in_(...)`.
VISITOR_SOURCES: tuple[str, ...] = ("ai", "tree")


# --- Modèle IA FIXE des outils config-time (dashboard) --------------------
#
# La génération d'arbre (tree_generator) et l'analyse « questions sans réponse »
# (insights_service) utilisent TOUJOURS ce modèle, indépendamment du modèle
# choisi par le client pour son bot : ce sont des appels internes au SaaS, sur
# la clé managée, et la qualité de sortie JSON dépend du modèle. Ne PAS exposer
# ce choix au client.
#
# Valeur reproduite à l'identique de l'existant :
#   - api/src/services/tree_generator.py    (GENERATION_MODEL, ~19)
#   - api/src/services/insights_service.py  (INSIGHTS_MODEL, ~20)
TREE_INSIGHTS_MODEL: str = "claude-sonnet-4-6"


# --- Modules d'entitlement (facturation modulaire — spec §3.1, D4) --------
#
# UN seul jeu de clés de modules, partagé backend/front (parité catalogue
# `billing-catalog-parity.spec.ts`). Ce sont des CLES D'ENTITLEMENT, PAS des
# permissions : ne JAMAIS les ajouter à BOT_PERMS / FIELD_PERMS (sinon
# `permissions-parity.spec.ts` casse).
MODULE_AI = "ai"
MODULE_INBOX = "inbox"
MODULE_RAG = "rag"
MODULE_ACTIONS = "actions"
MODULE_MCP = "mcp"
MODULE_AB = "ab"
MODULE_WHITELABEL = "white_label"

# Tuple (ordre stable et immuable) : source canonique de la parité front.
MODULE_KEYS: tuple[str, ...] = (
    MODULE_AI,
    MODULE_INBOX,
    MODULE_RAG,
    MODULE_ACTIONS,
    MODULE_MCP,
    MODULE_AB,
    MODULE_WHITELABEL,
)

# Mapping explicite des codes catalogue (billing_products.code) vers le module
# d'entitlement qu'ils activent. mod_ai et mod_ai_byok activent tous deux le
# module IA (BYOK = variante forfait non métrée).
CODE_TO_MODULE: dict[str, str] = {
    "mod_ai": MODULE_AI,
    "mod_ai_byok": MODULE_AI,
    "mod_inbox": MODULE_INBOX,
    "mod_rag": MODULE_RAG,
    "mod_actions": MODULE_ACTIONS,
    "mod_mcp": MODULE_MCP,
    "mod_ab": MODULE_AB,
    "mod_whitelabel": MODULE_WHITELABEL,
}
