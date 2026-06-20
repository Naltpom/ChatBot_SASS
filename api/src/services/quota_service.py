"""Compteur de quota IA mensuel par bot (spec §3.4 — D7/D8/F1).

Mécanique distincte du rate-limit (`services/rate_limit.py`) sur DEUX points :

1. **Compteur calendaire, pas fenêtre glissante** : clé Redis
   `quota:ai:{YYYY-MM}:bot:{bot_id}` incrémentée par `INCR`, avec `EXPIRE ~35j`
   (la clé du mois courant survit au mois ; elle expire d'elle-même un peu après
   la bascule de mois). `period = utcnow().strftime("%Y-%m")` — **UTC** (D8),
   STRICTEMENT le même calcul que `usage_service.count_ai_messages_month`.

2. **FAIL-CLOSED** (≠ rate-limit qui est fail-open) : si Redis est indisponible
   (paquet absent, `REDIS_URL` non définie, panne), on NE bypasse PAS en mémoire
   process — on retombe sur un `COUNT` SQL de la table `Message` (source de vérité
   durable, D7). Un quota cash-flow ne doit jamais s'ouvrir silencieusement sur
   une panne d'accélérateur. Idem au tout début de mois ou si la clé Redis a
   expiré/disparu : on **reseed** la clé depuis le COUNT SQL (cohérent : COUNT=0
   en début de mois) avant d'incrémenter.

Source DURABLE = `Message` (D7) ; Redis n'est qu'un accélérateur. La conso n'est
JAMAIS comptée deux fois : l'incrément Redis est posé APRÈS la persistance du
message (call-site `widget.py`), et le reseed lit le COUNT SQL qui inclut déjà
ce message.

DEUX TEMPS (corrige le crédit brûlé sur panne provider) :

- `ai_quota_precheck` — LECTURE SEULE, AVANT `generate_reply` : « le quota est-il
  déjà épuisé ? » sans aucun incrément. Sert à refuser proprement (message dédié)
  quand le mois est plein, sans réserver de crédit pour une réponse qui n'existe
  pas encore.
- `ai_quota_consume` — INCR, APRÈS un `generate_reply` réussi ET la persistance du
  message assistant. Une panne provider (`AIServiceError`) n'appelle JAMAIS
  `ai_quota_consume` : aucun crédit consommé, Redis ne dérive pas au-dessus du
  COUNT SQL durable.

BYOK : un bot BYOK a `ai_quota_for(ent) is None` (illimité) ⇒ l'appelant n'invoque
NI `ai_quota_precheck` NI `ai_quota_consume`. Ce module ne décide rien du BYOK
lui-même.
"""
import logging
import time

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.services.usage_service import count_ai_messages_month

logger = logging.getLogger("quota")

# Paquet optionnel (comme rate_limit) : repli COUNT SQL si absent.
try:
    import redis.asyncio as aioredis
except ImportError:  # pragma: no cover
    aioredis = None

# Connexion paresseuse dédiée au quota. On NE réutilise PAS le client de
# rate_limit (cooldown/état de panne partagés brouilleraient les sémantiques :
# fail-open là-bas, fail-closed ici).
_redis = None
_warned = False
_retry_at = 0.0
_RETRY_COOLDOWN_SECONDS = 30.0

# La clé du mois courant doit survivre jusqu'à la fin du mois ; 35 jours couvre
# le mois le plus long (31 j) + marge, puis la clé expire d'elle-même.
_QUOTA_TTL_SECONDS = 35 * 86400


def quota_period(now=None) -> str:
    """Période calendaire "YYYY-MM" en UTC (D8). Même calcul des deux côtés."""
    return (now or utcnow()).strftime("%Y-%m")


def _quota_key(period: str, bot_id: int) -> str:
    return f"quota:ai:{period}:bot:{bot_id}"


def _warn_once(reason: str) -> None:
    global _warned
    if not _warned:
        _warned = True
        logger.warning(
            "Quota IA : %s -> repli COUNT SQL (fail-CLOSED, la source durable "
            "Message fait foi)", reason
        )


def _get_redis():
    """Client redis.asyncio dédié au quota (paresseux). None => COUNT SQL."""
    global _redis, _retry_at
    if not settings.REDIS_URL:
        return None
    if aioredis is None:
        _warn_once("paquet python 'redis' absent de l'image")
        return None
    if time.monotonic() < _retry_at:
        return None
    if _redis is None:
        try:
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        except Exception as exc:  # URL invalide, etc.
            _retry_at = time.monotonic() + _RETRY_COOLDOWN_SECONDS
            _warn_once(f"connexion Redis impossible ({exc})")
            return None
    return _redis


def _redis_failed(exc: Exception) -> None:
    global _retry_at
    _retry_at = time.monotonic() + _RETRY_COOLDOWN_SECONDS
    _warn_once(f"erreur Redis ({exc})")


async def _count_sql(db: AsyncSession, bot_id: int, period: str) -> int:
    """Conso durable du mois depuis Message (source de vérité, D7)."""
    return await count_ai_messages_month(db, bot_id, period)


