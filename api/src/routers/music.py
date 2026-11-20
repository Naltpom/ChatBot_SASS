"""Boutique de partitions — surface publique (music.chapote.fr) et envoi des partitions.

Le site music.chapote.fr (conteneur `music`) appelle ces routes sur la MÊME
origine : son nginx relaie /api/music/* vers l'API. Aucun compte acheteur.

Public :
- GET  /api/music/rates                  taux BCE du jour (équivalent indicatif)
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
import re
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
from src.core.security import get_current_user, get_optional_user
from src.core.time import utcnow
from src.models.music import (
    ORDER_EXPIRED,
    ORDER_FAILED,
    ORDER_PAID,
    ORDER_PENDING,
    MusicOrder,
    MusicOrderItem,
    MusicReview,
    MusicSheet,
)
from src.models.user import User
from src.services.user_apps import record_app
from src.services import music_service as ms
from src.services import fx_rates, stripe_service
from src.services.stripe_service import StripeError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music", tags=["music"])


def _err(exc: ms.MusicError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": exc.message})


# --------------------------------------------------------------------------
# Catalogue
# --------------------------------------------------------------------------

def _sheet_public(s: MusicSheet, st, stats: Optional[dict] = None) -> dict:
    stats = stats or {}
    return {
        "id": s.id,
        "likes": s.instagram_likes,
        "downloads": stats.get("downloads", 0),
        "rating": stats.get("rating"),
        "reviews": stats.get("reviews", 0),
        "has_notes": s.has_notes,
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


def _pieces(sheets: list[MusicSheet], st, stats: Optional[dict] = None) -> list[dict]:
    pieces: dict[str, dict] = {}
    now = utcnow()
    stats = stats or {}
    for s in sheets:
        p = pieces.get(s.piece_slug)
        if p is None:
            p = pieces[s.piece_slug] = {
                "slug": s.piece_slug, "title": s.piece_title, "composer": s.composer,
                "public_domain": s.public_domain, "sheets": [], "_latest": None,
            }
        p["sheets"].append(_sheet_public(s, st, stats.get(s.id)))
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
        likes = [x["likes"] for x in p["sheets"] if x["likes"] is not None]
        p["likes"] = sum(likes) if likes else None
        p["downloads"] = sum(x["downloads"] for x in p["sheets"])
        n = sum(x["reviews"] for x in p["sheets"])
        p["reviews"] = n
        p["rating"] = (round(sum((x["rating"] or 0) * x["reviews"] for x in p["sheets"]) / n, 1) if n else None)
        out.append(p)
    out.sort(key=lambda p: p["latest"] or "", reverse=True)
    return out


async def _sheet_stats(db: AsyncSession, ids: list[int]) -> dict[int, dict]:
    """Téléchargements réels (commandes payées) et note moyenne des avis visibles, par partition."""
    if not ids:
        return {}
    out: dict[int, dict] = {i: {"downloads": 0, "rating": None, "reviews": 0} for i in ids}
    rows = (await db.execute(
        select(MusicOrderItem.sheet_id, func.coalesce(func.sum(MusicOrderItem.downloads), 0))
        .join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrder.status == ORDER_PAID, MusicOrderItem.sheet_id.in_(ids))
        .group_by(MusicOrderItem.sheet_id))).all()
    for sid, n in rows:
        out[sid]["downloads"] = int(n)
    rows = (await db.execute(
        select(MusicReview.sheet_id, func.avg(MusicReview.rating), func.count(MusicReview.id))
        .where(MusicReview.sheet_id.in_(ids), MusicReview.hidden.is_(False))
        .group_by(MusicReview.sheet_id))).all()
    for sid, avg, n in rows:
        out[sid]["rating"] = round(float(avg), 1)
        out[sid]["reviews"] = int(n)
    return out


@router.get("/config")
async def music_config():
    """Réglages publics du site (connexion Google si configurée)."""
    return {"google_client_id": settings.GOOGLE_CLIENT_ID or None}


@router.get("/rates")
async def music_rates():
    """Taux BCE du jour (base EUR) pour l'équivalent indicatif des prix."""
    data = await fx_rates.get_rates()
    return JSONResponse(data, headers={"Cache-Control": "public, max-age=3600"})


