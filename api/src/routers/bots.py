"""Bots : listes/creation par organisation, operations par bot (acces = membre
de l'org du bot, ou superadmin). Export/import config JSON versionnable,
snippets d'integration (script HTML, iframe, GTM)."""
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user, require_org_access, require_org_admin
from src.models.bot import Bot, BotCreate, BotOut, BotUpdate
from src.models.lead import Lead, LeadOut
from src.models.user import Organization, User
from src.services.crypto import encrypt_secret
from src.services.rate_limit import treegen_limiter
from src.services.tree_engine import TreeError, validate_tree
from src.services.usage_service import bots_week_stats, count_bots, plan_limits

router = APIRouter(prefix="/api", tags=["bots"])

# Champs de config exportes dans le fichier JSON (jamais de secrets)
CONFIG_FIELDS = ["name", "mode", "ai_provider", "ai_model", "system_prompt",
                 "temperature", "tree_json", "design_json"]

# Permission requise par champ modifiable, pour les MEMBERS (les admins de
# l'org et les superadmins ont tout). Aligne sur la matrice de la page Équipe.
FIELD_PERMS = {
    "name": "appearance",
    "design_json": "appearance",
    "mode": "appearance",
    "tree_json": "context",
    "actions_json": "context",
    "system_prompt": "context",
    "ai_provider": "context",
    "ai_model": "context",
    "temperature": "context",
    "api_key_mode": "context",
    "byok_key": "context",
    "allowed_domains": "security",
    "captcha_provider": "security",
    "captcha_site_key": "security",
    "captcha_secret": "security",
    "daily_ai_message_cap": "security",
    "is_active": "security",
}


async def _get_accessible_bot(db: AsyncSession, bot_id: int, user: User) -> tuple[Bot, Any]:
    """(bot, membership). membership=None pour un superadmin non membre."""
    bot = await db.get(Bot, bot_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bot introuvable")
    membership = await require_org_access(bot.organization_id, user, db)
    return bot, membership


def _member_perms(membership, bot: Bot) -> list[str]:
    return (membership.permissions or {}).get(str(bot.id), [])


def _check_bot_perm(user: User, membership, bot: Bot, perm: str) -> None:
    """Members : permission par bot requise. Admins d'org + superadmins : tout."""
    if user.is_superadmin or membership is None or membership.role == "admin":
        return
    if perm not in _member_perms(membership, bot):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Permission « {perm} » requise sur ce bot — demandez à un admin de votre organisation")


# Actions IA (tool-use) : bornes de validation
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_ACTION_TYPES = ("webhook", "capture_lead")
_ACTION_FIELD_TYPES = ("string", "number", "boolean")
_MAX_ACTIONS = 5
_MAX_ACTION_FIELDS = 8


def _check_actions(actions: Any) -> None:
    """Validation metier de actions_json (422 FR). capture_lead : url/fields
    ignores, le schema standard email/name/phone/message est impose cote
    ai_service."""
    def _bad(msg: str) -> None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)

    if not isinstance(actions, list):
        _bad("actions_json doit être une liste d'actions")
    if len(actions) > _MAX_ACTIONS:
        _bad(f"{_MAX_ACTIONS} actions maximum par bot")
    seen: set = set()
    for action in actions:
        if not isinstance(action, dict):
            _bad("Chaque action doit être un objet")
        name = action.get("name")
        if not isinstance(name, str) or not _ACTION_NAME_RE.fullmatch(name) or name in seen:
            _bad(f"Nom d'action invalide ou en double : {name}")
        seen.add(name)
        description = action.get("description")
        if not isinstance(description, str) or not 1 <= len(description) <= 500:
            _bad(f"L'action {name} doit avoir une description (1 à 500 caractères)")
        atype = action.get("type")
        if atype not in _ACTION_TYPES:
            _bad(f"Type d'action inconnu : {atype}")
        if atype != "webhook":
            continue
        url = action.get("url")
        if not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
            _bad(f"L'action {name} doit avoir une URL https://")
        secret = action.get("secret")
        if secret is not None and (not isinstance(secret, str) or len(secret) > 200):
            _bad(f"Le secret de l'action {name} est invalide (200 caractères max)")
        fields = action.get("fields", [])
        if not isinstance(fields, list) or len(fields) > _MAX_ACTION_FIELDS:
            _bad(f"L'action {name} accepte au plus {_MAX_ACTION_FIELDS} champs")
        for field in fields:
            if not isinstance(field, dict):
                _bad(f"Champ invalide dans l'action {name}")
            fname = field.get("name")
            if not isinstance(fname, str) or not _ACTION_NAME_RE.fullmatch(fname):
                _bad(f"Nom de champ invalide dans l'action {name} : {fname}")
            if field.get("type", "string") not in _ACTION_FIELD_TYPES:
                _bad(f"Type de champ invalide dans l'action {name} : {field.get('type')}")
            fdesc = field.get("description", "")
            if not isinstance(fdesc, str) or len(fdesc) > 200:
                _bad(f"Description de champ invalide dans l'action {name} (200 caractères max)")
            if not isinstance(field.get("required", False), bool):
                _bad(f"'required' doit être un booléen dans l'action {name}")


