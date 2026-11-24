"""Serveur MCP distant d'emails.chapote.fr (SDK officiel `mcp`, FastMCP, Streamable HTTP).

Monté sur /mcp dans l'app FastAPI (voir main.py) par `McpEndpoint`, une petite couche ASGI :
1. module désactivé -> 404 ;
2. jeton Bearer OAuth obligatoire (emails_oauth.verify_access) ; sinon 401 avec
   `WWW-Authenticate: Bearer resource_metadata=…` (découverte OAuth par Claude) ;
3. limite d'appels par connecteur (Redis, partagée entre workers) ;
4. passage au gestionnaire Streamable HTTP du SDK, en mode SANS ÉTAT (`stateless`) et
   réponses JSON : aucune session MCP gardée en mémoire, chaque requête se suffit, donc
   n'importe quel worker uvicorn peut la servir (pas d'affinité de session à gérer
   derrière le reverse proxy). L'en-tête Mcp-Session-Id n'est pas utilisé.

Outils (paramètre `account` = slug d'une boîte, voir list_accounts) : lecture (list_accounts,
list_folders, search_messages, search_all, get_message, get_thread, get_attachment),
rédaction (create_draft, send_message si allow_send), rangement (mark, move, trash si
allow_delete). Chaque appel est journalisé dans mcp_audit_log (outil, boîte, statut,
durée ; jamais de contenu). Les erreurs renvoyées à Claude sont rédigées ici (MailError) :
ni secret, ni trace d'exécution.
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Annotated, Any, Awaitable, Callable, Optional

import anyio
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.types import ToolAnnotations
from pydantic import Field
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.models.emails import Mailbox, McpAuditLog
from src.services import mail_client as mc
from src.services.emails_oauth import AccessInfo, issuer, verify_access
from src.services.mail_client import Draft, MailError
from src.services.mailboxes import config_of
from src.services.rate_limit import emails_mcp_anon_limiter, emails_mcp_limiter
from src.services.user_apps import client_ip

logger = logging.getLogger(__name__)

# Fabrique de sessions DB (remplacée par les tests pour viser la base jetable).
SessionFactory: Callable[[], Any] = AsyncSessionLocal

INSTRUCTIONS = (
    "Accès aux boîtes mail de Chapote (Email Pro OVH contact@chapote.fr et comptes Gmail). "
    "Commencez par list_accounts pour connaître les boîtes (paramètre `account` = slug) et leurs droits. "
    "Un message est identifié par (account, folder, uid) : réutilisez les valeurs renvoyées par les recherches. "
    "La lecture ne marque pas les messages comme lus. Préférez create_draft à send_message tant que "
    "l'utilisateur n'a pas explicitement demandé l'envoi. trash déplace dans la corbeille (jamais de "
    "suppression définitive) et n'est permis que sur les boîtes autorisées."
)

mcp = FastMCP("Chapote Emails", instructions=INSTRUCTIONS)

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
SEND = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True)
DELETE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False)

Account = Annotated[str, Field(description="Slug de la boîte, tel que renvoyé par list_accounts (ex. « contact »).")]
Folder = Annotated[str, Field(description="Nom exact du dossier (list_folders). Par défaut la boîte de réception.")]
Uid = Annotated[int, Field(description="UID du message dans ce dossier (renvoyé par les recherches).", ge=1)]
Uids = Annotated[list[int], Field(description="UID des messages (100 au plus), tous dans `folder`.", min_length=1, max_length=100)]
Day = Annotated[Optional[str], Field(description="Date au format AAAA-MM-JJ.")]
Recipients = Annotated[list[str], Field(description="Adresses (« Nom <a@b.fr> » ou « a@b.fr »).", max_length=50)]


# --------------------------------------------------------------------------
# Socle commun : authentification, boîte, audit, erreurs
# --------------------------------------------------------------------------

def _auth(ctx: Context) -> AccessInfo:
    request = getattr(ctx.request_context, "request", None)
    info = (getattr(request, "scope", None) or {}).get("state", {}).get("emails_auth") if request is not None else None
    if not isinstance(info, AccessInfo):
        raise ToolError("Non authentifié.")
    return info


async def _mailbox(slug: str) -> Mailbox:
    async with SessionFactory() as db:
        mb = (await db.execute(select(Mailbox).where(Mailbox.slug == (slug or "").strip().lower()))).scalar_one_or_none()
        if mb is None or not mb.is_active:
            names = (await db.execute(select(Mailbox.slug).where(Mailbox.is_active.is_(True))
                                      .order_by(Mailbox.slug))).scalars().all()
            raise MailError(f"Boîte « {slug} » inconnue ou désactivée. Boîtes disponibles : {', '.join(names) or 'aucune'}.",
                            "not_found")
        return mb


async def _audit(info: Optional[AccessInfo], tool: str, slug: Optional[str], status: str,
                 code: Optional[str], started: float, items: Optional[int]) -> None:
    try:
        async with SessionFactory() as db:
            db.add(McpAuditLog(client_pk=info.client_pk if info else None, user_id=info.user_id if info else None,
                               tool=tool, mailbox_slug=(slug or None) and slug[:40], status=status,
                               error_code=code, duration_ms=int((time.monotonic() - started) * 1000), items=items))
            await db.commit()
    except Exception as e:  # le journal ne doit jamais faire échouer l'appel
        logger.error("emails mcp : journal d'audit indisponible (%s)", type(e).__name__)


def _count(result: Any) -> Optional[int]:
    if isinstance(result, dict):
        for key in ("messages", "accounts", "folders", "uids"):
            if isinstance(result.get(key), list):
                return len(result[key])
        return 1
    return None


async def _call(ctx: Context, tool: str, slug: Optional[str], work: Callable[[], Awaitable[dict]]) -> dict:
    started = time.monotonic()
    info = _auth(ctx)
    status, code, items = "ok", None, None
    try:
        result = await work()
        items = _count(result)
        return result
    except MailError as e:
        status, code = ("denied" if e.code == "forbidden" else "error"), e.code
        raise ToolError(e.message)
    except ToolError:
        status, code = "error", "invalid"
        raise
    except Exception as e:
        status, code = "error", "internal"
        # Type seulement : pas de trace ni de message (qui pourrait citer une donnée).
        logger.error("emails mcp : erreur inattendue dans %s (%s)", tool, type(e).__name__)
        raise ToolError("Erreur interne du serveur de messagerie. Réessayez plus tard.")
    finally:
        await _audit(info, tool, slug, status, code, started, items)


async def _with_box(ctx: Context, tool: str, account: str, fn: Callable[..., dict], *args: Any,
                    need: Optional[str] = None) -> dict:
    async def work() -> dict:
        mb = await _mailbox(account)
        if need == "send" and not mb.allow_send:
            raise MailError(f"L'envoi est désactivé pour la boîte « {mb.slug} ». Utilisez create_draft : "
                            "le brouillon sera relu et envoyé par l'utilisateur.", "forbidden")
        if need == "delete" and not mb.allow_delete:
            raise MailError(f"La mise à la corbeille est désactivée pour la boîte « {mb.slug} » "
                            "(droit « suppression » à activer dans emails.chapote.fr).", "forbidden")
        cfg = config_of(mb)
        if need == "move":
            return await mc.run_blocking(lambda: fn(cfg, *args, allow_delete=mb.allow_delete))
        return await mc.run_blocking(fn, cfg, *args)
    return await _call(ctx, tool, account, work)


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------

@mcp.tool(annotations=READ, description=(
    "Liste les boîtes mail disponibles : slug (`account` des autres outils), adresse, libellé, fournisseur, "
    "droits (allow_send : envoi permis ; allow_delete : corbeille permise). À appeler en premier."))
async def list_accounts(ctx: Context) -> dict:
    async def work() -> dict:
        async with SessionFactory() as db:
            rows = (await db.execute(select(Mailbox).where(Mailbox.is_active.is_(True)).order_by(Mailbox.slug))).scalars().all()
        return {"accounts": [{"account": m.slug, "address": m.address, "label": m.label, "provider": m.preset,
                              "allow_send": m.allow_send, "allow_delete": m.allow_delete} for m in rows]}
    return await _call(ctx, "list_accounts", None, work)


@mcp.tool(annotations=READ, description=(
    "Liste les dossiers d'une boîte avec leur rôle (`special` : inbox, sent, drafts, trash, junk, all, archive). "
    "Utilisez les noms exacts renvoyés comme paramètre `folder`."))
async def list_folders(account: Account, ctx: Context) -> dict:
    return await _with_box(ctx, "list_folders", account, mc.list_folders)


@mcp.tool(annotations=READ, description=(
    "Cherche des messages dans UN dossier d'une boîte (boîte de réception par défaut), du plus récent au plus "
    "ancien. Tous les critères sont optionnels et combinés (ET). `query` : texte libre (sur Gmail, syntaxe de "
    "recherche Gmail : from:, has:attachment, older_than:7d…). Renvoie des résumés (uid, date, expéditeur, objet, "
    "non lu) et `total` ; lire un message avec get_message. `limit` : 50 au plus."))
async def search_messages(
    account: Account, ctx: Context,
    query: Annotated[Optional[str], Field(description="Texte cherché dans tout le message.")] = None,
    from_: Annotated[Optional[str], Field(alias="from", description="Expéditeur (adresse ou nom, partiel).")] = None,
    to: Annotated[Optional[str], Field(description="Destinataire (adresse ou nom, partiel).")] = None,
    subject: Annotated[Optional[str], Field(description="Texte de l'objet.")] = None,
    since: Day = None,
    before: Annotated[Optional[str], Field(description="Avant cette date (exclue), AAAA-MM-JJ.")] = None,
    unseen: Annotated[bool, Field(description="Seulement les non lus.")] = False,
    folder: Folder = "INBOX",
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
) -> dict:
    s, b = mc.parse_day(since, "since"), mc.parse_day(before, "before")

    def fn(cfg):
        return mc.search(cfg, folder=folder, query=query, from_=from_, to=to, subject=subject,
                         since=s, before=b, unseen=unseen, limit=limit)
    return await _with_box(ctx, "search_messages", account, fn)


@mcp.tool(annotations=READ, description=(
    "Cherche un texte dans TOUTES les boîtes actives à la fois (« Tous les messages » sur Gmail, boîte de "
    "réception ailleurs). Résultats fusionnés du plus récent au plus ancien, chacun avec son `account`. Une boîte "
    "injoignable n'empêche pas les autres : elle figure dans `errors`."))
async def search_all(
    ctx: Context,
    query: Annotated[str, Field(min_length=1, max_length=300, description="Texte cherché.")],
    since: Day = None,
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
) -> dict:
    s = mc.parse_day(since, "since")

    async def work() -> dict:
        async with SessionFactory() as db:
            boxes = (await db.execute(select(Mailbox).where(Mailbox.is_active.is_(True)).order_by(Mailbox.slug))).scalars().all()
        results: list[dict] = []
        errors: list[dict] = []

        async def one(mb: Mailbox) -> None:
            try:
                cfg = config_of(mb)
                r = await mc.run_blocking(mc.search_everywhere, cfg, query, s, limit)
                for m in r["messages"]:
                    results.append({"account": mb.slug, **m})
            except MailError as e:
                errors.append({"account": mb.slug, "error": e.message})

        async with anyio.create_task_group() as tg:
            for mb in boxes:
                tg.start_soon(one, mb)
        results.sort(key=lambda m: m.get("date") or "", reverse=True)
        return {"messages": results[:limit], "errors": errors, "accounts_searched": len(boxes)}
    return await _call(ctx, "search_all", None, work)


@mcp.tool(annotations=READ, description=(
    "Lit un message complet : en-têtes, corps en texte (HTML converti), liste des pièces jointes (index, nom, "
    "type, taille). Ne le marque pas comme lu. Corps tronqué à `max_chars` caractères."))
async def get_message(
    account: Account, uid: Uid, ctx: Context, folder: Folder = "INBOX",
    max_chars: Annotated[int, Field(ge=500, le=100_000)] = 20_000,
) -> dict:
    return await _with_box(ctx, "get_message", account, mc.get_message, folder, uid, max_chars)


@mcp.tool(annotations=READ, description=(
    "Reconstitue la conversation d'un message (fil Gmail, ou en-têtes References / In-Reply-To ailleurs, en "
    "cherchant aussi dans Envoyés), du plus ancien au plus récent, corps abrégés."))
async def get_thread(account: Account, uid: Uid, ctx: Context, folder: Folder = "INBOX") -> dict:
    return await _with_box(ctx, "get_thread", account, mc.get_thread, folder, uid)


@mcp.tool(annotations=READ, description=(
    "Récupère une pièce jointe (index donné par get_message, à partir de 0). Texte extrait quand c'est possible "
    "(texte, CSV, JSON, HTML, PDF) ; sinon contenu en base64 si la pièce fait 2 Mo au plus."))
async def get_attachment(
    account: Account, uid: Uid, ctx: Context,
    index: Annotated[int, Field(ge=0, description="Index de la pièce jointe (get_message).")],
    folder: Folder = "INBOX",
) -> dict:
    return await _with_box(ctx, "get_attachment", account, mc.get_attachment, folder, uid, index)


def _draft(to, subject, body, cc, bcc, html, reply_to_uid, reply_folder) -> Draft:
    return Draft(to=list(to or []), subject=subject or "", body=body or "", cc=list(cc or []), bcc=list(bcc or []),
                 html=html, reply_uid=reply_to_uid, reply_folder=reply_folder)


ReplyUid = Annotated[Optional[int], Field(ge=1, description=(
    "Pour une réponse : UID du message d'origine. Ajoute In-Reply-To / References, préfixe l'objet par « Re: » "
    "et, si `to` est vide, répond à l'expéditeur (Reply-To sinon From)."))]
ReplyFolder = Annotated[str, Field(description="Dossier du message d'origine (réponse).")]


@mcp.tool(annotations=WRITE, description=(
    "Crée un brouillon dans le dossier Brouillons de la boîte (rien n'est envoyé) : l'utilisateur le relit et "
    "l'envoie depuis sa messagerie. Option réponse : `reply_to_uid` (+ `reply_folder`). Corps en texte brut, "
    "`html` optionnel en plus."))
async def create_draft(
    account: Account, ctx: Context,
    to: Recipients = [],  # noqa: B006 — défaut immuable pour le schéma
    subject: Annotated[str, Field(max_length=500)] = "",
    body: Annotated[str, Field(max_length=200_000)] = "",
    cc: Recipients = [],  # noqa: B006
    bcc: Recipients = [],  # noqa: B006
    html: Annotated[Optional[str], Field(max_length=200_000)] = None,
    reply_to_uid: ReplyUid = None,
    reply_folder: ReplyFolder = "INBOX",
) -> dict:
    d = _draft(to, subject, body, cc, bcc, html, reply_to_uid, reply_folder)
    return await _with_box(ctx, "create_draft", account, mc.create_draft, d)


@mcp.tool(annotations=SEND, description=(
    "ENVOIE un e-mail depuis la boîte (SMTP), puis en garde une copie dans Envoyés. Refusé si la boîte n'a pas le "
    "droit d'envoi (allow_send) : utilisez alors create_draft. N'envoyez qu'à la demande explicite de "
    "l'utilisateur, après lui avoir montré le texte. Mêmes paramètres que create_draft."))
async def send_message(
    account: Account, ctx: Context,
    to: Recipients = [],  # noqa: B006
    subject: Annotated[str, Field(max_length=500)] = "",
    body: Annotated[str, Field(max_length=200_000)] = "",
    cc: Recipients = [],  # noqa: B006
    bcc: Recipients = [],  # noqa: B006
    html: Annotated[Optional[str], Field(max_length=200_000)] = None,
    reply_to_uid: ReplyUid = None,
    reply_folder: ReplyFolder = "INBOX",
) -> dict:
    d = _draft(to, subject, body, cc, bcc, html, reply_to_uid, reply_folder)
    return await _with_box(ctx, "send_message", account, mc.send, d, need="send")


@mcp.tool(annotations=WRITE, description=(
    "Marque des messages comme lus / non lus (`read`) et/ou suivis / non suivis (`flagged`)."))
async def mark(
    account: Account, uids: Uids, ctx: Context,
    read: Annotated[Optional[bool], Field(description="true = lu, false = non lu.")] = None,
    flagged: Annotated[Optional[bool], Field(description="true = suivi (étoile), false = retiré.")] = None,
    folder: Folder = "INBOX",
) -> dict:
    return await _with_box(ctx, "mark", account, mc.mark, folder, uids, read, flagged)


@mcp.tool(annotations=WRITE, description=(
    "Déplace des messages vers un autre dossier (nom exact, list_folders). La corbeille n'est accessible que si la "
    "boîte a le droit de suppression : sinon utilisez un dossier d'archive."))
async def move(
    account: Account, uids: Uids, ctx: Context,
    destination: Annotated[str, Field(min_length=1, description="Dossier de destination (nom exact).")],
    folder: Folder = "INBOX",
) -> dict:
    return await _with_box(ctx, "move", account, mc.move, folder, uids, destination, need="move")


@mcp.tool(annotations=DELETE, description=(
    "Met des messages à la corbeille de la boîte (récupérables, jamais de suppression définitive). Refusé si la "
    "boîte n'a pas le droit de suppression (allow_delete). Confirmez avec l'utilisateur avant d'appeler."))
async def trash(account: Account, uids: Uids, ctx: Context, folder: Folder = "INBOX") -> dict:
    return await _with_box(ctx, "trash", account, mc.trash, folder, uids, need="delete")


# --------------------------------------------------------------------------
# Transport HTTP (monté sur /mcp)
# --------------------------------------------------------------------------

_manager: Optional[StreamableHTTPSessionManager] = None


@asynccontextmanager
async def running():
    """Démarre le gestionnaire Streamable HTTP (lifespan de l'app, ou tests). Un gestionnaire
    neuf à chaque démarrage : le SDK n'autorise qu'un run() par instance."""
    global _manager
    mgr = StreamableHTTPSessionManager(app=mcp._mcp_server, json_response=True, stateless=True)
    async with mgr.run():
        _manager = mgr
        try:
            yield
        finally:
            _manager = None


def resource_metadata_url() -> str:
    return f"{issuer()}/.well-known/oauth-protected-resource"


def www_authenticate(error: Optional[str] = None, description: Optional[str] = None) -> str:
    value = f'Bearer resource_metadata="{resource_metadata_url()}", scope="emails"'
    if error:
        value += f', error="{error}"'
        if description:
            value += f', error_description="{description}"'
    return value


class McpEndpoint:
    """Application ASGI de /mcp : contrôle du jeton, puis gestionnaire du SDK."""

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        if not settings.EMAILS_ENABLED:
            await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
            return
        request = Request(scope)
        auth = request.headers.get("authorization") or ""
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
        if not token:
            if not await emails_mcp_anon_limiter.check(client_ip(request)):
                await JSONResponse({"error": "rate_limited"}, status_code=429)(scope, receive, send)
                return
            await JSONResponse({"error": "invalid_request", "error_description": "Jeton d'accès requis."},
                               status_code=401, headers={"WWW-Authenticate": www_authenticate()})(scope, receive, send)
            return
        async with SessionFactory() as db:
            info = await verify_access(db, token)
        if info is None:
            if not await emails_mcp_anon_limiter.check(client_ip(request)):
                await JSONResponse({"error": "rate_limited"}, status_code=429)(scope, receive, send)
                return
            await JSONResponse({"error": "invalid_token", "error_description": "Jeton invalide, expiré ou révoqué."},
                               status_code=401,
                               headers={"WWW-Authenticate": www_authenticate("invalid_token", "Jeton invalide, expiré ou révoqué.")}
                               )(scope, receive, send)
            return
        if not await emails_mcp_limiter.check(info.family_id):
            await JSONResponse({"error": "rate_limited", "error_description": "Trop d'appels, patientez une minute."},
                               status_code=429, headers={"Retry-After": "60"})(scope, receive, send)
            return
        if _manager is None:
            await JSONResponse({"error": "unavailable"}, status_code=503)(scope, receive, send)
            return
        # L'identité vérifiée suit la requête jusqu'aux outils (ctx.request_context.request).
        scope = {**scope, "state": {**(scope.get("state") or {}), "emails_auth": info}}
        await _manager.handle_request(scope, receive, send)


endpoint = McpEndpoint()
