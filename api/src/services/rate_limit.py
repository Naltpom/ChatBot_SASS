"""Rate limiting multi-niveaux, fenetre glissante.

Backend Redis (ZSET, partage entre workers) si REDIS_URL est definie, sinon
repli sur l'implementation memoire process -> 1 seul worker uvicorn
obligatoire dans ce cas (cf. docker-compose).

Fail-open : paquet `redis` absent de l'image, REDIS_URL non definie ou panne
Redis a l'execution => bascule silencieuse sur le limiteur memoire (un seul
warning logge). Une indisponibilite de Redis ne bloque JAMAIS le produit et
ne remonte aucune exception vers les routers.

Niveaux :
- par session (JWT)  : RATE_SESSION_MESSAGES / RATE_SESSION_WINDOW_SECONDS
- par IP             : anti-flood large, RATE_IP_REQUESTS / RATE_IP_WINDOW_SECONDS
- login/register     : anti-bruteforce, 10 tentatives / 15 min par IP
- outils IA (jour)   : treegen/insights, plafond quotidien par organisation
                       (anti-abus coût provider, pas un gating de plan)
"""
import logging
import time
import uuid
from collections import defaultdict, deque

from src.core.config import settings

logger = logging.getLogger("rate_limit")

# Paquet optionnel : l'image api peut ne pas l'embarquer (repli memoire).
try:
    import redis.asyncio as aioredis
except ImportError:  # pragma: no cover
    aioredis = None

# Connexion paresseuse, PARTAGEE par tous les limiteurs du process
_redis = None
_warned = False
# Apres une panne, on ne re-tente pas Redis a chaque requete (les timeouts
# de connexion ralentiraient tout le trafic) : cooldown avant nouvel essai.
_retry_at = 0.0
_RETRY_COOLDOWN_SECONDS = 30.0


def _warn_once(reason: str) -> None:
    global _warned
    if not _warned:
        _warned = True
        logger.warning(
            "Rate-limit : %s -> repli sur les limiteurs memoire (fail-open ; "
            "1 seul worker requis tant que Redis est indisponible)", reason
        )


def _get_redis():
    """Client redis.asyncio partage, cree paresseusement. None => mode memoire."""
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


