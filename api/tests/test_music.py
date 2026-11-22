"""Boutique de partitions (music.chapote.fr) — sur la vraie base jetable (`real_db`).

Prix calculés par le back (lot, codes promo), envoi des partitions par la
production (jeton), diffusion décidée par l'admin, aperçus floutés côté serveur,
commande gratuite / simulée / Stripe Checkout, webhook dédié, téléchargement.
"""
import json
import shutil
import time
from datetime import timedelta
from io import BytesIO

import httpx
import pytest
from sqlalchemy import select

from src.core.config import settings
from src.core.database import get_db
from src.core.security import AUTH_COOKIE_NAME, create_dashboard_token
from src.core.time import utcnow
from src.main import app
from src.models.music import ORDER_PAID, MusicOrder, MusicPromoCode, MusicSheet
from src.models.user import User
from src.services import music_service as ms
from src.services import stripe_service
from src.services.stripe_service import StripeError

from conftest import sign_stripe

pytestmark = [pytest.mark.real_db, pytest.mark.asyncio]

TOKEN = "ingest-token-de-test"
MUSIC_SECRET = "whsec_music_test"
needs_pdftoppm = pytest.mark.skipif(not shutil.which("pdftoppm"), reason="poppler-utils absent")


def pdf_bytes(pages: int = 3) -> bytes:
    from PIL import Image, ImageDraw
    imgs = []
    for n in range(pages):
        im = Image.new("RGB", (595, 842), "white")
        d = ImageDraw.Draw(im)
        for y in range(120, 800, 60):
            for k in range(5):
                d.line([(50, y + 6 * k), (545, y + 6 * k)], fill="black")
        d.text((280, 40), f"page {n + 1}", fill="black")
        imgs.append(im)
    buf = BytesIO()
    imgs[0].save(buf, "PDF", save_all=True, append_images=imgs[1:])
    return buf.getvalue()


