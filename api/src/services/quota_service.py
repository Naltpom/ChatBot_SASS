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
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import OVERAGE_CAP_DEFAULT
from src.core.time import utcnow
from src.models.billing import BotUsageCounter
from src.services import stripe_service
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

# --- Plafond dur journalier widget (audit M2) ---
# Plafond GÉNÉREUX par bot et par jour UTC, appliqué à TOUS les bots, BYOK
# COMPRIS : un bot BYOK a `ai_quota_for(ent) is None` (aucun quota mensuel) —
# sans ce plafond externe, un flux widget soutenu brûlerait la clé du client
# sans aucune borne. Plafond ADDITIONNEL : ne remplace ni le quota mensuel ni
# le metering des bots managés (qui restent inchangés en deçà).
WIDGET_DAILY_HARD_CAP = 5000
# La clé du jour survit un peu après la bascule de jour UTC puis expire seule.
_DAILY_CAP_TTL_SECONDS = 26 * 3600

# --- Plafond de tours IA en aperçu (audit M8) ---
# TTL confortable vs la durée d'une session d'aperçu (JWT widget 30 min) ;
# la clé expire d'elle-même bien après la mort de la session.
_PREVIEW_TTL_SECONDS = 6 * 3600


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


# --- Plafond dur journalier widget (audit M2) --------------------------------


def _daily_period(now=None) -> str:
    """Jour calendaire "YYYY-MM-DD" en UTC (même convention que quota_period)."""
    return (now or utcnow()).strftime("%Y-%m-%d")


def _daily_cap_key(day: str, bot_id: int) -> str:
    return f"quota:widget:day:{day}:bot:{bot_id}"


async def widget_daily_precheck(bot_id: int) -> bool:
    """LECTURE SEULE : le plafond dur journalier (WIDGET_DAILY_HARD_CAP) est-il
    encore ouvert pour `bot_id` aujourd'hui (UTC) ?

    Garde-fou anti-abus EXTERNE, vérifié AVANT `generate_reply` pour TOUS les
    bots (BYOK compris). N'incrémente rien : la conso n'est comptée
    (`widget_daily_consume`) qu'après une génération réussie.

    FAIL-OPEN (≠ quota mensuel) : sans Redis, pas de source durable raisonnable
    pour un compteur journalier — on laisse passer (comme les rate-limits) ; le
    quota mensuel fail-closed et les rate-limits amont restent en place.
    """
    client = _get_redis()
    if client is None:
        return True
    try:
        current = await client.get(_daily_cap_key(_daily_period(), bot_id))
        return int(current or 0) < WIDGET_DAILY_HARD_CAP
    except Exception as exc:
        _redis_failed(exc)
        return True


async def widget_daily_consume(bot_id: int) -> None:
    """Comptabilise UNE réponse IA servie aujourd'hui (UTC) pour `bot_id`.

    À appeler APRÈS un `generate_reply` réussi (jamais sur panne provider).
    Best-effort : une panne Redis ne casse pas la réponse au visiteur."""
    client = _get_redis()
    if client is None:
        return
    key = _daily_cap_key(_daily_period(), bot_id)
    try:
        await client.incr(key)
        await client.expire(key, _DAILY_CAP_TTL_SECONDS)
    except Exception as exc:
        _redis_failed(exc)


# --- Plafond de tours IA en aperçu (audit M8) ---------------------------------


async def preview_turn_acquire(conversation_id: int, max_turns: int) -> bool | None:
    """Réserve UN tour IA d'aperçu pour la conversation `conversation_id`.

    Compteur CÔTÉ SERVEUR (INCR Redis par conversation d'aperçu) : le plafond
    `max_turns` (settings.PREVIEW_MAX_AI_TURNS) ne dépend JAMAIS de l'historique
    fourni par le client — un widget qui strippe ses messages 'assistant' ne
    bypasse plus la borne. INCR-puis-vérif : atomique, sûr en concurrence.
    Un tour réservé n'est pas rendu sur panne provider (borne anti-abus,
    pas un crédit facturé : la simplicité prime).

    Renvoie :
    - True  : ce tour tient dans `max_turns` ;
    - False : plafond atteint, OU Redis configuré mais EN PANNE — FAIL-CLOSED
      (l'aperçu est un confort owner, jamais un chemin payant : pas de bypass
      silencieux sur une panne d'infrastructure) ;
    - None  : REDIS_URL NON configurée (dev/tests, choix de déploiement
      délibéré) — l'appelant retombe sur sa borne dégradée (historique local).
    """
    if max_turns <= 0:
        return False
    if not settings.REDIS_URL:
        return None
    client = _get_redis()
    if client is None:
        # Configuré mais indisponible (paquet absent, cooldown de panne) :
        # fail-closed, comme une erreur Redis ci-dessous.
        return False
    key = f"quota:preview:conv:{conversation_id}"
    try:
        new_count = await client.incr(key)
        await client.expire(key, _PREVIEW_TTL_SECONDS)
        return new_count <= max_turns
    except Exception as exc:
        _redis_failed(exc)
        return False


# --- Dépassement IA métré (overage) : compteur durable BotUsageCounter -----
#
# Le dépassement (réponses servies AU-DELÀ du quota, mode 'meter') est compté dans
# `BotUsageCounter.reported_overage` (par (bot_id, period) UTC), source de vérité
# locale qui fait foi pour la réconciliation. SQL (faible volume : seules les
# réponses au-delà du quota incrémentent) ; pas de Redis ici. Le plafond
# (`overage_cap`, défaut OVERAGE_CAP_DEFAULT) est vérifié AVANT génération
# (ai_overage_precheck), comme le quota : on ne génère jamais au-delà du plafond.


