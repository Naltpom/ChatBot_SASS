"""Endpoints PUBLICS (sans authentification) — données marketing non sensibles."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.constants import CODE_TO_MODULE
from src.core.database import get_db
from src.models.billing import BillingProduct

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/billing/pricing")
async def public_pricing(db: AsyncSession = Depends(get_db)):
    """Tarifs PUBLICS pour la landing (SANS auth) lus depuis billing_products :
    socle, paliers IA, modules, variante BYOK et remises d'intro. Indépendant de
    billing_enabled() (le catalogue existe en base même billing OFF). Aucune donnée
    sensible — uniquement des prix marketing affichés au public. Source de vérité :
    changer un prix / retirer une remise d'intro côté admin se reflète ici."""
    rows = (await db.execute(
        select(BillingProduct).order_by(BillingProduct.id)
    )).scalars().all()
    by_code = {r.code: r for r in rows}
    base = by_code.get("base")
    byok = by_code.get("mod_ai_byok")
    ai_tiers = [{
        "id": r.code, "label": r.label,
        "included_replies": r.included_replies or 0,
        "price_cents": r.unit_amount,
    } for r in rows if r.kind == "ai_tier" and r.is_active]
    modules = [{
        "key": CODE_TO_MODULE.get(r.code, r.code),
        "label": r.label, "price_cents": r.unit_amount,
        "description": r.description or r.label,
    } for r in rows if r.kind == "module" and r.is_active and r.code != "mod_ai_byok"]
    intro = {("default" if r.code == "base" else r.code): r.intro_percent
             for r in rows if r.intro_percent is not None}
    return {
        "currency": "eur",
        "base_price_cents": base.unit_amount if base is not None else 0,
        "byok_price_cents": byok.unit_amount if byok is not None else None,
        "ai_tiers": ai_tiers,
        "modules": modules,
        "intro_discounts": intro,
        "tax_note": "TVA non applicable, art. 293 B du CGI",
    }
