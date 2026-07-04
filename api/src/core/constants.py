"""Constantes partagées côté backend — sources visiteur comptabilisées et
identifiants de modèles IA."""

# --- Sources de messages comptées comme « visiteur » ---------------------
#
# Un message `role="user"` n'est comptabilisé comme question de visiteur que si
# sa `source` appartient à cette whitelist. Cela exclut les marqueurs système
# (ex. `[lead]...`) qui gonfleraient artificiellement les compteurs.
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

# --- Axe IA métré (dépassement de quota, Stripe Billing Meters) -----------
#
# METER_EVENT_NAME : event_name UNIQUE du Meter Stripe `mtr_ai` (référencé par le
# Price métré ET les meter_events rapportés). Figé côté catalogue (seed) et
# côté runtime (widget) : doit être IDENTIQUE des deux côtés.
METER_EVENT_NAME: str = "ai_reply_overage"

# OVERAGE_CAP_DEFAULT : plafond de sécurité par défaut du dépassement IA (réponses
# facturées max/mois) quand l'owner active le mode 'meter' sans cap explicite.
OVERAGE_CAP_DEFAULT: int = 1000

# METERED_CODE : code catalogue de la SEULE ligne MÉTRÉE (kind='metered',
# Stripe usage_type=metered). Un item métré est traité À PART de toute
# reconstruction de raw_items : on le reconduit TEL QUEL (price + si_id, flag
# `metered`, SANS quantity, JAMAIS supprimé), il ne porte AUCUN module et ne
# participe PAS à la classification ajout/retrait/swap des plans. Il n'est
# (dé)câblé QUE par le toggle dépassement (_sync_overage_item). Le retirer ou
# lui coller une quantity lors d'un changement de plan = fuite de revenu /
# Stripe 400 sur l'item métré.
METERED_CODE: str = "mtr_ai"


# --- Anti-brute-force du 2nd facteur 2FA (API-01) -------------------------
#
# MAX_2FA_CHALLENGE_FAILURES : plafond de TENTATIVES (crédits) sur UN challenge 2FA
# donné (clé = `jti`), toutes IP confondues. Chaque vérification du 2nd facteur
# décompte 1 crédit ATOMIQUEMENT et AVANT la crypto (cf. _enforce_2fa_verify) ;
# au-delà du plafond le challenge est INVALIDÉ (marqué consommé via le store
# single-use). C'est la borne anti-brute-force RÉELLE, indépendante de l'IP — elle
# ferme la rotation d'IP (impossible de dépasser ~ce nombre d'essais par challenge en
# changeant d'adresse) et TIENT SOUS CONCURRENCE (INCR atomique amont). Pour
# réessayer, il faut re-login (nouveau challenge), borné par le limiteur de login mot
# de passe. PAS de verrou persistant par compte (aucun DoS ciblé possible). Aligné
# sur le seuil du throttle par-IP.
MAX_2FA_CHALLENGE_FAILURES: int = 5


def is_metered_code(code: str | None) -> bool:
    """True si `code` désigne la ligne MÉTRÉE (mtr_ai) — item de facturation à
    l'usage attaché/détaché par le seul toggle dépassement, invariant des
    reconstructions de raw_items (jamais classé add/remove, jamais de quantity,
    jamais supprimé lors d'un changement de plan)."""
    return code == METERED_CODE


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
