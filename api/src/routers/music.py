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
import secrets
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
    ORDER_DISPUTED,
    ORDER_EXPIRED,
    ORDER_FAILED,
    ORDER_PAID,
    ORDER_PENDING,
    ORDER_REFUNDED,
    PROMO_TRIAL,
    SUB_ACTIVE_STATES,
    MusicOrder,
    MusicOrderItem,
    MusicReview,
    MusicSheet,
    MusicSubDownload,
    MusicSubscription,
    MusicTrackEvent,
    MusicTrackLink,
)
from src.models.user import User
from src.services.rate_limit import music_limiter, track_limiter
from src.services.user_apps import client_ip, record_app
from src.services import music_service as ms
from src.services import fx_rates, stripe_service
from src.services.stripe_service import StripeError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/music", tags=["music"])


async def _music_user(db: AsyncSession = Depends(get_db),
                      user: Optional[User] = Depends(get_optional_user)) -> Optional[User]:
    """Visiteur éventuellement connecté ; un superadmin sans 2nd facteur (production) n'a pas les droits admin ici."""
    return await _admin_ok(db, user)


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
async def piece(slug: str, db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(_music_user)):
    """Toutes les fiches existent ; une partition privée (non diffusée) ne se voit que par qui l'a (achat ou don)
    et par un administrateur. Sinon 404 `private` : le site renvoie au catalogue."""
    st = await ms.get_settings(db)
    sheets = (await db.execute(select(MusicSheet).where(MusicSheet.piece_slug == slug))).scalars().all()
    if not sheets:
        raise HTTPException(404, {"code": "not_found", "message": "This piece is not available."})
    admin = _is_admin(user)
    owned = await _owned_ids(db, user, [s.id for s in sheets])
    subscribed = await _active_sub(db, user) is not None
    if subscribed:  # abonné : toutes les partitions en vente du morceau sont à lui
        owned |= {s.id for s in sheets if s.published}
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
            x["pdf"] = f"/api/music/sheets/{sh.id}/pdf"
    p["private"] = any(not s.published for s in visible)
    p["subscribed"] = subscribed
    p["admin"] = admin
    p["pricing"] = {"unit_cents": st.unit_price_cents, "bundle_cents": st.bundle_price_cents, "currency": st.currency}
    return p


def _is_admin(user: Optional[User]) -> bool:
    """Administrateur pour la boutique : superadmin, avec en production la même exigence de 2nd facteur que
    l'administration (posée sur l'utilisateur par _admin_ok avant usage)."""
    return bool(user is not None and getattr(user, "is_superadmin", False) and getattr(user, "_music_admin_ok", True))


async def _admin_ok(db: AsyncSession, user: Optional[User]) -> Optional[User]:
    """Marque un superadmin sans 2nd facteur (en production) comme non-admin pour la boutique."""
    if user is not None and getattr(user, "is_superadmin", False) and settings.is_production and settings.TWOFA_ENFORCE_ADMIN:
        from src.core.security import user_has_2fa
        user._music_admin_ok = await user_has_2fa(db, user)
    return user


async def _owned_ids(db: AsyncSession, user: Optional[User], sheet_ids: list[int]) -> set[int]:
    """Partitions (parmi sheet_ids) que le compte a payées ou reçues (commande payée à son compte ou à son e-mail)."""
    if user is None or not sheet_ids:
        return set()
    rows = (await db.execute(
        select(MusicOrderItem.sheet_id).join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrderItem.sheet_id.in_(sheet_ids), MusicOrder.status == ORDER_PAID,
               _mine(user)))).all()
    return {r[0] for r in rows}


def _mine(user: User):
    """Commandes du compte : celles passées connecté, et celles faites sans compte avec la même adresse SEULEMENT si
    l'adresse du compte est vérifiée (sinon n'importe qui s'inscrirait avec l'e-mail d'un acheteur pour voir ses achats)."""
    if getattr(user, "email_verified", False):
        return or_(MusicOrder.user_id == user.id, func.lower(MusicOrder.email) == user.email.lower())
    return MusicOrder.user_id == user.id


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
                     user: Optional[User] = Depends(_music_user)):
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
                      user: Optional[User] = Depends(_music_user)):
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
    promo_codes: list[str] = Field(default_factory=list, max_length=4)  # 2 cumulés au plus


PROMO_ERRORS = {"promo_unknown", "promo_inactive", "promo_expired", "promo_used_up"}  # promo_too_many reste visible