@router.get("/catalog")
async def catalog(instrument: Optional[str] = None, q: Optional[str] = None,
                  offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=60),
                  sort: str = Query("new", pattern="^(new|popular|az)$"),
                  db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    stmt = select(MusicSheet).where(MusicSheet.published.is_(True))
    if q:
        like = f"%{q.strip()[:80]}%"
        stmt = stmt.where(or_(MusicSheet.piece_title.ilike(like), MusicSheet.composer.ilike(like),
                              MusicSheet.title.ilike(like)))
    sheets = (await db.execute(stmt)).scalars().all()
    pieces = _pieces(list(sheets), st, await _sheet_stats(db, [s.id for s in sheets]))
    if instrument:
        pieces = [p for p in pieces if any(x["instrument"] == instrument for x in p["sheets"])]
    if sort == "popular":
        pieces.sort(key=lambda p: (-(p["likes"] or 0), -(p["downloads"] or 0)))
    elif sort == "az":
        pieces.sort(key=lambda p: p["title"].lower())
    instruments: dict[str, str] = {}
    all_published = (await db.execute(select(MusicSheet.instrument, MusicSheet.instrument_label)
                                      .where(MusicSheet.published.is_(True)).distinct())).all()
    for key, label in all_published:
        instruments[key] = label
    total = len(pieces)
    page = pieces[offset:offset + limit]
    return {
        "pieces": page,
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
        "instruments": [{"key": k, "label": v} for k, v in sorted(instruments.items(), key=lambda kv: kv[1])],
        "pricing": {"unit_cents": st.unit_price_cents, "bundle_cents": st.bundle_price_cents, "currency": st.currency},
    }


@router.get("/pieces/{slug}")
async def piece(slug: str, db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(get_optional_user)):
    """Toutes les fiches existent ; une partition privée (non diffusée) ne se voit que par qui l'a (achat ou don)
    et par un administrateur. Sinon 404 `private` : le site renvoie au catalogue."""
    st = await ms.get_settings(db)
    sheets = (await db.execute(select(MusicSheet).where(MusicSheet.piece_slug == slug))).scalars().all()
    if not sheets:
        raise HTTPException(404, {"code": "not_found", "message": "This piece is not available."})
    admin = _is_admin(user)
    owned = await _owned_ids(db, user, [s.id for s in sheets])
    visible = [s for s in sheets if s.published or admin or s.id in owned]
    if not visible:
        raise HTTPException(404, {"code": "private", "message": "This piece is not available."})
    p = _pieces(visible, st, await _sheet_stats(db, [s.id for s in visible]))[0]
    by_id = {s.id: s for s in visible}
    for x in p["sheets"]:
        sh = by_id[x["id"]]
        x["published"] = sh.published
        x["owned"] = sh.id in owned
        if sh.id in owned or admin:  # pages nettes pour qui a la partition (et l'admin)
            x["pages_full"] = [f"/api/music/sheets/{sh.id}/clear/{n}.png" for n in range(1, sh.pages + 1)]
    p["private"] = any(not s.published for s in visible)
    p["admin"] = admin
    p["pricing"] = {"unit_cents": st.unit_price_cents, "bundle_cents": st.bundle_price_cents, "currency": st.currency}
    return p


def _is_admin(user: Optional[User]) -> bool:
    return bool(user is not None and getattr(user, "is_superadmin", False))


async def _owned_ids(db: AsyncSession, user: Optional[User], sheet_ids: list[int]) -> set[int]:
    """Partitions (parmi sheet_ids) que le compte a payées ou reçues (commande payée à son compte ou à son e-mail)."""
    if user is None or not sheet_ids:
        return set()
    rows = (await db.execute(
        select(MusicOrderItem.sheet_id).join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrderItem.sheet_id.in_(sheet_ids), MusicOrder.status == ORDER_PAID,
               or_(MusicOrder.user_id == user.id, func.lower(MusicOrder.email) == user.email.lower())))).all()
    return {r[0] for r in rows}


async def _visible_sheet(db: AsyncSession, sheet_id: int, user: Optional[User] = None,
                         order: Optional[str] = None, key: Optional[str] = None) -> MusicSheet:
    """La partition si elle est diffusée, ou privée mais possédée (compte, ou commande + clé) ou vue par un admin."""
    s = await db.get(MusicSheet, sheet_id)
    if s is None:
        raise HTTPException(404, "Introuvable")
    if not s.published and not _is_admin(user) and not await _owns_sheet(db, s.id, user=user, order=order, key=key):
        raise HTTPException(404, "Introuvable")
    return s