class _MemoryWindow:
    """Fenetre glissante en memoire process (implementation historique)."""

    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window = window_seconds
        self._events: dict[str, deque] = defaultdict(deque)
        self._last_purge = time.monotonic()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        self._maybe_purge(now)
        q = self._events[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(now)
        return True

    def _maybe_purge(self, now: float) -> None:
        # Evite la fuite memoire : on jette les cles inactives toutes les ~10 fenetres
        if now - self._last_purge < self.window * 10:
            return
        self._last_purge = now
        stale = [k for k, q in self._events.items() if not q or q[-1] <= now - self.window]
        for k in stale:
            del self._events[k]


class RateLimiter:
    """`max_events` evenements max par `window_seconds` glissantes.

    Redis si disponible (ZSET partage entre workers, prefixe de cle propre
    par limiteur), sinon memoire locale. check() ne leve jamais : toute
    erreur Redis => verdict du limiteur memoire (fail-open).
    """

    def __init__(self, prefix: str, max_events: int, window_seconds: int):
        self.prefix = prefix
        self.max_events = max_events
        self.window = window_seconds
        self._memory = _MemoryWindow(max_events, window_seconds)

    async def check(self, key: str) -> bool:
        """True si l'evenement est autorise (et le comptabilise)."""
        client = _get_redis()
        if client is None:
            return self._memory.allow(key)
        try:
            return await self._check_redis(client, key)
        except Exception as exc:
            _redis_failed(exc)
            return self._memory.allow(key)

    async def _check_redis(self, client, key: str) -> bool:
        rkey = f"{self.prefix}{key}"
        now = time.time()
        # Membre unique meme pour deux requetes dans la meme microseconde
        member = f"{now:.6f}:{uuid.uuid4().hex[:8]}"
        async with client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(rkey, 0, now - self.window)
            pipe.zcard(rkey)
            pipe.zadd(rkey, {member: now})
            pipe.expire(rkey, self.window)
            _, count, _, _ = await pipe.execute()
        if count >= self.max_events:
            # Limite atteinte : on retire l'evenement qu'on vient d'ajouter
            # (un refus ne consomme pas de credit, comme le mode memoire)
            await client.zrem(rkey, member)
            return False
        return True


session_limiter = RateLimiter(
    "rl:session:", settings.RATE_SESSION_MESSAGES, settings.RATE_SESSION_WINDOW_SECONDS
)
ip_limiter = RateLimiter(
    "rl:ip:", settings.RATE_IP_REQUESTS, settings.RATE_IP_WINDOW_SECONDS
)
# Anti-bruteforce login/register : 10 tentatives / 15 min par IP
auth_limiter = RateLimiter("rl:auth:", 10, 900)
# Generation d'arbre par IA (cout provider cote SaaS) : 10 / 24 h / organisation
treegen_limiter = RateLimiter("rl:treegen:", 10, 86400)
# Demandes de contact (leads) du widget : 5 / heure / session
lead_limiter = RateLimiter("rl:lead:", 5, 3600)
# Demandes de conseiller (handoff live chat) : 3 / heure / session
handoff_limiter = RateLimiter("rl:handoff:", 3, 3600)
# Polling live chat (cadence widget 2,5 s = 24/min) : limiteur dedie genereux
poll_limiter = RateLimiter("rl:poll:", 60, 60)
# Budget IP DEDIE au poll (jamais ip_limiter partage 100/min : 4 visiteurs en
# attente derriere un NAT l'epuiseraient et couperaient TOUT le widget de
# l'IP). 600/min = ~25 visiteurs simultanes par IP a 24 req/min chacun ;
# l'endpoint reste protege par le JWT de session + poll_limiter.
poll_ip_limiter = RateLimiter("rl:ippoll:", 600, 60)
# Messages visiteur en mode conseiller (plus fluide que le mode IA)
human_msg_limiter = RateLimiter("rl:humanmsg:", 60, 600)
# Retours CSAT du widget : 30 / heure / session
feedback_limiter = RateLimiter("rl:feedback:", 30, 3600)
# Analyses insights (cout IA cote SaaS) : 3 / 24 h / organisation, verifie
# AVANT tout appel
insights_limiter = RateLimiter("rl:insights:", 3, 86400)
# --- Demo publique « 1 URL -> chatbot » (page /demo, sans auth) ---
# Deux garde-fous anti-cout, fenetre glissante 24 h, verifies AVANT tout appel IA
# (uniquement sur cache MISS) :
#  - PAR IP : anti-abus individuel, cle = IP du visiteur.
#  - GLOBAL : coupe-circuit de depense Gemini, cle CONSTANTE ("demo") partagee.
# Tous deux fail-open (repli memoire) comme les autres limiteurs : une panne
# Redis ne bloque pas la demo ; en multi-worker prod, Redis rend le global exact.
# Le faible plafond (quelques centaines/jour) garde le ZSET global tout petit.
demo_ip_limiter = RateLimiter("rl:demoip:", settings.DEMO_IP_PER_DAY, 86400)
demo_global_limiter = RateLimiter("rl:demoglobal:", settings.DEMO_GLOBAL_PER_DAY, 86400)
# Chat IA de la demo (V2) : quotas PAR MESSAGE (chaque message = 1 appel Gemini),
# budgets SEPARES de la generation d'arbre (prefixes distincts). Le captcha
# one-shot de la generation fait office d'ouverture de session -> pas de captcha
# par message ; ces deux limiteurs + le pre-requis « arbre deja genere » bornent
# l'abus. Memes semantiques fenetre glissante 24 h + fail-open.
demo_chat_ip_limiter = RateLimiter("rl:demochatip:", settings.DEMO_CHAT_IP_PER_DAY, 86400)
demo_chat_global_limiter = RateLimiter("rl:demochatglobal:", settings.DEMO_CHAT_GLOBAL_PER_DAY, 86400)