async def _limit(request: Request) -> None:
    """Par IP : empêche de deviner les codes promo en masse (devis avec code, commandes)."""
    if not await music_limiter.check(client_ip(request)):
        raise HTTPException(429, {"code": "rate_limited", "message": "Too many attempts, please try again in a few minutes."})


def _quote_out(q) -> dict:
    d = q.as_dict()
    if d.get("promo_error") in PROMO_ERRORS:  # une seule réponse : ne dit pas si le code existe
        d["promo_error"] = "promo_invalid"
    return d


@router.post("/quote")
async def post_quote(body: QuoteIn, request: Request, db: AsyncSession = Depends(get_db)):
    if body.promo_code or body.promo_codes:
        await _limit(request)
    try:
        q = await ms.quote(db, body.sheet_ids, body.promo_code, body.promo_codes)
    except ms.MusicError as exc:
        raise _err(exc)
    return _quote_out(q)


class CheckoutIn(QuoteIn):
    track: Optional[str] = Field(None, pattern=r"^[a-z0-9]{6,16}$")  # lien d'arrivée (?b=…), si suivi accepté
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
async def checkout(body: CheckoutIn, request: Request, db: AsyncSession = Depends(get_db),
                   user: Optional[User] = Depends(_music_user)):
    await _limit(request)
    if not body.consent:
        raise HTTPException(400, {"code": "consent_required",
                                  "message": "Please confirm you want immediate access to the PDF."})
    try:
        q = await ms.quote(db, body.sheet_ids, body.promo_code, body.promo_codes)
    except ms.MusicError as exc:
        raise _err(exc)
    if (body.promo_code or body.promo_codes) and q.promo_error:
        raise HTTPException(400, {"code": "promo_invalid", "message": "This promo code cannot be used."})
    if 0 < q.total_cents < ms.STRIPE_MIN_CENTS:
        raise HTTPException(400, {"code": "amount_too_low", "message": "The minimum order is 0,50 €."})

    if q.total_cents > 0 and not settings.MOCK_BILLING and not settings.STRIPE_SECRET_KEY:
        raise HTTPException(503, {"code": "payments_off", "message": "Payments are not available right now."})

    instagram = _clean_instagram(body.instagram)
    email = str(body.email) if body.email else (user.email if user else None)
    order = MusicOrder(
        public_id=uuid.uuid4().hex, status=ORDER_PENDING, email=email, lang=body.lang,
        user_id=user.id if user else None, instagram_username=instagram, track_code=body.track,
        subtotal_cents=q.subtotal_cents, discount_cents=q.discount_cents, amount_cents=q.total_cents,
        currency=q.currency, promo_code_id=q.promo.id if q.promo else None,
        promo_code="+".join(p.code for p in q.promos) if q.promos else None, consent_at=utcnow(),
    )
    db.add(order)
    await db.flush()
    # utilisation du code réservée tout de suite, de façon atomique (rendue si la commande expire ou échoue)
    for pr in q.promos:
        if not await ms.reserve_promo(db, pr.id):
            await db.rollback()
            raise HTTPException(400, {"code": "promo_invalid", "message": "This promo code cannot be used."})
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
        await ms.release_promo(db, order)
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
    # remboursement complet : coupée ; litige bancaire : suspendue, puis rendue s'il est gagné, coupée s'il est perdu
    if etype in ("charge.refunded", "charge.dispute.created", "charge.dispute.closed"):
        pi = obj.get("payment_intent")
        order = (await db.execute(select(MusicOrder).where(MusicOrder.stripe_payment_intent == pi))).scalar_one_or_none() \
            if pi else None
        new = None
        if order is not None:
            if etype == "charge.refunded" and obj.get("refunded") is True and order.status in (ORDER_PAID, ORDER_DISPUTED):
                new = ORDER_REFUNDED
            elif etype == "charge.dispute.created" and order.status == ORDER_PAID:
                new = ORDER_DISPUTED
            elif etype == "charge.dispute.closed" and order.status == ORDER_DISPUTED:
                new = ORDER_PAID if obj.get("status") in ("won", "warning_closed") else ORDER_REFUNDED
        if new:
            order.status = new
            await db.commit()
            logger.info("Commande %s : %s (%s)", order.public_id, new, etype)
        return {"received": True}
    if etype.startswith("customer.subscription."):
        if (obj.get("metadata") or {}).get("music_sub"):
            await _sync_subscription(db, obj)
        return {"received": True}
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
        await ms.release_promo(db, order)
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
        # aperçu public de la page 1 : net seulement sur ce que joue l'extrait audio
        ms.render_page1_preview(sheet.id, ms.preview_cut(ms.load_cursor(sheet.id), sheet.pages))
    elif pdf is not None:
        ms.save_cursor(sheet.id, None)
    await db.commit()
    return {"created": created, **_state(sheet)}


