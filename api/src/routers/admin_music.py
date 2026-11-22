"""Back-office de la boutique de partitions (/admin/music, superadmin).

- vue d'ensemble : partitions (en vente / privées), commandes payées, chiffre ;
- toutes les partitions, y compris celles qui ne sont pas diffusées (badge privé) :
  diffuser ou retirer n'importe laquelle, prix propre ;
- prix généraux (partition, lot d'un morceau) ;
- codes promo (pourcentage ou montant, plafond, date de fin) ;
- commandes (statut, montant, lignes) et renvoi de l'e-mail de livraison ;
- qui possède chaque partition (achats et dons) ; donner une partition à une adresse e-mail (commande à 0 €
  marquée `granted_by_user_id`, avec l'e-mail de livraison si demandé) ou retirer un don.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import String, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import get_current_user, require_superadmin
from src.core.time import utcnow
from src.models.music import (
    ORDER_PAID,
    PROMO_AMOUNT,
    PROMO_PERCENT,
    MusicOrder,
    MusicOrderItem,
    MusicPromoCode,
    MusicReview,
    MusicSheet,
    MusicTrackEvent,
    MusicTrackLink,
)
from src.models.user import User, UserApp
from src.services import music_service as ms

router = APIRouter(prefix="/api/admin/music", tags=["admin-music"],
                   dependencies=[Depends(require_superadmin)])


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


async def _sales_by_sheet(db: AsyncSession) -> dict[int, tuple[int, int]]:
    rows = (await db.execute(
        select(MusicOrderItem.sheet_id, func.count(MusicOrderItem.id), func.coalesce(func.sum(MusicOrderItem.price_cents), 0))
        .join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrder.status == ORDER_PAID, MusicOrder.granted_by_user_id.is_(None))
        .group_by(MusicOrderItem.sheet_id)
    )).all()
    return {sid: (int(n), int(cents)) for sid, n, cents in rows}


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    total, published = (await db.execute(
        select(func.count(MusicSheet.id), func.count(MusicSheet.id).filter(MusicSheet.published.is_(True)))
    )).one()
    since = utcnow() - timedelta(days=30)
    paid = select(func.count(MusicOrder.id), func.coalesce(func.sum(MusicOrder.amount_cents), 0)).where(
        MusicOrder.status == ORDER_PAID, MusicOrder.granted_by_user_id.is_(None))  # les dons ne sont pas des ventes
    n_all, cents_all = (await db.execute(paid)).one()
    n_30, cents_30 = (await db.execute(paid.where(MusicOrder.paid_at >= since))).one()
    music_accounts = (await db.execute(select(func.count(UserApp.id)).where(UserApp.app == "music"))).scalar_one()
    music_signups = (await db.execute(select(func.count(User.id)).where(User.signup_app == "music"))).scalar_one()
    reviews_n = (await db.execute(select(func.count(MusicReview.id)))).scalar_one()
    by_status = dict((await db.execute(
        select(MusicOrder.status, func.count(MusicOrder.id)).group_by(MusicOrder.status))).all())
    sales = await _sales_by_sheet(db)
    top_ids = sorted(sales, key=lambda i: -sales[i][0])[:5]
    tops = {s.id: s for s in (await db.execute(select(MusicSheet).where(MusicSheet.id.in_(top_ids)))).scalars()} \
        if top_ids else {}
    await db.commit()
    return {
        "sheets": {"total": int(total), "published": int(published), "private": int(total) - int(published)},
        "orders": {"paid": int(n_all), "paid_30d": int(n_30), "by_status": {k: int(v) for k, v in by_status.items()}},
        "revenue_cents": {"total": int(cents_all), "last_30d": int(cents_30)},
        "accounts": {"using_music": int(music_accounts), "signed_up_on_music": int(music_signups)},
        "reviews": int(reviews_n),
        "pricing": {"unit_price_cents": st.unit_price_cents, "bundle_price_cents": st.bundle_price_cents,
                    "currency": st.currency},
        "top_sheets": [{"id": i, "title": f"{tops[i].piece_title} — {tops[i].instrument_label}",
                        "sales": sales[i][0], "revenue_cents": sales[i][1]} for i in top_ids if i in tops],
    }


# --------------------------------------------------------------------------
# Partitions
# --------------------------------------------------------------------------

@router.get("/sheets")
async def list_sheets(q: Optional[str] = None, instrument: Optional[str] = None,
                      status: Optional[str] = None, offset: int = 0, limit: int = 50,
                      db: AsyncSession = Depends(get_db)):
    offset, limit = max(0, offset), max(1, min(limit, 200))
    st = await ms.get_settings(db)
    stmt = select(MusicSheet)
    if q:
        like = f"%{q.strip()[:80]}%"
        stmt = stmt.where(or_(MusicSheet.piece_title.ilike(like), MusicSheet.composer.ilike(like),
                              MusicSheet.title.ilike(like), MusicSheet.source_ref.ilike(like)))
    if instrument:
        stmt = stmt.where(MusicSheet.instrument == instrument)
    if status == "published":
        stmt = stmt.where(MusicSheet.published.is_(True))
    elif status == "private":
        stmt = stmt.where(MusicSheet.published.is_(False))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    sheets = (await db.execute(stmt.order_by(MusicSheet.released_at.desc().nullslast(),
                                             MusicSheet.id.desc()).offset(offset).limit(limit))).scalars().all()
    sales = await _sales_by_sheet(db)
    owners = await _owners_count(db, [s.id for s in sheets])
    await db.commit()
    return {"total": int(total), "next_offset": offset + limit if offset + limit < total else None, "sheets": [{
        "id": s.id, "source_ref": s.source_ref, "piece_slug": s.piece_slug, "piece_title": s.piece_title,
        "composer": s.composer, "instrument": s.instrument, "instrument_label": s.instrument_label,
        "title": s.title, "rights": s.rights, "public_domain": s.public_domain, "published": s.published,
        "published_at": _iso(s.published_at), "pages": s.pages, "reel_url": s.reel_url,
        "price_cents": s.price_cents, "effective_price_cents": ms.sheet_price(s, st),
        "released_at": _iso(s.released_at), "sales": sales.get(s.id, (0, 0))[0],
        "revenue_cents": sales.get(s.id, (0, 0))[1], "url": ms.piece_url(s.piece_slug, s.instrument),
        "preview": f"/api/admin/music/sheets/{s.id}/page1.png",
        "likes": s.instagram_likes, "has_notes": s.has_notes,
        "owners": owners.get(s.id, 0),
    } for s in sheets]}


async def _owners_count(db: AsyncSession, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = (await db.execute(
        select(MusicOrderItem.sheet_id, func.count(func.distinct(func.coalesce(func.cast(MusicOrder.user_id, String()),
                                                                                 func.lower(MusicOrder.email)))))
        .join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrder.status == ORDER_PAID, MusicOrderItem.sheet_id.in_(ids))
        .group_by(MusicOrderItem.sheet_id))).all()
    return {sid: int(n) for sid, n in rows}


@router.get("/sheets/{sheet_id}/owners")
async def sheet_owners(sheet_id: int, db: AsyncSession = Depends(get_db)):
    """Comptes et adresses qui possèdent la partition : achats payés et dons d'un administrateur."""
    if await db.get(MusicSheet, sheet_id) is None:
        raise HTTPException(404, "Partition introuvable")
    rows = (await db.execute(
        select(MusicOrder, MusicOrderItem, User)
        .join(MusicOrderItem, MusicOrderItem.order_id == MusicOrder.id)
        .outerjoin(User, User.id == MusicOrder.user_id)
        .where(MusicOrderItem.sheet_id == sheet_id, MusicOrder.status == ORDER_PAID)
        .order_by(MusicOrder.paid_at.desc()))).all()
    return {"owners": [{
        "order_id": o.id, "item_id": it.id, "email": o.email, "user_id": o.user_id,
        "name": u.name if u else None, "has_account": u is not None,
        "source": "grant" if o.granted_by_user_id else "purchase",
        "amount_cents": it.price_cents, "at": _iso(o.paid_at),
    } for o, it, u in rows]}


class GrantIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    send_email: bool = True


@router.post("/sheets/{sheet_id}/grant")
async def grant_sheet(sheet_id: int, body: GrantIn, db: AsyncSession = Depends(get_db),
                      admin: User = Depends(get_current_user)):
    """Donne la partition (publique ou privée) : commande à 0 € payée, liée au compte s'il existe."""
    s = await db.get(MusicSheet, sheet_id)
    if s is None:
        raise HTTPException(404, "Partition introuvable")
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(422, "Adresse e-mail invalide")
    owner = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    already = (await db.execute(
        select(MusicOrderItem.id).join(MusicOrder, MusicOrder.id == MusicOrderItem.order_id)
        .where(MusicOrderItem.sheet_id == s.id, MusicOrder.status == ORDER_PAID,
               or_(func.lower(MusicOrder.email) == email,
                   MusicOrder.user_id == (owner.id if owner else -1))))).first()
    if already:
        raise HTTPException(409, "Cette personne a déjà cette partition")
    now = utcnow()
    # lié au compte seulement si son adresse est vérifiée (sinon elle s'y rattachera à la vérification)
    linked = owner if owner is not None and owner.email_verified else None
    order = MusicOrder(public_id=uuid.uuid4().hex, status=ORDER_PAID, email=email, lang="en",
                       user_id=linked.id if linked else None, subtotal_cents=0, discount_cents=0, amount_cents=0,
                       currency="eur", consent_at=now, paid_at=now, granted_by_user_id=admin.id)
    db.add(order)
    await db.flush()
    db.add(MusicOrderItem(order_id=order.id, sheet_id=s.id, price_cents=0,
                          label=f"{s.piece_title} — {s.instrument_label}"[:500]))
    await db.commit()
    sent = False
    if body.send_email:
        sent = await ms.deliver(db, order)
        await db.commit()
    return {"order_id": order.id, "email": email, "has_account": owner is not None, "emailed": sent}