def _project_action(action: dict) -> dict:
    """Re-projette une action entrante sur les SEULES cles autorisees : aucune
    cle posee par le client (dont secret_encrypted, qui rendrait le webhook
    silencieusement non signe) ne doit etre persistee ni re-servie au front."""
    out = {
        "name": action.get("name"),
        "description": action.get("description"),
        "type": action.get("type"),
    }
    if action.get("type") == "webhook":
        out["url"] = action.get("url")
        out["fields"] = [
            {
                "name": f.get("name"),
                "type": f.get("type", "string"),
                "description": f.get("description", ""),
                "required": bool(f.get("required", False)),
            }
            for f in (action.get("fields") or [])
        ]
    return out


def _merge_action_secrets(existing: list, incoming: list) -> list:
    """Semantique des secrets : envoyer `secret` pour le (re)poser, l'omettre
    (ou None) pour conserver celui deja stocke (chiffre) sous le MEME name.
    Chaque action est reconstruite via _project_action : `secret_encrypted`
    n'est posable QUE par encrypt_secret() ou herite de l'existant (webhook)."""
    by_name = {a.get("name"): a for a in (existing or [])}
    out = []
    for action in incoming:
        secret = action.get("secret")
        clean = _project_action(action)
        if clean["type"] == "webhook":
            if secret:
                clean["secret_encrypted"] = encrypt_secret(secret)
            else:
                previous = by_name.get(clean.get("name"))
                if previous and previous.get("secret_encrypted"):
                    clean["secret_encrypted"] = previous["secret_encrypted"]
        out.append(clean)
    return out


def _check_plan_constraints(org: Organization, user: User,
                            mode: str | None = None, tree_json: dict | None = None) -> None:
    """Contraintes du plan : free = mode arbre uniquement + quota de bulles.
    Les superadmins (staff) peuvent outrepasser."""
    if user.is_superadmin:
        return
    limits = plan_limits(org)
    if mode and mode != "tree" and limits.get("tree_only"):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Le plan free est limité au mode arbre — passez au plan Starter pour activer l'IA")
    max_nodes = limits.get("max_tree_nodes")
    if tree_json is not None and max_nodes is not None:
        count = len(tree_json.get("nodes", {}))
        if count > max_nodes:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Le plan {org.plan} est limité à {max_nodes} bulles dans l'arbre ({count} actuellement)")


# --- Par organisation ---

@router.get("/orgs/{org_id}/bots", response_model=list[BotOut])
async def list_bots(org_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await require_org_access(org_id, user, db)
    result = await db.execute(select(Bot).where(Bot.organization_id == org_id).order_by(Bot.created_at))
    week = await bots_week_stats(db, org_id)
    out = []
    for b in result.scalars().all():
        bo = BotOut.from_bot(b)
        bo.msgs_7d = week.get(b.id, {}).get("msgs_7d", 0)
        bo.visitors_7d = week.get(b.id, {}).get("visitors_7d", 0)
        out.append(bo)
    return out


@router.post("/orgs/{org_id}/bots", response_model=BotOut)
async def create_bot(org_id: int, body: BotCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # Creation reservee aux admins de l'org (les members ont des permissions
    # par bot existant, pas de creation)
    await require_org_admin(org_id, user, db)
    # Fetch verrouille : serialise le comptage de bots vis-a-vis des creations
    # concurrentes de la meme org (limite max_bots du plan)
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id).with_for_update()
    )).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation introuvable")

    # Limite de bots du plan (les superadmins peuvent outrepasser)
    if not user.is_superadmin:
        max_bots = plan_limits(org)["max_bots"]
        if await count_bots(db, org_id) >= max_bots:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"Limite du plan {org.plan} atteinte ({max_bots} bots). Passez au plan supérieur.")
    _check_plan_constraints(org, user, mode=body.mode or "hybrid")

    bot = Bot(organization_id=org_id, name=body.name, mode=body.mode or "hybrid")
    db.add(bot)
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


# --- Par bot ---

@router.get("/bots/{bot_id}", response_model=BotOut)
async def get_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, _ = await _get_accessible_bot(db, bot_id, user)
    return BotOut.from_bot(bot)