@router.post("/ingest/audio", dependencies=[Depends(_require_ingest)])
async def ingest_audio(source_ref: str = Form(...), audio: UploadFile = File(...), audio_preview: UploadFile = File(...),
                       db: AsyncSession = Depends(get_db)):
    """Son exact du Reel (MP3 calé sur les notes) : complet + extrait de 25 s, envoyés par la production."""
    sheet = (await db.execute(select(MusicSheet).where(MusicSheet.source_ref == source_ref))).scalar_one_or_none()
    if sheet is None:
        raise HTTPException(404, "Partition inconnue")
    try:
        ms.save_audio(sheet.id, await audio.read(), await audio_preview.read())
    except ms.MusicError as exc:
        raise _err(exc)
    return {"id": sheet.id, "audio": True}


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
        if (await db.execute(stmt.where(_mine(user)))).first():
            return True
        # abonné : toutes les partitions en vente
        if await _active_sub(db, user) is not None:
            s = await db.get(MusicSheet, sheet_id)
            if s is not None and s.published:
                return True
    return False


async def _active_sub(db: AsyncSession, user: Optional[User]) -> Optional[MusicSubscription]:
    """Abonnement en cours (essai ou payé, période pas finie) du compte, s'il y en a un."""
    if user is None:
        return None
    now = utcnow()
    rows = (await db.execute(select(MusicSubscription).where(
        MusicSubscription.user_id == user.id, MusicSubscription.status.in_(SUB_ACTIVE_STATES))
        .order_by(MusicSubscription.id.desc()))).scalars().all()
    for sub in rows:
        if sub.current_period_end is None or sub.current_period_end > now:
            return sub
    return None


@router.get("/sheets/{sheet_id}/notes")
async def sheet_notes(sheet_id: int, order: Optional[str] = None, k: Optional[str] = None,
                      db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(_music_user)):
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
    # son exact du Reel (si la production l'a envoyé) : le lecteur le joue à la place de la synthèse
    audio = None
    if full and ms.audio_path(s.id).exists():
        q = f"?order={order}&k={k}" if order and k else ""
        audio = f"/api/music/sheets/{s.id}/audio.mp3{q}"
    elif ms.audio_path(s.id, True).exists():
        audio = f"/api/music/sheets/{s.id}/preview.mp3"
    return {**data, "full": full, "audio": audio}


@router.get("/sheets/{sheet_id}/preview.mp3")
async def sheet_audio_preview(sheet_id: int, db: AsyncSession = Depends(get_db),
                              user: Optional[User] = Depends(_music_user)):
    """Extrait du son du Reel (25 s), pour tous ceux qui voient la fiche."""
    s = await _visible_sheet(db, sheet_id, user)
    path = ms.audio_path(s.id, True)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="audio/mpeg",
                        headers={"Cache-Control": f"{'public' if s.published else 'private'}, max-age=3600"})


@router.get("/sheets/{sheet_id}/audio.mp3")
async def sheet_audio(sheet_id: int, order: Optional[str] = None, k: Optional[str] = None,
                      db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(_music_user)):
    """Son complet du Reel : seulement pour qui a la partition (ou l'admin)."""
    s = await db.get(MusicSheet, sheet_id)
    if s is None or not (_is_admin(user) or await _owns_sheet(db, s.id, user=user, order=order, key=k)):
        raise HTTPException(404, "Introuvable")
    path = ms.audio_path(s.id)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/sheets/{sheet_id}/clear/{page}.png")
