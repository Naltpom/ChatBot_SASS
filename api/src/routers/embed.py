"""Surface EMBED (prefix /api/embed) : éditeur de bot embarqué (front dashboard
rendu en iframe dans le back-office WordPress du plugin).

Authentification = access token scope='embed' (require_embed_token), qui porte le
bot_id ET l'user : AUCUN endpoint ne prend de path param bot_id (le bot vient du
token). Couche MINCE réutilisant l'existant : validation d'arbre (tree_engine),
sanitisation d'apparence + gating module (widget_helpers / bot_service /
entitlement_service), exactement comme la surface /api/account du plugin.

Les permissions par champ du dashboard s'appliquent (FIELD_PERMS) : on re-résout la
membership via require_bot_access (l'owner perso / superadmin = accès complet) pour
qu'un membre d'org SANS la perm requise ne puisse pas éditer via l'embed (anti-escalade).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_bot_access, require_embed_token
from src.core.time import utcnow
from src.models.bot import Bot
from src.models.user import User
from src.routers.bots_helpers import FIELD_PERMS, _check_bot_perm
from src.routers.widget_helpers import sanitize_design
from src.services import tree_jobs
from src.services.bot_service import enforce_config_modules, strip_notnull_nulls
from src.services.entitlement_service import resolve
from src.services.tree_engine import TreeError, validate_tree

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/embed", tags=["embed-plugin"])


# --- Payloads --------------------------------------------------------------

class EmbedTreePayload(BaseModel):
    tree_json: dict


class EmbedAppearancePayload(BaseModel):
    design_json: dict


# --- Bot (lecture) ---------------------------------------------------------

@router.get("/bot")
async def get_bot(ctx: tuple[Bot, User] = Depends(require_embed_token)):
    """Bot ciblé par le token embed (config éditable par l'éditeur embarqué)."""
    bot, _user = ctx
    return {
        "id": bot.id,
        "name": bot.name,
        "mode": bot.mode,
        "tree_json": bot.tree_json,
        "design_json": bot.design_json,
        "public_key": bot.public_key,
    }


# --- Arbre (écriture) ------------------------------------------------------

@router.put("/bot/tree")
async def put_tree(
    body: EmbedTreePayload,
    ctx: tuple[Bot, User] = Depends(require_embed_token),
    db: AsyncSession = Depends(get_db),
):
    """Enregistre l'arbre. 422 si structurellement invalide. Permission par champ
    `tree_json` = 'context' (parité dashboard) ; aucun gating de module."""
    bot, user = ctx
    membership = await require_bot_access(bot, user, db)
    _check_bot_perm(user, membership, bot, FIELD_PERMS["tree_json"])
    try:
        validate_tree(body.tree_json)
    except TreeError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    bot.tree_json = body.tree_json
    bot.updated_at = utcnow()
    await db.commit()
    await db.refresh(bot)
    return {"tree_json": bot.tree_json, "updated_at": bot.updated_at.isoformat()}


# --- Apparence -------------------------------------------------------------

@router.patch("/bot/appearance")
async def patch_appearance(
    body: EmbedAppearancePayload,
    ctx: tuple[Bot, User] = Depends(require_embed_token),
    db: AsyncSession = Depends(get_db),
):
    """Édite UNIQUEMENT design_json. Même pipeline que la surface /api/account du
    plugin : sanitisation widget + gating module (retrait du « Powered by » ->
    white-label), permission par champ `design_json` = 'appearance'. Aucune garde de
    facturation (l'apparence reste éditable hors abonnement, décision actée plugin)."""
    bot, user = ctx
    membership = await require_bot_access(bot, user, db)
    _check_bot_perm(user, membership, bot, FIELD_PERMS["design_json"])

    data = {"design_json": sanitize_design(body.design_json)}
    strip_notnull_nulls(data)                   # parité (no-op si dict non-null)
    ent = await resolve(db, bot)
    enforce_config_modules(bot, data, ent)      # gate poweredBy -> whitelabel
    if "design_json" in data:
        bot.design_json = data["design_json"]
    await db.commit()
    await db.refresh(bot)
    return {"design_json": bot.design_json}


# --- Génération d'arbre : poll JSON (même contrat que /api/account) ---------

@router.get("/generate-status")
async def generate_status(
    job_id: str,
    ctx: tuple[Bot, User] = Depends(require_embed_token),
):
    """État d'un job de génération. 404 si le job n'est pas au couple (user, bot)
    porté par le token (anti-énumération, même garde que /api/account)."""
    bot, user = ctx
    job = await tree_jobs.get(job_id)
    if job is None or job.get("user_id") != user.id or job.get("bot_id") != bot.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Génération introuvable")
    return {
        "status": job.get("status"),
        "stage": job.get("stage"),
        "pct": job.get("pct"),
        "tree_json": job.get("tree_json"),
        "error": job.get("error"),
    }
