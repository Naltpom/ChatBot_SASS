"""Contrat d'erreur API unifié (PR-09, audit §3.6).

TOUTE réponse d'erreur de l'API expose désormais un corps `{detail, code, message}` :

- ``detail``  : INCHANGÉ — rétrocompat absolue. ~50 tests lisent
                ``resp.json()["detail"]`` et certains endpoints y mettent un dict
                métier (ex. ``{"error": "module_required", ...}``) : on le préserve
                VERBATIM, qu'il soit chaîne ou objet.
- ``code``    : code machine STABLE dérivé du status HTTP (ex. ``"rate_limited"``,
                ``"unauthorized"``). C'est le pivot consommé par le mapper de
                localisation du front (app/src/utils/errors.ts).
- ``message`` : message AFFICHABLE/localisable. Par défaut = ``detail`` s'il est une
                chaîne, sinon le libellé générique FR du status.

Le format est purement ADDITIF : aucun champ existant n'est retiré ni modifié.

Couvre les deux familles d'erreurs FastAPI : ``HTTPException`` (Starlette, dont les
404 de routes non matchées) et ``RequestValidationError`` (422 de validation, dont
le ``detail`` reste la liste d'erreurs produite par FastAPI).
"""
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Status HTTP -> code machine stable. Au-delà de cette table : ``http_<status>``.
_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    500: "server_error",
    502: "bad_gateway",
    503: "service_unavailable",
}

# Libellés FR génériques (fallback de ``message`` quand ``detail`` n'est pas une
# chaîne affichable, ex. dict métier ou liste de validation).
_STATUS_MESSAGES = {
    400: "Requête invalide.",
    401: "Authentification requise.",
    403: "Accès refusé.",
    404: "Ressource introuvable.",
    405: "Méthode non autorisée.",
    409: "Conflit avec l'état actuel.",
    413: "Contenu trop volumineux.",
    422: "Données invalides.",
    429: "Trop de requêtes. Réessayez dans un instant.",
    500: "Erreur interne du serveur.",
    502: "Service amont indisponible.",
    503: "Service temporairement indisponible.",
}


def code_for_status(status_code: int) -> str:
    """Code machine stable associé à un status HTTP."""
    return _STATUS_CODES.get(status_code, f"http_{status_code}")


def error_payload(status_code: int, detail, message: str | None = None) -> dict:
    """Corps d'erreur unifié ``{detail, code, message}``.

    ``detail`` est préservé tel quel (chaîne OU dict OU liste). ``message`` retombe
    sur ``detail`` s'il est une chaîne, sinon sur le libellé générique du status.
    """
    if message is None:
        message = detail if isinstance(detail, str) else _STATUS_MESSAGES.get(
            status_code, "Une erreur est survenue."
        )
    return {"detail": detail, "code": code_for_status(status_code), "message": message}


async def _http_exception_handler(request: Request, exc: StarletteHTTPException):
    # On conserve les en-têtes portés par l'exception (ex. WWW-Authenticate sur 401).
    headers = getattr(exc, "headers", None)
    return JSONResponse(
        error_payload(exc.status_code, exc.detail),
        status_code=exc.status_code,
        headers=headers,
    )


async def _validation_exception_handler(request: Request, exc: RequestValidationError):
    # `detail` reste la liste d'erreurs FastAPI (forme historique) ; on n'ajoute que
    # code + message générique par-dessus.
    detail = jsonable_encoder(exc.errors())
    return JSONResponse(
        error_payload(422, detail, message=_STATUS_MESSAGES[422]),
        status_code=422,
    )


def install_error_handlers(app: FastAPI) -> None:
    """Branche les handlers normalisant TOUTES les erreurs au contrat unifié.

    Remplace les handlers par défaut de FastAPI/Starlette pour HTTPException et
    RequestValidationError.
    """
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