@pytest.fixture
def music(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MUSIC_DIR", str(tmp_path / "music"))
    monkeypatch.setattr(settings, "MUSIC_INGEST_TOKEN", TOKEN)
    monkeypatch.setattr(settings, "STRIPE_MUSIC_WEBHOOK_SECRET", MUSIC_SECRET)
    monkeypatch.setattr(settings, "MUSIC_URL", "https://music.test")
    sent = []

    async def fake_send(to, subject, body, **kw):
        sent.append({"to": to, "subject": subject, "body": body, "html": kw.get("html")})
        return True
    monkeypatch.setattr(ms, "send_email", fake_send)
    return sent


class Client:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        async def _get_db():
            yield self._session
        app.dependency_overrides[get_db] = _get_db
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        return self

    async def __aexit__(self, *exc):
        await self.http.aclose()
        app.dependency_overrides.pop(get_db, None)

    def as_(self, user):
        self.http.cookies.set(AUTH_COOKIE_NAME, create_dashboard_token(user.id))
        return self.http


async def _user(db, email, **kw):
    u = User(email=email, hashed_password="x", name=email.split("@")[0], is_active=True, **kw)
    db.add(u)
    await db.flush()
    return u


async def _ingest(http, ref, *, piece="Swan Lake", instrument="violon", rights="domaine public",
                  pages=3, pdf=True, **extra):
    meta = {"source_ref": ref, "piece_title": piece, "composer": "Tchaikovsky", "instrument": instrument,
            "title": f"{piece} ({instrument})", "rights": rights,
            "reel_url": "https://www.instagram.com/reel/x/", **extra}
    files = {"pdf": ("partition.pdf", pdf_bytes(pages), "application/pdf")} if pdf else None
    return await http.post("/api/music/ingest", data={"meta": json.dumps(meta)}, files=files,
                           headers={"Authorization": f"Bearer {TOKEN}"})


async def _sheet(db, ref, *, piece="Swan Lake", instrument="violon", published=True, price=None):
    s = MusicSheet(source_ref=ref, piece_slug=ms.slugify(piece), piece_title=piece, composer="Tchaikovsky",
                   instrument=instrument, instrument_label=ms.instrument_label(instrument), title=piece,
                   rights="domaine public", public_domain=True, published=published, pages=3,
                   has_cover=False, price_cents=price, released_at=utcnow())
    db.add(s)
    await db.flush()
    return s


# --------------------------------------------------------------------------
# Prix
# --------------------------------------------------------------------------

async def test_quote_unit_bundle_and_promos(pg_session, music):
    v = await _sheet(pg_session, "gh/1", instrument="violon")
    p = await _sheet(pg_session, "gh/2", instrument="piano")
    other = await _sheet(pg_session, "gh/3", piece="Nocturne", instrument="piano")
    pg_session.add_all([
        MusicPromoCode(code="MOINS10", kind="percent", value=10, active=True, uses=0),
        MusicPromoCode(code="UNEURO", kind="amount", value=100, active=True, uses=0),
        MusicPromoCode(code="FINI", kind="percent", value=50, active=True, uses=3, max_uses=3),
        MusicPromoCode(code="VIEUX", kind="percent", value=50, active=True, uses=0,
                       expires_at=utcnow() - timedelta(days=1)),
    ])
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.http.post("/api/music/quote", json={"sheet_ids": [v.id]})
        assert r.json()["total_cents"] == 199
        # deux instruments du même morceau = lot à 2,99 €
        r = (await c.http.post("/api/music/quote", json={"sheet_ids": [v.id, p.id]})).json()
        assert (r["list_total_cents"], r["total_cents"], r["bundle_savings_cents"]) == (398, 299, 99)
        assert sum(l["price_cents"] for l in r["lines"]) == 299
        # le lot ne s'applique pas entre deux morceaux différents
        r = (await c.http.post("/api/music/quote", json={"sheet_ids": [v.id, other.id]})).json()
        assert r["total_cents"] == 398
        r = (await c.http.post("/api/music/quote", json={"sheet_ids": [v.id, p.id], "promo_code": "moins10"})).json()
        assert (r["discount_cents"], r["total_cents"]) == (29, 270)
        assert sum(l["price_cents"] for l in r["lines"]) == 270
        r = (await c.http.post("/api/music/quote", json={"sheet_ids": [v.id], "promo_code": "UNEURO"})).json()
        assert r["total_cents"] == 99
        # une seule réponse pour un code inconnu, épuisé ou expiré : on ne révèle pas qu'un code existe
        for code in ("FINI", "VIEUX", "NOPE"):
            r = (await c.http.post("/api/music/quote", json={"sheet_ids": [v.id], "promo_code": code})).json()
            assert (r["promo_error"], r["total_cents"]) == ("promo_invalid", 199)


async def test_admin_prices_apply(pg_session, music):
    admin = await _user(pg_session, "admin@t.dev", is_superadmin=True)
    v = await _sheet(pg_session, "gh/1")
    p = await _sheet(pg_session, "gh/2", instrument="piano")
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(admin)
        assert (await h.put("/api/admin/music/pricing", json={"unit_price_cents": 100,
                                                               "bundle_price_cents": None})).status_code == 200
        assert (await h.patch(f"/api/admin/music/sheets/{p.id}", json={"price_cents": 50})).status_code == 200
        r = (await h.post("/api/music/quote", json={"sheet_ids": [v.id, p.id]})).json()
        assert r["total_cents"] == 150 and r["bundles"] == []


# --------------------------------------------------------------------------
# Envoi des partitions, diffusion, aperçus
# --------------------------------------------------------------------------

async def test_ingest_requires_token(pg_session, music):
    async with Client(pg_session) as c:
        r = await c.http.post("/api/music/ingest", data={"meta": "{}"}, headers={"Authorization": "Bearer faux"})
        assert r.status_code == 401


@needs_pdftoppm
async def test_ingest_publishes_public_domain_only_and_blurs(pg_session, music):
    async with Client(pg_session) as c:
        r = await _ingest(c.http, "ghost-hands/a", pages=3)
        assert r.status_code == 200, r.text
        pd = r.json()
        assert pd["published"] is True and pd["pages"] == 3
        assert pd["url"] == "https://music.test/s/swan-lake?i=violon"
        r = await _ingest(c.http, "ghost-hands/b", piece="Enter Sandman", instrument="batterie",
                          rights="protégé (reprise)")
        priv = r.json()
        assert priv["published"] is False

        cat = (await c.http.get("/api/music/catalog")).json()
        assert [p["slug"] for p in cat["pieces"]] == ["swan-lake"]
        assert (await c.http.get("/api/music/pieces/enter-sandman")).status_code == 404
        assert (await c.http.get(f"/api/music/sheets/{priv['id']}/pages/1.png")).status_code == 404

        one = await c.http.get(f"/api/music/sheets/{pd['id']}/pages/1.png")
        two = await c.http.get(f"/api/music/sheets/{pd['id']}/pages/2.jpg")
        assert one.headers["content-type"] == "image/png" and two.headers["content-type"] == "image/jpeg"
        from PIL import Image
        assert Image.open(BytesIO(two.content)).width <= 620   # floutée et réduite
        assert (await c.http.get(f"/api/music/sheets/{pd['id']}/pages/2.png")).status_code == 404
        # une seule page : le bas de la page 1 est flouté (sinon l'aperçu donnerait tout)
        r = await _ingest(c.http, "ghost-hands/c", piece="Ave Maria", pages=1)
        one_page = await c.http.get(f"/api/music/sheets/{r.json()['id']}/pages/1.png")
        im = Image.open(BytesIO(one_page.content)).convert("L")
        w, h = im.size
        def lines(y0, y1):  # pixels très sombres (lignes de portée nettes)
            return sum(1 for y in range(y0, y1) for x in range(0, w, 4) if im.getpixel((x, y)) < 60)
        assert lines(int(h * 0.1), int(h * 0.35)) > 50 and lines(int(h * 0.5), int(h * 0.95)) == 0
        # le PDF complet n'est servi par aucune route publique
        assert (await c.http.get(f"/api/music/sheets/{pd['id']}/partition.pdf")).status_code == 404

        # mise à jour sans PDF : la décision de diffusion de l'admin est gardée
        s = await pg_session.get(MusicSheet, priv["id"])
        s.published = True
        await pg_session.commit()
        r = await _ingest(c.http, "ghost-hands/b", piece="Enter Sandman", instrument="batterie",
                          rights="protégé (reprise)", pdf=False)
        assert r.json()["published"] is True and r.json()["created"] is False


@needs_pdftoppm
async def test_admin_can_publish_any_sheet(pg_session, music):
    admin = await _user(pg_session, "admin@t.dev", is_superadmin=True)
    user = await _user(pg_session, "u@t.dev")
    await pg_session.commit()
    async with Client(pg_session) as c:
        priv = (await _ingest(c.http, "gh/p", piece="Whiplash", instrument="batterie", rights="protégé")).json()
        assert (await c.as_(user).get("/api/admin/music/sheets")).status_code == 403
        h = c.as_(admin)
        rows = (await h.get("/api/admin/music/sheets?status=private")).json()["sheets"]
        assert [r["id"] for r in rows] == [priv["id"]]
        assert (await h.patch(f"/api/admin/music/sheets/{priv['id']}", json={"published": True})).json()["published"]
        assert (await c.http.get("/api/music/pieces/whiplash")).status_code == 200
        ov = (await h.get("/api/admin/music/overview")).json()
        assert ov["sheets"] == {"total": 1, "published": 1, "private": 0}


# --------------------------------------------------------------------------
# Commande
# --------------------------------------------------------------------------

async def test_checkout_requires_consent_and_minimum(pg_session, music):
    v = await _sheet(pg_session, "gh/1", price=30)
    await pg_session.commit()
    async with Client(pg_session) as c:
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v.id]})
        assert r.status_code == 400 and r.json()["detail"]["code"] == "consent_required"
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v.id], "consent": True})
        assert r.status_code == 400 and r.json()["detail"]["code"] == "amount_too_low"


