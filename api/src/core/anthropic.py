"""Transport partagé pour l'API Messages d'Anthropic (REST, via httpx).

Centralise l'appel HTTP dupliqué dans :
  - api/src/services/ai_service.py    (boucle tool-use Anthropic, ~227-327)
  - api/src/services/tree_generator.py (génération d'arbre single-shot, ~99-106)
  - api/src/services/insights_service.py (analyse single-shot, ~100-107)

Ce module ne fait QUE le transport : URL, headers (`anthropic-version`,
`x-api-key`, `content-type`), POST du payload et parsing JSON. Il NE contient
aucune logique métier — la boucle tool-use, le choix du modèle, la construction
du system prompt et la validation de sortie restent chez les appelants.

`call_messages` est un SUPERSET couvrant les deux usages :
  (a) single-shot texte : l'appelant lit `result.text` (concaténation des
      blocs texte, comme `"".join(b.get("text", "") for b in content)`) ;
  (b) boucle tool-use : l'appelant lit `result.content` (blocs bruts, dont les
      `tool_use`), `result.stop_reason` et `result.usage` (tokens).

Gestion d'erreur/timeout reproduite à l'identique de l'existant : `httpx` lève
`HTTPStatusError` (via `raise_for_status`) ou `HTTPError` ; ces exceptions
remontent TELLES QUELLES à l'appelant, qui les traduit déjà en messages métier
(`AIServiceError`, `TreeGenerationError`, `InsightsError`). On NE convertit donc
pas les exceptions ici, pour rester 100 % rétro-compatible.
"""
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# Timeouts historiques : la boucle tool-use du widget tourne sur 60s, les
# outils config-time du dashboard (arbre/insights) sur 120s. Le défaut couvre
# le cas single-shot ; ai_service passera 60 explicitement.
DEFAULT_TIMEOUT = 120.0


@dataclass
class AnthropicResult:
    """Réponse parsée de l'API Messages, superset des besoins appelants.

    - `content`    : blocs bruts (`data["content"]`), inclut texte ET tool_use.
                     Requis par la boucle tool-use d'ai_service.
    - `text`       : concaténation des blocs texte ("".join sur `b["text"]`),
                     identique au parsing single-shot de tree/insights.
    - `stop_reason`: `data["stop_reason"]` (ex. "tool_use", "end_turn").
    - `tokens_in` / `tokens_out` : `data["usage"]["input_tokens"]` /
                     `["output_tokens"]` (0 si absents).
    - `raw`        : payload JSON complet, au cas où un appelant ait besoin
                     d'un champ non exposé ci-dessus.
    """
    content: list[dict] = field(default_factory=list)
    stop_reason: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    raw: dict = field(default_factory=dict)

    @property
    def text(self) -> str:
        """Texte concaténé des blocs `type=text` — équivalent strict de
        `"".join(b.get("text", "") for b in data.get("content", []))`."""
        return "".join(b.get("text", "") for b in self.content)


async def call_messages(
    *,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    max_tokens: int,
    tools: Optional[list[dict]] = None,
    temperature: Optional[float] = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> AnthropicResult:
    """Un appel POST /v1/messages, parsé en `AnthropicResult`.

    Le payload reproduit EXACTEMENT la forme des appelants : `model`,
    `max_tokens`, `system`, `messages` toujours présents ; `temperature` et
    `tools` ajoutés UNIQUEMENT s'ils sont fournis (les omettre laisse Anthropic
    appliquer ses défauts, comportement actuel de tree/insights qui ne passent
    ni l'un ni l'autre).

    `client` : passer un `httpx.AsyncClient` déjà ouvert pour réutiliser la
    connexion sur plusieurs tours (boucle tool-use d'ai_service). Si omis, un
    client éphémère est créé pour la durée de l'appel (cas single-shot).

    Lève `httpx.HTTPStatusError` (statut >= 400) ou `httpx.HTTPError` (réseau),
    comme le code existant — l'appelant les traduit en erreur métier.
    """
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if tools:
        payload["tools"] = tools

    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    if client is not None:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    else:
        async with httpx.AsyncClient(timeout=timeout) as ephemeral:
            resp = await ephemeral.post(ANTHROPIC_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

    usage = data.get("usage", {})
    return AnthropicResult(
        content=data.get("content", []),
        stop_reason=data.get("stop_reason"),
        tokens_in=usage.get("input_tokens", 0),
        tokens_out=usage.get("output_tokens", 0),
        raw=data,
    )
