"""Upload d'images (avatar du bot, icone du lanceur). Stockees sur le volume
/app/uploads, servies par /uploads/* (StaticFiles dans main.py)."""
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from src.core.config import settings
from src.core.security import get_current_user

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

# Pas de SVG : un SVG peut embarquer du <script> et serait servi depuis
# l'origine API (XSS stocke). Formats raster uniquement.
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


@router.post("")
async def upload_image(file: UploadFile, user=Depends(get_current_user)):
    ext = ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Formats acceptés : PNG, JPEG, GIF, WebP")
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Image trop lourde (max {settings.MAX_UPLOAD_BYTES // 1000} Ko)")

    # Nom aleatoire : pas de path traversal possible, pas de collision
    name = secrets.token_urlsafe(16) + ext
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / name).write_bytes(content)

    return {"url": f"{settings.API_URL}/uploads/{name}"}
