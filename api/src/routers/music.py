"""Boutique de partitions — surface publique (music.chapote.fr) et envoi des partitions.

Le site music.chapote.fr (conteneur `music`) appelle ces routes sur la MÊME
origine : son nginx relaie /api/music/* vers l'API. Aucun compte acheteur.

Public :
- GET  /api/music/catalog                 morceaux en vente (regroupés par morceau)
- GET  /api/music/pieces/{slug}           un morceau et ses partitions en vente
- GET  /api/music/sheets/{id}/pages/{n}   aperçu : page 1 nette, pages suivantes floutées
- GET  /api/music/sheets/{id}/cover.jpg   couverture de la vidéo
- POST /api/music/quote                   prix calculé par le back (lot, code promo)
- POST /api/music/checkout                commande + Stripe Checkout (ou gratuite)
- GET  /api/music/orders/{public_id}      état, liens de téléchargement une fois payée
- GET  /api/music/download/{order}/{item} le PDF (clé de la commande)
- POST /api/music/stripe/webhook          webhook Stripe DÉDIÉ (secret propre)

Production (Bearer MUSIC_INGEST_TOKEN) :
- POST /api/music/ingest                  crée / met à jour une partition (PDF + couverture)
- GET  /api/music/ingest/state            état d'une partition (en vente ? lien ?)
"""
from __future__ import annotations

import hmac
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.time import utcnow
from src.models.music import (
    ORDER_EXPIRED,
    ORDER_FAILED,
    ORDER_PAID,
    ORDER_PENDING,
    MusicOrder,
    MusicOrderItem,
    MusicSheet,
)
from src.services import music_service as ms
from src.services import stripe_service
from src.services.stripe_service import StripeError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music", tags=["music"])


