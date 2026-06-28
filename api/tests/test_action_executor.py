"""PR-13 — Exécution des actions IA (services/action_executor.py).

Ces handlers EXÉCUTENT des outils déclenchés par le modèle : ils signent des
webhooks (HMAC-SHA256), déchiffrent des secrets clients, parlent à des hôtes
externes (Cal.com) et persistent des leads. Aucun test ne les couvrait. On pose
la couverture sur les axes du plan PR-13 :

1. Dispatch par type  : execute_action route capture_lead / webhook / handoff /
                        create_ticket / calendar_slots vers le bon handler et
                        renvoie la forme attendue ; un type inconnu -> ActionError
                        (jamais de crash) ; args trop volumineux -> ActionError.
2. Webhook signé      : la requête _webhook porte X-Chapote-Signature =
                        sha256=HMAC(secret, corps canonique) — on RECALCULE la
                        signature à partir du corps RÉELLEMENT envoyé. Le pinning
                        anti-SSRF est exercé pour de vrai (URL -> safe_fetch :
                        https imposé, IP privée rejetée, Host/SNI = hostname
                        d'origine, connexion sur l'IP épinglée).
3. Secrets            : un secret chiffré (crypto.encrypt) est déchiffré et
                        utilisé pour signer ; un secret INDÉCHIFFRABLE
                        (InvalidToken -> None) refuse l'envoi (jamais d'envoi
                        non signé en silence), sans crash ni fuite.
4. Erreurs / timeouts : timeout réseau (httpx.HTTPError), statut d'erreur (5xx),
                        redirection 3xx -> ActionError exploitable, jamais
                        d'exception non gérée. Idem côté Cal.com (injoignable /
                        401 / non-200).
5. _compact_slots     : fonction PURE — seuil de 40 créneaux (cap), conversion
                        de timezone, repli sur liste vide.

La couche HTTP sortante est mockée en monkeypatchant `action_executor.httpx`
(capture des arguments pour asserter signature + headers + corps + URL pinnée) :
aucun réseau réel. La résolution anti-SSRF (`resolve_public_ip`) est exercée
POUR DE VRAI via des IP littérales (résolues localement par getaddrinfo, sans
DNS) ; un seul test l'override pour pouvoir asserter le pinning d'un HOSTNAME.

DB réelle (PR-10, pg_session) : `capture_lead` PERSISTE un Lead — c'est de la
vraie persistance (commit + relecture), couverte sur Postgres jetable. Le reste
(signature, secrets, parsing) est algorithmique -> unitaire sans DB.
"""
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from src.services import action_executor as ax
from src.services.action_executor import ActionError, _compact_slots, execute_action
from src.services.crypto import encrypt_secret


# --------------------------------------------------------------------------
# Helpers : faux client httpx (capture des appels sortants, aucun réseau)
# --------------------------------------------------------------------------

_UNSET = object()


def _bot(**kw):
    base = {"id": 1, "name": "Bot test"}
    base.update(kw)
    return SimpleNamespace(**base)


class _FakeResp:
    def __init__(self, status_code=200, *, json_data=_UNSET, text="", headers=None):
        self.status_code = status_code
        self._json = json_data
        self.text = text
        self.headers = headers or {}

    def json(self):
        if self._json is _UNSET:
            raise ValueError("réponse non JSON")
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            req = httpx.Request("POST", "https://captured.invalid/")
            raise httpx.HTTPStatusError(
                "erreur", request=req,
                response=httpx.Response(self.status_code, request=req),
            )


def _fake_client(captures, *, response=None, raise_exc=None):
    """Fabrique une classe httpx.AsyncClient bidon : chaque .post()/.get() pousse
    (méthode, url, kwargs) dans `captures` puis rend `response` (ou lève `raise_exc`)."""

    class _Client:
        def __init__(self, *a, **k):
            self.init_kwargs = k

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            captures.append(("post", url, kw))
            if raise_exc is not None:
                raise raise_exc
            return response

        async def get(self, url, **kw):
            captures.append(("get", url, kw))
            if raise_exc is not None:
                raise raise_exc
            return response

    return _Client


