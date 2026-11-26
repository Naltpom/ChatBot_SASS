"""Boutique de partitions : prix, codes promo, fichiers, aperçus, livraison.

Le PRIX est toujours calculé ici (jamais par le navigateur ni par Stripe) :
1. chaque partition vaut son prix propre (`MusicSheet.price_cents`) ou le prix
   général (`MusicSettings.unit_price_cents`) ;
2. plusieurs instruments d'un même morceau dans le panier = au plus le prix du
   lot (`bundle_price_cents`) pour ce morceau ;
3. un code promo (pourcentage ou montant) s'applique au total ;
4. le total est réparti sur les lignes (centimes exacts) et envoyé à Stripe
   Checkout en `price_data` : Stripe encaisse le montant que le back lui donne.

Les fichiers d'une partition vivent dans MUSIC_DIR/<id>/ (privé) :
`partition.pdf`, `p1.png` (page 1 nette, offerte), `p2.jpg`… (pages floutées
fabriquées ICI, côté serveur : l'image nette des pages payantes ne sort jamais),
`cover.jpg` (couverture de la vidéo, facultative).
"""
from __future__ import annotations

import hashlib
import hmac
import html
import logging
import re
import shutil
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.music import (
    ORDER_PAID,
    PROMO_AMOUNT,
    PROMO_PERCENT,
    PROMO_TRIAL,
    MusicOrder,
    MusicOrderItem,
    MusicPromoCode,
    MusicSettings,
    MusicSheet,
)
from src.services.email_service import send_email

logger = logging.getLogger(__name__)

# Stripe refuse un paiement par carte sous 0,50 € (EUR).
STRIPE_MIN_CENTS = 50
NEW_DAYS = 7
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PAGES = 40


class MusicError(Exception):
    """Erreur métier présentable (code stable + message)."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


# --------------------------------------------------------------------------
# Libellés
# --------------------------------------------------------------------------

INSTRUMENT_LABELS = {
    "piano": "Piano", "violon": "Violin", "guitare": "Guitar", "batterie": "Drums",
    "violoncelle": "Cello", "flute": "Flute", "flûte": "Flute", "saxophone": "Saxophone",
    "trompette": "Trumpet", "harpe": "Harp", "ukulele": "Ukulele", "basse": "Bass",
}


def instrument_label(key: str) -> str:
    return INSTRUMENT_LABELS.get((key or "").lower(), (key or "").capitalize() or "Sheet")


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text[:150] or "piece"


def euros(cents: int, lang: str = "en") -> str:
    s = f"{cents / 100:.2f}".replace(".", ",")
    return f"{s} €"


# --------------------------------------------------------------------------
# Prix
# --------------------------------------------------------------------------

async def get_settings(db: AsyncSession) -> MusicSettings:
    """La ligne unique des prix (créée avec les valeurs par défaut si absente)."""
    row = (await db.execute(select(MusicSettings).where(MusicSettings.id == 1))).scalar_one_or_none()
    if row is None:
        row = MusicSettings(id=1, unit_price_cents=199, bundle_price_cents=299, currency="eur")
        db.add(row)
        await db.flush()
    return row


def sheet_price(sheet: MusicSheet, st: MusicSettings) -> int:
    return sheet.price_cents if sheet.price_cents is not None else st.unit_price_cents


def promo_problem(promo: Optional[MusicPromoCode], now: Optional[datetime] = None) -> Optional[str]:
    """Raison pour laquelle un code ne s'applique pas (None = valable)."""
    if promo is None:
        return "promo_unknown"
    now = now or utcnow()
    if not promo.active:
        return "promo_inactive"
    if promo.expires_at is not None and promo.expires_at <= now:
        return "promo_expired"
    if promo.max_uses is not None and promo.uses >= promo.max_uses:
        return "promo_used_up"
    return None