def _err(exc: ms.MusicError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": exc.message})


# --------------------------------------------------------------------------
# Catalogue
# --------------------------------------------------------------------------

def _sheet_public(s: MusicSheet, st) -> dict:
    return {
        "id": s.id,
        "instrument": s.instrument,
        "instrument_label": s.instrument_label,
        "pages": s.pages,
        "price_cents": ms.sheet_price(s, st),
        "title": s.title,
        "reel_url": s.reel_url,
        "released_at": s.released_at.isoformat() + "Z" if s.released_at else None,
        "preview": f"/api/music/sheets/{s.id}/pages/1.png",
        "pages_preview": [f"/api/music/sheets/{s.id}/pages/{n}.{'png' if n == 1 else 'jpg'}"
                          for n in range(1, s.pages + 1)],
        "cover": f"/api/music/sheets/{s.id}/cover.jpg" if s.has_cover else None,
    }


def _pieces(sheets: list[MusicSheet], st) -> list[dict]:
    pieces: dict[str, dict] = {}
    now = utcnow()
    for s in sheets:
        p = pieces.get(s.piece_slug)
        if p is None:
            p = pieces[s.piece_slug] = {
                "slug": s.piece_slug, "title": s.piece_title, "composer": s.composer,
                "public_domain": s.public_domain, "sheets": [], "_latest": None,
            }
        p["sheets"].append(_sheet_public(s, st))
        rel = s.released_at or s.created_at
        if p["_latest"] is None or rel > p["_latest"]:
            p["_latest"] = rel
    out = []
    for p in pieces.values():
        latest = p.pop("_latest")
        p["sheets"].sort(key=lambda x: x["instrument_label"])
        p["from_cents"] = min(x["price_cents"] for x in p["sheets"])
        p["is_new"] = bool(latest and now - latest < timedelta(days=ms.NEW_DAYS))
        p["latest"] = latest.isoformat() + "Z" if latest else None
        p["cover"] = next((x["cover"] for x in p["sheets"] if x["cover"]), None)
        out.append(p)
    out.sort(key=lambda p: p["latest"] or "", reverse=True)
    return out


@router.get("/catalog")
async def catalog(instrument: Optional[str] = None, q: Optional[str] = None,
                  db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    stmt = select(MusicSheet).where(MusicSheet.published.is_(True))
    if q:
        like = f"%{q.strip()[:80]}%"
        stmt = stmt.where(or_(MusicSheet.piece_title.ilike(like), MusicSheet.composer.ilike(like),
                              MusicSheet.title.ilike(like)))
    sheets = (await db.execute(stmt)).scalars().all()
    pieces = _pieces(list(sheets), st)
    if instrument:
        pieces = [p for p in pieces if any(x["instrument"] == instrument for x in p["sheets"])]
    instruments: dict[str, str] = {}
    for s in sheets:
        instruments[s.instrument] = s.instrument_label
    return {
        "pieces": pieces,
        "instruments": [{"key": k, "label": v} for k, v in sorted(instruments.items(), key=lambda kv: kv[1])],
        "pricing": {"unit_cents": st.unit_price_cents, "bundle_cents": st.bundle_price_cents, "currency": st.currency},
    }


@router.get("/pieces/{slug}")
async def piece(slug: str, db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    sheets = (await db.execute(select(MusicSheet).where(
        MusicSheet.piece_slug == slug, MusicSheet.published.is_(True)))).scalars().all()
    if not sheets:
        raise HTTPException(404, {"code": "not_found", "message": "This piece is not available."})
    p = _pieces(list(sheets), st)[0]
    p["pricing"] = {"unit_cents": st.unit_price_cents, "bundle_cents": st.bundle_price_cents, "currency": st.currency}
    return p


async def _published_sheet(db: AsyncSession, sheet_id: int) -> MusicSheet:
    s = await db.get(MusicSheet, sheet_id)
    if s is None or not s.published:
        raise HTTPException(404, "Introuvable")
    return s


@router.get("/sheets/{sheet_id}/pages/{page}.{ext}")
async def sheet_page(sheet_id: int, page: int, ext: str, db: AsyncSession = Depends(get_db)):
    s = await _published_sheet(db, sheet_id)
    if page < 1 or page > s.pages or ext != ("png" if page == 1 else "jpg"):
        raise HTTPException(404, "Introuvable")
    path = ms.page_path(s.id, page)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="image/png" if page == 1 else "image/jpeg",
                        headers={"Cache-Control": "public, max-age=3600"})


@router.get("/sheets/{sheet_id}/cover.jpg")
async def sheet_cover(sheet_id: int, db: AsyncSession = Depends(get_db)):
    s = await _published_sheet(db, sheet_id)
    path = ms.cover_path(s.id)
    if not s.has_cover or not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})


# --------------------------------------------------------------------------
# Prix et commande
# --------------------------------------------------------------------------

class QuoteIn(BaseModel):
    sheet_ids: list[int] = Field(..., min_length=1, max_length=50)
    promo_code: Optional[str] = Field(None, max_length=40)


@router.post("/quote")
async def post_quote(body: QuoteIn, db: AsyncSession = Depends(get_db)):
    try:
        q = await ms.quote(db, body.sheet_ids, body.promo_code)
    except ms.MusicError as exc:
        raise _err(exc)
    return q.as_dict()


class CheckoutIn(QuoteIn):
    email: Optional[EmailStr] = None
    consent: bool = False
    lang: str = Field("en", pattern="^(en|fr)$")


