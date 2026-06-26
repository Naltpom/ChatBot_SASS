"""Endpoints PUBLICS (sans authentification) — données marketing non sensibles."""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import CODE_TO_MODULE
from src.core.database import get_db
from src.models.billing import BillingProduct
from src.services import demo_service
from src.services.captcha import verify_turnstile_token
from src.services.rate_limit import demo_global_limiter, demo_ip_limiter, ip_limiter

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


# ---------------------------------------------------------------------------
# Démo publique « 1 URL -> chatbot » (page /demo, SANS auth)
# ---------------------------------------------------------------------------
class DemoTreeIn(BaseModel):
    url: str = Field(..., min_length=3, max_length=2000)
    # Token Turnstile (front). Optionnel : si Turnstile n'est pas configuré côté
    # serveur (dev), la vérification est ignorée — voir verify_turnstile_token.
    turnstile_token: str | None = Field(None, max_length=4000)


@router.get("/public/demo-config")
async def public_demo_config():
    """Etat de la démo pour le front (afficher/masquer la page proprement)."""
    return {"enabled": settings.demo_active}


@router.post("/public/demo-tree")
async def public_demo_tree(
    body: DemoTreeIn, request: Request, db: AsyncSession = Depends(get_db),
):
    """Génère un arbre de chatbot depuis UNE URL, pour un visiteur anonyme.

    Anti-abus en couches (ordre = du moins cher au plus cher) :
      1. flag DEMO_ENABLED (404 si coupé) ;
      2. anti-flood IP grossier (même bucket que le widget) — borne aussi les
         cache hits qui écrivent hits++ ;
      3. CACHE : URL déjà vue et fraîche => on resert l'arbre SANS IA, sans
         captcha ni quota consommés (gratuit, instantané) ;
      4. sinon génération réelle : captcha Turnstile, puis quota/IP/jour, puis
         plafond GLOBAL/jour (coupe-circuit Gemini) — le tout AVANT l'appel IA.
    """
    if not settings.demo_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Démo indisponible.")

    ip = request.client.host if request.client else "unknown"
    if not await ip_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes, patientez un instant.")

    try:
        url_norm = demo_service.normalize_url(body.url)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    h = demo_service.url_hash(url_norm)

    # 3) Cache (pas d'IA, pas de captcha, pas de quota).
    row = await demo_service.get_row(db, h)
    if row is not None and demo_service.is_fresh(row, settings.DEMO_CACHE_TTL_DAYS):
        row.hits += 1
        await db.commit()
        return {"tree_json": row.tree_json, "cached": True}

    # 4) Génération réelle. Ordre = captcha -> fetch -> quotas -> IA. On lit la
    #    page AVANT de décompter les quotas : ainsi un site injoignable/vide
    #    (422) ne brûle NI le quota du visiteur NI le plafond global, qui ne
    #    compte donc que de vraies générations IA. Le fetch reste borné par
    #    l'anti-flood IP + le captcha ci-dessus.
    if not await verify_turnstile_token(body.turnstile_token, ip):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vérification anti-robot échouée, réessayez.")
    try:
        source = await demo_service.build_demo_source(url_norm)
    except demo_service.TreeGenerationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    if not await demo_ip_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations atteinte pour aujourd'hui — réessayez demain.")
    if not await demo_global_limiter.check("demo"):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "La démo a atteint sa capacité du jour — revenez un peu plus tard.")
    try:
        tree = await demo_service.generate_tree(source)
    except demo_service.TreeGenerationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    await demo_service.upsert(db, h, url_norm, tree, existing=row)
    return {"tree_json": tree, "cached": False}
