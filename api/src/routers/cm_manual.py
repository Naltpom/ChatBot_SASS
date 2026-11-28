"""cm.chapote.fr — publication faite à la main, hors de la programmation.

  POST /api/cm/targets/{id}/published-by-hand  {url?, published_at?}

Pour une cible prévue (SCHEDULED), ratée (FAILED) ou en brouillon TikTok (INBOX) : la personne a copié le texte et
publié elle-même dans l'app du réseau. La cible passe « publiée » (lien facultatif, vérifié selon le réseau) et ne
partira plus. La ligne est verrouillée pendant le changement : l'envoi programmé ne peut plus la prendre ensuite.
Route ajoutée : POST /targets/{id}/published (brouillon TikTok seulement) ne change pas.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.models.cm import T_FAILED, T_INBOX, T_SCHEDULED
from src.models.user import User
from src.routers.cm import (
    PublishedIn, TIKTOK_VIDEO_RE, _capture_account_scope, _get_target, _target_out, _tenant_index, get_cm_user,
    resolve_tiktok_link,
)
from src.services import cm_access
from src.services import cm_jobs
from src.services import cm_service as cm

router = APIRouter(prefix="/api/cm", tags=["cm"], dependencies=[Depends(_capture_account_scope)])

BY_HAND = (T_SCHEDULED, T_FAILED, T_INBOX)

LINKS = {
    "tiktok": TIKTOK_VIDEO_RE,
    "instagram": re.compile(r"^https://(?:www\.)?instagram\.com/(?:[\w.]+/)?(?:reels?|p|tv)/[\w-]+/?(?:[?#]\S*)?$"),
    "youtube": re.compile(r"^https://(?:(?:www\.|m\.)?youtube\.com/(?:shorts/|watch\?v=|live/)|youtu\.be/)[\w-]{6,}\S*$"),
}
EXAMPLE = {
    "tiktok": "https://www.tiktok.com/@compte/video/…",
    "instagram": "https://www.instagram.com/reel/…",
    "youtube": "https://youtube.com/shorts/…",
}
YT_ID = re.compile(r"(?:shorts/|watch\?v=|live/|youtu\.be/)([\w-]{6,})")


def video_id(platform: str, url: Optional[str]) -> Optional[str]:
    """Identifiant de la vidéo lu dans le lien (TikTok, YouTube). Instagram : le lien ne le donne pas."""
    if not url:
        return None
    m = re.search(r"/video/(\d+)", url) if platform == "tiktok" else YT_ID.search(url) if platform == "youtube" else None
    return m.group(1) if m else None


@router.post("/targets/{target_id}/published-by-hand")
async def published_by_hand(target_id: int, body: PublishedIn = PublishedIn(), db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)      # ligne verrouillée jusqu'au commit
    cm_access.require(tenant, "edit")
    cm_access.require_account(tenant, t.platform, t.account_id, "edit")
    if t.status not in BY_HAND:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette publication est déjà partie ou en cours d'envoi.")
    url = (body.url or "").strip() or None
    rule = LINKS.get(t.platform)
    if url and rule is not None and not rule.match(url):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Lien non reconnu ({EXAMPLE.get(t.platform, 'https://…')}).")
    if url and t.platform == "tiktok" and "/video/" not in url:
        url = await resolve_tiktok_link(url) or url   # lien court de partage (vm.tiktok.com/…) : lien complet
    t.url = url or t.url
    t.external_id = video_id(t.platform, url) or t.external_id
    t.published_at = cm.to_utc_naive(body.published_at) or None
    t.notice = None
    t.fail_reason = t.error_message = None
    await cm_jobs._record_published(db, t, post)
    await db.commit()
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)
