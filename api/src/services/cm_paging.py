"""Pagination « keyset » des listes de cm (rapide sur des millions de lignes, sans OFFSET).

Le tri porte sur une expression (vues, date, nom…) puis sur l'id pour départager. Le curseur
opaque (X-Next-Cursor) contient la dernière valeur et le dernier id ; la page suivante reprend
strictement après. Les NULL sont ramenés en fin de liste dans les deux sens par un COALESCE
(les index d'expression de la migration portent sur les mêmes COALESCE).

L'ancien curseur « o:<offset> » reste lu (clients pas encore rechargés après un déploiement).
"""
import base64
import json
from datetime import date, datetime
from typing import Any, Literal, Optional

from fastapi import HTTPException, Response, status
from sqlalchemy import BigInteger, Date, DateTime, Float, Integer, String, func, literal, literal_column, tuple_

Order = Literal["asc", "desc"]
Kind = Literal["int", "float", "dt", "date", "str"]

DT_LOW, DT_HIGH = datetime(1970, 1, 1), datetime(9999, 12, 31)
NUM_LOW, NUM_HIGH = -1, 2**62
TYPES = {"int": BigInteger(), "float": Float(), "dt": DateTime(), "date": Date(), "str": String()}


def bad_cursor():
    return HTTPException(status.HTTP_400_BAD_REQUEST, "Curseur de pagination invalide.")


def nulls_last(expr, kind: Kind, order: Order):
    """Expression de tri : les NULL passent toujours en dernier. Constantes écrites en dur (pas
    de paramètre) pour que PostgreSQL reconnaisse les index d'expression de la migration."""
    asc = order == "asc"
    if kind == "str":
        fill = "chr(1114111)" if asc else "''"
    elif kind == "dt":
        fill = "'9999-12-31'::timestamp" if asc else "'1970-01-01'::timestamp"
    elif kind == "date":
        fill = "'9999-12-31'::date" if asc else "'1970-01-01'::date"
    elif kind == "float":
        fill = "1e18::float8" if asc else "(-1)::float8"
    else:
        fill = "(%d)::bigint" % NUM_HIGH if asc else "(-1)::bigint"
    return func.coalesce(expr, literal_column(fill))


def _dump(v: Any):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _load(kind: Kind, v: Any):
    try:
        if kind == "dt":
            return datetime.fromisoformat(v)
        if kind == "date":
            return date.fromisoformat(v)
        if kind == "int":
            return int(v)
        if kind == "float":
            return float(v)
        return str(v)
    except (TypeError, ValueError):
        raise bad_cursor()


def decode(cursor: Optional[str]) -> Optional[dict]:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
    except (ValueError, UnicodeDecodeError):
        raise bad_cursor()
    if raw.startswith("o:"):
        try:
            off = int(raw[2:])
        except ValueError:
            raise bad_cursor()
        if not 0 <= off <= 100_000:
            raise bad_cursor()
        return {"o": off}
    try:
        c = json.loads(raw)
    except ValueError:
        raise bad_cursor()
    if not isinstance(c, dict) or "i" not in c or "v" not in c:
        raise bad_cursor()
    return c


def encode(value: Any, row_id: int) -> str:
    raw = json.dumps({"v": _dump(value), "i": int(row_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def apply(stmt, key, kind: Kind, id_col, order: Order, cursor: Optional[str], limit: int):
    """Ajoute tri, reprise après le curseur et LIMIT (limit + 1 pour savoir s'il reste une page).
    `key` doit déjà être passé par `nulls_last` et être sélectionné (label) pour `page()`."""
    c = decode(cursor)
    desc = order == "desc"
    if c and "o" in c:
        stmt = stmt.offset(c["o"])
    elif c:
        v = literal(_load(kind, c["v"]), type_=TYPES[kind])
        i = literal(int(c["i"]), type_=Integer())
        stmt = stmt.where(tuple_(key, id_col) < tuple_(v, i) if desc else tuple_(key, id_col) > tuple_(v, i))
    stmt = stmt.order_by(key.desc() if desc else key.asc(), id_col.desc() if desc else id_col.asc())
    return stmt.limit(limit + 1)


def page(response: Optional[Response], rows: list, limit: int, value_of, id_of, cursor: Optional[str] = None) -> list:
    """Coupe à `limit` et pose X-Next-Cursor (keyset ; offset si l'appel venait d'un ancien curseur)."""
    if len(rows) <= limit:
        return rows
    rows = rows[:limit]
    if response is not None:
        c = decode(cursor)
        if c and "o" in c:
            response.headers["X-Next-Cursor"] = base64.urlsafe_b64encode(
                f"o:{c['o'] + limit}".encode()).decode().rstrip("=")
        else:
            last = rows[-1]
            response.headers["X-Next-Cursor"] = encode(value_of(last), id_of(last))
    return rows


def like(q: Optional[str]) -> Optional[str]:
    """Motif ILIKE sûr (les % et _ tapés sont pris au pied de la lettre)."""
    q = (q or "").strip()
    if not q:
        return None
    return "%" + escape_like(q) + "%"


def escape_like(s: str) -> str:
    """Texte pris au pied de la lettre dans un LIKE (avec escape « \\ »)."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
