"""Surface EXTERNE « onboarding guidé » du plugin WordPress (prefix /api/account).

Couche MINCE (même contrat d'auth que routers/external/account.py) : access token
scope='plugin' (require_oauth_token -> User), puis ownership RÉUTILISÉE du dashboard
(require_bot_access -> anti-énumération 404). Toute l'intelligence (classement
d'URLs, repli sitemap, recommandation déterministe, génération d'arbre) vit dans
services/onboarding_service.py + services/tree_engine.py ; ce routeur ne fait
qu'orchestrer + valider les entrées.

Particularités :
- generate-from-urls : rate-limit `treegen_limiter` (coût provider, comme
  routers/tree.py) AVANT de lancer la tâche de fond ; le job porte le bot_id pour
  que generate-status n'autorise QUE le couple (user, bot).
- tree PUT : permission par champ `tree_json` (FIELD_PERMS = 'context'), 422 sur
  arbre invalide, AUCUN gating de module (l'arbre est du contenu, pas un module).
- preview-token / embed-token : émettent les JWT courts dédiés (core/security.py).
"""
import json
import logging
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import (
    EMBED_TOKEN_EXPIRE_MINUTES,
    WIDGET_PREVIEW_EXPIRE_MINUTES,
    create_embed_token,
    create_widget_preview_token,
    require_bot_access,
    require_oauth_token,
)
from src.models.bot import Bot
from src.models.user import Membership, User
from src.routers.bots_helpers import FIELD_PERMS, _check_bot_perm
from src.services import kb_service, onboarding_service, tree_jobs
from src.services.billing_service import catalog_payload
from src.services.bot_service import apply_tree_update
from src.services.rate_limit import treegen_limiter
from src.services.tree_engine import TreeError, prune_tree_with_removed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/account", tags=["onboarding-plugin"])


# --- Payloads --------------------------------------------------------------

class DiscoverUrlsPayload(BaseModel):
    site_url: str
    # Liste de pages remontée par le plugin (0..300). Vide -> repli sitemap.
    urls: list[str] = Field(default_factory=list, max_length=300)


class GenerateFromUrlsPayload(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=15)
    description: Optional[str] = None
    visitors_per_month: Optional[int] = Field(None, ge=0)
    exclude_modules: list[str] = Field(default_factory=list)


class RecommendationPayload(BaseModel):
    description: Optional[str] = None
    visitors_per_month: Optional[int] = Field(None, ge=0)
    # Tolérant : le proxy plugin peut relayer l'arbre sous une forme imparfaite
    # (objet, chaîne JSON, voire liste). On accepte tout ici et on le normalise
    # côté handler (_coerce_tree) — un type strict `dict` provoquait un 422 qui
    # vidait la recommandation (offre « rien de sélectionné »).
    tree_json: Optional[Any] = None


class TreePayload(BaseModel):
    tree_json: dict


class PrunePayload(BaseModel):
    kept_modules: list[str] = Field(default_factory=list)


# --- Ownership (réutilise la garde dashboard) ------------------------------