@needs_pdftoppm
async def test_free_order_delivers_and_downloads(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", False)
    pg_session.add(MusicPromoCode(code="OFFERT", kind="percent", value=100, active=True, uses=0, max_uses=1))
    await pg_session.commit()
    async with Client(pg_session) as c:
        sid = (await _ingest(c.http, "gh/a")).json()["id"]
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [sid], "consent": True,
                                                          "promo_code": "OFFERT", "email": "fan@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["redirect"].startswith("https://music.test/thanks?order=")
        public_id = r.json()["order"]
        k = ms.download_key(public_id)
        assert (await c.http.get(f"/api/music/orders/{public_id}?k=mauvaise")).status_code == 404
        o = (await c.http.get(f"/api/music/orders/{public_id}?k={k}")).json()
        assert o["status"] == ORDER_PAID and o["email"] == "f•••@example.com"
        pdf = await c.http.get(o["items"][0]["download"])
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        assert len(music) == 1 and music[0]["to"] == ["fan@example.com"]
        assert f"/api/music/download/{public_id}/" in music[0]["body"]
        promo = (await pg_session.execute(select(MusicPromoCode))).scalar_one()
        await pg_session.refresh(promo)
        assert promo.uses == 1
        # code épuisé
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [sid], "consent": True,
                                                          "promo_code": "OFFERT"})
        assert r.status_code == 400 and r.json()["detail"]["code"] == "promo_invalid"