async def _published_sheet(db: AsyncSession, sheet_id: int) -> MusicSheet:
    s = await db.get(MusicSheet, sheet_id)
    if s is None or not s.published:
        raise HTTPException(404, "Introuvable")
    return s


@router.get("/sheets/{sheet_id}/pages/{page}.{ext}")
async def sheet_page(sheet_id: int, page: int, ext: str, db: AsyncSession = Depends(get_db),
                     user: Optional[User] = Depends(get_optional_user)):
    s = await _visible_sheet(db, sheet_id, user)
    if page < 1 or page > s.pages or ext != ("png" if page == 1 else "jpg"):
        raise HTTPException(404, "Introuvable")
    path = ms.page_path(s.id, page)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="image/png" if page == 1 else "image/jpeg",
                        headers={"Cache-Control": f"{'public' if s.published else 'private'}, max-age=3600"})


@router.get("/sheets/{sheet_id}/cover.jpg")
async def sheet_cover(sheet_id: int, db: AsyncSession = Depends(get_db),
                      user: Optional[User] = Depends(get_optional_user)):
    s = await _visible_sheet(db, sheet_id, user)
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
    lang: str = Field("en", pattern="^(en|fr|es|ru)$")
    instagram: Optional[str] = Field(None, max_length=60)


IG_USERNAME = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def _clean_instagram(raw: Optional[str]) -> Optional[str]:
    """Pseudo Instagram facultatif : « @nom », « instagram.com/nom/ » ou « nom » -> « nom »."""
    v = (raw or "").strip()
    if not v:
        return None
    v = re.sub(r"^(https?://)?(www\.)?instagram\.com/", "", v, flags=re.I).strip("/").lstrip("@").lower()
    if not IG_USERNAME.match(v):
        raise HTTPException(400, {"code": "instagram_invalid", "message": "Invalid Instagram username."})
    return v


@router.post("/checkout")
async def checkout(body: CheckoutIn, db: AsyncSession = Depends(get_db),
                   user: Optional[User] = Depends(get_optional_user)):
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

    instagram = _clean_instagram(body.instagram)
    email = str(body.email) if body.email else (user.email if user else None)
    order = MusicOrder(
        public_id=uuid.uuid4().hex, status=ORDER_PENDING, email=email, lang=body.lang,
        user_id=user.id if user else None, instagram_username=instagram,
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
    if email:
        data["customer_email"] = email
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
    if settings.MUSIC_ADAPTIVE_PRICING:
        # Stripe affiche et encaisse le prix dans la devise de l'acheteur (taux garanti
        # 24 h, frais de conversion à sa charge) ; on reçoit toujours des euros.
        data["adaptive_pricing[enabled]"] = "true"
    try:
        try:
            session = await stripe_service.create_payment_checkout(data)
        except StripeError as exc:
            if "adaptive_pricing[enabled]" not in data or "adaptive" not in str(exc).lower():
                raise
            logger.warning("Adaptive Pricing refusé par Stripe, paiement en euros : %s", exc)
            data.pop("adaptive_pricing[enabled]")
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
            "id": it.id, "sheet_id": s.id, "has_notes": s.has_notes, "instrument": s.instrument,
            "piece_title": s.piece_title, "piece_slug": s.piece_slug,
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
                 cover: Optional[UploadFile] = File(None), notes: Optional[UploadFile] = File(None),
                 cursor: Optional[UploadFile] = File(None),
                 db: AsyncSession = Depends(get_db)):
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
    if notes is not None:
        try:
            sheet.has_notes = ms.save_notes(sheet.id, json.loads((await notes.read()).decode("utf-8")))
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(422, f"notes.json invalide : {exc}")
    if cursor is not None:
        try:
            ms.save_cursor(sheet.id, json.loads((await cursor.read()).decode("utf-8")), sheet.pages)
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(422, f"curseur.json invalide : {exc}")
    elif pdf is not None:
        ms.save_cursor(sheet.id, None)
    await db.commit()
    return {"created": created, **_state(sheet)}


@router.get("/ingest/state", dependencies=[Depends(_require_ingest)])
async def ingest_state(source_ref: str, db: AsyncSession = Depends(get_db)):
    sheet = (await db.execute(select(MusicSheet).where(MusicSheet.source_ref == source_ref))).scalar_one_or_none()
    if sheet is None:
        raise HTTPException(404, "Inconnue")
    return _state(sheet)


