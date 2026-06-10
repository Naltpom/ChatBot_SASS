"""Rate limiting multi-niveaux, en memoire process (1 worker uvicorn, cf.
docker-compose). A migrer vers Redis avant tout passage en multi-worker.

Niveaux :
- par session (JWT)  : RATE_SESSION_MESSAGES / RATE_SESSION_WINDOW_SECONDS
- par IP             : anti-flood large, RATE_IP_REQUESTS / RATE_IP_WINDOW_SECONDS
- par bot (jour)     : cap IA quotidien -> gere dans usage_service (requete SQL)
"""
import time
from collections import defaultdict, deque

from src.core.config import settings


class SlidingWindowLimiter:
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


session_limiter = SlidingWindowLimiter(
    settings.RATE_SESSION_MESSAGES, settings.RATE_SESSION_WINDOW_SECONDS
)
ip_limiter = SlidingWindowLimiter(
    settings.RATE_IP_REQUESTS, settings.RATE_IP_WINDOW_SECONDS
)
# Anti-bruteforce login/register : 10 tentatives / 15 min par IP
auth_limiter = SlidingWindowLimiter(10, 900)