# ==========================================================================
# Axe 1 — Dispatch par type d'action
# ==========================================================================

@pytest.mark.asyncio
async def test_dispatch_unknown_type_raises_actionerror():
    """Un type d'action inconnu -> ActionError propre (pas de crash, pas de KeyError)."""
    with pytest.raises(ActionError) as exc:
        await execute_action({"type": "telepathy"}, {}, _bot())
    assert "inconnu" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_dispatch_oversized_args_rejected():
    """Garde d'entrée : des args sérialisés > 4000 chars -> ActionError avant tout handler."""
    big = {"x": "a" * 5000}
    with pytest.raises(ActionError):
        await execute_action({"type": "webhook"}, big, _bot())


@pytest.mark.asyncio
@pytest.mark.parametrize("atype", ["capture_lead", "handoff", "create_ticket"])
async def test_dispatch_db_dependent_handlers_without_db(atype):
    """capture_lead / handoff / create_ticket sont ROUTÉS vers leur handler, qui
    refuse proprement (ActionError) quand la session db manque — preuve que le
    dispatch atteint le bon handler sans planter (pas de None.attr)."""
    action = {"type": atype, "subject": "x", "summary": "y"}
    with pytest.raises(ActionError):
        await execute_action(action, {"email": "a@b.co"}, _bot(), db=None,
                             conversation_id=None)


@pytest.mark.asyncio
async def test_dispatch_calendar_without_key_routes_and_errors():
    """calendar_slots routé : sans clé API configurée -> ActionError dédiée."""
    with pytest.raises(ActionError) as exc:
        await execute_action({"type": "calendar_slots"}, {}, _bot())
    assert "Cal.com" in str(exc.value)


# ==========================================================================
# Axe 2 — Webhook signé + pinning anti-SSRF
# ==========================================================================

@pytest.mark.asyncio
async def test_webhook_signature_matches_hmac_of_sent_body(monkeypatch):
    """La requête _webhook porte X-Chapote-Signature = sha256=HMAC(secret, corps).
    On recalcule la signature attendue à partir du corps RÉELLEMENT envoyé (le
    payload embarque ts=now, donc non reproductible à l'avance : on signe le corps
    capturé). Le corps doit aussi être canonique (clés triées, séparateurs compacts)."""
    secret = "wh-secret-123"
    action = {"type": "webhook", "name": "notify",
              "url": "https://93.184.216.34/hook",  # IP publique littérale : pas de DNS
              "secret_encrypted": encrypt_secret(secret)}
    captures = []
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client(captures, response=_FakeResp(200, json_data={"ok": True})))

    result = await execute_action(action, {"q": "bonjour"}, _bot(id=7), conversation_id="c1")
    assert result == {"ok": True}

    assert len(captures) == 1
    method, url, kw = captures[0]
    assert method == "post"
    body = kw["content"]
    headers = kw["headers"]
    # Signature : recalcul HMAC-SHA256 du corps réellement transmis.
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert headers["X-Chapote-Signature"] == expected
    # Corps canonique + contenu attendu (clés triées, args du modèle inclus).
    payload = json.loads(body)
    assert payload["action"] == "notify"
    assert payload["bot_id"] == 7
    assert payload["conversation_id"] == "c1"
    assert payload["args"] == {"q": "bonjour"}
    assert body == json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    assert headers["Content-Type"] == "application/json"


