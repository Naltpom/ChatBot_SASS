"""ChatBot SaaS — API.

Surfaces :
- /api/auth, /api/orgs, /api/bots, /api/stats : dashboard clients (CORS strict)
- /api/admin/*                  : back-office superadmin (staff Kertios)
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
from src.core.database import AsyncSessionLocal, Base, engine
import src.models  # noqa: F401 — enregistre les tables sur Base.metadata
from src.routers import admin, auth, bots, orgs, stats, uploads, widget
from src.services.auth_service import ensure_dev_admin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

WIDGET_JS = Path("/app/widget/widget.js")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # v1 : create_all au demarrage. Passer a Alembic des la premiere migration
    # de schema en prod.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as session:
        await ensure_dev_admin(session)
    logger.info("Base de données prête")
    yield


app = FastAPI(title="ChatBot SaaS API", lifespan=lifespan)

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
        })

    response = await call_next(request)
    if is_widget:
        response.headers["Access-Control-Allow-Origin"] = origin
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
async def widget_frame(key: str):
    """Page hote pour l'integration iframe : le chat s'affiche ouvert, en
    pleine zone. La securite reste identique (origin de l'iframe = l'API,
    toujours accepte ; le referer de la page parente est verifie au handshake
    via le header Referer transmis par le navigateur)."""
    # Anti-XSS : `key` est reflete dans le HTML -> format pk_... strict ou rien
    if not re.fullmatch(r"pk_[A-Za-z0-9_-]{10,64}", key):
        return HTMLResponse("Bad request", status_code=400)
    html = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chat</title><style>html,body{{margin:0;height:100%;background:#f8fafc}}</style></head>
<body>
<script src="{settings.API_URL}/widget.js" data-bot-key="{key}" data-inline="true" defer></script>
</body></html>"""
    return HTMLResponse(html)


@app.get("/health")
async def health():
    return {"status": "ok", "mock_ai": settings.MOCK_AI}


Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router)
app.include_router(orgs.router)
app.include_router(bots.router)
app.include_router(admin.router)
app.include_router(uploads.router)
app.include_router(stats.router)
app.include_router(widget.router)