async def _overage_count(db: AsyncSession, bot_id: int, period: str) -> int:
    """Lecture du compteur de dépassement du mois (0 si pas de ligne)."""
    row = (await db.execute(
        select(BotUsageCounter).where(
            BotUsageCounter.bot_id == bot_id,
            BotUsageCounter.period == period,
        )
    )).scalar_one_or_none()
    return int(row.reported_overage or 0) if row is not None else 0


def _month_start_utc(now=None) -> datetime:
    """1er du mois courant à 00:00 UTC, datetime NAÏF (convention colonnes)."""
    d = now or utcnow()
    return datetime(d.year, d.month, 1)


async def ai_overage_precheck(db: AsyncSession, bot_id: int, cap: int | None) -> bool:
    """LECTURE SEULE : reste-t-il du dépassement facturable sous le plafond ?

    Renvoie True si `reported_overage(period) < (cap or OVERAGE_CAP_DEFAULT)` (une
    réponse de dépassement de plus tiendrait sous le plafond), False sinon. Vérifié
    AVANT génération (comme ai_quota_precheck) : on ne génère jamais au-delà du
    plafond. N'incrémente RIEN."""
    period = quota_period()
    limit = cap if cap is not None else OVERAGE_CAP_DEFAULT
    used = await _overage_count(db, bot_id, period)
    return used < limit


async def ai_overage_consume(db: AsyncSession, bot_id: int,
                             customer_id: str | None,
                             event_name: str, cap: int | None) -> bool:
    """Comptabilise UNE réponse de dépassement (INCR durable) ET la rapporte à Stripe.

    À appeler APRÈS un `generate_reply` réussi et AVANT la persistance du message,
    UNIQUEMENT quand le bot est en dépassement armé (overage_active + plafond non
    atteint au pré-check). Étapes :
      1) upsert ATOMIQUE de `BotUsageCounter` sur (bot_id, period) — period_start =
         1er du mois UTC — via `INSERT ... ON CONFLICT DO NOTHING` (aucune
         IntegrityError en course de création concurrente) ;
      2) INCR ATOMIQUE et BORNÉ : un seul `UPDATE ... SET reported_overage =
         reported_overage + 1 WHERE reported_overage < plafond RETURNING ...`.
         Postgres verrouille la ligne pour la durée de l'UPDATE : deux réponses de
         dépassement concurrentes du MÊME bot sont sérialisées — ni lost-update
         (sous-facturation), ni dépassement du plafond en course. Si l'UPDATE ne
         touche aucune ligne (plafond déjà atteint, course du dernier crédit) :
         renvoie False (refus, ne consomme pas) — le gating principal reste le
         pré-check ;
      3) si un `customer_id` payeur est résolu, rapporte le meter event Stripe
         (best-effort : StripeError AVALÉE et loggée — un hoquet Stripe ne casse
         pas la réponse au visiteur, le compteur local fait foi) avec
         `identifier=f"{bot_id}:{period}:{new_count}"` où `new_count` est le compteur
         ATOMIQUE renvoyé par l'UPDATE (jamais dérivé d'une lecture non verrouillée :
         identifiant unique et monotone même en concurrence — dédup Stripe 24 h).
         Sans customer (org sans payeur Stripe, jamais souscrit) : on NE rapporte
         PAS, mais l'INCRÉMENT durable (étapes 1-2) a TOUJOURS lieu — le plafond
         reste enforce, jamais de dépassement illimité non plafonné. Renvoie True.

    Increment ATOMIQUE (≠ read-modify-write précédent) : indispensable car le
    pré-check (lecture seule) ne verrouille rien et l'endpoint widget peut servir
    plusieurs réponses de dépassement en parallèle pour un même bot.
    """
    period = quota_period()
    limit = cap if cap is not None else OVERAGE_CAP_DEFAULT

    # 1) Crée la ligne (bot_id, period) si absente, SANS écraser un compteur
    #    existant ni lever d'IntegrityError en course de création concurrente.
    await db.execute(
        pg_insert(BotUsageCounter)
        .values(bot_id=bot_id, period=period, reported_overage=0,
                period_start=_month_start_utc())
        .on_conflict_do_nothing(index_elements=["bot_id", "period"])
    )

    # 2) Incrément atomique borné par le plafond. Le verrou ligne pris par l'UPDATE
    #    sérialise les appels concurrents : `new_count` est exact et le plafond ne
    #    peut pas être franchi (WHERE reported_overage < limit).
    new_count = (await db.execute(
        update(BotUsageCounter)
        .where(BotUsageCounter.bot_id == bot_id,
               BotUsageCounter.period == period,
               BotUsageCounter.reported_overage < limit)
        .values(reported_overage=BotUsageCounter.reported_overage + 1)
        .returning(BotUsageCounter.reported_overage)
    )).scalar_one_or_none()
    if new_count is None:
        # Plafond atteint (course concurrente du dernier crédit) : refus.
        return False

    # Report Stripe best-effort, UNIQUEMENT si un payeur (customer) est résolu : un
    # échec ne doit pas casser la réponse visiteur, et l'absence de customer ne doit
    # pas empêcher le comptage du plafond (déjà fait ci-dessus). Le compteur local
    # (reported_overage) fait foi et permet la réconciliation.
    if customer_id:
        try:
            await stripe_service.report_meter_event(
                event_name=event_name,
                customer_id=customer_id,
                value=1,
                identifier=f"{bot_id}:{period}:{new_count}",
            )
        except stripe_service.StripeError as exc:
            logger.warning(
                "overage: report_meter_event échoué bot %s (%s) — compteur local "
                "fait foi, réconciliation ultérieure", bot_id, exc)
    return True