# --------------------------------------------------------------------------
# Chiffres Instagram (envoyés par la production) et envoi Instagram des commandes
# --------------------------------------------------------------------------

class StatLine(BaseModel):
    source_ref: str = Field(..., max_length=200)
    likes: Optional[int] = Field(None, ge=0)
    comments: Optional[int] = Field(None, ge=0)


@router.post("/ingest/stats", dependencies=[Depends(_require_ingest)])
async def ingest_stats(lines: list[StatLine], db: AsyncSession = Depends(get_db)):
    refs = {l.source_ref: l for l in lines[:2000]}
    sheets = (await db.execute(select(MusicSheet).where(MusicSheet.source_ref.in_(refs)))).scalars().all()
    now = utcnow()
    for sh in sheets:
        l = refs[sh.source_ref]
        sh.instagram_likes, sh.instagram_comments, sh.stats_updated_at = l.likes, l.comments, now
    await db.commit()
    return {"updated": len(sheets)}


@router.get("/ingest/instagram-pending", dependencies=[Depends(_require_ingest)])
async def instagram_pending(db: AsyncSession = Depends(get_db)):
    """Commandes payées depuis moins de 48 h avec un pseudo Instagram, pas encore traitées."""
    since = utcnow() - timedelta(hours=48)
    orders = (await db.execute(select(MusicOrder).where(
        MusicOrder.status == ORDER_PAID, MusicOrder.instagram_username.is_not(None),
        MusicOrder.instagram_status.is_(None), MusicOrder.paid_at >= since))).scalars().all()
    out = []
    for o in orders:
        items = await ms.order_items(db, o)
        out.append({"order": o.public_id, "username": o.instagram_username, "lang": o.lang,
                    "paid_at": o.paid_at.isoformat() + "Z",
                    "items": [{"source_ref": sh.source_ref, "title": f"{sh.piece_title} — {sh.instrument_label}",
                               "download_url": ms.download_url(o, it)} for it, sh in items]})
    return {"orders": out}


class InstagramDone(BaseModel):
    order: str = Field(..., max_length=40)
    status: str = Field(..., pattern="^(sent|no_conversation|window_closed|error)$")


@router.post("/ingest/instagram-done", dependencies=[Depends(_require_ingest)])
async def instagram_done(body: InstagramDone, db: AsyncSession = Depends(get_db)):
    o = (await db.execute(select(MusicOrder).where(MusicOrder.public_id == body.order))).scalar_one_or_none()
    if o is None:
        raise HTTPException(404, "Commande inconnue")
    o.instagram_status = body.status
    if body.status == "sent":
        o.instagram_sent_at = utcnow()
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# Lecteur : notes horodatées (aperçu de PREVIEW_SECONDS, complet pour l'acheteur)
# --------------------------------------------------------------------------

async def _owns_sheet(db: AsyncSession, sheet_id: int, *, user: Optional[User] = None,
                      order: Optional[str] = None, key: Optional[str] = None) -> bool:
    """Vrai si la commande donnée (clé valide) ou le compte connecté a payé cette partition."""
    stmt = (select(MusicOrderItem.id).join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
            .where(MusicOrderItem.sheet_id == sheet_id, MusicOrder.status == ORDER_PAID))
    if order and ms.check_key(order, key):
        if (await db.execute(stmt.where(MusicOrder.public_id == order))).first():
            return True
    if user is not None:
        cond = or_(MusicOrder.user_id == user.id, func.lower(MusicOrder.email) == user.email.lower())
        if (await db.execute(stmt.where(cond))).first():
            return True
    return False


@router.get("/sheets/{sheet_id}/notes")
async def sheet_notes(sheet_id: int, order: Optional[str] = None, k: Optional[str] = None,
                      db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(get_optional_user)):
    s = await _visible_sheet(db, sheet_id, user, order, k)
    data = ms.load_notes(s.id) if s.has_notes else None
    if data is None:
        raise HTTPException(404, "Pas de notes pour cette partition")
    cursor = ms.load_cursor(s.id)
    if cursor:
        data = {**data, "cursor": cursor}
    full = _is_admin(user) or await _owns_sheet(db, s.id, user=user, order=order, key=k)
    if not full:
        data = ms.preview_notes(data)
    return {**data, "full": full}