@router.delete("/sheets/{sheet_id}/grant/{order_id}")
async def revoke_grant(sheet_id: int, order_id: int, db: AsyncSession = Depends(get_db)):
    """Retire un don (jamais un achat payé)."""
    o = await db.get(MusicOrder, order_id)
    if o is None or not o.granted_by_user_id:
        raise HTTPException(404, "Don introuvable")
    item = (await db.execute(select(MusicOrderItem).where(MusicOrderItem.order_id == o.id,
                                                          MusicOrderItem.sheet_id == sheet_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "Don introuvable")
    await db.delete(o)
    await db.commit()
    return {"revoked": True}


@router.get("/sheets/{sheet_id}/page1.png")
async def admin_page1(sheet_id: int, db: AsyncSession = Depends(get_db)):
    from fastapi.responses import FileResponse
    s = await db.get(MusicSheet, sheet_id)
    path = ms.page_path(sheet_id, 1)
    if s is None or not path.exists():
        raise HTTPException(404, "Introuvable")
    return FileResponse(path, media_type="image/png")


class SheetPatch(BaseModel):
    published: Optional[bool] = None
    price_cents: Optional[int] = Field(None, ge=0, le=100_000)
    reset_price: bool = False


@router.patch("/sheets/{sheet_id}")
async def patch_sheet(sheet_id: int, body: SheetPatch, db: AsyncSession = Depends(get_db)):
    s = await db.get(MusicSheet, sheet_id)
    if s is None:
        raise HTTPException(404, "Partition introuvable")
    if body.published is not None and body.published != s.published:
        s.published = body.published
        s.published_at = utcnow() if body.published else None
    if body.reset_price:
        s.price_cents = None
    elif body.price_cents is not None:
        s.price_cents = body.price_cents
    await db.commit()
    return {"id": s.id, "published": s.published, "price_cents": s.price_cents}


# --------------------------------------------------------------------------
# Prix généraux
# --------------------------------------------------------------------------

class PricingIn(BaseModel):
    unit_price_cents: int = Field(..., ge=0, le=100_000)
    bundle_price_cents: Optional[int] = Field(None, ge=0, le=100_000)


@router.get("/pricing")
async def get_pricing(db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    await db.commit()
    return {"unit_price_cents": st.unit_price_cents, "bundle_price_cents": st.bundle_price_cents,
            "currency": st.currency}


@router.put("/pricing")
async def put_pricing(body: PricingIn, db: AsyncSession = Depends(get_db)):
    st = await ms.get_settings(db)
    st.unit_price_cents = body.unit_price_cents
    st.bundle_price_cents = body.bundle_price_cents
    await db.commit()
    return {"unit_price_cents": st.unit_price_cents, "bundle_price_cents": st.bundle_price_cents,
            "currency": st.currency}


# --------------------------------------------------------------------------
# Codes promo
# --------------------------------------------------------------------------

def _promo(p: MusicPromoCode) -> dict:
    return {"id": p.id, "code": p.code, "kind": p.kind, "value": p.value, "active": p.active,
            "max_uses": p.max_uses, "uses": p.uses, "expires_at": _iso(p.expires_at), "note": p.note,
            "created_at": _iso(p.created_at), "usable": ms.promo_problem(p) is None}


class PromoIn(BaseModel):
    code: str = Field(..., min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    kind: str = Field(..., pattern=f"^({PROMO_PERCENT}|{PROMO_AMOUNT})$")
    value: int = Field(..., ge=1, le=100_000)
    max_uses: Optional[int] = Field(None, ge=1)
    expires_at: Optional[datetime] = None
    note: Optional[str] = Field(None, max_length=200)
    active: bool = True


class PromoPatch(BaseModel):
    active: Optional[bool] = None
    max_uses: Optional[int] = Field(None, ge=1)
    clear_max_uses: bool = False
    expires_at: Optional[datetime] = None
    clear_expires_at: bool = False
    note: Optional[str] = Field(None, max_length=200)


def _naive_utc(d: Optional[datetime]) -> Optional[datetime]:
    if d is None or d.tzinfo is None:
        return d
    return (d - d.utcoffset()).replace(tzinfo=None)


@router.get("/promos")
async def list_promos(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MusicPromoCode).order_by(MusicPromoCode.created_at.desc()))).scalars().all()
    return {"promos": [_promo(p) for p in rows]}


@router.post("/promos")
async def create_promo(body: PromoIn, db: AsyncSession = Depends(get_db)):
    if body.kind == PROMO_PERCENT and body.value > 100:
        raise HTTPException(400, "Un pourcentage va de 1 à 100")
    p = MusicPromoCode(code=body.code.upper(), kind=body.kind, value=body.value, max_uses=body.max_uses,
                       expires_at=_naive_utc(body.expires_at), note=body.note, active=body.active, uses=0)
    db.add(p)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Ce code existe déjà")
    return _promo(p)


@router.patch("/promos/{promo_id}")
async def patch_promo(promo_id: int, body: PromoPatch, db: AsyncSession = Depends(get_db)):
    p = await db.get(MusicPromoCode, promo_id)
    if p is None:
        raise HTTPException(404, "Code introuvable")
    if body.active is not None:
        p.active = body.active
    if body.clear_max_uses:
        p.max_uses = None
    elif body.max_uses is not None:
        p.max_uses = body.max_uses
    if body.clear_expires_at:
        p.expires_at = None
    elif body.expires_at is not None:
        p.expires_at = _naive_utc(body.expires_at)
    if body.note is not None:
        p.note = body.note
    await db.commit()
    return _promo(p)


# --------------------------------------------------------------------------
# Commandes
# --------------------------------------------------------------------------

@router.get("/orders")
async def list_orders(status: Optional[str] = None, offset: int = 0, limit: int = 50,
                      db: AsyncSession = Depends(get_db)):
    offset, limit = max(0, offset), max(1, min(limit, 200))
    stmt = select(MusicOrder)
    if status:
        stmt = stmt.where(MusicOrder.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    orders = (await db.execute(stmt.order_by(MusicOrder.created_at.desc()).offset(offset).limit(limit))).scalars().all()
    ids = [o.id for o in orders]
    items: dict[int, list[str]] = {}
    links: dict[int, list[dict]] = {}
    if ids:
        for it, sh in (await db.execute(select(MusicOrderItem, MusicSheet).join(MusicSheet, MusicSheet.id == MusicOrderItem.sheet_id)
                                        .where(MusicOrderItem.order_id.in_(ids)).order_by(MusicOrderItem.id))).all():
            items.setdefault(it.order_id, []).append(it.label)
            links.setdefault(it.order_id, []).append({"label": it.label, "url": ms.piece_url(sh.piece_slug, sh.instrument)})
    return {"total": int(total), "next_offset": offset + limit if offset + limit < total else None, "orders": [{
        "id": o.id, "public_id": o.public_id, "status": o.status, "email": o.email,
        "amount_cents": o.amount_cents, "subtotal_cents": o.subtotal_cents, "discount_cents": o.discount_cents,
        "promo_code": o.promo_code, "created_at": _iso(o.created_at), "paid_at": _iso(o.paid_at),
        "emailed_at": _iso(o.emailed_at), "items": items.get(o.id, []),
        "instagram_username": o.instagram_username, "instagram_status": o.instagram_status,
        "user_id": o.user_id, "granted": bool(o.granted_by_user_id), "item_links": links.get(o.id, []),
    } for o in orders]}


@router.post("/orders/{order_id}/resend")
async def resend(order_id: int, db: AsyncSession = Depends(get_db)):
    o = await db.get(MusicOrder, order_id)
    if o is None or o.status != ORDER_PAID:
        raise HTTPException(404, "Commande payée introuvable")
    ok = await ms.deliver(db, o)
    await db.commit()
    if not ok:
        raise HTTPException(502, "E-mail non envoyé (adresse absente ou SMTP indisponible)")
    return {"sent": True}


# --------------------------------------------------------------------------
# Avis : lecture et retrait (règles des CGU) — jamais de modification du contenu
# --------------------------------------------------------------------------

@router.get("/reviews")
async def list_reviews(offset: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    offset, limit = max(0, offset), max(1, min(limit, 200))
    total = (await db.execute(select(func.count(MusicReview.id)))).scalar_one()
    rows = (await db.execute(
        select(MusicReview, MusicSheet, User)
        .join(MusicSheet, MusicSheet.id == MusicReview.sheet_id).join(User, User.id == MusicReview.user_id)
        .order_by(MusicReview.updated_at.desc()).offset(offset).limit(limit))).all()
    return {"total": int(total), "next_offset": offset + limit if offset + limit < total else None,
            "reviews": [{"id": r.id, "rating": r.rating, "comment": r.comment, "hidden": r.hidden,
                         "date": _iso(r.updated_at), "user": u.email,
                         "sheet": f"{sh.piece_title} — {sh.instrument_label}"} for r, sh, u in rows]}


class ReviewPatch(BaseModel):
    hidden: bool


@router.patch("/reviews/{review_id}")
async def patch_review(review_id: int, body: ReviewPatch, db: AsyncSession = Depends(get_db)):
    r = await db.get(MusicReview, review_id)
    if r is None:
        raise HTTPException(404, "Avis introuvable")
    r.hidden = body.hidden
    await db.commit()
    return {"id": r.id, "hidden": r.hidden}



# --------------------------------------------------------------------------
# Suivi des liens (?b=…) : qui a cliqué, ce qu'il a fait (visiteurs qui ont accepté le suivi)
# --------------------------------------------------------------------------

FUNNEL = ("landing", "page", "play", "add_to_cart", "checkout_open", "checkout", "purchase")


@router.get("/tracking")
async def tracking(offset: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    offset, limit = max(0, offset), max(1, min(limit, 200))
    ev = (select(MusicTrackEvent.code, func.min(MusicTrackEvent.created_at).label("first"),
                 func.max(MusicTrackEvent.created_at).label("last"), func.count(MusicTrackEvent.id).label("n"),
                 func.count(func.distinct(MusicTrackEvent.visit)).label("visits"))
          .group_by(MusicTrackEvent.code).subquery())
    links_total = (await db.execute(select(func.count(MusicTrackLink.code)))).scalar_one()
    clicked = (await db.execute(select(func.count()).select_from(ev))).scalar_one()
    rows = (await db.execute(
        select(ev.c.code, ev.c.first, ev.c.last, ev.c.n, ev.c.visits, MusicTrackLink)
        .outerjoin(MusicTrackLink, MusicTrackLink.code == ev.c.code)
        .order_by(ev.c.last.desc()).offset(offset).limit(limit))).all()
    codes = [r[0] for r in rows]
    refs = {link.sheet_ref for *_, link in rows if link is not None and link.sheet_ref}
    sheet_urls = {sh.source_ref: (sh.piece_title, sh.instrument_label, ms.piece_url(sh.piece_slug, sh.instrument))
                  for sh in (await db.execute(select(MusicSheet).where(MusicSheet.source_ref.in_(refs)))).scalars()} if refs else {}
    kinds: dict[str, dict[str, int]] = {}
    orders: dict[str, tuple[int, int]] = {}
    if codes:
        for code, kind, n in (await db.execute(
                select(MusicTrackEvent.code, MusicTrackEvent.kind, func.count(MusicTrackEvent.id))
                .where(MusicTrackEvent.code.in_(codes)).group_by(MusicTrackEvent.code, MusicTrackEvent.kind))).all():
            kinds.setdefault(code, {})[kind] = int(n)
        for code, n, cents in (await db.execute(
                select(MusicOrder.track_code, func.count(MusicOrder.id), func.coalesce(func.sum(MusicOrder.amount_cents), 0))
                .where(MusicOrder.track_code.in_(codes), MusicOrder.status == ORDER_PAID)
                .group_by(MusicOrder.track_code))).all():
            orders[code] = (int(n), int(cents))
    return {
        "links_sent": int(links_total), "links_with_visits": int(clicked),
        "next_offset": offset + limit if offset + limit < clicked else None,
        "rows": [{
            "code": code, "instagram": link.instagram_username if link else None,
            "source": link.source if link else None, "sheet_ref": link.sheet_ref if link else None,
            "sheet": ({"title": f"{sheet_urls[link.sheet_ref][0]} — {sheet_urls[link.sheet_ref][1]}", "url": sheet_urls[link.sheet_ref][2]}
                      if link is not None and link.sheet_ref in sheet_urls else None),
            "sent_at": _iso(link.created_at) if link else None, "first_at": _iso(first), "last_at": _iso(last),
            "events": int(n), "visits": int(visits), "kinds": kinds.get(code, {}),
            "orders": orders.get(code, (0, 0))[0], "revenue_cents": orders.get(code, (0, 0))[1],
        } for code, first, last, n, visits, link in rows],
    }


@router.get("/tracking/{code}")
async def tracking_detail(code: str, db: AsyncSession = Depends(get_db)):
    link = await db.get(MusicTrackLink, code)
    events = (await db.execute(select(MusicTrackEvent).where(MusicTrackEvent.code == code)
                               .order_by(MusicTrackEvent.created_at, MusicTrackEvent.id).limit(2000))).scalars().all()
    if link is None and not events:
        raise HTTPException(404, "Lien inconnu")
    orders = (await db.execute(select(MusicOrder).where(MusicOrder.track_code == code)
                               .order_by(MusicOrder.created_at))).scalars().all()
    return {
        "code": code, "instagram": link.instagram_username if link else None, "source": link.source if link else None,
        "sheet_ref": link.sheet_ref if link else None, "sent_at": _iso(link.created_at) if link else None,
        "events": [{"at": _iso(e.created_at), "visit": e.visit, "kind": e.kind, "path": e.path, "data": e.data} for e in events],
        "orders": [{"public_id": o.public_id, "status": o.status, "amount_cents": o.amount_cents,
                    "created_at": _iso(o.created_at), "promo_code": o.promo_code} for o in orders],
    }