async def test_stripe_checkout_and_webhook(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", False)
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_x")
    v = await _sheet(pg_session, "gh/1")
    p = await _sheet(pg_session, "gh/2", instrument="piano")
    await pg_session.commit()
    sent = {}

    async def fake_create(data):
        sent.update(data)
        return {"id": "cs_test_123", "url": "https://checkout.stripe.test/cs_test_123"}
    monkeypatch.setattr(stripe_service, "create_payment_checkout", fake_create)

    async with Client(pg_session) as c:
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v.id, p.id], "consent": True, "lang": "fr"})
        assert r.status_code == 200, r.text
        assert r.json()["redirect"] == "https://checkout.stripe.test/cs_test_123"
        public_id = r.json()["order"]
        # le montant envoyé à Stripe est celui calculé par le back (lot 2,99 €)
        amounts = [int(v_) for k_, v_ in sent.items() if k_.endswith("[unit_amount]")]
        assert sum(amounts) == 299 and sent["mode"] == "payment"
        assert sent["metadata[music_order]"] == public_id and sent["locale"] == "fr"
        assert sent["adaptive_pricing[enabled]"] == "true"

        o = (await c.http.get(f"/api/music/orders/{public_id}?k={ms.download_key(public_id)}")).json()
        assert o["status"] == "pending" and o["items"][0]["download"] is None

        # mauvais secret (celui de l'abonnement Chapote) : refusé
        event = {"type": "checkout.session.completed", "data": {"object": {
            "id": "cs_test_123", "payment_status": "paid", "status": "complete", "payment_intent": "pi_1",
            "customer_details": {"email": "buyer@example.com"}, "metadata": {"music_order": public_id}}}}
        raw = json.dumps(event).encode()
        bad = await c.http.post("/api/music/stripe/webhook", content=raw,
                                headers={"stripe-signature": sign_stripe(raw, "whsec_autre", int(time.time()))})
        assert bad.status_code == 400
        for _ in range(2):  # idempotent
            ok = await c.http.post("/api/music/stripe/webhook", content=raw,
                                   headers={"stripe-signature": sign_stripe(raw, MUSIC_SECRET, int(time.time()))})
            assert ok.status_code == 200
        order = (await pg_session.execute(select(MusicOrder))).scalar_one()
        await pg_session.refresh(order)
        assert order.status == ORDER_PAID and order.email == "buyer@example.com"
        assert order.stripe_payment_intent == "pi_1" and order.amount_cents == 299
        assert len(music) == 1 and "Vos partitions" in music[0]["subject"]
        # la page « merci » retrouve la commande avec l'identifiant de session Stripe
        o = (await c.http.get(f"/api/music/orders/{public_id}?session_id=cs_test_123")).json()
        assert o["status"] == ORDER_PAID and o["key"] == ms.download_key(public_id)

        # événement d'un autre produit (abonnement Chapote) : ignoré
        other = json.dumps({"type": "checkout.session.completed", "data": {"object": {"id": "cs_x", "metadata": {}}}}).encode()
        r = await c.http.post("/api/music/stripe/webhook", content=other,
                              headers={"stripe-signature": sign_stripe(other, MUSIC_SECRET, int(time.time()))})
        assert r.json().get("ignored") is True

        # remboursement complet dans Stripe : la commande est coupée (plus de téléchargement)
        assert o["items"][0]["download"]
        ev = json.dumps({"type": "charge.refunded", "data": {"object": {"id": "ch_1", "payment_intent": "pi_1", "refunded": True}}}).encode()
        r = await c.http.post("/api/music/stripe/webhook", content=ev,
                              headers={"stripe-signature": sign_stripe(ev, MUSIC_SECRET, int(time.time()))})
        assert r.status_code == 200
        await pg_session.refresh(order)
        assert order.status == "refunded"
        o = (await c.http.get(f"/api/music/orders/{public_id}?k={ms.download_key(public_id)}")).json()
        assert o["items"][0]["download"] is None

        # litige bancaire : suspendue ; gagné -> rendue ; perdu -> coupée
        async def send(ev):
            raw = json.dumps(ev).encode()
            return await c.http.post("/api/music/stripe/webhook", content=raw,
                                     headers={"stripe-signature": sign_stripe(raw, MUSIC_SECRET, int(time.time()))})
        order.status = ORDER_PAID
        await pg_session.commit()
        await send({"type": "charge.dispute.created", "data": {"object": {"id": "dp_1", "payment_intent": "pi_1", "status": "needs_response"}}})
        await pg_session.refresh(order)
        assert order.status == "disputed"
        await send({"type": "charge.dispute.closed", "data": {"object": {"id": "dp_1", "payment_intent": "pi_1", "status": "won"}}})
        await pg_session.refresh(order)
        assert order.status == ORDER_PAID
        await send({"type": "charge.dispute.created", "data": {"object": {"id": "dp_2", "payment_intent": "pi_1", "status": "needs_response"}}})
        await send({"type": "charge.dispute.closed", "data": {"object": {"id": "dp_2", "payment_intent": "pi_1", "status": "lost"}}})
        await pg_session.refresh(order)
        assert order.status == "refunded"
        # remboursement partiel : rien ne change
        order.status = ORDER_PAID
        await pg_session.commit()
        await send({"type": "charge.refunded", "data": {"object": {"id": "ch_1", "payment_intent": "pi_1", "refunded": False, "amount_refunded": 100}}})
        await pg_session.refresh(order)
        assert order.status == ORDER_PAID


async def test_admin_promos_and_orders(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", True)
    admin = await _user(pg_session, "admin@t.dev", is_superadmin=True)
    v_id = (await _sheet(pg_session, "gh/1")).id
    await pg_session.commit()
    async with Client(pg_session) as c:
        h = c.as_(admin)
        r = await h.post("/api/admin/music/promos", json={"code": "noel", "kind": "percent", "value": 20})
        assert r.status_code == 200 and r.json()["code"] == "NOEL"
        assert (await h.post("/api/admin/music/promos", json={"code": "NOEL", "kind": "amount",
                                                               "value": 50})).status_code == 409
        assert (await h.post("/api/admin/music/promos", json={"code": "TROP", "kind": "percent",
                                                               "value": 150})).status_code == 400
        # MOCK_BILLING : commande payée tout de suite (dev / e2e)
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v_id], "consent": True,
                                                          "promo_code": "NOEL", "email": "a@b.fr"})
        assert r.status_code == 200
        orders = (await h.get("/api/admin/music/orders")).json()["orders"]
        assert orders[0]["status"] == ORDER_PAID and orders[0]["amount_cents"] == 160
        ov = (await h.get("/api/admin/music/overview")).json()
        assert ov["orders"]["paid"] == 1 and ov["revenue_cents"]["total"] == 160
        promo_id = (await h.get("/api/admin/music/promos")).json()["promos"][0]["id"]
        r = await h.patch(f"/api/admin/music/promos/{promo_id}", json={"active": False})
        assert r.json()["usable"] is False and r.json()["uses"] == 1
        assert (await h.post(f"/api/admin/music/orders/{orders[0]['id']}/resend")).json()["sent"] is True


