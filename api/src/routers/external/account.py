"""Surface EXTERNE « compte » du plugin WordPress (prefix /api/account).

Couche MINCE : authentifiée par un access token scope='plugin' (require_oauth_token,
qui renvoie un User EXACTEMENT comme get_current_user), puis bornée par l'ownership
RÉUTILISÉE du dashboard (require_billing_owner pour l'écriture/facturation,
require_bot_access pour la lecture — même anti-énumération 404). Toute la logique
métier (création de bot, sanitisation d'apparence, gating de modules, checkout /
abonnement) est consommée via des SERVICES PARTAGÉS (services/billing_service,
services/bot_service, services/entitlement_service, widget_helpers) : ZÉRO
duplication, et — depuis PR-19 — AUCUN appel à un symbole PRIVÉ d'un router frère.

Dette PR-20 (résiduelle, documentée) : le checkout (`open_checkout`, entaché de
toute la cascade Checkout) et les modifications d'abonnement (`subscription_update`
/ `subscription_cancel`, des ENDPOINTS publics du router billing) sont encore
délégués au router billing tant que son split en service n'est pas fait (PR-20).
Ce sont des symboles PUBLICS — plus aucun `_privé` d'un autre router.

Décision actée : l'apparence (design_json) reste éditable même si le bot n'est pas
payé (status 'inactive') — AUCUNE garde de facturation sur l'édition. Le verrou
d'activation du widget est 100 % côté plugin (qui lit `billing_status`). On EXPOSE
donc billing_status sans rien bloquer côté serveur (le gate poweredBy ->
white-label reste, à l'identique du dashboard, car c'est un gate de MODULE — pas
une garde sur l'état de paiement du bot).
"""
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import (
    require_billing_owner,
    require_bot_access,
    require_oauth_token,
)
from src.core.time import utcnow
from src.models.billing import (
    BillingWordPressLink,
    BillingWordPressLinkOut,
    BotConfigPayload,
)
from src.models.bot import Bot, BotCreate, BotOut
from src.models.user import User
# Logique métier PARTAGÉE via SERVICES (PR-19) — plus d'appel aux symboles privés
# des routers frères.
from src.routers.widget_helpers import sanitize_design
from src.services import stripe_service
from src.services.billing_service import (
    DISABLED,
    billable_bots,
    catalog_payload,
    validate_config_modules,
)
from src.services.bot_service import (
    billing_status_for_bots,
    enforce_config_modules,
    strip_notnull_nulls,
)
from src.services.entitlement_service import resolve, resolve_many
# DETTE PR-20 (documentée) : délégation à des ENDPOINTS PUBLICS du router billing
# (checkout/abonnement) + leurs schémas de requête, et à l'endpoint public de
# création de bot. À remplacer par des services dédiés au split de billing.py.
from src.routers.billing import (
    SubscriptionCancelPayload,
    SubscriptionUpdatePayload,
    open_checkout,
    subscription_cancel,
    subscription_update,
)
from src.routers.bots import create_personal_bot

router = APIRouter(prefix="/api/account", tags=["account-plugin"])


# --- Payloads --------------------------------------------------------------

class AppearancePayload(BaseModel):
    design_json: dict


class AccountCheckoutPayload(BaseModel):
    config: BotConfigPayload
    grouping: Optional[str] = None
    consent: Optional[bool] = False
    success_url: str
    cancel_url: str


class AccountLinkPayload(BaseModel):
    wordpress_site_url: str
    wordpress_post_id: Optional[int] = None


class AccountSubUpdatePayload(BaseModel):
    config: BotConfigPayload
    consent: Optional[bool] = False
    # P4 : redirections de retour si la modif relance un Checkout (bot pas encore
    # souscrit). Optionnelles ; validées + threadées par billing.subscription_update
    # (anti open-redirect, même hôte que le site WP lié — comme le Checkout plugin).
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


# --- Helpers (anti open-redirect du checkout) ------------------------------

def _redirect_host(raw: str) -> str:
    """Origine réseau (netloc = host[:port], minuscule) d'une URL de redirection
    http(s) ABSOLUE, ou 400.

    Anti open-redirect : success_url/cancel_url sont des URLs vers lesquelles
    Stripe renverra le NAVIGATEUR du client après paiement. Sans contrôle, un appel
    authentifié pourrait fabriquer une redirection vers un site de phishing maquillé
    en suite du paiement. On exige donc une URL http(s) absolue (scheme + netloc).

    On compare le NETLOC (host:port), pas le seul hostname : un site WP lié sur un
    port non standard (https://exemple.fr:8443) ne doit pas valider une redirection
    vers le même host sur un AUTRE port (https://exemple.fr:9000)."""
    parsed = urlparse((raw or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "URL de redirection invalide (http(s) absolu requis)",
        )
    return parsed.netloc.lower()


async def _assert_checkout_urls(
    db: AsyncSession, bot: Bot, success_url: str, cancel_url: str
) -> None:
    """Valide les redirections du Checkout plugin (anti open-redirect) :

    1) success_url ET cancel_url sont des URLs http(s) absolues du MÊME hôte (on ne
       ramène le client que sur un seul domaine cohérent) ;
    2) si le bot est DÉJÀ lié à un site WordPress (BillingWordPressLink), cet hôte
       DOIT être celui du site lié — le retour de paiement reste sur le domaine du
       marchand. Avant tout lien (1er checkout), on accepte tout hôte http(s) bien
       formé (on ne connaît pas encore le site canonique du bot)."""
    s_host = _redirect_host(success_url)
    c_host = _redirect_host(cancel_url)
    if s_host != c_host:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "success_url et cancel_url doivent partager le même hôte",
        )
    link = (await db.execute(
        select(BillingWordPressLink).where(BillingWordPressLink.bot_id == bot.id)
    )).scalar_one_or_none()
    if link is not None:
        # Comparaison sur le NETLOC (host:port) — même critère que _redirect_host —
        # pour que le PORT du site lié soit pris en compte.
        link_host = urlparse(link.wordpress_site_url).netloc
        if link_host and link_host.lower() != s_host:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Les URLs de redirection doivent pointer vers le site WordPress lié",
            )