@router.post("/checkout")
async def checkout(body: CheckoutIn, db: AsyncSession = Depends(get_db)):
    if not body.consent:
        raise HTTPException(400, {"code": "consent_required",
                                  "message": "Please confirm you want immediate access to the PDF."})
    try:
        q = await ms.quote(db, body.sheet_ids, body.promo_code)
    except ms.MusicError as exc:
        raise _err(exc)
    if body.promo_code and q.promo_error:
        raise HTTPException(400, {"code": q.promo_error, "message": "This promo code cannot be used."})
    if 0 < q.total_cents < ms.STRIPE_MIN_CENTS:
        raise HTTPException(400, {"code": "amount_too_low", "message": "The minimum order is 0,50 €."})

    if q.total_cents > 0 and not settings.MOCK_BILLING and not settings.STRIPE_SECRET_KEY:
        raise HTTPException(503, {"code": "payments_off", "message": "Payments are not available right now."})

    order = MusicOrder(
        public_id=uuid.uuid4().hex, status=ORDER_PENDING, email=body.email, lang=body.lang,
        subtotal_cents=q.subtotal_cents, discount_cents=q.discount_cents, amount_cents=q.total_cents,
        currency=q.currency, promo_code_id=q.promo.id if q.promo else None,
        promo_code=q.promo.code if q.promo else None, consent_at=utcnow(),
    )
    db.add(order)
    await db.flush()
    items = []
    for line in q.lines:
        it = MusicOrderItem(order_id=order.id, sheet_id=line.sheet.id, price_cents=line.price_cents,
                            label=f"{line.sheet.piece_title} — {line.sheet.instrument_label}"[:500])
        db.add(it)
        items.append(it)
    await db.flush()

    # Gratuit (code 100 %) ou paiements simulés (dev/e2e) : livrée tout de suite.
    if q.total_cents == 0 or settings.MOCK_BILLING:
        await ms.mark_paid(db, order)
        await db.commit()
        await ms.deliver(db, order)
        await db.commit()
        return {"order": order.public_id, "redirect": ms.thanks_url(order)}

    base = settings.MUSIC_URL.rstrip("/")
    slug = q.lines[0].sheet.piece_slug
    data: dict[str, str] = {
        "mode": "payment",
        "success_url": f"{base}/thanks?order={order.public_id}&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/s/{slug}",
        "locale": body.lang,
        "metadata[music_order]": order.public_id,
        "payment_intent_data[metadata][music_order]": order.public_id,
        "payment_intent_data[description]": f"Ghost Hands sheets — order {order.public_id[:8]}",
    }
    if body.email:
        data["customer_email"] = str(body.email)
    if any(i.price_cents <= 0 for i in items):
        # Stripe refuse les lignes à 0 : une seule ligne pour toute la commande.
        data.update({
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": q.currency,
            "line_items[0][price_data][unit_amount]": str(q.total_cents),
            "line_items[0][price_data][product_data][name]": f"Sheet music ({len(items)})",
        })
    else:
        for n, it in enumerate(items):
            data.update({
                f"line_items[{n}][quantity]": "1",
                f"line_items[{n}][price_data][currency]": q.currency,
                f"line_items[{n}][price_data][unit_amount]": str(it.price_cents),
                f"line_items[{n}][price_data][product_data][name]": f"{it.label} (PDF)",
            })
    try:
        session = await stripe_service.create_payment_checkout(data)
    except StripeError as exc:
        await db.rollback()
        raise HTTPException(502, {"code": "stripe_error", "message": str(exc)})
    order.stripe_session_id = session["id"]
    await db.commit()
    return {"order": order.public_id, "redirect": session["url"]}


async def _order_by_public_id(db: AsyncSession, public_id: str) -> MusicOrder:
    order = (await db.execute(select(MusicOrder).where(MusicOrder.public_id == public_id))).scalar_one_or_none()
    if order is None:
        raise HTTPException(404, {"code": "not_found", "message": "Order not found."})
    return order


async def _sync_from_stripe(db: AsyncSession, order: MusicOrder) -> None:
    """Webhook en retard : relit la session Stripe et confirme le paiement si besoin."""
    if order.status != ORDER_PENDING or not order.stripe_session_id or settings.MOCK_BILLING:
        return
    try:
        session = await stripe_service.retrieve_checkout_session(order.stripe_session_id)
    except StripeError:
        return
    await _apply_session(db, order, session)


async def _apply_session(db: AsyncSession, order: MusicOrder, session: dict) -> None:
    status = session.get("status")
    if session.get("payment_status") == "paid":
        email = (session.get("customer_details") or {}).get("email") or session.get("customer_email")
        just_paid = await ms.mark_paid(db, order, email=email, payment_intent=session.get("payment_intent"))
        await db.commit()
        if just_paid:
            await ms.deliver(db, order)
            await db.commit()
    elif status == "expired" and order.status == ORDER_PENDING:
        order.status = ORDER_EXPIRED
        await db.commit()


