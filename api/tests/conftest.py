"""Fixtures partagées des tests de facturation modulaire (spec §7.3).

Contraintes d'environnement
---------------------------
La suite tourne SANS base de données réelle (ni Postgres ni SQLite : aucun
driver async n'est garanti dans l'image, cf. requirements.txt). On reproduit
donc le gabarit de `test_tree_sources.py` : `app.dependency_overrides` pour
`get_current_user` / `get_db`, et une **fausse AsyncSession** en mémoire
(`FakeSession`) qui couvre exactement les accès des routeurs/serveurs billing :

- `db.get(Model, pk)`            -> store en mémoire
- `db.execute(select(Entity)…)`  -> filtrage Python générique sur les
                                    BinaryExpression `colonne == valeur`
                                    (et `.in_(...)`) de la clause WHERE
- `db.scalar(select(col)…)`      -> 1re valeur scalaire du résultat
- `db.add / db.flush / db.commit / db.refresh` : no-op de persistance locale

C'est volontairement minimal mais suffisant : les requêtes billing sont des
`select` simples (1 entité, égalités/`in_` sur des colonnes). Aucune jointure.

MOCK_BILLING est vrai par défaut (settings) ; `billing_enabled()` dépend des
clés Stripe — les tests posent/retirent `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
via la fixture `billing_on` / monkeypatch selon le besoin.

`sign_stripe(payload, secret, ts)` : header `Stripe-Signature` HMAC-SHA256
identique à celui que Stripe émet et que `verify_webhook_signature` valide.
"""
import hashlib
import hmac
import json
import time
from typing import Any, Optional

import httpx
import pytest

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user
from src.main import app


# --------------------------------------------------------------------------
# Faux modèles légers (objets simples avec attributs) — pour les helpers qui
# n'ont besoin que des attributs lus, sans passer par l'ORM SQLAlchemy.
# --------------------------------------------------------------------------

class Obj:
    """Sac d'attributs trivial (stand-in d'une ligne ORM dans les helpers)."""

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)

    def __repr__(self) -> str:  # pragma: no cover - debug only
        return f"Obj({self.__dict__!r})"


# --------------------------------------------------------------------------
# Fausse AsyncSession
# --------------------------------------------------------------------------

class _Result:
    """Imite le Result de SQLAlchemy pour les quelques accesseurs utilisés."""

    def __init__(self, rows: list[Any], scalar_mode: bool):
        # scalar_mode = la requête sélectionne une COLONNE (ex. Organization.id)
        # -> scalars() renvoie déjà les valeurs ; sinon ce sont des entités.
        self._rows = rows
        self._scalar_mode = scalar_mode

    # select(Entity) -> .scalars().all() / .scalar_one_or_none()
    class _Scalars:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return list(self._rows)

        def first(self):
            return self._rows[0] if self._rows else None

    def scalars(self):
        return _Result._Scalars(self._rows)

    def scalar_one_or_none(self):
        if not self._rows:
            return None
        if len(self._rows) > 1:
            raise AssertionError("scalar_one_or_none: plusieurs lignes")
        return self._rows[0]

    def scalar_one(self):
        if len(self._rows) != 1:
            raise AssertionError("scalar_one: attendu exactement 1 ligne")
        return self._rows[0]

    def scalar(self):
        return self._rows[0] if self._rows else None

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)


def _model_of(stmt) -> tuple[Any, bool, Optional[str]]:
    """(entité ORM ciblée, scalar_mode, nom_colonne_si_scalaire) d'un select.

    scalar_mode=True quand on sélectionne une colonne (Organization.id) plutôt
    qu'une entité complète (Organization)."""
    desc = stmt.column_descriptions[0]
    entity = desc.get("entity")
    expr = desc.get("expr")
    # Colonne -> expr est un InstrumentedAttribute ; entité -> expr est la classe.
    is_column = expr is not entity and hasattr(expr, "key")
    col_name = getattr(expr, "key", None) if is_column else None
    return entity, is_column, col_name