def _split(total: int, weights: list[int]) -> list[int]:
    """Répartit `total` centimes au prorata de `weights` (somme exacte)."""
    if not weights:
        return []
    wsum = sum(weights)
    if wsum <= 0:
        base = [total // len(weights)] * len(weights)
        base[-1] += total - sum(base)
        return base
    parts = [total * w // wsum for w in weights]
    rest = total - sum(parts)
    # les centimes restants vont aux plus grosses lignes
    order = sorted(range(len(weights)), key=lambda i: -weights[i])
    for i in order[:rest]:
        parts[i] += 1
    return parts


@dataclass
class QuoteLine:
    sheet: MusicSheet
    list_cents: int      # prix affiché
    price_cents: int     # prix payé (après lot et code promo)


@dataclass
class Quote:
    lines: list[QuoteLine]
    list_total_cents: int
    subtotal_cents: int          # après lot
    discount_cents: int          # code promo
    total_cents: int
    currency: str
    bundles: list[str] = field(default_factory=list)   # piece_slug des lots appliqués
    promo: Optional[MusicPromoCode] = None
    promo_error: Optional[str] = None
    promos: list = field(default_factory=list)       # tous les codes appliqués (2 au plus)
    promo_cuts: list = field(default_factory=list)   # remise de chaque code, dans l'ordre de promos

    def as_dict(self) -> dict:
        return {
            "lines": [{"sheet_id": l.sheet.id, "list_cents": l.list_cents, "price_cents": l.price_cents}
                      for l in self.lines],
            "list_total_cents": self.list_total_cents,
            "subtotal_cents": self.subtotal_cents,
            "bundle_savings_cents": self.list_total_cents - self.subtotal_cents,
            "discount_cents": self.discount_cents,
            "total_cents": self.total_cents,
            "currency": self.currency,
            "bundles": self.bundles,
            "promo_code": "+".join(p.code for p in self.promos) if self.promos else None,
            "promo_codes": [p.code for p in self.promos],
            # détail par code pour le récapitulatif (« INSTA20 · −20 % … −0,49 € »)
            "promos": [{"code": p.code, "kind": p.kind, "value": p.value, "cents": c}
                       for p, c in zip(self.promos, self.promo_cuts)],
            "promo_error": self.promo_error,
        }


async def find_promo(db: AsyncSession, code: Optional[str]) -> Optional[MusicPromoCode]:
    code = (code or "").strip().upper()
    if not code:
        return None
    return (await db.execute(select(MusicPromoCode).where(MusicPromoCode.code == code))).scalar_one_or_none()


MAX_PROMOS = 2


async def quote(db: AsyncSession, sheet_ids: list[int], promo_code: Optional[str] = None,
                promo_codes: Optional[list[str]] = None) -> Quote:
    ids = list(dict.fromkeys(int(i) for i in sheet_ids))  # dédoublonné, ordre gardé
    if not ids:
        raise MusicError("empty_cart", "Choose at least one sheet.")
    if len(ids) > 50:
        raise MusicError("cart_too_big", "Too many sheets in one order.")
    rows = (await db.execute(select(MusicSheet).where(MusicSheet.id.in_(ids)))).scalars().all()
    by_id = {s.id: s for s in rows}
    sheets = [by_id[i] for i in ids if i in by_id and by_id[i].published]
    if len(sheets) != len(ids):
        raise MusicError("sheet_unavailable", "One of these sheets is not for sale.", 404)
    st = await get_settings(db)

    groups: dict[str, list[MusicSheet]] = {}
    for s in sheets:
        groups.setdefault(s.piece_slug, []).append(s)

    lines: list[QuoteLine] = []
    bundles: list[str] = []
    for slug, group in groups.items():
        lists = [sheet_price(s, st) for s in group]
        group_total = sum(lists)
        if len(group) >= 2 and st.bundle_price_cents is not None and st.bundle_price_cents < group_total:
            group_total = st.bundle_price_cents
            bundles.append(slug)
        for s, lp, paid in zip(group, lists, _split(group_total, lists)):
            lines.append(QuoteLine(sheet=s, list_cents=lp, price_cents=paid))

    list_total = sum(l.list_cents for l in lines)
    subtotal = sum(l.price_cents for l in lines)

    # jusqu'à MAX_PROMOS codes cumulés, appliqués l'un après l'autre (-20 % puis -10 % = -28 %)
    codes = list(dict.fromkeys(c.strip().upper() for c in ([promo_code] if promo_code else []) + list(promo_codes or [])
                                if c and c.strip()))
    promos: list[MusicPromoCode] = []
    promo_cuts: list[int] = []
    promo_error, discount = None, 0
    if len(codes) > MAX_PROMOS:
        promo_error, codes = "promo_too_many", codes[:MAX_PROMOS]
    rest = subtotal
    for code in codes:
        found = await find_promo(db, code)
        err = promo_problem(found)
        if err is None and (found.kind == PROMO_TRIAL or (found.applies_to or "sheet") == "sub"):
            err = "promo_unknown"  # code réservé à l'abonnement : sans effet sur une partition
        if err is not None:
            promo_error = promo_error or err
            continue
        cut = 0
        if found.kind == PROMO_PERCENT:
            cut = rest * max(0, min(100, found.value)) // 100
        elif found.kind == PROMO_AMOUNT:
            cut = max(0, min(found.value, rest))
        rest -= cut
        discount += cut
        promos.append(found)
        promo_cuts.append(cut)
    promo = promos[0] if promos else None
    total = subtotal - discount
    if discount:
        cuts = _split(discount, [l.price_cents for l in lines])
        for l, cut in zip(lines, cuts):
            l.price_cents -= cut
    return Quote(lines=lines, list_total_cents=list_total, subtotal_cents=subtotal,
                 discount_cents=discount, total_cents=total, currency=st.currency,
                 bundles=bundles, promo=promo, promo_error=promo_error, promos=promos, promo_cuts=promo_cuts)


# --------------------------------------------------------------------------
# Liens de téléchargement (clé HMAC dérivée de la commande : rien à stocker)
# --------------------------------------------------------------------------

def download_key(public_id: str) -> str:
    mac = hmac.new(settings.JWT_SECRET_KEY.encode(), f"music-order:{public_id}".encode(), hashlib.sha256)
    return mac.hexdigest()[:40]


def check_key(public_id: str, key: Optional[str]) -> bool:
    return bool(key) and hmac.compare_digest(download_key(public_id), key)


def links_valid(order: MusicOrder, now: Optional[datetime] = None) -> bool:
    if order.status != ORDER_PAID or order.paid_at is None:
        return False
    return (now or utcnow()) < order.paid_at + timedelta(days=settings.MUSIC_DOWNLOAD_DAYS)


def download_url(order: MusicOrder, item: MusicOrderItem) -> str:
    base = settings.MUSIC_URL.rstrip("/")
    return f"{base}/api/music/download/{order.public_id}/{item.id}?k={download_key(order.public_id)}"


def thanks_url(order: MusicOrder) -> str:
    return f"{settings.MUSIC_URL.rstrip('/')}/thanks?order={order.public_id}&k={download_key(order.public_id)}"


def piece_url(slug: str, instrument: Optional[str] = None) -> str:
    url = f"{settings.MUSIC_URL.rstrip('/')}/s/{slug}"
    return f"{url}?i={instrument}" if instrument else url


def preview_url(sheet: MusicSheet, page: int = 1) -> str:
    ext = "png" if page == 1 else "jpg"
    return f"{settings.MUSIC_URL.rstrip('/')}/api/music/sheets/{sheet.id}/pages/{page}.{ext}"


# --------------------------------------------------------------------------
# Fichiers et aperçus
# --------------------------------------------------------------------------

def sheet_dir(sheet_id: int) -> Path:
    return Path(settings.MUSIC_DIR) / str(int(sheet_id))


def pdf_path(sheet_id: int) -> Path:
    return sheet_dir(sheet_id) / "partition.pdf"


def page_path(sheet_id: int, page: int) -> Path:
    return sheet_dir(sheet_id) / (f"p{page}.png" if page == 1 else f"p{page}.jpg")


def clear_page_path(sheet_id: int, page: int) -> Path:
    return sheet_dir(sheet_id) / f"c{page}.png"


def cover_path(sheet_id: int) -> Path:
    return sheet_dir(sheet_id) / "cover.jpg"


def render_previews(pdf: bytes, out_dir: Path) -> int:
    """Rend les pages du PDF : page 1 nette (PNG), suivantes floutées (JPEG).

    Le flou est irréversible (réduction à ~110 px de large puis agrandissement
    et flou gaussien) : on voit la mise en page, pas les notes. Renvoie le
    nombre de pages. Lève MusicError si le PDF est illisible."""
    from PIL import Image, ImageFilter

    if not pdf.startswith(b"%PDF"):
        raise MusicError("bad_pdf", "Le fichier n'est pas un PDF.")
    if not shutil.which("pdftoppm"):
        raise MusicError("no_renderer", "pdftoppm (poppler-utils) manque sur le serveur.", 500)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.pdf"
        src.write_bytes(pdf)
        try:
            subprocess.run(["pdftoppm", "-r", "110", "-l", str(MAX_PAGES), "-png", str(src), str(Path(tmp) / "pg")],
                           check=True, capture_output=True, timeout=120)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise MusicError("bad_pdf", f"PDF illisible : {exc}")
        pages = sorted(Path(tmp).glob("pg-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
        if not pages:
            raise MusicError("bad_pdf", "PDF sans page.")
        for old in out_dir.glob("p*.*"):
            old.unlink()
        for old in out_dir.glob("c*.png"):
            old.unlink()
        for n, p in enumerate(pages, start=1):
            with Image.open(p) as im:
                im = im.convert("RGB")
                if im.width > 1240:
                    im = im.resize((1240, round(im.height * 1240 / im.width)), Image.LANCZOS)
                # page nette, servie seulement aux acheteurs (lecteur « Play »)
                im.save(out_dir / f"c{n}.png", optimize=True)
                if n == 1 and len(pages) == 1:
                    # partition d'une seule page : offrir la page entière = tout donner. Le haut
                    # reste lisible (titre, premiers systèmes), le reste est flouté.
                    w, h = im.size
                    cut = int(h * 0.38)
                    small = im.resize((110, max(1, round(h * 110 / w))), Image.BILINEAR)
                    blurred = small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(10))
                    blurred.paste(im.crop((0, 0, w, cut)), (0, 0))
                    blurred.save(out_dir / "p1.png", optimize=True)
                elif n == 1:
                    im.save(out_dir / "p1.png", optimize=True)
                else:
                    w, h = im.size
                    small = im.resize((110, max(1, round(h * 110 / w))), Image.BILINEAR)
                    big = small.resize((w // 2, h // 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6))
                    big.save(out_dir / f"p{n}.jpg", quality=55)
        return len(pages)


def preview_cut(cursor: Optional[list], pages: int) -> Optional[float]:
    """Hauteur (fraction de la page 1) jusqu'où l'aperçu est net : la fin de la dernière ligne jouée par l'extrait
    audio (PREVIEW_SECONDS). None sans curseur (aperçu par défaut). Si l'extrait déborde sur la page 2, la page 1
    est nette en entier ; une partition d'une seule page n'est jamais montrée au-delà de la moitié."""
    if not cursor:
        return None
    jouees = [e for e in cursor if e[0] < PREVIEW_SECONDS]
    if not jouees:
        return 0.2
    if any(e[1] > 0 for e in jouees):
        cut = 1.0
    else:
        cut = max(e[4] for e in jouees) + 0.012  # bas du dernier système joué, et un peu d'air
    if pages <= 1:
        cut = min(cut, 0.5)
    return max(0.12, min(1.0, cut))


def render_page1_preview(sheet_id: int, cut: Optional[float]) -> bool:
    """Réécrit l'aperçu public de la page 1 à partir de la page nette (c1.png) : net jusqu'à `cut`, flouté dessous
    (même flou irréversible que les autres pages). cut None ou >= 1 : page 1 nette en entier (sauf partition d'une page,
    déjà coupée par render_previews)."""
    from PIL import Image, ImageFilter
    d = sheet_dir(sheet_id)
    src = d / "c1.png"
    if not src.exists() or cut is None:
        return False
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        if cut >= 1.0:
            im.save(d / "p1.png", optimize=True)
            return True
        y = int(h * cut)
        small = im.resize((110, max(1, round(h * 110 / w))), Image.BILINEAR)
        blurred = small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(10))
        blurred.paste(im.crop((0, 0, w, y)), (0, 0))
        blurred.save(d / "p1.png", optimize=True)
    return True


def save_sheet_files(sheet_id: int, pdf: Optional[bytes], cover: Optional[bytes]) -> Optional[int]:
    """Écrit le PDF (et ses aperçus) et la couverture. Renvoie le nombre de pages si PDF."""
    d = sheet_dir(sheet_id)
    d.mkdir(parents=True, exist_ok=True)
    pages = None
    if pdf is not None:
        if len(pdf) > MAX_PDF_BYTES:
            raise MusicError("pdf_too_big", "PDF trop lourd (20 Mo au plus).")
        pages = render_previews(pdf, d)
        tmp = d / "partition.pdf.tmp"
        tmp.write_bytes(pdf)
        tmp.replace(pdf_path(sheet_id))
    if cover is not None:
        from io import BytesIO

        from PIL import Image
        try:
            with Image.open(BytesIO(cover)) as im:
                im = im.convert("RGB")
                im.thumbnail((720, 1280))
                im.save(cover_path(sheet_id), quality=82)
        except Exception as exc:  # image illisible : on ignore la couverture
            logger.warning("music: couverture illisible pour %s : %s", sheet_id, exc)
    return pages


# --------------------------------------------------------------------------
# Paiement confirmé : état + e-mail
# --------------------------------------------------------------------------

async def order_items(db: AsyncSession, order: MusicOrder) -> list[tuple[MusicOrderItem, MusicSheet]]:
    rows = (await db.execute(
        select(MusicOrderItem, MusicSheet)
        .join(MusicSheet, MusicSheet.id == MusicOrderItem.sheet_id)
        .where(MusicOrderItem.order_id == order.id)
        .order_by(MusicOrderItem.id)
    )).all()
    return [(i, s) for i, s in rows]


async def mark_paid(db: AsyncSession, order: MusicOrder, *, email: Optional[str] = None,
                    payment_intent: Optional[str] = None) -> bool:
    """Passe la commande à « payée » (idempotent). Renvoie True si elle vient de l'être."""
    if order.status == ORDER_PAID:
        return False
    # passage conditionnel : si le webhook et la page de retour arrivent ensemble, un seul « gagne »
    # (un seul e-mail de livraison)
    from sqlalchemy import update
    won = (await db.execute(update(MusicOrder).where(MusicOrder.id == order.id, MusicOrder.status != ORDER_PAID)
                            .values(status=ORDER_PAID).returning(MusicOrder.id))).first()
    if won is None:
        await db.refresh(order)
        return False
    order.status = ORDER_PAID
    order.paid_at = utcnow()
    if email:
        order.email = email.strip()[:320]
    if payment_intent:
        order.stripe_payment_intent = payment_intent
    # l'utilisation du code promo est réservée à la commande (reserve_promo), pas comptée ici
    await db.flush()
    return True


async def reserve_promo(db: AsyncSession, promo_id: int) -> bool:
    """Réserve une utilisation du code de façon atomique (pas de course entre commandes simultanées) :
    False si le code est épuisé, inactif ou expiré à cet instant."""
    from sqlalchemy import or_ as _or, update
    now = utcnow()
    row = (await db.execute(
        update(MusicPromoCode)
        .where(MusicPromoCode.id == promo_id, MusicPromoCode.active.is_(True),
               _or(MusicPromoCode.expires_at.is_(None), MusicPromoCode.expires_at > now),
               _or(MusicPromoCode.max_uses.is_(None), MusicPromoCode.uses < MusicPromoCode.max_uses))
        .values(uses=MusicPromoCode.uses + 1)
        .returning(MusicPromoCode.id))).first()
    return row is not None


async def release_promo(db: AsyncSession, order) -> None:
    """Rend l'utilisation réservée d'une commande ou d'un abonnement qui n'aboutit pas (expiré, refusé)."""
    from sqlalchemy import update
    codes = [c for c in (order.promo_code or "").split("+") if c]
    if codes:
        await db.execute(update(MusicPromoCode).where(MusicPromoCode.code.in_(codes), MusicPromoCode.uses > 0)
                         .values(uses=MusicPromoCode.uses - 1))
    elif getattr(order, "promo_code_id", None):
        await db.execute(update(MusicPromoCode).where(MusicPromoCode.id == order.promo_code_id, MusicPromoCode.uses > 0)
                         .values(uses=MusicPromoCode.uses - 1))


_TEXTS = {
    "en": {
        "subject": "Your sheet music — Ghost Hands",
        "hello": "Thank you for your order!",
        "intro": "Here are your sheets. Each link downloads the PDF; they work for {days} days.",
        "total": "Order total",
        "help": "A problem with your order? Reply to this e-mail or write to music@chapote.fr.",
        "legal": "Sheets for personal use. Ghost Hands Sheets is a service of Chapote (chapote.fr). VAT not applicable, art. 293 B CGI.",
        "button": "Download",
        "page": "Open my order page",
    },
    "fr": {
        "subject": "Vos partitions — Ghost Hands",
        "hello": "Merci pour votre commande !",
        "intro": "Voici vos partitions. Chaque lien télécharge le PDF ; ils restent valables {days} jours.",
        "total": "Total de la commande",
        "help": "Un problème avec votre commande ? Répondez à cet e-mail ou écrivez à music@chapote.fr.",
        "legal": "Partitions pour un usage personnel. Ghost Hands Sheets est un service de Chapote (chapote.fr). TVA non applicable, art. 293 B du CGI.",
        "button": "Télécharger",
        "page": "Ouvrir ma commande",
    },
}


def build_delivery_email(order: MusicOrder, items: list[tuple[MusicOrderItem, MusicSheet]]) -> tuple[str, str, str]:
    t = _TEXTS.get(order.lang, _TEXTS["en"])
    lines_txt, rows_html = [], []
    for item, sheet in items:
        url = download_url(order, item)
        name = f"{sheet.piece_title} — {sheet.instrument_label}"
        lines_txt.append(f"- {name}\n  {url}")
        rows_html.append(
            f'<tr><td style="padding:14px 0;border-bottom:1px solid #e8e8ed;font:600 15px Arial,sans-serif;color:#1d1d1f">'
            f'{html.escape(name)}<br><span style="font:400 13px Arial,sans-serif;color:#6e6e73">'
            f'{sheet.pages} pages · PDF</span></td>'
            f'<td style="padding:14px 0;border-bottom:1px solid #e8e8ed;text-align:right">'
            f'<a href="{html.escape(url)}" style="background:#0071e3;color:#fff;text-decoration:none;'
            f'border-radius:999px;padding:10px 18px;font:600 14px Arial,sans-serif;display:inline-block">'
            f'{t["button"]}</a></td></tr>')
    total = euros(order.amount_cents, order.lang)
    text = "\n\n".join([
        t["hello"], t["intro"].format(days=settings.MUSIC_DOWNLOAD_DAYS), "\n".join(lines_txt),
        f'{t["total"]} : {total}', f'{t["page"]} : {thanks_url(order)}', t["help"], t["legal"],
    ])
    body = (
        '<div style="background:#f5f5f7;padding:28px 12px"><table role="presentation" width="100%" '
        'style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px">'
        '<tr><td style="font:700 20px Arial,sans-serif;color:#1d1d1f;padding-bottom:6px">Ghost Hands '
        '<span style="color:#6e6e73;font-weight:600">Sheets</span></td></tr>'
        f'<tr><td style="font:700 26px Arial,sans-serif;color:#1d1d1f;padding:14px 0 6px">{html.escape(t["hello"])}</td></tr>'
        f'<tr><td style="font:400 15px/1.5 Arial,sans-serif;color:#424245;padding-bottom:10px">'
        f'{html.escape(t["intro"].format(days=settings.MUSIC_DOWNLOAD_DAYS))}</td></tr>'
        f'<tr><td><table role="presentation" width="100%">{"".join(rows_html)}</table></td></tr>'
        f'<tr><td style="font:600 15px Arial,sans-serif;color:#1d1d1f;padding:16px 0">{html.escape(t["total"])} : {total}</td></tr>'
        f'<tr><td style="font:400 14px Arial,sans-serif;padding-bottom:16px"><a href="{html.escape(thanks_url(order))}" '
        f'style="color:#0066cc">{html.escape(t["page"])}</a></td></tr>'
        f'<tr><td style="font:400 13px/1.5 Arial,sans-serif;color:#6e6e73">{html.escape(t["help"])}<br><br>'
        f'{html.escape(t["legal"])}</td></tr></table></div>'
    )
    return t["subject"], text, body


async def deliver(db: AsyncSession, order: MusicOrder) -> bool:
    """Envoie l'e-mail de livraison (si l'adresse est connue). Ne lève jamais."""
    if not order.email:
        return False
    items = await order_items(db, order)
    subject, text, body = build_delivery_email(order, items)
    ok = await send_email([order.email], subject, text, html=body, reply_to=settings.MUSIC_REPLY_TO,
                          from_addr=settings.MUSIC_EMAIL_FROM)
    if ok:
        order.emailed_at = utcnow()
        await db.flush()
    return ok


# --------------------------------------------------------------------------
# Notes du lecteur « Play » (notes.json de la vidéo, compacté)
# --------------------------------------------------------------------------

PREVIEW_SECONDS = 25.0


def notes_path(sheet_id: int) -> Path:
    return sheet_dir(sheet_id) / "notes.json"


def compact_notes(raw: dict) -> dict:
    """notes.json de la production -> forme compacte servie au lecteur :
    notes = [[t, d, p, v, main (0 gauche, 1 droite), rôle (1 mélodie/instrument, 0 accompagnement), élément?]]."""
    if not isinstance(raw, dict) or not isinstance(raw.get("notes"), list):
        raise ValueError("champ notes manquant")
    out = []
    for n in raw["notes"][:20000]:
        try:
            t, d, p = float(n["t"]), float(n.get("d") or 0.2), int(n["p"])
        except (KeyError, TypeError, ValueError):
            continue
        row = [round(t, 3), round(max(0.05, d), 3), p, int(n.get("v") or 80),
               1 if n.get("main") == "D" else 0, 0 if n.get("role") == "fond" else 1]
        if n.get("element"):
            row.append(str(n["element"])[:30])
        out.append(row)
    out.sort(key=lambda r: r[0])
    duree = float(raw.get("duree") or (max((r[0] + r[1] for r in out), default=0)))
    return {"instrument": str(raw.get("instrument") or ""), "duration": round(duree, 2),
            "bpm": raw.get("bpm") if isinstance(raw.get("bpm"), (int, float)) else None, "notes": out}


def save_notes(sheet_id: int, raw: dict) -> bool:
    import json as _json
    data = compact_notes(raw)
    if not data["notes"]:
        return False
    d = sheet_dir(sheet_id)
    d.mkdir(parents=True, exist_ok=True)
    notes_path(sheet_id).write_text(_json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return True


def load_notes(sheet_id: int) -> Optional[dict]:
    import json as _json
    p = notes_path(sheet_id)
    if not p.exists():
        return None
    return _json.loads(p.read_text(encoding="utf-8"))


def preview_notes(data: dict) -> dict:
    """Aperçu : seulement les PREVIEW_SECONDS premières secondes."""
    notes = [n for n in data["notes"] if n[0] < PREVIEW_SECONDS]
    out = {**data, "notes": notes, "duration": min(data["duration"], PREVIEW_SECONDS),
           "full_duration": data["duration"], "preview_seconds": PREVIEW_SECONDS}
    if data.get("cursor"):
        out["cursor"] = [e for e in data["cursor"] if e[0] < PREVIEW_SECONDS]
    return out


MAX_AUDIO_BYTES = 30 * 1024 * 1024


def audio_path(sheet_id: int, preview: bool = False) -> Path:
    """Son exact du Reel (MP3) : complet pour l'acheteur, extrait de PREVIEW_SECONDS pour tous."""
    return sheet_dir(sheet_id) / ("audio_preview.mp3" if preview else "audio.mp3")


def save_audio(sheet_id: int, full: bytes, preview: bytes) -> None:
    for data in (full, preview):
        if len(data) > MAX_AUDIO_BYTES or len(data) < 4 or not (data[:3] == b"ID3" or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0)):
            raise MusicError("bad_audio", "Le son doit être un MP3.")
    d = sheet_dir(sheet_id)
    d.mkdir(parents=True, exist_ok=True)
    audio_path(sheet_id).write_bytes(full)
    audio_path(sheet_id, True).write_bytes(preview)


def cursor_path(sheet_id: int) -> Path:
    return sheet_dir(sheet_id) / "cursor.json"


def compact_cursor(raw: dict, pages: Optional[int] = None) -> list:
    """curseur.json de la production -> [[t, page, x, y0, y1]] (page à partir de 0, positions en fractions de la page A4),
    trié par temps. Sert le curseur de lecture posé sur la feuille."""
    if not isinstance(raw, dict) or not isinstance(raw.get("events"), list):
        raise ValueError("champ events manquant")
    out = []
    for e in raw["events"][:20000]:
        try:
            t, pg, x, y0, y1 = float(e[0]), int(e[1]), float(e[2]), float(e[3]), float(e[4])
        except (IndexError, TypeError, ValueError):
            continue
        if t < 0 or pg < 0 or (pages and pg >= pages) or not (0 <= x <= 1 and 0 <= y0 < y1 <= 1):
            continue
        out.append([round(t, 3), pg, round(x, 4), round(y0, 4), round(y1, 4)])
    out.sort(key=lambda r: r[0])
    return out


def save_cursor(sheet_id: int, raw: Optional[dict], pages: Optional[int] = None) -> bool:
    """Enregistre le curseur (ou l'efface si raw est None : un nouveau PDF sans curseur rend l'ancien faux)."""
    import json as _json
    p = cursor_path(sheet_id)
    ev = compact_cursor(raw, pages) if raw is not None else []
    if not ev:
        p.unlink(missing_ok=True)
        return False
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_json.dumps(ev, separators=(",", ":")), encoding="utf-8")
    return True


def load_cursor(sheet_id: int) -> Optional[list]:
    import json as _json
    p = cursor_path(sheet_id)
    return _json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
