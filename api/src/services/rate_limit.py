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
from src.core.security import TWOFA_CHALLENGE_EXPIRE_MINUTES

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
    """Fenetre glissante en memoire process."""

    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window = window_seconds
        self._events: dict[str, deque] = defaultdict(deque)
        self._last_purge = time.monotonic()

    def _live(self, key: str, now: float) -> deque:
        """Purge la fenetre de `key` (events expires) et renvoie la deque vivante."""
        q = self._events[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        return q

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        self._maybe_purge(now)
        q = self._live(key, now)
        if len(q) >= self.max_events:
            return False
        q.append(now)
        return True

    def reset(self, key: str) -> None:
        """Oublie tous les evenements de `key` (ex. reset apres un succes)."""
        self._events.pop(key, None)

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

    async def reset(self, key: str) -> None:
        """Oublie tous les evenements de `key` (ex. apres un succes 2FA)."""
        client = _get_redis()
        if client is None:
            self._memory.reset(key)
            return
        try:
            await client.delete(f"{self.prefix}{key}")
        except Exception as exc:
            _redis_failed(exc)
            self._memory.reset(key)


class _MemoryNonces:
    """Jetons consommés (anti-rejeu) avec expiration, en mémoire process.

    Repli quand Redis est indisponible : mêmes garanties que `_MemoryWindow`
    (exact en mono-worker, suffisant en dev/CI). Purge paresseuse pour borner
    la mémoire."""

    def __init__(self, ttl_seconds: int):
        self.ttl = ttl_seconds
        self._seen: dict[str, float] = {}
        self._last_purge = time.monotonic()

    def is_used(self, key: str) -> bool:
        now = time.monotonic()
        self._maybe_purge(now)
        exp = self._seen.get(key)
        return exp is not None and exp > now

    def claim(self, key: str) -> bool:
        """Réserve `key` de façon ATOMIQUE : True si on l'a réservée (1er appel),
        False si déjà réservée et non expirée. Pas d'`await` -> atomique sous
        asyncio (aucune préemption entre le test et l'écriture)."""
        now = time.monotonic()
        self._maybe_purge(now)
        exp = self._seen.get(key)
        if exp is not None and exp > now:
            return False
        self._seen[key] = now + self.ttl
        return True

    def _maybe_purge(self, now: float) -> None:
        if now - self._last_purge < self.ttl:
            return
        self._last_purge = now
        for k in [k for k, e in self._seen.items() if e <= now]:
            del self._seen[k]


class _MemoryCounter:
    """Compteurs entiers à TTL, en mémoire process (repli quand Redis est absent).

    `incr()` augmente le compteur de `key` et renvoie la NOUVELLE valeur ; un TTL
    écoulé repart de zéro. Pas d'`await` -> atomique sous asyncio (aucune
    préemption entre lecture et écriture). Purge paresseuse pour borner la mémoire."""

    def __init__(self):
        self._counts: dict[str, tuple[int, float]] = {}  # key -> (compteur, expiration)
        self._last_purge = time.monotonic()

    def incr(self, key: str, ttl: int) -> int:
        now = time.monotonic()
        self._maybe_purge(now, ttl)
        count, exp = self._counts.get(key, (0, 0.0))
        if exp <= now:          # fenêtre expirée -> on repart de zéro
            count = 0
        count += 1
        self._counts[key] = (count, now + ttl)
        return count

    def reset(self, key: str) -> None:
        self._counts.pop(key, None)

    def _maybe_purge(self, now: float, ttl: int) -> None:
        if now - self._last_purge < ttl:
            return
        self._last_purge = now
        for k in [k for k, (_, e) in self._counts.items() if e <= now]:
            del self._counts[k]


class SingleUseTokens:
    """Marque des jetons « à usage unique » (clé = identifiant du jeton, ex. `jti`)
    consommés pour une durée bornée (TTL = durée de vie du jeton) -> anti-rejeu.

    Redis (partagé entre workers) si disponible, sinon mémoire process. Comme
    `RateLimiter`, ne lève JAMAIS : toute erreur Redis bascule sur le repli
    mémoire (fail-open).

    - `is_used()` : lecture seule (pré-rejet d'un rejeu AVANT toute mutation —
      ex. ne pas brûler un code de secours sur un challenge déjà consommé).
    - `claim()` : consommation ATOMIQUE (Redis `SET NX EX`) renvoyant True si on
      a bien réservé le jeton, False s'il l'était déjà -> ferme la course TOCTOU
      (deux requêtes concurrentes : une seule peut « gagner » le claim)."""

    def __init__(self, prefix: str, ttl_seconds: int):
        self.prefix = prefix
        self.ttl = ttl_seconds
        self._memory = _MemoryNonces(ttl_seconds)

    async def is_used(self, key: str) -> bool:
        client = _get_redis()
        if client is None:
            return self._memory.is_used(key)
        try:
            return bool(await client.exists(f"{self.prefix}{key}"))
        except Exception as exc:
            _redis_failed(exc)
            return self._memory.is_used(key)

    async def claim(self, key: str) -> bool:
        """Réserve `key` atomiquement (SET NX). True = réservé par CET appel,
        False = déjà consommé. Fail-open : sur panne Redis, repli mémoire."""
        client = _get_redis()
        if client is None:
            return self._memory.claim(key)
        try:
            # nx=True -> SET seulement si absent ; renvoie True si posé, None sinon.
            return bool(await client.set(f"{self.prefix}{key}", "1", ex=self.ttl, nx=True))
        except Exception as exc:
            _redis_failed(exc)
            return self._memory.claim(key)


class FailureCounter:
    """Compteur d'échecs ATOMIQUE à TTL (clé = identifiant, ex. le `jti` d'un
    challenge 2FA). Chaque `incr()` augmente le compteur d'une unité et renvoie la
    NOUVELLE valeur ; le TTL borne la durée de vie de la clé.

    Redis (`INCR` + `EXPIRE` posés ensemble dans UN pipeline atomique, partagé
    entre workers) si disponible, sinon mémoire process. Comme `RateLimiter` /
    `SingleUseTokens`, ne lève JAMAIS : toute erreur Redis bascule sur le repli
    mémoire (fail-open).

    Sert à plafonner les échecs de vérification sur la durée d'un challenge,
    INDÉPENDAMMENT de l'IP (ferme la rotation d'IP) : l'appelant invalide le
    challenge quand `incr()` atteint le plafond. À distinguer de `RateLimiter`
    (fenêtre glissante, refus = rollback) : ici le comptage est MONOTONE jusqu'au
    plafond, sans rollback."""

    def __init__(self, prefix: str, ttl_seconds: int):
        self.prefix = prefix
        self.ttl = ttl_seconds
        self._memory = _MemoryCounter()

    async def incr(self, key: str) -> int:
        """Incrémente le compteur de `key` et renvoie la nouvelle valeur. Pose
        (ou rafraîchit) le TTL à chaque appel pour garantir l'expiration de la clé."""
        client = _get_redis()
        if client is None:
            return self._memory.incr(key, self.ttl)
        try:
            rkey = f"{self.prefix}{key}"
            async with client.pipeline(transaction=True) as pipe:
                pipe.incr(rkey)
                pipe.expire(rkey, self.ttl)
                count, _ = await pipe.execute()
            return int(count)
        except Exception as exc:
            _redis_failed(exc)
            return self._memory.incr(key, self.ttl)

    async def reset(self, key: str) -> None:
        client = _get_redis()
        if client is None:
            self._memory.reset(key)
            return
        try:
            await client.delete(f"{self.prefix}{key}")
        except Exception as exc:
            _redis_failed(exc)
            self._memory.reset(key)


session_limiter = RateLimiter(
    "rl:session:", settings.RATE_SESSION_MESSAGES, settings.RATE_SESSION_WINDOW_SECONDS
)
ip_limiter = RateLimiter(
    "rl:ip:", settings.RATE_IP_REQUESTS, settings.RATE_IP_WINDOW_SECONDS
)
# Anti-bruteforce login/register : 10 tentatives / 15 min par IP
auth_limiter = RateLimiter("rl:auth:", 10, 900)
# Boutique de partitions : devis avec code promo et commandes, par IP (anti-devinette des codes promo)
music_limiter = RateLimiter("rl:music:", 30, 600)
# Vérification du 2nd facteur 2FA (TOTP/recovery/passkey) : anti-bruteforce du
# code à 6 chiffres. Deux protections COMPLÉMENTAIRES (cf. routers/twofa) :
#  1) THROTTLE PAR-IP ATOMIQUE (clé {user_id}:{ip}) : incrément-et-test en UN seul
#     pipeline (check()) AVANT la vérif crypto -> borne un burst concurrent à
#     ~5 tentatives / 15 min depuis une source. Un succès RÉINITIALISE la clé
#     (reset) : un usage normal répété ne lockoute jamais le légitime. 429 au-delà.
twofa_verify_limiter = RateLimiter("rl:2faverify:", 5, 900)
#  2) CAP PAR-CHALLENGE ATOMIQUE (clé = `jti`, INDÉPENDANT de l'IP) : compteur de
#     CRÉDITS atomique (INCR + EX = TTL du challenge), décompté AVANT la vérif crypto
#     dans _enforce_2fa_verify -> chaque tentative consomme 1 crédit. Au-delà de
#     MAX_2FA_CHALLENGE_FAILURES (toutes IP confondues), le challenge est invalidé via
#     le store single-use ci-dessous -> ferme la ROTATION d'IP, et la borne TIENT SOUS
#     CONCURRENCE (INCR atomique amont). PAS de verrou persistant par compte : pour
#     réessayer il faut re-login (borné par le limiteur de login).
twofa_challenge_failures = FailureCounter("rl:2fafail:", TWOFA_CHALLENGE_EXPIRE_MINUTES * 60)
# Challenge 2FA à usage unique (anti-rejeu) : un challenge validé avec succès — ou
# invalidé par le cap d'échecs ci-dessus — est consommé (clé = `jti` du challenge)
# pour le reste de sa durée de vie. TTL dérivé de la durée réelle du challenge
# (core.security) : suit automatiquement le réglage.
twofa_challenge_store = SingleUseTokens("rl:2fachallenge:", TWOFA_CHALLENGE_EXPIRE_MINUTES * 60)
# Reset de mot de passe PAR DESTINATAIRE (cle = email, pas IP) : empeche le
# bombardement d'une victime via plusieurs IP. 3 liens / heure / adresse.
password_reset_email_limiter = RateLimiter("rl:pwdresetmail:", 3, 3600)
# Generation d'arbre par IA (cout provider cote SaaS) : 10 / 24 h en PROD ; plafond
# LARGE en dev/CI pour ne pas bloquer l'iteration de test (le limiteur reste ACTIF ->
# le test qui monkeypatche `check` passe toujours ; seule la valeur du plafond change).
treegen_limiter = RateLimiter("rl:treegen:", 10 if settings.is_production else 1000, 86400)
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
# --- OAuth « plugin » (Authorization Code + PKCE, surface externe) ---
# Émission de codes d'autorisation (par IP, dashboard authentifié) : anti-abus.
oauth_authorize_limiter = RateLimiter("rl:oauthauthz:", 20, 60)
# Échange /token (par IP) : couvre authorization_code + refresh_token.
oauth_token_limiter = RateLimiter("rl:oauthtoken:", 30, 60)
# Rotation refresh (par IP) : 30 / jour.
oauth_refresh_limiter = RateLimiter("rl:oauthrefresh:", 30, 86400)
# Notification « plafond IA atteint » au proprietaire : 1 mail / ~31 j / bot
# (cle = bot.id). Evite de spammer le payeur a chaque requete une fois le
# plafond touche — un seul rappel par cycle de facturation.
overage_cap_email_limiter = RateLimiter("rl:overagecapmail:", 1, 2678400)