# --------------------------------------------------------------------------
# V2 : pagination, chiffres Instagram, lecteur, comptes partagés, avis, pseudo Instagram
# --------------------------------------------------------------------------

def notes_json(seconds: float = 60.0) -> bytes:
    notes = [{"t": i * 0.5, "d": 0.4, "p": 60 + i % 12, "v": 80, "main": "D" if i % 2 else "G", "role": "instrument"}
             for i in range(int(seconds * 2))]
    return json.dumps({"instrument": "piano", "duree": seconds, "bpm": 120, "notes": notes}).encode()


async def test_catalog_pagination_and_instagram_stats(pg_session, music):
    for i in range(5):
        await _sheet(pg_session, f"gh/{i}", piece=f"Piece {i}", instrument="piano")
    await pg_session.commit()
    async with Client(pg_session) as c:
        p1 = (await c.http.get("/api/music/catalog?limit=2")).json()
        assert p1["total"] == 5 and len(p1["pieces"]) == 2 and p1["next_offset"] == 2
        p3 = (await c.http.get("/api/music/catalog?limit=2&offset=4")).json()
        assert len(p3["pieces"]) == 1 and p3["next_offset"] is None
        r = await c.http.post("/api/music/ingest/stats", json=[{"source_ref": "gh/3", "likes": 64692, "comments": 120}],
                              headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.json()["updated"] == 1
        top = (await c.http.get("/api/music/catalog?sort=popular&limit=1")).json()["pieces"][0]
        assert top["title"] == "Piece 3" and top["likes"] == 64692
        assert (await c.http.post("/api/music/ingest/stats", json=[])).status_code == 401  # sans jeton


@needs_pdftoppm
async def test_player_notes_preview_and_buyer(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", True)
    async with Client(pg_session) as c:
        meta = {"source_ref": "gh/n", "piece_title": "Nocturne", "instrument": "piano", "rights": "domaine public"}
        curseur = json.dumps({"version": 1, "pages": 2, "events": [[1.0, 0, 0.2, 0.1, 0.2], [30.0, 1, 0.5, 0.3, 0.4],
                                                                   [31.0, 5, 0.5, 0.3, 0.4], [32.0, 1, 1.5, 0.3, 0.4]]}).encode()
        files = {"pdf": ("p.pdf", pdf_bytes(2), "application/pdf"), "notes": ("notes.json", notes_json(60), "application/json"),
                 "cursor": ("curseur.json", curseur, "application/json")}
        sid = (await c.http.post("/api/music/ingest", data={"meta": json.dumps(meta)}, files=files,
                                 headers={"Authorization": f"Bearer {TOKEN}"})).json()["id"]
        prev = (await c.http.get(f"/api/music/sheets/{sid}/notes")).json()
        assert prev["full"] is False and prev["duration"] == 25 and prev["full_duration"] == 60
        assert prev["cursor"] == [[1.0, 0, 0.2, 0.1, 0.2]]  # aperçu : 25 s ; page 5 et x > 1 écartés
        # aperçu public de la page 1 : net jusqu'au bas de la dernière ligne jouée par l'extrait (0,2 + marge), flouté dessous
        from PIL import Image, ImageChops
        d = ms.sheet_dir(sid)
        with Image.open(d / "p1.png") as p1, Image.open(d / "c1.png") as c1:
            w, h = c1.size
            assert ImageChops.difference(p1.convert("RGB").crop((0, 0, w, int(h * 0.2))), c1.convert("RGB").crop((0, 0, w, int(h * 0.2)))).getbbox() is None
            assert ImageChops.difference(p1.convert("RGB").crop((0, int(h * 0.3), w, h)), c1.convert("RGB").crop((0, int(h * 0.3), w, h))).getbbox() is not None
        assert max(n[0] for n in prev["notes"]) < 25
        assert (await c.http.get(f"/api/music/sheets/{sid}/clear/2.png")).status_code == 404
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [sid], "consent": True})
        order = r.json()["order"]
        k = ms.download_key(order)
        full = (await c.http.get(f"/api/music/sheets/{sid}/notes?order={order}&k={k}")).json()
        assert full["full"] is True and full["duration"] == 60 and len(full["cursor"]) == 2
        # son exact du Reel : extrait public, complet pour l'acheteur seulement
        mp3 = b"ID3" + b"\x00" * 200
        r = await c.http.post("/api/music/ingest/audio", data={"source_ref": "gh/n"},
                              files={"audio": ("a.mp3", mp3, "audio/mpeg"), "audio_preview": ("p.mp3", mp3[:100], "audio/mpeg")},
                              headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200, r.text
        assert (await c.http.post("/api/music/ingest/audio", data={"source_ref": "gh/n"},
                                  files={"audio": ("a.mp3", b"nope", "audio/mpeg"), "audio_preview": ("p.mp3", b"nope", "audio/mpeg")},
                                  headers={"Authorization": f"Bearer {TOKEN}"})).status_code == 400
        prev = (await c.http.get(f"/api/music/sheets/{sid}/notes")).json()
        assert prev["audio"] == f"/api/music/sheets/{sid}/preview.mp3"
        assert (await c.http.get(prev["audio"])).status_code == 200
        assert (await c.http.get(f"/api/music/sheets/{sid}/audio.mp3")).status_code == 404
        full = (await c.http.get(f"/api/music/sheets/{sid}/notes?order={order}&k={k}")).json()
        assert full["audio"] == f"/api/music/sheets/{sid}/audio.mp3?order={order}&k={k}"
        a = await c.http.get(full["audio"])
        assert a.status_code == 200 and a.content == mp3
        ok = await c.http.get(f"/api/music/sheets/{sid}/clear/2.png?order={order}&k={k}")
        assert ok.status_code == 200 and ok.headers["content-type"] == "image/png"
        assert (await c.http.get(f"/api/music/sheets/{sid}/clear/2.png?order={order}&k=faux")).status_code == 404


async def test_shared_account_apps_and_verified_reviews(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", True)
    v = await _sheet(pg_session, "gh/1")
    other = await _sheet(pg_session, "gh/2", piece="Other")
    await pg_session.commit()
    v_id, other_id = v.id, other.id
    async with Client(pg_session) as c:
        # achat sans compte avec l'e-mail, puis inscription depuis music : l'achat est retrouvé une fois l'adresse vérifiée
        await c.http.post("/api/music/checkout", json={"sheet_ids": [v_id], "consent": True, "email": "fan@example.com"})
        r = await c.http.post("/api/auth/register", json={"name": "Fan Club", "email": "fan@example.com", "password": "secret-123"},
                              headers={"X-Chapote-App": "music"})
        assert r.status_code == 200, r.text
        u = (await pg_session.execute(select(User).where(User.email == "fan@example.com"))).scalar_one()
        await pg_session.refresh(u)
        assert u.signup_app == "music"
        acc = (await c.http.get("/api/music/account")).json()
        assert acc["sheets"] == [] and acc["user"]["email_verified"] is False  # adresse pas encore prouvée : rien
        assert (await c.http.get(f"/api/music/sheets/{v_id}/clear/1.png")).status_code == 404
        u.email_verified = True
        await pg_session.commit()
        acc = (await c.http.get("/api/music/account")).json()
        assert [s["sheet_id"] for s in acc["sheets"]] == [v_id]
        from src.models.user import UserApp
        apps = {a.app for a in (await pg_session.execute(select(UserApp).where(UserApp.user_id == u.id))).scalars()}
        assert apps == {"music"}
        # connexion plus tard sur chapote.fr : le service s'ajoute, l'inscription reste « music »
        await c.http.post("/api/auth/login", json={"email": "fan@example.com", "password": "secret-123"})
        apps = {a.app for a in (await pg_session.execute(select(UserApp).where(UserApp.user_id == u.id))).scalars()}
        assert apps == {"music", "chapote"}
        # avis : seulement sur une partition achetée
        assert (await c.http.post(f"/api/music/sheets/{other_id}/review", json={"rating": 5})).status_code == 403
        assert (await c.http.post(f"/api/music/sheets/{v_id}/review", json={"rating": 4, "comment": "Super"})).status_code == 200
        assert (await c.http.post(f"/api/music/sheets/{v_id}/review", json={"rating": 5})).status_code == 200  # modification
        rv = (await c.http.get("/api/music/pieces/swan-lake/reviews")).json()
        assert rv["total"] == 1 and rv["reviews"][0]["rating"] == 5 and rv["reviews"][0]["author"] == "Fan C."
        piece = (await c.http.get("/api/music/pieces/swan-lake")).json()
        assert piece["rating"] == 5.0 and piece["reviews"] == 1
        # l'admin masque l'avis
        admin = await _user(pg_session, "admin@t.dev", is_superadmin=True)
        await pg_session.commit()
        h = c.as_(admin)
        rid = (await h.get("/api/admin/music/reviews")).json()["reviews"][0]["id"]
        assert (await h.patch(f"/api/admin/music/reviews/{rid}", json={"hidden": True})).json()["hidden"] is True
        assert (await c.http.get("/api/music/pieces/swan-lake/reviews")).json()["total"] == 0


async def test_instagram_username_and_thank_you_queue(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", True)
    v_id = (await _sheet(pg_session, "gh/1")).id
    await pg_session.commit()
    auth = {"Authorization": f"Bearer {TOKEN}"}
    async with Client(pg_session) as c:
        bad = await c.http.post("/api/music/checkout", json={"sheet_ids": [v_id], "consent": True, "instagram": "pas un pseudo !"})
        assert bad.status_code == 400 and bad.json()["detail"]["code"] == "instagram_invalid"
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v_id], "consent": True,
                                                          "instagram": "https://www.instagram.com/Fan.Name/", "lang": "es"})
        order = r.json()["order"]
        pending = (await c.http.get("/api/music/ingest/instagram-pending", headers=auth)).json()["orders"]
        assert pending[0]["username"] == "fan.name" and pending[0]["lang"] == "es"
        assert pending[0]["items"][0]["download_url"].startswith("https://music.test/api/music/download/")
        await c.http.post("/api/music/ingest/instagram-done", json={"order": order, "status": "sent"}, headers=auth)
        assert (await c.http.get("/api/music/ingest/instagram-pending", headers=auth)).json()["orders"] == []
        assert (await c.http.get("/api/music/ingest/instagram-pending")).status_code in (401, 503)