async def clear_page(sheet_id: int, page: int, order: Optional[str] = None, k: Optional[str] = None,
                     db: AsyncSession = Depends(get_db), user: Optional[User] = Depends(_music_user)):
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
        .where(MusicOrder.status == ORDER_PAID, _mine(user))
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
    sub = await _active_sub(db, user)
    sub_out = _sub_out(sub) if sub else None
    if sub is not None and sub.status == "trialing":
        used = (await db.execute(select(func.count(MusicSubDownload.id)).where(
            MusicSubDownload.subscription_id == sub.id, MusicSubDownload.in_trial.is_(True)))).scalar_one()
        sub_out["trial_downloads_left"] = max(0, settings.MUSIC_TRIAL_DOWNLOADS - int(used))
    from src.core.security import user_has_2fa
    return {"user": {"name": user.name, "email": user.email, "signup_app": user.signup_app,
                     "email_verified": bool(user.email_verified), "nickname": user.nickname,
                     "avatar": "/api/music/account/avatar" if user.avatar_url else None,
                     "password_login": user.auth_source == "local", "twofa_enabled": await user_has_2fa(db, user),
                     "security_url": f"{settings.APP_URL.rstrip('/')}/app/profile"}, "sheets": sheets,
            "subscription": sub_out}


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



# --------------------------------------------------------------------------
# Suivi des liens (?b=…) : parcours d'un visiteur arrivé par un lien suivi, seulement s'il l'a accepté
# --------------------------------------------------------------------------

TRACK_CODE = re.compile(r"^[a-z0-9]{6,16}$")
TRACK_KIND = re.compile(r"^[a-z_]{2,40}$")


class TrackEventIn(BaseModel):
    kind: str = Field(..., max_length=40)
    path: Optional[str] = Field(None, max_length=300)
    data: Optional[dict] = None


class TrackIn(BaseModel):
    code: str = Field(..., max_length=16)
    visit: str = Field(..., max_length=16)
    events: list[TrackEventIn] = Field(..., max_length=40)


@router.post("/track", status_code=204)
async def track(body: TrackIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Lot d'événements du site (le site n'en envoie qu'après l'accord du visiteur). Rien d'autre que le code du lien,
    la visite, le type d'action, la page et quelques détails (instrument, montant) : ni IP ni navigateur."""
    if not TRACK_CODE.match(body.code) or not TRACK_CODE.match(body.visit):
        raise HTTPException(422, "code invalide")
    if not await track_limiter.check(client_ip(request)):
        raise HTTPException(429, "trop d'événements")
    now = utcnow()
    for ev in body.events:
        if not TRACK_KIND.match(ev.kind):
            continue
        data = json.dumps(ev.data, ensure_ascii=False, separators=(",", ":"))[:500] if ev.data else None
        db.add(MusicTrackEvent(code=body.code, visit=body.visit, kind=ev.kind, path=(ev.path or "")[:300] or None,
                               data=data, created_at=now))
    if secrets.randbelow(200) == 0:  # de temps en temps : conservation de 13 mois (politique de confidentialité)
        from sqlalchemy import delete
        await db.execute(delete(MusicTrackEvent).where(MusicTrackEvent.created_at < now - timedelta(days=396)))
    await db.commit()


class TrackLinkIn(BaseModel):
    code: str = Field(..., max_length=16)
    instagram: Optional[str] = Field(None, max_length=60)
    source: Optional[str] = Field(None, max_length=40)
    sheet_ref: Optional[str] = Field(None, max_length=120)


@router.post("/ingest/links", dependencies=[Depends(_require_ingest)])
async def ingest_links(links: list[TrackLinkIn], db: AsyncSession = Depends(get_db)):
    """La production déclare les liens suivis qu'elle envoie (code -> pseudo Instagram). Chaque nouveau lien est tiré
    au sort dans le test A/B : « sub » (abonnement, code d'essai) ou « sheet » (prix par partition) ; renvoyé à la production
    pour qu'elle mette le bon code promo dans le lien."""
    n, variants = 0, {}
    for ln in links[:500]:
        if not TRACK_CODE.match(ln.code):
            continue
        row = await db.get(MusicTrackLink, ln.code)
        if row is None:
            # même groupe pour toute personne déjà tirée (plusieurs « SHEET » = plusieurs liens, une seule expérience)
            who = (ln.instagram or "").lstrip("@").lower()[:60]
            prev = (await db.execute(select(MusicTrackLink.variant).where(
                func.lower(MusicTrackLink.instagram_username) == who, MusicTrackLink.variant.is_not(None))
                .order_by(MusicTrackLink.created_at).limit(1))).scalar_one_or_none() if who else None
            variant = prev or ("sub" if secrets.randbelow(10_000) < int(settings.MUSIC_SUB_AB_SHARE * 10_000) else "sheet")
            row = MusicTrackLink(code=ln.code, created_at=utcnow(), variant=variant)
            db.add(row)
            await db.flush()
        variants[ln.code] = row.variant or "sheet"
        row.instagram_username = (ln.instagram or "").lstrip("@")[:60] or row.instagram_username
        row.source = ln.source or row.source
        row.sheet_ref = ln.sheet_ref or row.sheet_ref
        n += 1
    await db.commit()
    return {"saved": n, "variants": variants}