# --- Compte (identité / catalogue) -----------------------------------------

@router.get("/me")
async def account_me(user: User = Depends(require_oauth_token)):
    """Identité du détenteur du token plugin (couche MINIME) : {email, name}.
    Sert au plugin à afficher le compte connecté côté WordPress. Aucune lecture DB
    (require_oauth_token a déjà chargé le User)."""
    return {"email": user.email, "name": user.name}


@router.get("/catalog")
async def account_catalog(db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_oauth_token)):
    """Catalogue de facturation pour le plugin — SORTIE STRICTEMENT IDENTIQUE à
    GET /api/billing/catalog (même contrat de prix, aucun prix codé en dur côté
    plugin). RÉUTILISE le service factorisé billing_service.catalog_payload (zéro
    duplication). Billing OFF ⇒ {billing: disabled}."""
    return await catalog_payload(db)


# --- Bots (lecture / création) ---------------------------------------------

@router.get("/bots")
async def list_account_bots(db: AsyncSession = Depends(get_db),
                            user: User = Depends(require_oauth_token)):
    """Bots facturables par le détenteur du token plugin (ses bots perso + bots des
    orgs dont il est owner) — RÉUTILISE billing_service.billable_bots. Liste allégée
    pour le plugin : {id, name, public_key, billing_status, modules}.

    billing_status est calculé par le MÊME chemin que le badge dashboard
    (bot_service.billing_status_for_bots : statut brut de la ligne d'entitlement,
    None si billing OFF) ; `modules` provient du resolver d'entitlements (état
    effectif), résolu en UNE requête pour TOUTE la liste (resolve_many, anti N+1)."""
    bots = await billable_bots(db, user)
    statuses = await billing_status_for_bots(db, [b.id for b in bots])
    # Résolution GROUPÉE des entitlements (1 select pour toute la liste) au lieu d'un
    # resolve() par bot (N+1). Sémantique identique à resolve() bot par bot.
    ents = await resolve_many(db, bots)
    out = []
    for b in bots:
        ent = ents[b.id]
        billing_status, _trial = statuses.get(b.id, (None, None))
        out.append({
            "id": b.id,
            "name": b.name,
            "public_key": b.public_key,
            "billing_status": billing_status,
            "modules": sorted(ent.modules),
        })
    return out


@router.post("/bots", response_model=BotOut)
async def create_account_bot(body: BotCreate, db: AsyncSession = Depends(get_db),
                             user: User = Depends(require_oauth_token)):
    """Crée un bot PERSO (owner = détenteur du token). RÉUTILISE EXACTEMENT le
    chemin dashboard bots.create_personal_bot (-> _seed_pending_entitlement)."""
    return await create_personal_bot(body, db, user)