@pytest.mark.asyncio
async def test_cookie_domain_shared_between_subdomains(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_COOKIE_DOMAIN", None)
    monkeypatch.setattr(settings, "APP_URL", "https://chapote.fr")
    monkeypatch.setattr(settings, "MUSIC_URL", "https://music.chapote.fr")
    monkeypatch.setattr(type(settings), "is_production", property(lambda self: True))
    assert settings.cookie_domain == "chapote.fr"
    monkeypatch.setattr(type(settings), "is_production", property(lambda self: False))
    assert settings.cookie_domain is None


@pytest.mark.asyncio
async def test_client_ip_from_music_proxy_needs_the_key(monkeypatch):
    from starlette.requests import Request as StarletteRequest
    from src.services.user_apps import client_ip
    monkeypatch.setattr(settings, "MUSIC_INGEST_TOKEN", "cle")

    def req(headers):
        return StarletteRequest({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                                 "client": ("10.0.0.5", 1234)})
    assert client_ip(req({"X-Music-Client-IP": "1.2.3.4", "X-Music-Proxy-Key": "cle"})) == "1.2.3.4"
    assert client_ip(req({"X-Music-Client-IP": "1.2.3.4", "X-Music-Proxy-Key": "fausse"})) == "10.0.0.5"
    assert client_ip(req({"X-Music-Client-IP": "1.2.3.4"})) == "10.0.0.5"


@pytest.mark.asyncio
async def test_checkout_falls_back_without_adaptive_pricing(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", False)
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_x")
    v = await _sheet(pg_session, "gh/ap")
    await pg_session.commit()
    calls = []

    async def fake_create(data):
        calls.append(dict(data))
        if "adaptive_pricing[enabled]" in data:
            raise StripeError("Adaptive Pricing is not available for this account")
        return {"id": "cs_test_ap", "url": "https://checkout.stripe.test/cs_test_ap"}
    monkeypatch.setattr(stripe_service, "create_payment_checkout", fake_create)

    async with Client(pg_session) as c:
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [v.id], "consent": True, "lang": "en"})
        assert r.status_code == 200, r.text
    assert len(calls) == 2 and "adaptive_pricing[enabled]" not in calls[1]