# --------------------------------------------------------------------------
# Abonnement « toutes les partitions » (test A/B des liens « SHEET ») : Stripe, chaque semaine, essai avec un code
# --------------------------------------------------------------------------

def _dt(epoch) -> Optional[datetime]:
    try:
        return datetime.utcfromtimestamp(int(epoch)) if epoch else None
    except (TypeError, ValueError):
        return None


PLANS = ("week", "month", "year")


def _plan_prices(st) -> dict[str, int]:
    return {"week": st.sub_weekly_cents, "month": st.sub_monthly_cents, "year": st.sub_yearly_cents}


def _promo_trial_days(promo) -> int:
    """Jours d'essai d'abonnement qu'ouvre un code : code « essai » (valeur), ou code de réduction avec trial_days."""
    if promo is None:
        return 0
    days = promo.value if promo.kind == PROMO_TRIAL else (promo.trial_days or 0)
    return max(0, min(30, int(days)))


def _sub_out(sub: MusicSubscription) -> dict:
    return {"status": sub.status, "plan": sub.plan, "price_cents": sub.weekly_cents, "weekly_cents": sub.weekly_cents,
            "trial_end": sub.trial_end.isoformat() + "Z" if sub.trial_end else None,
            "current_period_end": sub.current_period_end.isoformat() + "Z" if sub.current_period_end else None,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "retention_applied": bool(sub.retention_accepted_at),
            "trial_downloads_left": None}


