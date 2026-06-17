"""Bots : listes/creation par organisation, operations par bot (acces = membre
de l'org du bot, ou superadmin). Export/import config JSON versionnable,
snippets d'integration (script HTML, iframe, GTM).

Les helpers d'acces/permission et la validation metier des champs riches sont
factorises dans routers/bots_helpers.py (partages avec inbox.py et kb.py)."""
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel as _BaseModel
from pydantic import ValidationError
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import (
    get_current_user,
    require_bot_admin,
    require_org_access,
    require_org_admin,
)
from src.core.time import utcnow
from src.models.analytics import InsightsReport, InsightsReportOut
from src.models.bot import Bot, BotCreate, BotOut, BotUpdate
from src.models.conversation import Conversation, Message
from src.models.lead import Lead, LeadOut
from src.models.user import BOT_PERMS, Membership, Organization, User
from src.routers.bots_helpers import (
    CONFIG_FIELDS,
    FIELD_PERMS,
    _check_actions,
    _check_bot_perm,
    _check_mcp_servers,
    _check_triggers,
    _get_accessible_bot,
    _mask_bot_out,
    _merge_action_secrets,
    _merge_mcp_secrets,
    attach_week_stats,
)
from src.services.crypto import encrypt_secret
from src.services.rate_limit import insights_limiter, treegen_limiter
from src.services.tree_engine import TreeError, validate_tree
from src.services.usage_service import bots_week_stats, bots_week_stats_for_ids

router = APIRouter(prefix="/api", tags=["bots"])


def _bot_limiter_key(bot: Bot) -> str:
    """Cle de rate-limit IA (treegen/insights) : par organisation pour un bot
    d'equipe, par utilisateur proprietaire pour un bot perso."""
    return f"org:{bot.organization_id}" if bot.organization_id else f"user:{bot.owner_user_id}"


# --- Meta : sources canoniques des permissions (lecture seule) ---

@router.get("/meta/permissions")
async def permissions_meta(user: User = Depends(get_current_user)):
    """Expose les deux sources de verite backend des permissions, en lecture
    seule (aucun effet sur l'enforcement) :
    - bot_perms : permissions par bot accordables aux members (models/user.py)
    - field_perms : permission requise par champ modifiable (bots_helpers.py)
    Sert au front a verifier la parite avec ses propres tables (anti-divergence).
    Auth dashboard requise, comme les autres routes du router."""
    return {"bot_perms": BOT_PERMS, "field_perms": FIELD_PERMS}


# --- Mes bots (ownership polymorphe : perso + equipes) ---