def test_parse_ecb_rates():
    from src.services.fx_rates import parse_ecb
    xml = ("<?xml version='1.0' encoding='UTF-8'?><gesmes:Envelope xmlns:gesmes='http://www.gesmes.org/xml/2002-08-01'"
           " xmlns='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'><Cube><Cube time='2026-11-20'>"
           "<Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8431'/><Cube currency='XX' rate='2'/>"
           "</Cube></Cube></gesmes:Envelope>")
    date, rates = parse_ecb(xml)
    assert date == "2026-11-20" and rates == {"USD": 1.0812, "GBP": 0.8431}


async def test_private_piece_only_for_owners_and_admin_grants(pg_session, music, monkeypatch):
    """Une fiche privée existe mais ne se voit que par qui a la partition (achat ou don) et par l'admin ;
    l'admin voit les propriétaires, donne et retire un don."""
    priv = await _sheet(pg_session, "gh/p", piece="Rocky", published=False)
    pub = await _sheet(pg_session, "gh/q", piece="Rocky", instrument="piano")
    solo = await _sheet(pg_session, "gh/s", piece="Secret", published=False)
    admin = await _user(pg_session, "boss@t.dev", is_superadmin=True)
    fan = await _user(pg_session, "fan@t.dev", email_verified=True)
    await pg_session.commit()
    priv_id, pub_id, solo_id, fan_email = priv.id, pub.id, solo.id, fan.email
    async with Client(pg_session) as c:
        # visiteur : fiche entièrement privée -> 404 « private » ; fiche mixte -> seulement la partition diffusée
        r = await c.http.get("/api/music/pieces/secret")
        assert r.status_code == 404 and r.json()["detail"]["code"] == "private"
        assert (await c.http.get("/api/music/pieces/nope")).json()["detail"]["code"] == "not_found"
        p = (await c.http.get("/api/music/pieces/rocky")).json()
        assert [x["id"] for x in p["sheets"]] == [pub_id] and p["private"] is False
        assert (await c.http.get(f"/api/music/sheets/{solo_id}/pages/1.png")).status_code == 404
        # admin : tout voir, avec le bandeau « privé »
        h = c.as_(admin)
        p = (await h.get("/api/music/pieces/secret")).json()
        assert p["private"] is True and p["admin"] is True and p["sheets"][0]["published"] is False
        assert p["sheets"][0]["pages_full"][0].endswith(f"/sheets/{solo_id}/clear/1.png")
        # don à fan@t.dev
        r = await h.post(f"/api/admin/music/sheets/{solo_id}/grant", json={"email": "Fan@T.dev"})
        assert r.status_code == 200 and r.json()["has_account"] is True and r.json()["emailed"] is True, r.text
        assert (await h.post(f"/api/admin/music/sheets/{solo_id}/grant", json={"email": "fan@t.dev"})).status_code == 409
        owners = (await h.get(f"/api/admin/music/sheets/{solo_id}/owners")).json()["owners"]
        assert len(owners) == 1 and owners[0]["source"] == "grant" and owners[0]["email"] == "fan@t.dev"
        listed = {s["id"]: s for s in (await h.get("/api/admin/music/sheets?limit=10")).json()["sheets"]}
        assert listed[solo_id]["owners"] == 1 and listed[solo_id]["sales"] == 0  # un don n'est pas une vente
        assert (await h.get("/api/admin/music/overview")).json()["orders"]["paid"] == 0
        order_id = owners[0]["order_id"]
        # le fan voit la fiche privée, ses pages nettes, et la retrouve dans « Mes partitions »
        h = c.as_(fan)
        p = (await h.get("/api/music/pieces/secret")).json()
        assert p["private"] is True and p["admin"] is False and p["sheets"][0]["owned"] is True
        assert [s["sheet_id"] for s in (await h.get("/api/music/account")).json()["sheets"]] == [solo_id]
        p = (await h.get("/api/music/pieces/rocky")).json()
        assert [x["id"] for x in p["sheets"]] == [pub_id]  # privée non possédée : toujours cachée
        # une partition privée ne s'achète pas
        r = await c.http.post("/api/music/quote", json={"sheet_ids": [priv_id]})
        assert r.status_code != 200 or not r.json().get("lines"), r.text
        # retrait du don : plus d'accès
        h = c.as_(admin)
        assert (await h.delete(f"/api/admin/music/sheets/{solo_id}/grant/{order_id}")).json()["revoked"] is True
        h = c.as_(fan)
        assert (await h.get("/api/music/pieces/secret")).status_code == 404
    assert any(m["to"] == [fan_email] for m in music)