@pytest.mark.asyncio
async def test_webhook_pins_ip_keeps_host_and_sni(monkeypatch):
    """Pinning anti DNS-rebinding : l'URL part vers l'IP validée (host remplacé),
    mais le header Host ET le SNI TLS restent le hostname d'origine. On override
    resolve_public_ip (IP fixe) pour pouvoir utiliser un HOSTNAME et l'asserter."""
    async def fake_resolve(url):
        return "93.184.216.34"

    monkeypatch.setattr(ax, "resolve_public_ip", fake_resolve)
    captures = []
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client(captures, response=_FakeResp(200, json_data={})))

    action = {"type": "webhook", "name": "h", "url": "https://hooks.example.com/path"}
    await execute_action(action, {}, _bot())

    _, url, kw = captures[0]
    assert url == "https://93.184.216.34/path"          # connexion sur l'IP épinglée
    assert kw["headers"]["Host"] == "hooks.example.com"  # Host = hostname d'origine
    assert kw["extensions"]["sni_hostname"] == "hooks.example.com"  # SNI = hostname d'origine


@pytest.mark.asyncio
async def test_webhook_rejects_private_ip(monkeypatch):
    """Anti-SSRF RÉEL : une IP privée littérale est résolue localement (sans DNS)
    et refusée par resolve_public_ip -> ActionError, AVANT toute connexion httpx."""
    # Si la garde SSRF échouait, httpx serait appelé : on pose un client qui le
    # signalerait (mais la résolution doit lever bien avant).
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], response=_FakeResp(200, json_data={})))
    action = {"type": "webhook", "name": "evil", "url": "https://10.0.0.1/x"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "non publique" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_webhook_rejects_non_https():
    """http:// refusé par resolve_public_ip -> ActionError (https requis)."""
    action = {"type": "webhook", "name": "evil", "url": "http://example.com/x"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "https" in str(exc.value).lower()


# ==========================================================================
# Axe 3 — Secrets (déchiffrement + refus du secret indéchiffrable)
# ==========================================================================

@pytest.mark.asyncio
async def test_webhook_without_secret_sends_unsigned(monkeypatch):
    """Action sans secret configuré : envoi NON signé (pas d'en-tête de signature)
    — comportement légitime, le secret est optionnel."""
    captures = []
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client(captures, response=_FakeResp(200, json_data={"ok": 1})))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook"}
    await execute_action(action, {}, _bot())
    assert "X-Chapote-Signature" not in captures[0][2]["headers"]


@pytest.mark.asyncio
async def test_webhook_undecipherable_secret_refuses_send(monkeypatch):
    """Secret CONFIGURÉ mais indéchiffrable (token Fernet invalide -> decrypt None) :
    l'envoi est REFUSÉ (ActionError) plutôt qu'émis non signé en silence, et aucune
    requête httpx ne part."""
    captures = []
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client(captures, response=_FakeResp(200, json_data={})))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook",
              "secret_encrypted": "ceci-n-est-pas-un-token-fernet"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "indéchiffrable" in str(exc.value).lower()
    assert captures == []  # rien n'est parti sur le réseau


# ==========================================================================
# Axe 4 — Erreurs / timeouts (webhook + Cal.com)
# ==========================================================================

@pytest.mark.asyncio
async def test_webhook_timeout_returns_actionerror(monkeypatch):
    """Un timeout httpx (sous-classe de HTTPError) -> ActionError « injoignable »,
    jamais d'exception réseau non gérée remontant au visiteur."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], raise_exc=httpx.ConnectTimeout("timeout")))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "injoignable" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_webhook_error_status_returns_actionerror(monkeypatch):
    """Le webhook répond 500 : raise_for_status lève -> ActionError exploitable
    portant le code de statut."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], response=_FakeResp(500, text="boom")))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "500" in str(exc.value)


@pytest.mark.asyncio
async def test_webhook_redirect_refused(monkeypatch):
    """Une 3xx (redirect) est refusée par sécurité (no-follow) -> ActionError."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], response=_FakeResp(302)))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "redirection" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_webhook_non_json_response_returned_bounded(monkeypatch):
    """Réponse non JSON : repli sur {status, body} tronqué (donnée non fiable)."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], response=_FakeResp(200, text="OK brut")))
    action = {"type": "webhook", "name": "h", "url": "https://93.184.216.34/hook"}
    out = await execute_action(action, {}, _bot())
    assert out == {"status": 200, "body": "OK brut"}