@router.patch("/bots/{bot_id}", response_model=BotOut)
async def update_bot(bot_id: int, body: BotUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    data = body.model_dump(exclude_unset=True)

    # Colonnes JSON NOT NULL : un null explicite serait persiste (JSON null)
    # ou violerait l'integrite -> bot illisible (tous les GET en 500). On
    # ignore ces null AVANT la boucle setattr.
    for field in ("actions_json", "tree_json", "design_json", "allowed_domains"):
        if field in data and data[field] is None:
            data.pop(field)

    # Permissions par bot : chaque champ modifie doit etre couvert
    for field in data:
        perm = FIELD_PERMS.get(field)
        if perm:
            _check_bot_perm(user, membership, bot, perm)

    org = await db.get(Organization, bot.organization_id)

    # BYOK : reserve aux plans qui incluent l'option (superadmin bypass, coherent
    # avec _check_plan_constraints). Uniquement si la valeur CHANGE : un bot deja
    # en BYOK hors plan (pose par un superadmin, downgrade webhook) doit rester
    # sauvable sur ses autres champs.
    if data.get("api_key_mode") == "byok" and bot.api_key_mode != "byok" and not user.is_superadmin:
        if not plan_limits(org).get("byok"):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "L'utilisation de votre propre clé API (BYOK) est réservée au plan Agence — passez au plan supérieur")

    # Contraintes du plan : uniquement si le mode ou l'arbre CHANGENT reellement
    # (un patch design seul, ou renvoyant des valeurs identiques, ne doit pas
    # etre bloque par l'etat existant d'un bot hors plan apres downgrade)
    mode_changed = "mode" in data and data["mode"] != bot.mode
    tree_changed = "tree_json" in data and data["tree_json"] != bot.tree_json
    if mode_changed or tree_changed:
        _check_plan_constraints(org, user, mode=data.get("mode", bot.mode), tree_json=data.get("tree_json"))

    if "tree_json" in data and data["tree_json"] is not None:
        try:
            validate_tree(data["tree_json"])
        except TreeError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    # Secrets : chiffres au stockage, jamais renvoyes en clair
    if "byok_key" in data:
        bot.byok_key_encrypted = encrypt_secret(data.pop("byok_key"))
    if "captcha_secret" in data:
        bot.captcha_secret_encrypted = encrypt_secret(data.pop("captcha_secret"))

    # Actions IA : validation metier + fusion des secrets (chiffres au
    # stockage, omis = conserves)
    if "actions_json" in data and data["actions_json"] is not None:
        _check_actions(data["actions_json"])
        data["actions_json"] = _merge_action_secrets(bot.actions_json or [], data["actions_json"])

    for field, value in data.items():
        setattr(bot, field, value)

    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


@router.delete("/bots/{bot_id}")
async def delete_bot(bot_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from sqlalchemy import delete as sa_delete

    from src.models.conversation import Conversation, Message

    bot, _ = await _get_accessible_bot(db, bot_id, user)
    await require_org_admin(bot.organization_id, user, db)
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


@router.put("/bots/{bot_id}/config.json", response_model=BotOut)
async def import_config(bot_id: int, config: dict[str, Any], db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Import d'un fichier de config exporte (les champs inconnus sont ignores)."""
    bot, membership = await _get_accessible_bot(db, bot_id, user)
    # Permission par champ effectivement importe (meme mapping que le PATCH)
    for field in CONFIG_FIELDS:
        if field in config:
            perm = FIELD_PERMS.get(field)
            if perm:
                _check_bot_perm(user, membership, bot, perm)
    org = await db.get(Organization, bot.organization_id)
    # Contraintes du plan : uniquement si le mode ou l'arbre CHANGENT reellement
    # (comme le PATCH — un import partiel ou identique, ex. design seul, ne doit
    # pas etre bloque par l'etat existant d'un bot hors plan apres un downgrade)
    mode_changed = "mode" in config and config["mode"] != bot.mode
    tree_changed = "tree_json" in config and config["tree_json"] != bot.tree_json
    if mode_changed or tree_changed:
        _check_plan_constraints(org, user, mode=config.get("mode", bot.mode),
                                tree_json=config.get("tree_json"))
    if "tree_json" in config:
        try:
            validate_tree(config["tree_json"])
        except TreeError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    for field in CONFIG_FIELDS:
        # Toutes les colonnes de CONFIG_FIELDS sont NOT NULL : un null importe
        # est ignore (meme regle que le PATCH)
        if field in config and config[field] is not None:
            setattr(bot, field, config[field])
    await db.commit()
    await db.refresh(bot)
    return BotOut.from_bot(bot)


from pydantic import BaseModel as _BaseModel
from typing import Optional as _Optional


class TreeGenerateRequest(_BaseModel):
    source_text: _Optional[str] = None
    url: _Optional[str] = None


@router.post("/bots/{bot_id}/tree/generate")
async def generate_tree_endpoint(bot_id: int, body: TreeGenerateRequest,
                                 db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Construit un arbre par IA à partir d'un texte (FAQ collée) ou d'une URL
    de page d'aide. Retourne le tree_json SANS le sauvegarder — le client
    prévisualise puis enregistre. Plans payants uniquement (coût IA côté SaaS)."""
    from src.services.tree_generator import TreeGenerationError, fetch_page_text, generate_tree

    bot, membership = await _get_accessible_bot(db, bot_id, user)
    _check_bot_perm(user, membership, bot, "context")

    org = await db.get(Organization, bot.organization_id)
    if not user.is_superadmin and plan_limits(org).get("price", 0) <= 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "La génération d'arbre par IA est réservée aux plans payants")

    # Rate-limit par organisation AVANT tout appel IA (protection cout,
    # superadmin inclus)
    if not await treegen_limiter.check(str(bot.organization_id)):
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    return {"tree_json": tree}


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