def test_preview_cut_follows_the_audio_excerpt():
    assert ms.preview_cut(None, 3) is None
    assert abs(ms.preview_cut([[1, 0, 0.5, 0.1, 0.2], [20, 0, 0.5, 0.3, 0.4], [30, 0, 0.5, 0.6, 0.7]], 3) - 0.412) < 1e-9
    assert ms.preview_cut([[1, 0, 0.5, 0.1, 0.2], [24, 1, 0.5, 0.1, 0.2]], 3) == 1.0  # l'extrait atteint la page 2
    assert ms.preview_cut([[1, 0, 0.5, 0.1, 0.2], [20, 0, 0.5, 0.7, 0.8]], 1) == 0.5  # une seule page : la moitié au plus
    assert ms.preview_cut([[30, 0, 0.5, 0.1, 0.2]], 3) == 0.2  # rien dans l'extrait : le haut seulement


async def test_tracked_links_events_orders_and_admin(pg_session, music, monkeypatch):
    monkeypatch.setattr(settings, "MOCK_BILLING", True)
    v = await _sheet(pg_session, "gh/t")
    admin = await _user(pg_session, "boss2@t.dev", is_superadmin=True)
    await pg_session.commit()
    vid = v.id
    async with Client(pg_session) as c:
        auth = {"Authorization": f"Bearer {TOKEN}"}
        r = await c.http.post("/api/music/ingest/links", json=[{"code": "ab12cd34", "instagram": "@fan.name", "source": "sheet_dm",
                                                                 "sheet_ref": "gh/t"}], headers=auth)
        assert r.json()["saved"] == 1
        assert (await c.http.post("/api/music/ingest/links", json=[])).status_code in (401, 503)
        ev = {"code": "ab12cd34", "visit": "v1visit1", "events": [
            {"kind": "landing", "path": "/s/swan-lake"}, {"kind": "play", "path": "/s/swan-lake", "data": {"instrument": "violon"}},
            {"kind": "BAD-KIND"}]}
        assert (await c.http.post("/api/music/track", json=ev)).status_code == 204
        assert (await c.http.post("/api/music/track", json={**ev, "code": "../x"})).status_code == 422
        r = await c.http.post("/api/music/checkout", json={"sheet_ids": [vid], "consent": True, "email": "f@x.dev", "track": "ab12cd34"})
        assert r.status_code == 200, r.text
        h = c.as_(admin)
        t = (await h.get("/api/admin/music/tracking")).json()
        row = t["rows"][0]
        assert row["code"] == "ab12cd34" and row["instagram"] == "fan.name" and row["kinds"] == {"landing": 1, "play": 1}
        assert row["orders"] == 1 and t["links_sent"] == 1 and t["links_with_visits"] == 1
        d = (await h.get("/api/admin/music/tracking/ab12cd34")).json()
        assert [e["kind"] for e in d["events"]] == ["landing", "play"] and d["orders"][0]["status"] == "paid"
        # code promo INSTA20 : créé par la migration en production ; ici, simple vérification du devis -20 %
        from src.models.music import MusicPromoCode
        pg_session.add(MusicPromoCode(code="INSTA20", kind="percent", value=20, active=True))
        await pg_session.commit()
        q = (await c.http.post("/api/music/quote", json={"sheet_ids": [vid], "promo_code": "insta20"})).json()
        assert q["total_cents"] == 160  # 1,99 € - 20 % (réduction arrondie au centime inférieur)