def _build_predicate(clause):
    """Traduit récursivement une clause WHERE SQLAlchemy en fonction row->bool.

    Gère : AND (BooleanClauseList op and_), OR (op or_), `== / is_`, `.in_(…)`.
    Une clause non reconnue devient « vrai » (neutre) : les tests seedent des
    stores cohérents pour ne jamais dépendre d'un filtre non évalué."""
    if clause is None:
        return lambda r: True

    # BooleanClauseList (AND/OR) : combiner les sous-clauses.
    sub = getattr(clause, "clauses", None)
    op = getattr(getattr(clause, "operator", None), "__name__", "")
    if sub is not None and op in ("and_", "or_"):
        parts = [_build_predicate(c) for c in sub]
        if op == "or_":
            return lambda r, ps=parts: any(p(r) for p in ps)
        return lambda r, ps=parts: all(p(r) for p in ps)

    left = getattr(clause, "left", None)
    right = getattr(clause, "right", None)
    col = getattr(left, "key", None)
    if col is None:
        return lambda r: True

    _missing = object()
    if op in ("eq", "is_"):
        val = getattr(right, "value", _missing)
        if val is _missing:
            # Membre droit non littéral (true_(), colonne…) : ne pas filtrer
            # (neutre) plutôt que d'exclure à tort.
            return lambda r: True
        return lambda r, c=col, v=val: getattr(r, c, None) == v
    if op in ("in_op", "in_"):
        seq = getattr(right, "value", None)
        if seq is None:
            seq = [getattr(e, "value", None)
                   for e in getattr(right, "clauses", [])]
        seq = list(seq or [])
        return lambda r, c=col, s=seq: getattr(r, c, None) in s
    # Opérateur non géré (>=, like…) : neutre.
    return lambda r: True


def _predicates(stmt):
    """Liste à un élément : le prédicat racine de la clause WHERE (ou rien)."""
    where = getattr(stmt, "whereclause", None)
    if where is None:
        return []
    return [_build_predicate(where)]


def _apply_column_defaults(obj) -> None:
    """Renseigne les colonnes ORM None avec leur `default` Python (scalaire ou
    callable). Émule grossièrement l'effet d'un flush/refresh côté DB pour que
    les `response_model` (KbSourceOut, …) ne plantent pas sur des NOT NULL None."""
    table = getattr(type(obj), "__table__", None)
    if table is None:
        return
    for col in table.columns:
        name = col.name
        if getattr(obj, name, None) is not None:
            continue
        default = getattr(col, "default", None)
        if default is None:
            continue
        arg = getattr(default, "arg", None)
        if arg is None:
            continue
        if callable(arg):
            # SQLAlchemy enveloppe un default callable 0-arg (ex. utcnow) en
            # fn(ctx) : on passe d'abord un contexte (None), repli sur l'appel nu.
            try:
                value = arg(None)
            except TypeError:
                try:
                    value = arg()
                except TypeError:
                    continue
        else:
            value = arg
        setattr(obj, name, value)


class FakeSession:
    """AsyncSession minimale en mémoire (voir docstring du module)."""

    def __init__(self):
        # store[Model] = list[instances]
        self.store: dict[Any, list[Any]] = {}
        self.added: list[Any] = []
        self.committed = 0
        self.executed: list[Any] = []
        self._seq: dict[Any, int] = {}

    def _autoid(self, obj) -> None:
        """Émule l'autoincrement de la PK `id` : une ligne ajoutée sans id en
        reçoit un (sinon les `select(Model.id)…` renvoient None, ce qui casse
        p. ex. la garde d'idempotence du webhook qui teste `id is not None`)."""
        if hasattr(obj, "id") and getattr(obj, "id", None) is None:
            nxt = self._seq.get(type(obj), 0) + 1
            self._seq[type(obj)] = nxt
            obj.id = nxt

    # --- API de seed pour les tests -----------------------------------
    def seed(self, *objs: Any) -> None:
        for o in objs:
            self._autoid(o)
            # Applique les defaults Python (is_active=True, server defaults…) :
            # une ligne seedée se comporte comme une ligne déjà flushée en DB.
            _apply_column_defaults(o)
            self.store.setdefault(type(o), []).append(o)

    def rows(self, model) -> list[Any]:
        return self.store.get(model, [])

    # --- API AsyncSession utilisée par le code -------------------------
    async def get(self, model, pk):
        for row in self.store.get(model, []):
            if getattr(row, "id", None) == pk:
                return row
        return None

    async def execute(self, stmt, params=None):
        self.executed.append(stmt)
        # Statements non-SELECT (text() d'advisory lock, etc.) : no-op.
        try:
            desc = stmt.column_descriptions
        except Exception:
            return _Result([], False)
        if not desc:
            return _Result([], False)
        entity, scalar_mode, col = _model_of(stmt)
        rows = list(self.store.get(entity, []))
        for pred in _predicates(stmt):
            rows = [r for r in rows if pred(r)]
        if scalar_mode and col:
            rows = [getattr(r, col, None) for r in rows]
        return _Result(rows, scalar_mode)

    async def scalar(self, stmt):
        res = await self.execute(stmt)
        return res.scalar()

    def add(self, obj):
        self._autoid(obj)
        self.added.append(obj)
        self.store.setdefault(type(obj), []).append(obj)

    async def flush(self):
        # Émule l'assignation des defaults par la DB au flush/insert (created_at,
        # is_active…) pour que les response_model sérialisant un NOT NULL ne voient
        # pas None quand le routeur flush puis renvoie l'objet sans commit/refresh.
        for obj in self.added:
            _apply_column_defaults(obj)
        return None

    async def commit(self):
        self.committed += 1
        # Émule l'application des defaults serveur au flush : les lignes ajoutées
        # voient leurs colonnes NULL recevoir leur `default` Python (sinon un
        # response_model sérialisant un int NOT NULL casse sur None).
        for obj in self.added:
            _apply_column_defaults(obj)

    async def refresh(self, obj, *a, **k):
        _apply_column_defaults(obj)
        return None

    async def delete(self, obj):
        lst = self.store.get(type(obj), [])
        if obj in lst:
            lst.remove(obj)


