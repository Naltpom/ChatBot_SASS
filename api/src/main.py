"""ChatBot SaaS — API.

Surfaces :
- /api/auth, /api/orgs, /api/bots, /api/stats : dashboard clients (CORS strict)
- /api/admin/*                  : back-office superadmin (staff)
- /api/widget/*                 : endpoints publics du widget embarque
                                  (CORS ouvert, controle reel = whitelist de
                                  domaines par bot + captcha + JWT session)
- /widget.js, /widget-frame     : le script a embarquer + la page iframe
- /uploads/*                    : images uploadees (avatars, lanceurs)
"""
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.errors import install_error_handlers
import src.models  # noqa: F401 — enregistre les tables sur Base.metadata
from src.routers import emails, emails_oauth
from src.routers import admin, admin_billing, admin_music, admin_prospecting, admin_tiktok, auth, billing, bots, cm, cm_inbox, cm_library, cm_team, embed, inbox, kb, music, orgs, public, stats, tiktok, tree, twofa, uploads, widget, youtube
from src.routers.external import account as ext_account
from src.routers.external import oauth as ext_oauth
from src.routers.external import onboarding as ext_onboarding
from src.services import cm_jobs, tiktok_jobs, youtube_jobs
from src.routers import cm_mobile
from src.routers import cm_invite_links
from src.routers import cm_account_requests
from src.services import cm_push
from src.services import emails_mcp
from src.services.auth_service import ensure_dev_admin

logging.basicConfig(level=logging.INFO)
# httpx journalise chaque URL appelée en INFO, query string comprise : l'URL
# d'upload TikTok porte un upload_token. Seuls les avertissements passent.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Journal d'accès d'uvicorn : aucun paramètre d'URL n'est écrit (codes et state OAuth, ?k= des liens de
# téléchargement, session_id de Stripe, jetons…) : seul le chemin reste, suivi de « ?… » s'il y en avait.
def _sans_params(path: str) -> str:
    base, sep, _ = path.partition("?")
    return base + ("?…" if sep else "")


