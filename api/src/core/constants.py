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
