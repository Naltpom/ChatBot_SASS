"""Tâches de fond fire-and-forget (envoi d'email hors du cycle requête).

`asyncio.create_task` ne garde qu'une weakref sur la tâche : sans référence
forte, le GC peut la collecter avant la fin et ses exceptions seraient avalées
en silence. On retient donc chaque tâche dans un set (auto-retiré à la fin) et
on logge tout échec via `add_done_callback`. Helper PARTAGÉ (routers/auth +
services/action_executor) pour ne pas réimplémenter le pattern.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

_background_tasks: set[asyncio.Task] = set()


def spawn_background(coro, *, error_label: str = "Tâche de fond en échec") -> None:
    """Planifie une coroutine en tâche de fond (non bloquante). Ne lève jamais ;
    logge l'éventuelle exception résiduelle (sinon avalée par asyncio)."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    def _log(t: "asyncio.Task") -> None:
        if not t.cancelled() and t.exception() is not None:
            logger.error("%s : %s", error_label, t.exception())

    task.add_done_callback(_log)