@router.get("/bots/{bot_id}")
async def get_account_bot(bot_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_oauth_token)):
    """Détail d'un bot pour le plugin (anti-énumération 404 via require_bot_access).

    Expose le status effectif (resolver), billing_status (chemin dashboard),
    modules, public_key et design_json (l'apparence reste lisible/éditable même hors
    abonnement)."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_bot_access(bot, user, db)
    ent = await resolve(db, bot)
    statuses = await billing_status_for_bots(db, [bot.id])
    billing_status, _trial = statuses.get(bot.id, (None, None))
    return {
        "id": bot.id,
        "name": bot.name,
        "public_key": bot.public_key,
        "status": ent.status,
        "billing_status": billing_status,
        "modules": sorted(ent.modules),
        "design_json": bot.design_json,
    }


# --- Apparence (design_json seulement) -------------------------------------

@router.patch("/bots/{bot_id}/appearance", response_model=BotOut)
async def update_account_appearance(
    bot_id: int, body: AppearancePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Édite UNIQUEMENT design_json. RÉUTILISE la sanitisation du widget
    (widget_helpers.sanitize_design) puis le gating dashboard
    (bot_service.strip_notnull_nulls, puis bot_service.enforce_config_modules — qui
    ne gate QUE le retrait du badge « Powered by » -> MODULE_WHITELABEL ;
    couleurs/polices restent gratuites).

    Aucune garde de FACTURATION sur l'apparence (décision actée) : un bot 'inactive'
    reste personnalisable (le verrou d'activation est côté plugin). require_bot_access
    (l'owner / membership None = accès complet ; pas de nouvelle permission BOT_PERMS).

    NB : contrairement au PATCH dashboard (qui stocke design_json tel quel), la
    surface plugin SANITISE l'entrée — choix plus sûr pour une entrée externe."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_bot_access(bot, user, db)

    # Même pipeline que le PATCH dashboard, restreint à design_json.
    data = {"design_json": sanitize_design(body.design_json)}
    strip_notnull_nulls(data)                   # parité (no-op si dict non-null)
    ent = await resolve(db, bot)
    enforce_config_modules(bot, data, ent)      # gate poweredBy -> whitelabel
    if "design_json" in data:
        bot.design_json = data["design_json"]
    await db.commit()
    await db.refresh(bot)

    out = BotOut.from_bot(bot)
    statuses = await billing_status_for_bots(db, [bot.id])
    out.billing_status, out.trial_end = statuses.get(bot.id, (None, None))
    return out


# --- Facturation (checkout / lien WP / abonnement) -------------------------

@router.post("/bots/{bot_id}/checkout")
async def account_checkout(
    bot_id: int, body: AccountCheckoutPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Ouvre un Checkout Stripe pour le bot, avec retour sur le site WordPress
    (success_url/cancel_url surchargés, P4). Owner-only (require_billing_owner).
    RÉUTILISE billing.open_checkout (endpoint public, dette PR-20). Billing OFF ⇒
    {billing: disabled}."""
    if not stripe_service.billing_enabled():
        return DISABLED
    validate_config_modules(body.config)
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)
    # Anti open-redirect : borne les hôtes des URLs de retour AVANT toute session.
    await _assert_checkout_urls(db, bot, body.success_url, body.cancel_url)

    grouping = body.grouping or user.billing_grouping
    result = await open_checkout(
        db, user, bot, grouping, body.config, consent=bool(body.consent),
        success_url=body.success_url, cancel_url=body.cancel_url,
    )
    await db.commit()
    return {"checkout_url": result.get("checkout_url")}


@router.post("/bots/{bot_id}/link", response_model=BillingWordPressLinkOut)
async def link_account_bot(
    bot_id: int, body: AccountLinkPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """UPSERT du lien canonique bot <-> site WordPress (1 ligne par bot, bot_id
    UNIQUE) : crée la ligne, ou met à jour l'URL/post_id + updated_at si elle existe.
    Owner-only (require_billing_owner). L'URL est validée (http(s) absolu) et
    normalisée en origine (scheme://host[:port])."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    await require_billing_owner(bot, user, db)

    parsed = urlparse((body.wordpress_site_url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "wordpress_site_url invalide (http(s) absolu requis)",
        )
    site_url = f"{parsed.scheme}://{parsed.netloc}"

    link = (await db.execute(
        select(BillingWordPressLink).where(BillingWordPressLink.bot_id == bot.id)
    )).scalar_one_or_none()
    if link is None:
        link = BillingWordPressLink(bot_id=bot.id)
        db.add(link)
    link.wordpress_site_url = site_url
    link.wordpress_post_id = body.wordpress_post_id
    link.updated_at = utcnow()
    await db.commit()
    await db.refresh(link)
    return BillingWordPressLinkOut.model_validate(link)


@router.post("/bots/{bot_id}/subscription/update")
async def account_subscription_update(
    bot_id: int, body: AccountSubUpdatePayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Modifie le plan/modules d'un bot déjà souscrit (prorata). DÉLÈGUE au chemin
    dashboard billing.subscription_update (require_billing_owner inclus ; mêmes
    réponses : {status:'updated'} | {status:'needs_checkout', checkout_url} | billing
    OFF {billing:'disabled'}).

    success_url/cancel_url (P4) sont threadés tels quels : ils ne servent QUE si la
    modif relance un Checkout (bot non encore souscrit -> needs_checkout). Validés
    par billing.subscription_update (anti open-redirect, même hôte que le site WP
    lié) comme le Checkout plugin. Absents ⇒ fallback APP_URL."""
    payload = SubscriptionUpdatePayload(
        bot_id=bot_id, config=body.config, consent=bool(body.consent),
        success_url=body.success_url, cancel_url=body.cancel_url)
    return await subscription_update(payload, db, user)


@router.post("/bots/{bot_id}/subscription/cancel")
async def account_subscription_cancel(
    bot_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_oauth_token),
):
    """Annule l'abonnement du bot en fin de période. DÉLÈGUE au chemin dashboard
    billing.subscription_cancel (require_billing_owner inclus ; renvoie
    {status:'cancel_scheduled', current_period_end} | billing OFF {billing:'disabled'})."""
    payload = SubscriptionCancelPayload(bot_id=bot_id)
    return await subscription_cancel(payload, db, user)