@pytest.mark.asyncio
async def test_calendar_slots_happy_path(monkeypatch):
    """calendar_slots : clé déchiffrée envoyée en Bearer vers l'hôte FIXE
    api.cal.com (jamais l'URL client : pas de SSRF), réponse compactée en jours."""
    captures = []
    cal = {"data": {"2026-07-01": [{"start": "2026-07-01T09:00:00Z"},
                                   {"start": "2026-07-01T10:00:00Z"}]}}
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client(captures, response=_FakeResp(200, json_data=cal)))
    action = {"type": "calendar_slots", "name": "rdv",
              "api_key_encrypted": encrypt_secret("cal-live-key"),
              "event_type_id": 42, "timezone": "Europe/Paris"}
    out = await execute_action(action, {}, _bot())

    method, url, kw = captures[0]
    assert method == "get"
    assert url == "https://api.cal.com/v2/slots"            # hôte fixe, aucune SSRF
    assert kw["headers"]["Authorization"] == "Bearer cal-live-key"
    assert out["timezone"] == "Europe/Paris"
    assert out["days"][0]["date"] == "2026-07-01"
    assert out["days"][0]["slots"] == ["11:00", "12:00"]    # UTC -> Europe/Paris (+2h en été)


@pytest.mark.asyncio
async def test_calendar_slots_undecipherable_key_refuses():
    """Clé Cal.com indéchiffrable -> ActionError (pas d'appel anonyme)."""
    action = {"type": "calendar_slots", "name": "rdv",
              "api_key_encrypted": "token-invalide"}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "indéchiffrable" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_calendar_slots_unauthorized(monkeypatch):
    """Cal.com répond 401 -> ActionError « clé invalide/expirée »."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], response=_FakeResp(401)))
    action = {"type": "calendar_slots", "name": "rdv",
              "api_key_encrypted": encrypt_secret("k"), "event_type_id": 1}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "invalide" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_calendar_slots_network_error(monkeypatch):
    """Cal.com injoignable (httpx.HTTPError) -> ActionError « injoignable »."""
    monkeypatch.setattr(ax.httpx, "AsyncClient",
                        _fake_client([], raise_exc=httpx.ConnectError("down")))
    action = {"type": "calendar_slots", "name": "rdv",
              "api_key_encrypted": encrypt_secret("k"), "event_type_id": 1}
    with pytest.raises(ActionError) as exc:
        await execute_action(action, {}, _bot())
    assert "injoignable" in str(exc.value).lower()


# ==========================================================================
# Axe 5 — _compact_slots : fonction pure (seuil 40, timezone, vide)
# ==========================================================================

def test_compact_slots_below_threshold_keeps_all():
    """En dessous de 40 créneaux : tout est conservé, groupé par jour."""
    data = {"data": {"2026-07-01": ["2026-07-01T08:00:00Z", "2026-07-01T09:00:00Z"],
                     "2026-07-02": ["2026-07-02T08:00:00Z"]}}
    out = _compact_slots(data, "UTC")
    assert out["timezone"] == "UTC"
    total = sum(len(d["slots"]) for d in out["days"])
    assert total == 3
    assert out["days"][0]["date"] == "2026-07-01"
    assert out["days"][0]["slots"] == ["08:00", "09:00"]


def test_compact_slots_caps_at_forty():
    """Au-delà du seuil de 40 : la liste est compactée à EXACTEMENT 40 créneaux."""
    entries = [f"2026-07-01T{h:02d}:{m:02d}:00Z" for h in range(10) for m in range(0, 60, 6)]
    assert len(entries) == 100
    out = _compact_slots({"data": {"2026-07-01": entries}}, "UTC")
    total = sum(len(d["slots"]) for d in out["days"])
    assert total == 40


def test_compact_slots_empty_message():
    """Aucun créneau lisible -> message « aucune dispo » + days vide."""
    out = _compact_slots({"data": {}}, "Europe/Paris")
    assert out["days"] == []
    assert "Aucun créneau" in out["message"]


def test_compact_slots_v1_shape_and_invalid_tz():
    """Forme v1 ({"slots": ...}) tolérée, et une timezone invalide -> repli (pas
    de crash) : les créneaux restent renvoyés."""
    data = {"slots": {"2026-07-01": [{"time": "2026-07-01T07:30:00Z"}]}}
    out = _compact_slots(data, "Pas/UneZone")
    # Repli Europe/Paris (UTC+2 en été) : 07:30 UTC -> 09:30, sans crash.
    assert out["days"][0]["slots"] == ["09:30"]


def test_compact_slots_ignores_unparseable_entries():
    """Entrées illisibles (non-ISO, non-string) ignorées sans lever."""
    data = {"data": {"2026-07-01": ["pas une date", 12345,
                                    {"start": "2026-07-01T06:00:00Z"}]}}
    out = _compact_slots(data, "UTC")
    assert out["days"][0]["slots"] == ["06:00"]


# ==========================================================================
# Axe 1 (suite) — capture_lead : persistance RÉELLE (DB Postgres jetable)
# ==========================================================================

@pytest.mark.real_db
@pytest.mark.asyncio
async def test_capture_lead_persists_on_real_db(pg_session, monkeypatch):
    """capture_lead INSÈRE un Lead (source=ai) committé en base : on relit la ligne
    pour prouver la persistance (FakeSession masquerait le commit). L'email de
    notification est fire-and-forget (SMTP non configuré -> no-op), non bloquant."""
    from src.models.bot import Bot
    from src.models.lead import Lead
    from src.models.user import User

    user = User(email="owner-lead@test.dev", name="Owner", hashed_password="x",
                is_active=True, auth_source="local")
    pg_session.add(user)
    await pg_session.commit()
    await pg_session.refresh(user)
    bot = Bot(name="Bot lead", owner_user_id=user.id)
    pg_session.add(bot)
    await pg_session.commit()
    await pg_session.refresh(bot)

    out = await execute_action({"type": "capture_lead"},
                               {"email": "Visitor@Example.COM", "name": "Jean",
                                "phone": "0102030405", "message": "rappelez-moi"},
                               bot, db=pg_session, conversation_id=None)
    assert out["ok"] is True
    lead_id = out["lead_id"]

    fresh = (await pg_session.execute(select(Lead).where(Lead.id == lead_id))).scalar_one()
    assert fresh.bot_id == bot.id
    assert fresh.source == "ai"
    assert fresh.email == "visitor@example.com"  # normalisé en minuscules
    assert fresh.name == "Jean"


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_capture_lead_invalid_email_rejected(pg_session):
    """Un email invalide -> ActionError, aucun Lead persisté (garde d'entrée)."""
    from src.models.bot import Bot
    from src.models.lead import Lead
    from src.models.user import User

    user = User(email="owner2@test.dev", name="O2", hashed_password="x",
                is_active=True, auth_source="local")
    pg_session.add(user)
    await pg_session.commit()
    await pg_session.refresh(user)
    bot = Bot(name="Bot lead2", owner_user_id=user.id)
    pg_session.add(bot)
    await pg_session.commit()
    await pg_session.refresh(bot)

    with pytest.raises(ActionError):
        await execute_action({"type": "capture_lead"}, {"email": "pas-un-email"},
                             bot, db=pg_session, conversation_id=None)

    n = len((await pg_session.execute(select(Lead).where(Lead.bot_id == bot.id)))
            .scalars().all())
    assert n == 0