@router.get("/orders/{public_id}")
async def get_order(public_id: str, k: Optional[str] = None, session_id: Optional[str] = None,
                    db: AsyncSession = Depends(get_db)):
    order = await _order_by_public_id(db, public_id)
    by_session = bool(session_id) and order.stripe_session_id is not None and hmac.compare_digest(
        order.stripe_session_id, session_id)
    if not (ms.check_key(public_id, k) or by_session):
        raise HTTPException(404, {"code": "not_found", "message": "Order not found."})
    if by_session:
        await _sync_from_stripe(db, order)
    items = await ms.order_items(db, order)
    valid = ms.links_valid(order)
    email = order.email or ""
    masked = (email[0] + "•••" + email[email.index("@"):]) if "@" in email else None
    return {
        "order": order.public_id,
        "status": order.status,
        "key": ms.download_key(order.public_id) if order.status == ORDER_PAID else None,
        "email": masked,
        "amount_cents": order.amount_cents,
        "currency": order.currency,
        "links_valid": valid,
        "items": [{
            "id": it.id, "piece_title": s.piece_title, "piece_slug": s.piece_slug,
            "instrument_label": s.instrument_label, "pages": s.pages, "price_cents": it.price_cents,
            "download": (f"/api/music/download/{order.public_id}/{it.id}?k={ms.download_key(order.public_id)}"
                         if valid else None),
        } for it, s in items],
    }


@router.get("/download/{public_id}/{item_id}")
async def download(public_id: str, item_id: int, k: str = Query(...), db: AsyncSession = Depends(get_db)):
    if not ms.check_key(public_id, k):
        raise HTTPException(404, "Introuvable")
    order = await _order_by_public_id(db, public_id)
    if not ms.links_valid(order):
        raise HTTPException(410, {"code": "link_expired", "message": "This link is no longer valid."})
    item = await db.get(MusicOrderItem, item_id)
    if item is None or item.order_id != order.id:
        raise HTTPException(404, "Introuvable")
    sheet = await db.get(MusicSheet, item.sheet_id)
    path = ms.pdf_path(item.sheet_id)
    if sheet is None or not path.exists():
        raise HTTPException(404, "Introuvable")
    item.downloads += 1
    await db.commit()
    name = f"{sheet.piece_slug}-{ms.slugify(sheet.instrument_label)}.pdf"
    return FileResponse(path, media_type="application/pdf", filename=name)


# --------------------------------------------------------------------------
# Webhook Stripe de la boutique (endpoint et secret DÉDIÉS)
# --------------------------------------------------------------------------

@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    secret = settings.STRIPE_MUSIC_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(503, "Webhook boutique non configuré")
    raw = await request.body()
    try:
        event = stripe_service.verify_webhook_signature(raw, request.headers.get("stripe-signature"), secret=secret)
    except StripeError as exc:
        raise HTTPException(400, str(exc))
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    public_id = (obj.get("metadata") or {}).get("music_order")
    if not etype.startswith("checkout.session.") or not public_id:
        return {"received": True, "ignored": True}
    order = (await db.execute(select(MusicOrder).where(MusicOrder.public_id == public_id))).scalar_one_or_none()
    if order is None or (order.stripe_session_id and order.stripe_session_id != obj.get("id")):
        return {"received": True, "ignored": True}
    if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"):
        await _apply_session(db, order, obj)
    elif etype == "checkout.session.async_payment_failed" and order.status == ORDER_PENDING:
        order.status = ORDER_FAILED
        await db.commit()
    return {"received": True}


# --------------------------------------------------------------------------
# Envoi des partitions par la chaîne de production
# --------------------------------------------------------------------------