@router.get("/bots", response_model=list[BotOut])
async def list_my_bots(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Tous les bots accessibles : mes bots perso + ceux des organisations dont
    je suis membre. Un superadmin voit SES bots perso + ceux de SES orgs (pas
    tout le parc — la vue back-office est dans /api/admin)."""
    # Une SEULE requete Membership : my_org_ids (filtre des bots d'equipe) et
    # by_org (masquage des champs selon la perm) en sont tous deux derives.
    memberships = (await db.execute(
        select(Membership).where(Membership.user_id == user.id)
    )).scalars().all()
    by_org = {m.organization_id: m for m in memberships}
    conditions = [Bot.owner_user_id == user.id]
    if by_org:
        conditions.append(Bot.organization_id.in_(list(by_org)))
    bots = (await db.execute(
        select(Bot).where(or_(*conditions)).order_by(Bot.created_at)
    )).scalars().all()

    week = await bots_week_stats_for_ids(db, {b.id for b in bots})

    out = []
    for b in bots:
        # Bot perso (owner) ou superadmin -> membership None (tous droits) ;
        # bot d'equipe -> membership dans l'org (None aussi pour superadmin)
        if b.owner_user_id == user.id:
            membership = None
        else:
            membership = None if user.is_superadmin else by_org.get(b.organization_id)
        bo = _mask_bot_out(BotOut.from_bot(b), user, membership, b)
        out.append(attach_week_stats(bo, b.id, week))
    return out


@router.post("/bots", response_model=BotOut)
async def create_personal_bot(body: BotCreate, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """Cree un bot PERSO (appartient directement a l'utilisateur, aucune org).
    Memes defauts que la creation d'equipe."""
    bot = Bot(owner_user_id=user.id, organization_id=None,
              name=body.name, mode=body.mode or "hybrid")
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


class MoveRequest(_BaseModel):
    organization_id: int


@router.post("/bots/{bot_id}/move", response_model=BotOut)
async def move_bot_to_org(bot_id: int, body: MoveRequest,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Deplace un bot PERSO vers une organisation (equipe). Sens unique :
    une fois en equipe, le bot suit la hierarchie de l'org (pas de retour
    perso). Le bot adopte l'org comme proprietaire (owner_user_id efface) ;
    le deplaceur doit etre membre de la cible (s'il n'en est pas admin il
    retombe a son role member sur ce bot — comportement voulu)."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    if bot.owner_user_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Ce bot appartient déjà à une organisation")
    # Seul l'owner (ou un superadmin) peut deplacer son bot perso
    if not user.is_superadmin and user.id != bot.owner_user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    # La cible : je dois etre membre de l'org (require_org_access, superadmin OK)
    await require_org_access(body.organization_id, user, db)
    org = await db.get(Organization, body.organization_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")

    bot.organization_id = body.organization_id
    bot.owner_user_id = None
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


# --- Par organisation ---

@router.get("/orgs/{org_id}/bots", response_model=list[BotOut])
async def list_bots(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    membership = await require_org_access(org_id, user, db)
    result = await db.execute(select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at))
    week = await bots_week_stats(db, org_id)
    out = []
    for b in result.scalars().all():
        bo = _mask_bot_out(BotOut.from_bot(b), user, membership, b)
        out.append(attach_week_stats(bo, b.id, week))
    return out


@router.post("/orgs/{org_id}/bots", response_model=BotOut)
async def create_bot(org_id: int, body: BotCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # Creation reservee aux admins de l'org (les members ont des permissions
    # par bot existant, pas de creation)
    await require_org_admin(org_id, user, db)
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")

    bot = Bot(organization_id=org_id, name=body.name, mode=body.mode or "hybrid")
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


# --- Par bot ---

@router.get("/bots/{bot_id}", response_model=BotOut)
async def get_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


# Colonnes JSON/int NOT NULL : un null explicite serait persiste (JSON null) ou
# violerait l'integrite -> bot illisible (tous les GET en 500). tree_variant_json
# n'y figure PAS : null explicite = desactivation voulue de la variante A/B.
_NOTNULL_NO_NULL_FIELDS = ("actions_json", "tree_json", "design_json", "allowed_domains",
                           "mcp_servers_json", "triggers_json", "ab_split_pct")


def _strip_notnull_nulls(data: dict) -> None:
    """Retire (in place) les null explicites visant des colonnes NOT NULL,
    AVANT la boucle setattr (sinon JSON null persiste / integrite violee)."""
    for field in _NOTNULL_NO_NULL_FIELDS:
        if field in data and data[field] is None:
            data.pop(field)


def _enforce_field_perms(user: User, membership: "Membership | None", bot: Bot, data: dict) -> None:
    """Permissions par bot : chaque champ effectivement modifie doit etre couvert."""
    for field in data:
        perm = FIELD_PERMS.get(field)
        if perm:
            _check_bot_perm(user, membership, bot, perm)


def _vt(value: Any) -> None:
    """Validation structurelle d'un arbre -> 422 si invalide. PAS de garde None
    interne (volontaire) : import_config valide tree_json meme quand null (le
    moteur leve 422), contrairement a _validate_trees. La garde `is not None`
    reste donc chez chaque appelant."""
    try:
        validate_tree(value)
    except TreeError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e


def _validate_trees(bot: Bot, data: dict) -> None:
    """Validation structurelle des arbres modifies (principal + variante A/B).
    null variante = desactiver (deja gere : non valide). 422 sur arbre invalide."""
    # Variante A/B : validation structurelle de l'arbre. null = desactiver.
    variant_changed = "tree_variant_json" in data and data["tree_variant_json"] != bot.tree_variant_json
    if variant_changed and data["tree_variant_json"] is not None:
        _vt(data["tree_variant_json"])

    if "tree_json" in data and data["tree_json"] is not None:
        _vt(data["tree_json"])


def _normalize_handoff_url(data: dict) -> None:
    """Webhook de notification handoff : https:// + borne, chaine vide = effacer.
    Normalise (in place) data['handoff_webhook_url'] ou leve 422."""
    if "handoff_webhook_url" in data and data["handoff_webhook_url"] is not None:
        url = data["handoff_webhook_url"].strip()
        if not url:
            data["handoff_webhook_url"] = None
        elif not url.startswith("https://") or len(url) > 500:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "URL de notification invalide (https:// requis, 500 caractères max)")
        else:
            data["handoff_webhook_url"] = url


def _apply_secrets(bot: Bot, data: dict) -> None:
    """Secrets en clair a l'entree : chiffres au stockage, jamais renvoyes en
    clair. Retires (pop) de data pour ne pas finir dans la boucle setattr."""
    if "byok_key" in data:
        bot.byok_key_encrypted = encrypt_secret(data.pop("byok_key"))
    if "captcha_secret" in data:
        bot.captcha_secret_encrypted = encrypt_secret(data.pop("captcha_secret"))


def _merge_rich_collections(bot: Bot, data: dict) -> None:
    """Actions IA et serveurs MCP : validation metier + fusion des secrets
    (chiffres au stockage, omis = conserves par nom). Remplace (in place) les
    listes de data par leurs versions fusionnees/projetees."""
    if "actions_json" in data and data["actions_json"] is not None:
        _check_actions(data["actions_json"])
        data["actions_json"] = _merge_action_secrets(bot.actions_json or [], data["actions_json"])

    if "mcp_servers_json" in data and data["mcp_servers_json"] is not None:
        _check_mcp_servers(data["mcp_servers_json"])
        data["mcp_servers_json"] = _merge_mcp_secrets(bot.mcp_servers_json or [], data["mcp_servers_json"])


@router.patch("/bots/{bot_id}", response_model=BotOut)
async def update_bot(bot_id: int, body: BotUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    data = body.model_dump(exclude_unset=True)

    _strip_notnull_nulls(data)
    _enforce_field_perms(user, membership, bot, data)
    _validate_trees(bot, data)

    # Triggers proactifs : validation metier (types, bornes, messages)
    if "triggers_json" in data and data["triggers_json"] is not None:
        _check_triggers(data["triggers_json"])

    _normalize_handoff_url(data)
    _apply_secrets(bot, data)
    _merge_rich_collections(bot, data)

    for field, value in data.items():
        setattr(bot, field, value)

    await db.commit()
    await db.refresh(bot)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


@router.delete("/bots/{bot_id}")
async def delete_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, _ = await _get_accessible_bot(db, bot_id, user)
    await require_bot_admin(bot, user, db)
    # Purge explicite des donnees liees (la cascade FK est aussi ajoutee au
    # schema par ailleurs ; ce delete garantit le comportement quelle que soit la base)
    await db.execute(sa_delete(Message).where(Message.bot_id == bot.id))
    await db.execute(sa_delete(Conversation).where(Conversation.bot_id == bot.id))
    await db.delete(bot)
    await db.commit()
    return {"deleted": True}


@router.get("/bots/{bot_id}/leads")
async def list_leads(bot_id: int, limit: int = 50,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Leads captures par le bot (formulaire arbre ou action IA capture_lead),
    plus recents d'abord."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    limit = max(1, min(200, limit))
    total = (await db.execute(
        select(func.count(Lead.id)).where(Lead.bot_id == bot.id)
    )).scalar_one()
    rows = (await db.execute(
        select(Lead).where(Lead.bot_id == bot.id)
        .order_by(Lead.created_at.desc())
        .limit(limit)
    )).scalars().all()
    return {"total": total, "leads": [LeadOut.model_validate(lead) for lead in rows]}


@router.get("/bots/{bot_id}/config.json")
async def export_config(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Export de la config en fichier JSON versionnable (sans secrets ni domaines)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    return {field: getattr(bot, field) for field in CONFIG_FIELDS}


# Scalaires de CONFIG_FIELDS portant des contraintes Pydantic (mode/provider/
# temperature/...) : valides via BotUpdate a l'import (l'arbre et le design
# restent valides separement, comme aujourd'hui).
_CONFIG_SCALAR_FIELDS = ("name", "mode", "ai_provider", "ai_model",
                         "system_prompt", "temperature")


@router.put("/bots/{bot_id}/config.json", response_model=BotOut)
async def import_config(bot_id: int, config: dict[str, Any], db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Import d'un fichier de config exporte (les champs inconnus sont ignores)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    # Permission par champ effectivement importe (meme mapping/boucle que le PATCH)
    _enforce_field_perms(user, membership, bot, {f: config[f] for f in CONFIG_FIELDS if f in config})
    if "tree_json" in config:
        # null inclus -> 422 (comme avant : _vt sans garde None interne)
        _vt(config["tree_json"])
    # Scalaires : memes contraintes que le PATCH (BotUpdate). On ne valide que
    # les champs presents et non-null (un null importe est ignore comme avant) ;
    # les valeurs coercees/validees ecrasent les brutes pour ces seuls champs.
    scalar_in = {f: config[f] for f in _CONFIG_SCALAR_FIELDS
                 if f in config and config[f] is not None}
    try:
        validated = BotUpdate(**scalar_in).model_dump(exclude_unset=True) if scalar_in else {}
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Configuration invalide : {e.errors()[0].get('msg', 'champ invalide')}") from e
    for field in CONFIG_FIELDS:
        # Toutes les colonnes de CONFIG_FIELDS sont NOT NULL : un null importe
        # est ignore (meme regle que le PATCH)
        if field in config and config[field] is not None:
            setattr(bot, field, validated.get(field, config[field]))
    await db.commit()
    await db.refresh(bot)
    return _mask_bot_out(BotOut.from_bot(bot), user, membership, bot)


class TreeGenerateRequest(_BaseModel):
    source_text: str | None = None
    url: str | None = None


@router.post("/bots/{bot_id}/tree/generate")
async def generate_tree_endpoint(bot_id: int, body: TreeGenerateRequest,
                                 db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Construit un arbre par IA à partir d'un texte (FAQ collée) ou d'une URL
    de page d'aide. Retourne le tree_json SANS le sauvegarder — le client
    prévisualise puis enregistre."""
    from src.services.tree_generator import TreeGenerationError, fetch_page_text, generate_tree

    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")

    # Rate-limit par proprietaire (org pour un bot d'equipe, user pour un bot
    # perso) AVANT tout appel IA (protection cout, superadmin inclus)
    if not await treegen_limiter.check(_bot_limiter_key(bot)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite de générations d'arbre atteinte pour aujourd'hui — réessayez demain")

    try:
        if body.url:
            source = await fetch_page_text(body.url.strip())
        elif body.source_text and body.source_text.strip():
            source = body.source_text
        else:
            raise TreeGenerationError("Fournissez un texte ou une URL")
        tree = await generate_tree(source)
    except TreeGenerationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    return {"tree_json": tree}


@router.post("/bots/{bot_id}/insights/generate", response_model=InsightsReportOut)
async def generate_insights_endpoint(bot_id: int, db: AsyncSession = Depends(get_db),
                                     user: User = Depends(get_current_user)):
    """Analyse IA « questions sans réponse » : clusterise les messages visiteurs
    adressés à l'IA sur les 30 derniers jours et suggère des bulles d'arbre.
    3 analyses/jour/organisation. Le rapport est persisté (insights_reports)
    et renvoyé."""
    from src.services.insights_service import InsightsError, generate_insights

    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")

    # Rate-limit par organisation AVANT tout echantillonnage/appel IA
    # (protection cout, superadmin inclus — comme treegen). NB : un 422
    # « aucune question » ci-dessous a donc deja consomme un credit (voulu :
    # le limiteur protege le cout, pas le confort).
    if not await insights_limiter.check(_bot_limiter_key(bot)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Limite d'analyses atteinte pour aujourd'hui — réessayez demain")

    since = utcnow() - timedelta(days=30)
    samples = (await db.execute(
        select(Message.content)
        .where(Message.bot_id == bot.id, Message.role == "user",
               Message.source == "ai", Message.created_at >= since)
        .order_by(Message.created_at.desc())
        .limit(200)
    )).scalars().all()
    if not samples:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Aucune question visiteur à analyser sur les 30 derniers jours")

    try:
        report = await generate_insights(list(samples))
    except InsightsError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    record = InsightsReport(bot_id=bot.id, report_json=report, message_count=len(samples))
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return InsightsReportOut.model_validate(record)


@router.get("/bots/{bot_id}/insights")
async def get_insights(bot_id: int, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Dernier rapport d'insights du bot (null JSON si aucun)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")
    record = (await db.execute(
        select(InsightsReport).where(InsightsReport.bot_id == bot.id)
        .order_by(InsightsReport.id.desc()).limit(1)
    )).scalar_one_or_none()
    return InsightsReportOut.model_validate(record) if record else None


@router.get("/bots/{bot_id}/embed")
async def embed_snippets(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Les differents modes d'integration sur le site du client."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "copy")
    api = settings.API_URL
    pk = bot.public_key
    script_tag = f'<script src="{api}/widget.js" data-bot-key="{pk}" defer></script>'
    return {
        "public_key": pk,
        "integrations": [
            {
                "id": "html",
                "label": "Balise HTML <script>",
                "icon": "</>",
                "description": "À coller juste avant </body> sur les pages où le chat doit apparaître.",
                "snippet": script_tag,
            },
            {
                "id": "wordpress",
                "label": "Plugin WordPress",
                "icon": "W",
                "description": "Apparence → Éditeur de thème → footer.php avant </body>, ou via un plugin d'insertion de code (WPCode…).",
                "snippet": script_tag,
            },
            {
                "id": "gtm",
                "label": "Google Tag Manager",
                "icon": "GTM",
                "description": "Créer une balise « HTML personnalisé » déclenchée sur All Pages, et y coller le script.",
                "snippet": script_tag,
            },
            {
                "id": "react",
                "label": "Composant React (npm)",
                "icon": "npm",
                "description": "Chargez le widget depuis un composant React (le script s'injecte au montage).",
                "snippet": (
                    "useEffect(() => {\n"
                    "  const s = document.createElement('script');\n"
                    f"  s.src = '{api}/widget.js';\n"
                    f"  s.dataset.botKey = '{pk}';\n"
                    "  s.defer = true;\n"
                    "  document.body.appendChild(s);\n"
                    "  return () => s.remove();\n"
                    "}, []);"
                ),
            },
            {
                "id": "iframe",
                "label": "iFrame (page dédiée)",
                "icon": "ifr",
                "description": "Intègre le chat ouvert dans un bloc de la page (FAQ, page contact…).",
                "snippet": f'<iframe src="{api}/widget-frame?key={pk}" style="width:100%;height:600px;border:none;border-radius:12px;" title="Chat"></iframe>',
            },
        ],
    }