async def ai_quota_precheck(db: AsyncSession, bot_id: int, quota: int) -> bool:
    """LECTURE SEULE : reste-t-il du crédit IA ce mois-ci pour `bot_id` ?

    Renvoie True si une réponse de plus tiendrait dans `quota` (conso courante
    < quota), False si le quota est déjà atteint (mode `block`). N'incrémente
    et ne crée AUCUNE clé : le crédit n'est consommé (`ai_quota_consume`) qu'une
    fois la réponse IA réellement générée ET persistée. Une panne provider en
    aval ne brûle donc jamais de crédit.

    `quota` = `ai_monthly_quota` effectif (entier >= 0). Le cas illimité (BYOK /
    `ai_quota_for(ent) is None`) est géré par l'APPELANT, qui n'appelle alors ni
    ce pré-check ni le consume. Par sécurité, `quota <= 0` (module IA absent)
    refuse.

    FAIL-CLOSED : Redis indispo OU clé absente => verdict via COUNT SQL durable
    (jamais de bypass silencieux).
    """
    if quota <= 0:
        return False

    period = quota_period()
    client = _get_redis()
    if client is not None:
        try:
            current = await client.get(_quota_key(period, bot_id))
            if current is not None:
                return int(current) < quota
        except Exception as exc:
            _redis_failed(exc)
    # Pas de Redis, clé absente (début de mois / expirée), ou erreur : on tranche
    # sur le COUNT SQL durable. Pas de reseed ici (lecture seule) — le reseed est
    # posé par ai_quota_consume au moment de l'incrément.
    used = await _count_sql(db, bot_id, period)
    return used < quota


async def ai_quota_consume(db: AsyncSession, bot_id: int, quota: int) -> bool:
    """Comptabilise (INCR) UNE réponse IA du mois courant pour `bot_id`.

    À appeler UNIQUEMENT après un `generate_reply` réussi, et AVANT la persistance
    du message assistant (call-site `widget.py`) : le reseed lit alors le COUNT SQL
    durable qui n'inclut PAS encore cette réponse (seed=conso des messages déjà
    persistés), et l'INCR ajoute exactement cette réponse — Redis reste aligné sur
    la source de vérité, jamais de double comptage. Sur panne provider, l'appelant
    ne nous invoque PAS (return en amont sur `AIServiceError`) : aucun crédit n'est
    brûlé et Redis ne dérive jamais au-dessus du COUNT SQL.

    Renvoie True si la réponse est dans le quota (et la comptabilise), False si
    l'incrément dépasse le quota — dans ce dernier cas l'incrément est annulé (le
    refus ne consomme pas de crédit). Le gating visiteur est fait en amont par
    `ai_quota_precheck` (lecture seule) ; ce retour False sert de borne de sûreté
    sur une course concurrente du dernier crédit.

    `quota` = `ai_monthly_quota` effectif (entier >= 0). Le cas illimité (BYOK /
    `ai_quota_for(ent) is None`) est géré par l'APPELANT, qui n'appelle alors pas
    cette fonction. Par sécurité, `quota <= 0` (module IA absent) refuse.

    FAIL-CLOSED : Redis indispo => verdict via COUNT SQL (jamais de bypass).
    """
    if quota <= 0:
        return False

    period = quota_period()
    client = _get_redis()

    if client is None:
        # Fail-CLOSED : pas de Redis -> on tranche sur le COUNT SQL durable.
        used = await _count_sql(db, bot_id, period)
        return used < quota

    key = _quota_key(period, bot_id)
    try:
        # La clé existe-t-elle déjà pour ce mois ? Si non (début de mois, clé
        # expirée, ou Redis vidé), on reseed depuis le COUNT SQL durable AVANT
        # d'incrémenter, sinon on repartirait à 0 en milieu de mois.
        current = await client.get(key)
        if current is None:
            seed = await _count_sql(db, bot_id, period)
            if seed >= quota:
                # Quota déjà atteint d'après la source durable : ne pas créer la
                # clé (laisser le prochain reseed retrancher), refuser.
                return False
            # Reseed atomique : pose la valeur durable puis incrémente cette
            # réponse. SET NX évite d'écraser une clé posée en concurrence.
            await client.set(key, seed, ex=_QUOTA_TTL_SECONDS, nx=True)
            new_count = await client.incr(key)
            await client.expire(key, _QUOTA_TTL_SECONDS)
        else:
            new_count = await client.incr(key)
            await client.expire(key, _QUOTA_TTL_SECONDS)

        if new_count > quota:
            # Dépassement : on annule l'incrément qu'on vient de poser (un refus
            # ne consomme pas de crédit, comme le rate-limit Redis).
            await client.decr(key)
            return False
        return True
    except Exception as exc:
        _redis_failed(exc)
        # FAIL-CLOSED : on retombe sur la source durable, jamais sur un bypass.
        used = await _count_sql(db, bot_id, period)
        return used < quota


async def ai_quota_usage(db: AsyncSession, bot_id: int) -> int:
    """Conso IA du mois courant (Redis si dispo, sinon COUNT SQL durable).

    Lecture seule, sert l'affichage usage vs quota (endpoint /api/billing/usage).
    Ne crée ni n'incrémente aucune clé : si la clé Redis manque, lit le COUNT SQL.
    """
    period = quota_period()
    client = _get_redis()
    if client is not None:
        try:
            current = await client.get(_quota_key(period, bot_id))
            if current is not None:
                return int(current)
        except Exception as exc:
            _redis_failed(exc)
    return await _count_sql(db, bot_id, period)