# --------------------------------------------------------------------------
# Utilisateur courant injectable
# --------------------------------------------------------------------------

class FakeUser:
    """User minimal pour les overrides get_current_user."""

    def __init__(self, id=1, is_superadmin=False, is_active=True,
                 stripe_customer_id=None, billing_grouping="total",
                 billing_email=None, email="u@test.dev", name="Test"):
        self.id = id
        self.is_superadmin = is_superadmin
        self.is_active = is_active
        self.stripe_customer_id = stripe_customer_id
        self.billing_grouping = billing_grouping
        self.billing_email = billing_email
        self.email = email
        self.name = name


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

@pytest.fixture
def db() -> FakeSession:
    return FakeSession()


@pytest.fixture
def current_user() -> FakeUser:
    return FakeUser()


@pytest.fixture
def overrides(db, current_user):
    """Branche get_db -> FakeSession et get_current_user -> FakeUser.

    Le test peut muter `current_user` AVANT la requête (id, is_superadmin…)."""
    async def _get_db():
        yield db

    async def _get_user():
        return current_user

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = _get_user
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def billing_on(monkeypatch):
    """Active billing_enabled() (pose les 2 clés Stripe). MOCK_BILLING reste vrai
    => aucun appel Stripe sortant (URLs locales). À utiliser quand un test veut
    sortir de l'invariant « billing OFF = tout gratuit »."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "rk_test_xxx", raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_test_xxx", raising=False)
    monkeypatch.setattr(settings, "MOCK_BILLING", True, raising=False)
    yield


@pytest.fixture
def billing_off(monkeypatch):
    """Force billing_enabled() == False (invariant D0 : tout gratuit)."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None, raising=False)
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", None, raising=False)
    yield


# --------------------------------------------------------------------------
# Helper signature webhook Stripe (HMAC) — réutilisé par test_billing_webhook
# --------------------------------------------------------------------------

def sign_stripe(payload: bytes, secret: str, ts: Optional[int] = None) -> str:
    """Header `Stripe-Signature` valide pour `verify_webhook_signature`.

    Stripe signe HMAC-SHA256 de "{t}.{corps brut}" avec le webhook secret et
    renvoie "t=<epoch>,v1=<hex>". `ts` permet de forger une signature expirée
    (t hors tolérance) pour tester le rejet anti-rejeu."""
    if ts is None:
        ts = int(time.time())
    signed = f"{ts}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def stripe_event(event_type: str, sub_id: str = "sub_1", *,
                 event_id: str = "evt_1", status_: str = "active",
                 items: Optional[list[dict]] = None,
                 metadata: Optional[dict] = None,
                 customer: Optional[str] = None) -> dict:
    """Fabrique un event Stripe subscription.* minimal (forme data.object)."""
    obj: dict[str, Any] = {
        "id": sub_id,
        "status": status_,
        "metadata": metadata or {},
    }
    if customer:
        obj["customer"] = customer
    if items is not None:
        obj["items"] = {"data": items}
    return {"id": event_id, "type": event_type, "data": {"object": obj}}


def to_bytes(event: dict) -> bytes:
    return json.dumps(event).encode()