@router.get("/offer")
async def offer(b: Optional[str] = None, code: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Ce que voit le visiteur : l'abonnement n'est proposé qu'aux liens du groupe « sub » du test A/B."""
    st = await ms.get_settings(db)
    # tout le monde voit l'abonnement, sauf le groupe A du test (lien « SHEET » tiré « sheet »)
    variant = "sub"
    if b and TRACK_CODE.match(b):
        link = await db.get(MusicTrackLink, b)
        if link is not None and link.variant == "sheet":
            variant = "sheet"
    trial_days, discount_pct = 0, 0
    if code:
        found = await ms.find_promo(db, code)
        if found is not None and not ms.promo_problem(found):
            trial_days = _promo_trial_days(found)
            discount_pct = max(0, min(100, found.value)) if found.kind == "percent" else 0
    prices = _plan_prices(st)
    return {"variant": variant, "plans": [{"plan": p, "cents": prices[p]} for p in PLANS],
            "sub_weekly_cents": st.sub_weekly_cents, "currency": st.currency,
            "trial_days": trial_days, "first_discount_pct": discount_pct, "trial_downloads": settings.MUSIC_TRIAL_DOWNLOADS}


class SubscribeIn(BaseModel):
    plan: str = Field("week", pattern="^(week|month|year)$")
    promo_code: Optional[str] = Field(None, max_length=40)
    promo_codes: list[str] = Field(default_factory=list, max_length=4)
    consent: bool = False
    lang: str = Field("en", pattern="^(en|fr|es|ru)$")
    track: Optional[str] = Field(None, pattern=r"^[a-z0-9]{6,16}$")


@router.post("/subscribe")
async def subscribe(body: SubscribeIn, request: Request, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Stripe Checkout en abonnement hebdomadaire. Essai seulement avec un code d'essai valable et une seule fois
    par compte ; sans code, le premier prélèvement est immédiat."""
    await _limit(request)
    if not body.consent:
        raise HTTPException(400, {"code": "consent_required", "message": "Please accept the subscription terms."})
    if await _active_sub(db, user) is not None:
        raise HTTPException(409, {"code": "already_subscribed", "message": "You already have a subscription."})
    if not settings.MOCK_BILLING and not settings.STRIPE_SECRET_KEY:
        raise HTTPException(503, {"code": "payments_off", "message": "Payments are not available right now."})
    st = await ms.get_settings(db)
    # jusqu'à 2 codes : essai (le plus long) + remise en % sur le premier paiement (cumulée : -20 % puis -10 % = -28 %)
    codes = list(dict.fromkeys(c.strip().upper() for c in ([body.promo_code] if body.promo_code else []) + body.promo_codes
                                if c and c.strip()))
    if len(codes) > ms.MAX_PROMOS:
        raise HTTPException(400, {"code": "promo_too_many", "message": "Two promo codes at most."})
    trial_days, promos, keep = 0, [], 100
    for code in codes:
        found = await ms.find_promo(db, code)
        if found is None or ms.promo_problem(found):
            raise HTTPException(400, {"code": "promo_invalid", "message": "This promo code cannot be used."})
        promos.append(found)
        trial_days = max(trial_days, _promo_trial_days(found))
        if found.kind == "percent":
            keep = keep * (100 - max(0, min(100, found.value))) // 100
    first_pct = 100 - keep if keep < 100 else None
    if trial_days:
        had_one = (await db.execute(select(MusicSubscription.id).where(
            MusicSubscription.user_id == user.id, MusicSubscription.trial_end.is_not(None)))).first()
        if had_one:  # un seul essai par compte ; la remise reste valable
            trial_days = 0
    promo = promos[0] if promos else None
    price = _plan_prices(st)[body.plan]
    sub = MusicSubscription(user_id=user.id, email=user.email, status="incomplete", weekly_cents=price, plan=body.plan,
                            promo_code="+".join(p.code for p in promos) or None, track_code=body.track, consent_at=utcnow(),
                            first_discount_pct=first_pct)
    db.add(sub)
    await db.flush()
    base = settings.MUSIC_URL.rstrip("/")
    data = {
        "mode": "subscription",
        "success_url": f"{base}/account/abonnement?sub=ok",
        "cancel_url": f"{base}/",
        "locale": body.lang,
        "customer_email": user.email,
        "client_reference_id": str(user.id),
        "metadata[music_sub]": str(sub.id),
        "subscription_data[metadata][music_sub]": str(sub.id),
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": st.currency,
        "line_items[0][price_data][unit_amount]": str(price),
        "line_items[0][price_data][recurring][interval]": body.plan,
        "line_items[0][price_data][product_data][name]": f"Ghost Hands Sheets — every sheet ({ {'week': 'weekly', 'month': 'monthly', 'year': 'yearly'}[body.plan] })",
    }
    if trial_days:
        data["subscription_data[trial_period_days]"] = str(trial_days)
        data["payment_method_collection"] = "always"
    elif first_pct and not settings.MOCK_BILLING:
        # sans essai, la remise va sur le paiement de la souscription ; avec un essai, elle est posée après la création
        try:
            coupon = await stripe_service.create_coupon(first_pct, "once", name=f"Ghost Hands -{first_pct}% (1er paiement)")
        except StripeError as exc:
            await db.rollback()
            raise HTTPException(502, {"code": "stripe_error", "message": str(exc)})
        data["discounts[0][coupon]"] = coupon["id"]
        sub.first_discount_applied = True
    if settings.MOCK_BILLING:
        now = utcnow()
        sub.status = "trialing" if trial_days else "active"
        sub.trial_end = now + timedelta(days=trial_days) if trial_days else None
        sub.current_period_end = sub.trial_end or now + timedelta(days={"week": 7, "month": 30, "year": 365}[body.plan])
        await db.commit()
        return {"redirect": data["success_url"]}
    try:
        session = await stripe_service.create_payment_checkout(data)
    except StripeError as exc:
        await db.rollback()
        raise HTTPException(502, {"code": "stripe_error", "message": str(exc)})
    sub.stripe_session_id = session.get("id")
    await db.commit()
    return {"redirect": session.get("url")}


@router.post("/subscription/cancel")
async def cancel_subscription(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Résiliation en un clic : plus de prélèvement ; l'accès reste jusqu'à la fin de la période (ou de l'essai)
    déjà commencée, sans remboursement."""
    sub = await _active_sub(db, user)
    if sub is None:
        raise HTTPException(404, {"code": "no_subscription", "message": "No active subscription."})
    if sub.stripe_subscription_id and not settings.MOCK_BILLING:
        try:
            await stripe_service.cancel_at_period_end(sub.stripe_subscription_id)
        except StripeError as exc:
            raise HTTPException(502, {"code": "stripe_error", "message": str(exc)})
    if await _retention_eligible(db, user, sub):  # l'offre a été montrée et refusée : plus jamais proposée
        sub.retention_offered_at = utcnow()
    sub.cancel_at_period_end = True
    await db.commit()
    return {"subscription": _sub_out(sub)}


@router.get("/sheets/{sheet_id}/pdf")
async def sheet_pdf(sheet_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """PDF pour le compte connecté qui a la partition (achat, don ou abonnement). Pendant l'essai de l'abonnement :
    MUSIC_TRIAL_DOWNLOADS partitions au plus."""
    s = await db.get(MusicSheet, sheet_id)
    if s is None:
        raise HTTPException(404, "Introuvable")
    bought = (await db.execute(
        select(MusicOrderItem.id).join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrderItem.sheet_id == s.id, MusicOrder.status == ORDER_PAID, _mine(user)))).first() is not None
    sub = None if bought else await _active_sub(db, user)
    if not bought and not (sub is not None and s.published):
        raise HTTPException(404, "Introuvable")
    if sub is not None:
        done = (await db.execute(select(MusicSubDownload).where(MusicSubDownload.subscription_id == sub.id,
                                                                MusicSubDownload.sheet_id == s.id))).scalar_one_or_none()
        if done is None:
            in_trial = sub.status == "trialing"
            if in_trial:
                n = (await db.execute(select(func.count(MusicSubDownload.id)).where(
                    MusicSubDownload.subscription_id == sub.id, MusicSubDownload.in_trial.is_(True)))).scalar_one()
                if n >= settings.MUSIC_TRIAL_DOWNLOADS:
                    raise HTTPException(403, {"code": "trial_limit",
                                              "message": f"During the free trial you can download {settings.MUSIC_TRIAL_DOWNLOADS} sheets."})
            db.add(MusicSubDownload(subscription_id=sub.id, sheet_id=s.id, in_trial=in_trial))
            await db.commit()
    path = ms.pdf_path(s.id)
    if not path.exists():
        raise HTTPException(404, "Introuvable")
    name = re.sub(r"[^A-Za-z0-9 _.-]+", "", f"{s.piece_title} - {s.instrument_label}")[:120] or "sheet"
    return FileResponse(path, media_type="application/pdf", filename=f"{name}.pdf",
                        headers={"Cache-Control": "private, no-store"})


async def _sync_subscription(db: AsyncSession, obj: dict) -> None:
    """customer.subscription.* (abonnement de la boutique : metadata.music_sub) -> état local."""
    sid = (obj.get("metadata") or {}).get("music_sub")
    sub = None
    if obj.get("id"):
        sub = (await db.execute(select(MusicSubscription).where(
            MusicSubscription.stripe_subscription_id == obj["id"]))).scalar_one_or_none()
    if sub is None and sid and str(sid).isdigit():
        sub = await db.get(MusicSubscription, int(sid))
    if sub is None:
        return
    sub.stripe_subscription_id = obj.get("id") or sub.stripe_subscription_id
    sub.stripe_customer_id = obj.get("customer") or sub.stripe_customer_id
    sub.status = str(obj.get("status") or sub.status)[:20]
    sub.trial_end = _dt(obj.get("trial_end")) or sub.trial_end
    end = obj.get("current_period_end")
    if not end:
        items = ((obj.get("items") or {}).get("data") or [])
        end = items[0].get("current_period_end") if items else None
    sub.current_period_end = _dt(end) or sub.current_period_end
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
    # essai + remise : la remise des codes est posée maintenant, pour le premier vrai paiement
    if sub.first_discount_pct and not sub.first_discount_applied and sub.stripe_subscription_id \
            and sub.status == "trialing" and not settings.MOCK_BILLING:
        try:
            coupon = await stripe_service.create_coupon(sub.first_discount_pct, "once",
                                                        name=f"Ghost Hands -{sub.first_discount_pct}% (1er paiement)")
            await stripe_service._stripe_request("POST", f"/subscriptions/{sub.stripe_subscription_id}",
                                                 data={"discounts[0][coupon]": coupon["id"]})
            sub.first_discount_applied = True
        except StripeError as exc:
            logger.warning("Remise du premier paiement non posée (%s) : %s", sub.stripe_subscription_id, exc)
    await db.commit()



# --------------------------------------------------------------------------
# Profil (compte partagé avec chapote.fr) : nom, pseudo, photo
# --------------------------------------------------------------------------

class ProfileIn(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    nickname: Optional[str] = Field(None, max_length=40)


@router.patch("/account/profile")
async def patch_profile(body: ProfileIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if body.name is not None:
        name = " ".join(body.name.split())
        if not name:
            raise HTTPException(422, {"code": "name_required", "message": "Name required."})
        user.name = name[:120]
    if body.nickname is not None:
        nick = body.nickname.strip().lstrip("@")
        if nick and not re.fullmatch(r"[A-Za-z0-9._-]{2,40}", nick):
            raise HTTPException(422, {"code": "nickname_invalid", "message": "Letters, digits, dots, dashes and underscores only."})
        user.nickname = nick or None
    await db.commit()
    return {"name": user.name, "nickname": user.nickname}


AVATAR_MAX = 5 * 1024 * 1024


@router.post("/account/avatar")
async def upload_avatar(file: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Photo de profil : ré-encodée en JPEG 256×256 (rien d'autre n'est gardé du fichier envoyé), partagée avec chapote.fr."""
    from io import BytesIO
    from PIL import Image, ImageOps
    data = await file.read(AVATAR_MAX + 1)
    if len(data) > AVATAR_MAX:
        raise HTTPException(413, {"code": "too_large", "message": "Image too large (5 MB max)."})
    try:
        with Image.open(BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im = ImageOps.fit(im, (256, 256), Image.LANCZOS)
            out = BytesIO()
            im.save(out, "JPEG", quality=85)
    except Exception:
        raise HTTPException(415, {"code": "bad_image", "message": "This file is not a picture."})
    name = f"{secrets.token_urlsafe(16)}.jpg"
    from pathlib import Path
    up = Path(settings.UPLOAD_DIR)
    up.mkdir(parents=True, exist_ok=True)
    (up / name).write_bytes(out.getvalue())
    user.avatar_url = f"{settings.API_URL}/uploads/{name}"
    await db.commit()
    return {"avatar": "/api/music/account/avatar"}


@router.get("/account/avatar")
async def get_avatar(user: User = Depends(get_current_user)):
    """La photo du compte, servie sur music.chapote.fr (fichier local, ou redirection vers Google)."""
    from fastapi.responses import RedirectResponse
    from pathlib import Path
    url = user.avatar_url or ""
    local = f"{settings.API_URL}/uploads/"
    if url.startswith(local):
        path = Path(settings.UPLOAD_DIR) / url[len(local):].split("/")[-1]
        if path.is_file():
            return FileResponse(path, headers={"Cache-Control": "private, max-age=300"})
    if url.startswith("https://") and "googleusercontent.com" in url:
        return RedirectResponse(url)
    raise HTTPException(404, "Pas de photo")


# --------------------------------------------------------------------------
# Résiliation : à la première demande, une offre de rétention (-50 % sur le prochain paiement, une fois par compte)
# --------------------------------------------------------------------------

RETENTION_PERCENT = 50


async def _retention_eligible(db: AsyncSession, user: User, sub: MusicSubscription) -> bool:
    if sub.status != "active" or sub.cancel_at_period_end:  # pas pendant l'essai : rien n'a encore été payé
        return False
    used = (await db.execute(select(MusicSubscription.id).where(
        MusicSubscription.user_id == user.id, MusicSubscription.retention_offered_at.is_not(None)))).first()
    return used is None


@router.get("/subscription/retention")
async def retention_offer(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    sub = await _active_sub(db, user)
    if sub is None:
        raise HTTPException(404, {"code": "no_subscription", "message": "No active subscription."})
    ok = await _retention_eligible(db, user, sub)
    return {"eligible": ok, "percent": RETENTION_PERCENT if ok else None,
            "next_cents": sub.weekly_cents * (100 - RETENTION_PERCENT) // 100 if ok else None}


@router.post("/subscription/retain")
async def retain(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """L'abonné garde son abonnement : -50 % sur son prochain paiement (coupon Stripe « once »)."""
    sub = await _active_sub(db, user)
    if sub is None or not await _retention_eligible(db, user, sub):
        raise HTTPException(400, {"code": "not_eligible", "message": "This offer is not available."})
    if sub.stripe_subscription_id and not settings.MOCK_BILLING:
        try:
            coupon = await stripe_service.create_coupon(RETENTION_PERCENT, "once", name="Ghost Hands -50% (rétention)")
            await stripe_service._stripe_request("POST", f"/subscriptions/{sub.stripe_subscription_id}",
                                                 data={"discounts[0][coupon]": coupon["id"]})
        except StripeError as exc:
            raise HTTPException(502, {"code": "stripe_error", "message": str(exc)})
    now = utcnow()
    sub.retention_offered_at = sub.retention_offered_at or now
    sub.retention_accepted_at = now
    await db.commit()
    return {"subscription": _sub_out(sub)}
