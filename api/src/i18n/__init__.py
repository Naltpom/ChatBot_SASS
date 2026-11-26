"""Traduction des textes du serveur pour le site et l'app cm (Chapote CM).

Le français reste la langue source : chaque message est écrit en français dans le code, tel quel.
Quand le client demande l'anglais (en-tête ``X-Chapote-Lang: en``, envoyé par cm.chapote.fr et l'app),
un middleware réécrit les réponses JSON : toute chaîne qui correspond EXACTEMENT à un message connu
(dictionnaires ``en_*.py`` de ce dossier) est remplacée par sa traduction. Les messages avec des valeurs
(« Vidéo trop longue : {} s… ») sont des modèles : ``{}`` (ou ``{0}``, ``{1}`` si l'ordre change en
anglais) prend n'importe quel texte, recopié dans la traduction.

Rien ne change sans l'en-tête : les autres clients (chapote.fr, routines) reçoivent le français.
"""
from __future__ import annotations

import importlib
import json
import pkgutil
import re
from contextvars import ContextVar
from typing import Any, Optional

LANG: ContextVar[str] = ContextVar("chapote_lang", default="fr")

_PH = re.compile(r"\{(\d*)\}")


def _load() -> dict[str, str]:
    out: dict[str, str] = {}
    for m in pkgutil.iter_modules(__path__):
        if m.name.startswith("en_"):
            out.update(getattr(importlib.import_module(f"{__name__}.{m.name}"), "EN", {}))
    return out


EN: dict[str, str] = _load()
_EXACT: dict[str, str] = {k: v for k, v in EN.items() if not _PH.search(k)}
# Modèles : (regex compilée, traduction avec {0}, {1}…) rangés par le début littéral du français.
_PATTERNS: list[tuple[str, re.Pattern, str]] = []


def _compile() -> None:
    for fr, en in EN.items():
        if not _PH.search(fr):
            continue
        parts, pos = [], 0
        for m in _PH.finditer(fr):
            parts.append(re.escape(fr[pos:m.start()]))
            parts.append("(.+?)")
            pos = m.end()
        parts.append(re.escape(fr[pos:]))
        literal = _PH.sub("", fr).strip()
        if len(literal) < 8:            # un modèle court traduirait n'importe quoi
            continue
        prefix = fr[:_PH.search(fr).start()]
        # Traduction : {} successifs = valeurs dans l'ordre du français ; {i} = la i-ème valeur.
        counter = iter(range(100))
        en_t = _PH.sub(lambda m: "{" + (m.group(1) or str(next(counter))) + "}", en)
        _PATTERNS.append((prefix, re.compile("^" + "".join(parts) + "$", re.S), en_t))


_compile()


def tr(text: str, lang: Optional[str] = None) -> str:
    """Le texte dans la langue demandée (français inchangé ; inconnu : inchangé)."""
    if (lang or LANG.get()) != "en" or not text or len(text) > 2000:
        return text
    hit = _EXACT.get(text)
    if hit is not None:
        return hit
    for prefix, rx, en in _PATTERNS:
        if prefix and not text.startswith(prefix):
            continue
        m = rx.match(text)
        if m:
            vals = [tr(v, lang) for v in m.groups()]
            return re.sub(r"\{(\d+)\}", lambda x: vals[int(x.group(1))] if int(x.group(1)) < len(vals) else x.group(0), en)
    return text


def trf(template: str, lang: Optional[str], *values: Any) -> str:
    """Modèle français (« Rejoindre « {} » ») traduit puis rempli avec `values` : les valeurs (noms, e-mails, messages
    écrits par les gens) sont recopiées telles quelles, jamais traduites. `lang` vaut « en » pour l'anglais, sinon français
    (pas de repli sur la langue de la requête : à passer explicitement)."""
    text = EN.get(template, template) if lang == "en" else template
    return text.format(*values)


def tr_json(value: Any, lang: Optional[str] = None) -> Any:
    """Toutes les chaînes d'une réponse JSON, traduites (clés inchangées)."""
    if isinstance(value, str):
        return tr(value, lang)
    if isinstance(value, list):
        return [tr_json(v, lang) for v in value]
    if isinstance(value, dict):
        return {k: tr_json(v, lang) for k, v in value.items()}
    return value


def lang_of(headers) -> str:
    """Langue demandée par le client cm : en-tête X-Chapote-Lang (« en » ou « fr »), sinon français."""
    v = (headers.get("x-chapote-lang") or "").strip().lower()
    return "en" if v.startswith("en") else "fr"


def browser_lang(request) -> str:
    """Langue d'une page HTML ouverte dans un navigateur : ``?lang=en|fr`` s'il est donné, sinon la première langue
    de l'en-tête Accept-Language (anglais si ce n'est pas le français ; sans en-tête : français)."""
    q = (request.query_params.get("lang") or "").strip().lower()
    if q[:2] in ("en", "fr"):
        return q[:2]
    first = (request.headers.get("accept-language") or "").split(",")[0].split(";")[0].strip().lower()
    return "en" if first and first != "*" and not first.startswith("fr") else "fr"


async def translate_response(request, call_next):
    """Middleware : langue de la requête (pour tr()), et réponses JSON traduites en anglais si demandé."""
    lang = lang_of(request.headers)
    token = LANG.set(lang)
    try:
        response = await call_next(request)
    finally:
        LANG.reset(token)
    if lang != "en" or "application/json" not in (response.headers.get("content-type") or ""):
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    try:
        data = json.loads(body or b"null")
    except ValueError:
        from starlette.responses import Response
        return Response(content=body, status_code=response.status_code, headers=dict(response.headers), media_type=response.media_type)
    from starlette.responses import JSONResponse
    headers = {k: v for k, v in response.headers.items() if k.lower() not in ("content-length", "content-type")}
    return JSONResponse(tr_json(data, lang), status_code=response.status_code, headers=headers)