async def _load_bot(db: AsyncSession, bot_id: int, user: User) -> tuple[Bot, Optional[Membership]]:
    """(bot, membership) après require_bot_access (404 anti-énumération). membership
    = None pour un owner perso / superadmin (accès complet)."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    membership = await require_bot_access(bot, user, db)
    return bot, membership


def _register_source_domains(bot: Bot, urls: list[str]) -> bool:
    """Ajoute l'hôte des URLs sources à bot.allowed_domains (additif, dédupliqué,
    normalisé minuscule). Renvoie True si la liste a changé. Sûr : c'est le propre
    site du user (auth + ownership en amont) et le domaine pour lequel il construit
    son bot. `_domain_allowed` matche l'hôte exact -> on stocke l'hôte tel quel."""
    existing = list(bot.allowed_domains or [])
    seen = {d.lower().strip() for d in existing if isinstance(d, str)}
    changed = False
    for raw in urls:
        host = (urlparse(raw).hostname or "").lower()
        if host and host not in seen:
            existing.append(host)
            seen.add(host)
            changed = True
    if changed:
        bot.allowed_domains = existing  # réassignation -> détection de changement JSON
    return changed


def _coerce_tree(raw: Any) -> Optional[dict]:
    """Normalise un tree_json relayé par le proxy plugin : dict tel quel, chaîne
    JSON -> dict, sinon None (le handler retombe alors sur l'arbre sauvé du bot)."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


# --- Découverte d'URLs -----------------------------------------------------

@router.post("/bots/{bot_id}/discover-urls")
async def discover_urls(
    bot_id: int, body: DiscoverUrlsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Classe les pages du site WP pour la génération d'arbre. Source = la liste
    fournie par le plugin (`plugin_list`) ; repli sur le sitemap (`sitemap`) si
    le plugin n'a rien remonté ou si rien n'est exploitable ; `none` sinon."""
    await _load_bot(db, bot_id, user)
    suggested: list[dict] = []
    source = "none"
    if body.urls:
        suggested = onboarding_service.rank_wp_urls(body.site_url, body.urls)
        if suggested:
            source = "plugin_list"
    if not suggested:
        sitemap_urls = await onboarding_service.sitemap_fallback(body.site_url)
        suggested = onboarding_service.rank_wp_urls(body.site_url, sitemap_urls)
        if suggested:
            source = "sitemap"
    return {"site_url": body.site_url, "suggested": suggested, "source": source}


# --- Génération d'arbre (job éphémère lié au bot) --------------------------

@router.post("/bots/{bot_id}/generate-from-urls")
async def generate_from_urls(
    bot_id: int, body: GenerateFromUrlsPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Démarre la génération d'arbre IA depuis 1..15 URLs (tâche de fond, lue via
    generate-status). 404 si non ayant droit, 429 si le quota de génération du jour
    est atteint (treegen_limiter, anti-coût provider — pas un gating de plan)."""
    bot, _ = await _load_bot(db, bot_id, user)
    if not await treegen_limiter.check(f"treegen:user:{user.id}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations d'arbre atteinte pour aujourd'hui — réessayez demain")
    # Le bot est construit POUR ce site : on enregistre son domaine dans
    # allowed_domains (additif) pour que le widget s'y affiche EN PRODUCTION sans
    # étape manuelle. (L'aperçu in-admin reste piloté par preview_token : il teste
    # un bot encore NON payé, que le contrôle de servabilité bloquerait sinon.)
    if _register_source_domains(bot, body.urls):
        await db.commit()
    job_id = await tree_jobs.create(user.id, bot_id=bot.id)
    tree_jobs.spawn(onboarding_service.run_bot_generation(
        job_id, body.urls, body.description, exclude_modules=body.exclude_modules))
    # EN PARALLÈLE (n'attend pas, ne bloque pas la réponse) : on ingère les mêmes
    # pages dans la base de connaissances (RAG) du bot, pour que le mode IA libre
    # réponde DEPUIS le site. Embeddings locaux = zéro coût externe, toujours actif
    # (pas de gating module à l'ingestion). Best-effort & idempotent côté service.
    tree_jobs.spawn(onboarding_service.run_kb_ingestion(bot.id, body.urls))
    return {"job_id": job_id}


@router.get("/bots/{bot_id}/generate-status")
async def generate_status(
    bot_id: int, job_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """État d'un job de génération (poll JSON). 404 si le job n'est pas au couple
    (user, bot) — pas de fuite des générations d'autrui (anti-énumération)."""
    await _load_bot(db, bot_id, user)
    job = await tree_jobs.get(job_id)
    if job is None or job.get("user_id") != user.id or job.get("bot_id") != bot_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Génération introuvable")
    return tree_jobs.public_status(job)


# --- Recommandation (déterministe, pilotée catalogue) ----------------------

@router.post("/bots/{bot_id}/recommendation")
async def recommendation(
    bot_id: int, body: RecommendationPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Recommande palier IA + modules pour le bot (déterministe). L'arbre utilisé
    est `body.tree_json` s'il est fourni, sinon l'arbre courant du bot."""
    bot, _ = await _load_bot(db, bot_id, user)
    catalog = await catalog_payload(db)
    tree = _coerce_tree(body.tree_json) or bot.tree_json
    # bot_has_kb_sources (et non les chunks) : une KB EN COURS d'ingestion compte,
    # pour ne pas rater la reco RAG à cause d'une course avec l'ingestion async.
    has_kb = await kb_service.bot_has_kb_sources(db, bot.id)
    result = onboarding_service.recommend(catalog, tree, body.description,
                                          body.visitors_per_month, bot.mode, has_kb=has_kb)
    # Explication PERSONNALISÉE générée par l'IA (2-3 phrases sur mesure). Best-effort :
    # None si l'IA échoue -> l'offre retombe sur `explanations` (statique) déjà dans
    # result. Petit texte, NON compté dans treegen_limiter.
    result["explanation_ai"] = await onboarding_service.generate_plan_pitch(
        bot.name, body.description, result["recommended_modules"],
        body.visitors_per_month, result["expected_replies"])
    return result


@router.get("/bots/{bot_id}/recommendation")
async def recommendation_get(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Commodité : recommandation sur l'arbre COURANT du bot (sans corps)."""
    bot, _ = await _load_bot(db, bot_id, user)
    catalog = await catalog_payload(db)
    # KB en cours d'ingestion incluse (cf. recommendation POST) : tolère la course.
    has_kb = await kb_service.bot_has_kb_sources(db, bot.id)
    return onboarding_service.recommend(catalog, bot.tree_json, None, None, bot.mode, has_kb=has_kb)


# --- Arbre (lecture / écriture / élagage proposé) --------------------------

@router.get("/bots/{bot_id}/tree")
async def get_tree(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Arbre courant du bot."""
    bot, _ = await _load_bot(db, bot_id, user)
    return {"tree_json": bot.tree_json}


@router.put("/bots/{bot_id}/tree")
async def put_tree(
    bot_id: int, body: TreePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Enregistre l'arbre. 422 si structurellement invalide (validate_tree).
    Permission par champ `tree_json` = 'context' (parité dashboard, FIELD_PERMS) ;
    AUCUN gating de module (l'arbre est du contenu éditable, pas un module payant)."""
    bot, membership = await _load_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, FIELD_PERMS["tree_json"])
    try:
        tree_json, updated_at = await apply_tree_update(bot, body.tree_json, db)
    except TreeError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return {"tree_json": tree_json, "updated_at": updated_at}


@router.post("/bots/{bot_id}/tree/prune")
async def prune_tree(
    bot_id: int, body: PrunePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Propose un arbre élagué aux modules conservés (`kept_modules`) SANS le
    sauvegarder : renvoie l'arbre élagué + les ids de noeuds retirés (diff pour
    l'aperçu côté plugin). La sauvegarde se fait via PUT /tree."""
    bot, _ = await _load_bot(db, bot_id, user)
    pruned, removed = prune_tree_with_removed(bot.tree_json, set(body.kept_modules))
    return {"tree_json": pruned, "removed_node_ids": removed}


# --- Jetons courts (aperçu widget / éditeur embarqué) ----------------------

@router.post("/bots/{bot_id}/preview-token")
async def preview_token(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Émet un token d'aperçu widget (scope='widget_preview') pour CE bot : le
    widget bootstrap/session l'accepte en `?preview_token=` pour bypasser
    origine+captcha en session sans side-effects."""
    bot, _ = await _load_bot(db, bot_id, user)
    return {"preview_token": create_widget_preview_token(bot.id, user.id),
            "expires_in": WIDGET_PREVIEW_EXPIRE_MINUTES * 60}


@router.post("/bots/{bot_id}/embed-token")
async def embed_token(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Émet un token d'éditeur embarqué (scope='embed') pour CE bot : la surface
    /api/embed l'accepte en Bearer (bot_id porté par le token)."""
    bot, _ = await _load_bot(db, bot_id, user)
    return {"embed_token": create_embed_token(bot.id, user.id),
            "expires_in": EMBED_TOKEN_EXPIRE_MINUTES * 60}