def _require_ingest(authorization: Optional[str] = Header(None)) -> None:
    token = settings.MUSIC_INGEST_TOKEN
    if not token:
        raise HTTPException(503, "Envoi des partitions non configuré")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not given or not hmac.compare_digest(given, token):
        raise HTTPException(401, "Jeton invalide")


def _state(s: MusicSheet) -> dict:
    return {
        "id": s.id, "source_ref": s.source_ref, "published": s.published, "public_domain": s.public_domain,
        "piece_slug": s.piece_slug, "pages": s.pages,
        "url": ms.piece_url(s.piece_slug, s.instrument),
        "preview_url": ms.preview_url(s, 1),
    }


class IngestMeta(BaseModel):
    source_ref: str = Field(..., min_length=3, max_length=200)
    piece_title: str = Field(..., min_length=1, max_length=300)
    composer: Optional[str] = Field(None, max_length=200)
    instrument: str = Field(..., min_length=1, max_length=40)
    instrument_label: Optional[str] = Field(None, max_length=60)
    title: Optional[str] = Field(None, max_length=400)
    rights: Optional[str] = Field(None, max_length=80)
    public_domain: Optional[bool] = None
    reel_url: Optional[str] = Field(None, max_length=500)
    released_at: Optional[datetime] = None
    piece_slug: Optional[str] = Field(None, max_length=160)


@router.post("/ingest", dependencies=[Depends(_require_ingest)])
async def ingest(meta: str = Form(...), pdf: Optional[UploadFile] = File(None),
                 cover: Optional[UploadFile] = File(None), db: AsyncSession = Depends(get_db)):
    try:
        m = IngestMeta(**json.loads(meta))
    except Exception as exc:
        raise HTTPException(422, f"meta invalide : {exc}")
    sheet = (await db.execute(select(MusicSheet).where(MusicSheet.source_ref == m.source_ref))).scalar_one_or_none()
    pdf_bytes = await pdf.read() if pdf is not None else None
    cover_bytes = await cover.read() if cover is not None else None
    if sheet is None and not pdf_bytes:
        raise HTTPException(422, "PDF obligatoire pour une nouvelle partition")
    public_domain = m.public_domain if m.public_domain is not None else (
        (m.rights or "").strip().lower() == "domaine public")
    released = m.released_at.replace(tzinfo=None) - (m.released_at.utcoffset() or timedelta(0)) \
        if m.released_at and m.released_at.tzinfo else m.released_at
    created = sheet is None
    if created:
        sheet = MusicSheet(source_ref=m.source_ref, published=public_domain,
                           published_at=utcnow() if public_domain else None, pages=1, has_cover=False)
        db.add(sheet)
    sheet.piece_title = m.piece_title.strip()
    sheet.piece_slug = ms.slugify(m.piece_slug or m.piece_title)
    sheet.composer = (m.composer or "").strip() or None
    sheet.instrument = m.instrument.strip().lower()
    sheet.instrument_label = m.instrument_label or ms.instrument_label(sheet.instrument)
    sheet.title = (m.title or m.piece_title).strip()
    sheet.rights = m.rights
    sheet.public_domain = public_domain
    sheet.reel_url = m.reel_url or sheet.reel_url
    sheet.released_at = released or sheet.released_at
    await db.flush()
    try:
        pages = ms.save_sheet_files(sheet.id, pdf_bytes, cover_bytes)
    except ms.MusicError as exc:
        await db.rollback()
        raise _err(exc)
    if pages:
        sheet.pages = pages
    if cover_bytes and ms.cover_path(sheet.id).exists():
        sheet.has_cover = True
    await db.commit()
    return {"created": created, **_state(sheet)}


@router.get("/ingest/state", dependencies=[Depends(_require_ingest)])
async def ingest_state(source_ref: str, db: AsyncSession = Depends(get_db)):
    sheet = (await db.execute(select(MusicSheet).where(MusicSheet.source_ref == source_ref))).scalar_one_or_none()
    if sheet is None:
        raise HTTPException(404, "Inconnue")
    return _state(sheet)