class _MasqueCles(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = args[:2] + (_sans_params(args[2]),) + args[3:]
        return True


logging.getLogger("uvicorn.access").addFilter(_MasqueCles())

WIDGET_JS = Path("/app/widget/widget.js")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # IMPORTANT : l'app ne joue PLUS `alembic upgrade head` au démarrage.
    # En multi-réplica/multi-worker, migrer au boot bloque le démarrage de TOUS
    # les réplicas et provoque des courses. Les migrations sont désormais une
    # ÉTAPE DE DÉPLOIEMENT DÉDIÉE, jouée UNE fois AVANT de (re)démarrer l'app :
    #   - prod  : deploy.sh -> `docker compose run --rm api alembic upgrade head`
    #   - dev   : service one-shot `migrate` (docker-compose.yml), dont l'api
    #             dépend (service_completed_successfully)
    #   - make  : `make migrate`
    # L'app ASSUME donc une base déjà migrée. `ensure_dev_admin` n'est PAS une
    # migration (simple upsert du compte admin de dev) : on le garde au boot.
    async with AsyncSessionLocal() as session:
        await ensure_dev_admin(session)
    logger.info("API prête (DB supposée déjà migrée — voir deploy.sh / make migrate)")
    # Module TikTok : refresh des jetons, suivi des publications, nettoyage
    # (un seul worker par tick, cf. services/tiktok_jobs). No-op si désactivé.
    tiktok_jobs.start_scheduler()
    # Module YouTube : suivi des Shorts envoyés, vérification des chaînes.
    youtube_jobs.start_scheduler()
    # cm.chapote.fr : publications programmées, suivi, statistiques, nettoyage.
    cm_jobs.start_scheduler()
    # Application mobile : notifications (vidéo publiée, échec, brouillon, commentaires).
    cm_push.start_scheduler()
    # emails.chapote.fr : gestionnaire Streamable HTTP du serveur MCP (sans état, /mcp).
    async with emails_mcp.running():
        yield
    await tiktok_jobs.stop_scheduler()
    await youtube_jobs.stop_scheduler()
    await cm_jobs.stop_scheduler()
    await cm_push.stop_scheduler()


# Doc interactive (Swagger /docs, ReDoc /redoc, schema /openapi.json) : on la
# COUPE en prod (reduit la surface d'attaque + evite une page Swagger blanche,
# son JS venant d'un CDN jsdelivr + script inline que la CSP stricte bloque).
# Conservee en dev pour le confort.
_docs_kwargs = {} if not settings.is_production else dict(
    docs_url=None, redoc_url=None, openapi_url=None
)
app = FastAPI(title="ChatBot SaaS API", lifespan=lifespan, **_docs_kwargs)

# Contrat d'erreur unifié (PR-09) : normalise TOUTES les réponses d'erreur en
# {detail, code, message}. `detail` reste inchangé (rétrocompat). Voir core/errors.py.
install_error_handlers(app)

# CORS dashboard (strict). Les /api/widget/* sont geres par le middleware dedie.
dashboard_origins = [settings.APP_URL]
if not settings.is_production:
    dashboard_origins += ["http://localhost:3001", "http://127.0.0.1:3001"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=dashboard_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# En-tetes de securite globaux (audit §3.5/§4.8) ---------------------------
#
# CSP du dashboard : l'app React pose massivement des styles inline
# (attributs style={{...}}) -> style-src doit autoriser 'unsafe-inline'.
# Images en data:/https: (avatars, lanceurs). frame-ancestors 'none' =
# anti-clickjacking (l'objectif premier). Origines TIERCES reellement
# chargees par l'app servie (doit rester aligne avec app/nginx.conf) :
#   - script-src : hash de l'IIFE anti-flash inline d'index.html (pas de
#     'unsafe-inline' sur les scripts) + Turnstile (captcha /demo) ;
#   - frame-src / connect-src : iframe + endpoint Turnstile ;
#   - style-src / font-src : Google Fonts + Fontshare (polices distantes) ;
#   - connect-src 'self' https: : l'app appelle l'API sur une origine
#     DISTINCTE (VITE_API_URL, ex. api.chapote.fr), inconnue a la compile ;
#     https: la couvre (et couvre aussi le POST Turnstile).
# object-src 'none' = pas de plugins legacy.
DASHBOARD_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'sha256-+rn9zAXD0btXkTbfuB8S0nuhugvmkoMuK9AQce4NwJ0=' https://challenges.cloudflare.com https://accounts.google.com/gsi/client; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://accounts.google.com/gsi/style; "
    "img-src 'self' data: https:; media-src 'self' blob:; "
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com; "
    "connect-src 'self' https:; "
    "frame-src https://challenges.cloudflare.com https://accounts.google.com/gsi/; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "object-src 'none'"
)


def _is_embeddable(path: str) -> bool:
    """Routes du widget embarque en iframe sur des sites clients : elles NE
    doivent PAS recevoir les en-tetes anti-embarquement (X-Frame-Options /
    frame-ancestors). Tout le reste = dashboard/API -> anti-clickjacking actif."""
    return (
        path.startswith("/api/widget")
        or path.startswith("/uploads")
        or path == "/widget.js"
        or path == "/widget-frame"
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """En-tetes de securite globaux : anti-sniffing, Referrer-Policy, HSTS (prod
    seulement) sur TOUTES les routes ; anti-embarquement (X-Frame-Options DENY +
    CSP frame-ancestors 'none') sur les routes NON-widget uniquement.

    `setdefault` + branche embeddable preservent la CSP stricte propre que
    widget_cors pose deja sur /uploads (default-src 'none')."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if settings.is_production:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    if not _is_embeddable(request.url.path):
        response.headers["X-Frame-Options"] = "DENY"
        response.headers.setdefault("Content-Security-Policy", DASHBOARD_CSP)
    return response


@app.middleware("http")
async def widget_cors(request: Request, call_next):
    """CORS ouvert UNIQUEMENT pour le widget : il est embarque sur des sites
    arbitraires. L'autorisation reelle (whitelist de domaines du bot) est
    verifiee dans le router widget, pas ici."""
    path = request.url.path
    is_widget = path.startswith("/api/widget") or path == "/widget.js" or path.startswith("/uploads")
    origin = request.headers.get("origin", "*")

    if is_widget and request.method == "OPTIONS":
        return JSONResponse({}, headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
            # L'origine est refletee : les caches (CDN/proxy) doivent varier dessus
            "Vary": "Origin",
        })

    response = await call_next(request)
    if is_widget:
        response.headers["Access-Control-Allow-Origin"] = origin
        # L'origine est refletee : les caches doivent varier dessus
        existing_vary = response.headers.get("Vary")
        if existing_vary:
            if "origin" not in existing_vary.lower():
                response.headers["Vary"] = f"{existing_vary}, Origin"
        else:
            response.headers["Vary"] = "Origin"
        if path.startswith("/uploads"):
            # Defense en profondeur : un fichier uploade ne doit jamais
            # s'executer s'il est ouvert directement depuis l'origine API
            response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
            response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/widget.js", include_in_schema=False)
async def serve_widget():
    return FileResponse(WIDGET_JS, media_type="application/javascript",
                        headers={"Cache-Control": "public, max-age=300"})


@app.get("/widget-frame", include_in_schema=False)
async def widget_frame(key: str, preview_token: str | None = None,
                       parent_origin: str | None = None, design_nonce: str | None = None):
    """Page hote pour l'integration iframe : le chat s'affiche ouvert, en
    pleine zone. La securite reste identique (origin de l'iframe = l'API,
    toujours accepte ; le referer de la page parente est verifie au handshake
    via le header Referer transmis par le navigateur).

    Aperçu (onboarding plugin WP) : `?preview_token=<jwt>` est reflété en
    `data-preview-token` ; widget.js le joint à bootstrap/session pour bypasser
    origine+captcha (session sans side-effects). Validé strictement (format JWT
    compact base64url.base64url.base64url) avant réflexion (anti-XSS)."""
    # Anti-XSS : `key` est reflete dans le HTML -> format pk_... strict ou rien
    if not re.fullmatch(r"pk_[A-Za-z0-9_-]{10,64}", key):
        return HTMLResponse("Bad request", status_code=400)
    # Anti-XSS : un JWT n'a que des caractères base64url + 2 points ; tout le reste
    # est rejeté (l'attribut n'est posé que sur un token bien formé).
    preview_attr = ""
    src_cache_bust = ""
    reskin_attr = ""
    if preview_token and re.fullmatch(r"[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", preview_token):
        preview_attr = f' data-preview-token="{preview_token}"'
        # Aperçu : widget.js est servi avec max-age=300 (cache public 5 min). Sans
        # cache-buster, « Recommencer » rechargerait l'ancien widget.js en cache
        # (qui restaure la session) -> pas de reset. On suffixe la signature du
        # token (base64url, unique à chaque mint, donc à chaque Recommencer) pour
        # forcer une URL neuve -> dernière version + état vierge. Public inchangé.
        src_cache_bust = "?v=" + preview_token.rsplit(".", 1)[-1][-16:]
        # Re-skin à chaud : l'éditeur d'apparence (origine app + nonce) pousse le
        # design en live via postMessage. widget.js ne l'accepte QUE de cette
        # origine + ce nonce. Validés STRICTEMENT (anti-XSS : origine bien formée,
        # nonce alphanum) avant réflexion ; absents -> pas de re-skin (no-op).
        if (parent_origin and design_nonce
                and re.fullmatch(r"https?://[A-Za-z0-9.\-]+(:\d{1,5})?", parent_origin)
                and re.fullmatch(r"[A-Za-z0-9]{8,64}", design_nonce)):
            reskin_attr = f' data-reskin-origin="{parent_origin}" data-reskin-nonce="{design_nonce}"'
    # Présentation : l'éditeur d'apparence (re-skin actif) veut le widget FLOTTANT
    # (lanceur + panneau positionnés selon le design) pour prévisualiser position/
    # taille/lanceur -> data-inline=false + auto-ouverture du panneau. L'étape
    # « Aperçu » du plugin (sans re-skin) garde l'INLINE plein écran (test conv).
    inline_val = "false" if reskin_attr else "true"
    open_attr = ' data-preview-open="1"' if reskin_attr else ""
    # Mode flottant (éditeur d'apparence) : fond TRANSPARENT pour que l'iframe ne
    # montre que le widget (lanceur + panneau) par-dessus la page de l'éditeur.
    body_bg = "transparent" if reskin_attr else "#f8fafc"
    html = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chat</title><style>html,body{{margin:0;height:100%;background:{body_bg}}}</style></head>
<body>
<script src="{settings.API_URL}/widget.js{src_cache_bust}" data-bot-key="{key}"{preview_attr}{reskin_attr}{open_attr} data-inline="{inline_val}" defer></script>
</body></html>"""
    # CSP minimale (defense en profondeur sur le HTML reflete) : widget.js vient
    # de l'API, ses appels fetch() vont vers l'API, les styles sont injectes
    # inline, l'avatar peut etre un upload API ou un logo externe (https/data:).
    # Pas de frame-ancestors : la page DOIT rester embarquable partout (iframe).
    api = settings.API_URL
    csp = (
        "default-src 'none'; "
        f"script-src 'self' {api}; "
        "style-src 'unsafe-inline'; "
        f"img-src 'self' {api} data: https:; "
        f"connect-src 'self' {api}"
    )
    return HTMLResponse(html, headers={"Content-Security-Policy": csp})


@app.get("/health")
async def health():
    return {"status": "ok", "mock_ai": settings.MOCK_AI}


Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router)
app.include_router(twofa.router)
app.include_router(orgs.router)
app.include_router(bots.router)
app.include_router(kb.router)
app.include_router(inbox.router)
app.include_router(admin.router)
app.include_router(admin_billing.router)
app.include_router(admin_prospecting.router)
app.include_router(tiktok.router)
app.include_router(admin_tiktok.router)
app.include_router(youtube.router)
app.include_router(cm.router)
app.include_router(cm_library.router)
app.include_router(cm_inbox.router)
app.include_router(cm_team.router)
app.include_router(cm_mobile.router)
app.include_router(cm_invite_links.router)
app.include_router(cm_account_requests.router)
app.include_router(music.router)
app.include_router(admin_music.router)
app.include_router(uploads.router)
app.include_router(stats.router)
app.include_router(tree.router)
app.include_router(billing.router)
app.include_router(public.router)
app.include_router(widget.router)
# Surface EMBED (éditeur de bot embarqué dans le back-office WP) : scope 'embed',
# bot_id porté par le token (pas de path param). Appelé par le front dashboard.
app.include_router(embed.router)
# Surface EXTERNE (plugin WordPress) : OAuth « plugin » (Authorization Code + PKCE (S256), RFC 7636) + API de
# compte (/api/account/*, scope 'plugin'). Distinct du dashboard ; appels
# server-to-server (PHP) => hors CORS widget. `onboarding` = onboarding guidé
# (découverte d'URLs, génération d'arbre, recommandation, jetons aperçu/embed).
app.include_router(ext_oauth.router)
app.include_router(ext_account.router)
app.include_router(ext_onboarding.router)
# emails.chapote.fr (superadmin) : interface /api/emails/*, OAuth 2.1 (/.well-known/oauth-*,
# /oauth/*) et serveur MCP distant /mcp (connecteur personnalisé claude.ai). 404 si
# EMAILS_ENABLED=false. /mcp est une route ASGI brute (pas de redirection /mcp -> /mcp/).
app.include_router(emails.router)
app.include_router(emails_oauth.router)
app.add_route("/mcp", emails_mcp.endpoint, include_in_schema=False)