@router.get("/sheets/{sheet_id}/clear/{page}.png")
async def clear_page(sheet_id: int, page: int, order: Optional[str] = None, k: Optional[str] = None,
                     db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(get_optional_user)):
    """Page nette (lecteur de l'acheteur) : seulement pour qui a payé la partition."""
    s = await db.get(MusicSheet, sheet_id)
    if s is None or page < 1 or page > s.pages or not (
            _is_admin(user) or await _owns_sheet(db, s.id, user=user, order=order, key=k)):
        raise HTTPException(404, "Introuvable")
    path = ms.clear_page_path(s.id, page)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


# --------------------------------------------------------------------------
# Compte (partagé avec chapote.fr) : mes partitions
# --------------------------------------------------------------------------

@router.get("/account")
async def account(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await record_app(db, user, "music")
    await db.commit()
    rows = (await db.execute(
        select(MusicOrder, MusicOrderItem, MusicSheet)
        .join(MusicOrderItem, MusicOrderItem.order_id == MusicOrder.id)
        .join(MusicSheet, MusicSheet.id == MusicOrderItem.sheet_id)
        .where(MusicOrder.status == ORDER_PAID,
               or_(MusicOrder.user_id == user.id, func.lower(MusicOrder.email) == user.email.lower()))
        .order_by(MusicOrder.paid_at.desc()))).all()
    reviewed = {r.sheet_id: r.rating for r in (await db.execute(
        select(MusicReview).where(MusicReview.user_id == user.id))).scalars()}
    sheets, seen = [], set()
    for o, it, sh in rows:
        if sh.id in seen:
            continue
        seen.add(sh.id)
        sheets.append({
            "sheet_id": sh.id, "piece_slug": sh.piece_slug, "piece_title": sh.piece_title,
            "instrument_label": sh.instrument_label, "pages": sh.pages, "has_notes": sh.has_notes,
            "bought_at": o.paid_at.isoformat() + "Z" if o.paid_at else None,
            "download": (f"/api/music/download/{o.public_id}/{it.id}?k={ms.download_key(o.public_id)}"
                         if ms.links_valid(o) else None),
            "my_rating": reviewed.get(sh.id),
        })
    return {"user": {"name": user.name, "email": user.email, "signup_app": user.signup_app}, "sheets": sheets}


# --------------------------------------------------------------------------
# Avis (acheteurs vérifiés)
# --------------------------------------------------------------------------

def _display_name(u: User) -> str:
    parts = (u.name or "").split()
    if not parts:
        return "—"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


@router.get("/pieces/{slug}/reviews")
async def piece_reviews(slug: str, offset: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50),
                        db: AsyncSession = Depends(get_db)):
    base = (select(MusicReview, MusicSheet, User)
            .join(MusicSheet, MusicSheet.id == MusicReview.sheet_id)
            .join(User, User.id == MusicReview.user_id)
            .where(MusicSheet.piece_slug == slug, MusicSheet.published.is_(True), MusicReview.hidden.is_(False)))
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(MusicReview.updated_at.desc()).offset(offset).limit(limit))).all()
    return {
        "total": int(total),
        "next_offset": offset + limit if offset + limit < total else None,
        "reviews": [{"id": r.id, "rating": r.rating, "comment": r.comment, "author": _display_name(u),
                     "instrument_label": sh.instrument_label, "date": r.updated_at.isoformat() + "Z"}
                    for r, sh, u in rows],
    }


class ReviewIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=2000)


@router.post("/sheets/{sheet_id}/review")
async def post_review(sheet_id: int, body: ReviewIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    s = await _published_sheet(db, sheet_id)
    if not await _owns_sheet(db, s.id, user=user):
        raise HTTPException(403, {"code": "not_a_buyer", "message": "Only buyers can rate this sheet."})
    r = (await db.execute(select(MusicReview).where(MusicReview.sheet_id == s.id,
                                                    MusicReview.user_id == user.id))).scalar_one_or_none()
    comment = (body.comment or "").strip() or None
    if r is None:
        r = MusicReview(sheet_id=s.id, user_id=user.id, rating=body.rating, comment=comment, hidden=False)
        db.add(r)
    else:
        r.rating, r.comment = body.rating, comment
    await record_app(db, user, "music")
    await db.commit()
    return {"id": r.id, "rating": r.rating, "comment": r.comment}
