"""Endpoints PUBLICS (sans authentification) — données marketing non sensibles."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import CODE_TO_MODULE
from src.core.database import get_db
from src.core.time import utcnow
from src.models.billing import BillingProduct
from src.models.prospect import Prospect
from src.services import demo_service, prospecting_service
from src.services.captcha import verify_turnstile_token
from src.services.rate_limit import (
    demo_chat_global_limiter, demo_chat_ip_limiter, demo_global_limiter,
    demo_ip_limiter, ip_limiter,
)

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
      3. captcha vérifié EN AMONT : sa réussite émet un `chat_token` (jeton court
         signé) qui débloque le chat IA (sinon le chat — dépense par message —
         serait accessible sans captcha sur une URL déjà en cache) ;
      4. CACHE : URL déjà vue et fraîche => arbre resservi instantanément ;
      5. sinon génération réelle : captcha OBLIGATOIRE, puis quota IP/jour, puis
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

    # Captcha EN AMONT (token Turnstile à usage unique) : sa réussite conditionne
    # l'émission du chat_token qui gardera la dépense IA par message de /demo-chat.
    captcha_ok = await verify_turnstile_token(body.turnstile_token, ip)
    chat_token = demo_service.make_chat_token(h, ip) if captcha_ok else None

    # Cache (arbre gratuit/instantané ; le chat n'est débloqué que si captcha OK).
    row = await demo_service.get_row(db, h)
    if row is not None and demo_service.is_fresh(row, settings.DEMO_CACHE_TTL_DAYS):
        row.hits += 1
        await db.commit()
        return {"tree_json": row.tree_json, "cached": True, "session_id": h, "chat_token": chat_token}

    # Cache miss : génération réelle, captcha OBLIGATOIRE. On lit la page AVANT de
    # décompter les quotas : un site injoignable/vide (422) ne brûle ni le quota
    # du visiteur ni le plafond global (qui ne compte que de vraies générations IA).
    if not captcha_ok:
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

    await demo_service.upsert(db, h, url_norm, tree, source, existing=row)
    return {"tree_json": tree, "cached": False, "session_id": h, "chat_token": chat_token}


class HistoryItem(BaseModel):
    # Borne la taille PAR ITEM dès la validation (endpoint public sans auth) :
    # extra ignoré, role contraint, content plafonné.
    model_config = ConfigDict(extra="ignore")
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=2000)


class DemoChatIn(BaseModel):
    # session_id = url_hash renvoyé par /demo-tree ; url = repli si absent.
    session_id: str | None = Field(None, max_length=128)
    url: str | None = Field(None, max_length=2000)
    # Jeton émis par /demo-tree après un captcha valide (preuve d'ouverture de session).
    chat_token: str | None = Field(None, max_length=512)
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=40)


@router.post("/public/demo-chat")
async def public_demo_chat(
    body: DemoChatIn, request: Request, db: AsyncSession = Depends(get_db),
):
    """Chat IA de la démo : réponse bornée AU CONTENU SCRAPÉ de l'URL générée.

    Le chat IA est une dépense PAR MESSAGE sur un endpoint public : il est gardé
    par un `chat_token` (jeton court signé émis par /demo-tree APRÈS un captcha,
    lié à url_hash + IP). Ainsi un session_id devinable (= sha256 de l'URL) ne
    suffit pas à chatter sans captcha. Quotas PAR MESSAGE dédiés (IP/jour +
    global/jour). Ordre : flag -> flood IP -> jeton -> row fraîche -> quotas ->
    contexte (backfill éventuel, métré) -> IA.
    """
    if not settings.demo_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Démo indisponible.")

    ip = request.client.host if request.client else "unknown"
    if not await ip_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop de requêtes, patientez un instant.")

    # Retrouve la génération (session_id = url_hash, ou repli sur l'URL).
    h = (body.session_id or "").strip()
    if not h:
        if not body.url:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Session de démo manquante.")
        try:
            h = demo_service.url_hash(demo_service.normalize_url(body.url))
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    # Jeton de chat OBLIGATOIRE (preuve d'un captcha récent pour cette génération+IP).
    if not demo_service.check_chat_token(body.chat_token, h, ip):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Session de chat expirée — régénérez le chatbot.")

    row = await demo_service.get_row(db, h)
    if row is None or not demo_service.is_fresh(row, settings.DEMO_CACHE_TTL_DAYS):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Générez d'abord le chatbot (session expirée).")

    # Quotas PAR MESSAGE (chaque message = 1 appel Gemini), AVANT tout fetch/IA
    # — y compris le backfill paresseux ci-dessous, qui est ainsi métré.
    if not await demo_chat_ip_limiter.check(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de messages atteinte pour aujourd'hui — réessayez demain.")
    if not await demo_chat_global_limiter.check("demo"):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Le chat de démo a atteint sa capacité du jour — revenez plus tard.")

    # Contexte = texte scrapé. Lignes pré-V2 : backfill paresseux (une fois).
    source = row.source_text
    if not source:
        try:
            source = await demo_service.build_demo_source(row.url)
        except demo_service.TreeGenerationError as e:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Régénérez le chatbot pour activer le chat.") from e
        row.source_text = source
        await db.commit()

    host = demo_service.host_of(row.url)
    try:
        reply = await demo_service.demo_reply(
            source, host, [h.model_dump() for h in body.history], body.message)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    except demo_service.TreeGenerationError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
    return {"reply": reply}


# --- Désinscription prospection à froid (opt-out RGPD, lien du cold email) ----
# Réponse NEUTRE et idempotente quel que soit le résultat : un token invalide ou
# un prospect inexistant renvoie le MÊME message qu'un opt-out réussi (ne révèle
# jamais l'existence d'un prospect). GET pour un clic depuis l'email.
_OPTOUT_MESSAGE = (
    "Votre demande a bien été prise en compte. "
    "Vous ne serez plus contacté par Chapote. "
    "Pour toute question : rgpd@chapote.fr"
)


@router.get("/prospect/optout", response_class=PlainTextResponse)
async def prospect_optout(token: str = "", db: AsyncSession = Depends(get_db)):
    """Désinscription d'un prospect via le lien signé du cold email (art. 21 RGPD).
    Idempotent, réponse neutre (ne révèle pas l'existence du prospect)."""
    prospect_id = prospecting_service.parse_optout_token(token)
    if prospect_id is not None:
        p = await db.get(Prospect, prospect_id)
        if p is not None and not p.opt_out:
            p.opt_out = True
            p.opt_out_at = utcnow()
            await db.commit()
    return PlainTextResponse(_OPTOUT_MESSAGE)
