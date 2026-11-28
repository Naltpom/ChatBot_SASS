"""cm.chapote.fr — publication faite à la main, hors de la programmation.

  POST /api/cm/targets/{id}/published-by-hand  {url?, published_at?}
  PUT  /api/cm/targets/{id}/link                {url?}   lien d'une publication publiée, corrigé (vide = retiré)

Pour une cible prévue (SCHEDULED), ratée (FAILED) ou en brouillon TikTok (INBOX) : la personne a copié le texte et
publié elle-même dans l'app du réseau. La cible passe « publiée » (lien facultatif, vérifié selon le réseau) et ne
partira plus. La ligne est verrouillée pendant le changement : l'envoi programmé ne peut plus la prendre ensuite.
Lien corrigé : l'identifiant de la vidéo suit le lien (TikTok, YouTube) ; la fiche vidéo de l'ancien identifiant est
détachée (effacée si le réseau ne l'a jamais confirmée : aucun chiffre relevé).
Routes ajoutées : POST /targets/{id}/published (brouillon TikTok seulement) ne change pas.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.models.cm import CmVideo, T_FAILED, T_INBOX, T_PUBLISHED, T_SCHEDULED
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
    url = await _checked_url(t.platform, body.url)   # lien court TikTok (vm.tiktok.com/…) : lien complet
    t.url = url or t.url
    t.external_id = video_id(t.platform, url) or t.external_id
    t.published_at = cm.to_utc_naive(body.published_at) or None
    t.notice = None
    t.fail_reason = t.error_message = None
    await cm_jobs._record_published(db, t, post)
    await db.commit()
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)


class LinkIn(BaseModel):
    url: Optional[str] = Field(default=None, max_length=500)


async def _checked_url(platform: str, raw: Optional[str]) -> Optional[str]:
    url = (raw or "").strip() or None
    rule = LINKS.get(platform)
    if url and rule is not None and not rule.match(url):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Lien non reconnu ({EXAMPLE.get(platform, 'https://…')}).")
    if url and platform == "tiktok" and "/video/" not in url:
        url = await resolve_tiktok_link(url) or url
    return url


@router.put("/targets/{target_id}/link")
async def fix_link(target_id: int, body: LinkIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_cm_user)):
    t, post, tenant = await _get_target(db, user, target_id)
    cm_access.require(tenant, "edit")
    cm_access.require_account(tenant, t.platform, t.account_id, "edit")
    if t.status != T_PUBLISHED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Seule une publication publiée a un lien à corriger.")
    url = await _checked_url(t.platform, body.url)
    old_id, old_url = t.external_id, t.url
    new_id = video_id(t.platform, url)
    t.url = url
    if new_id:
        t.external_id = new_id
    elif old_id and video_id(t.platform, old_url) == old_id:
        t.external_id = None          # l'identifiant venait du lien retiré ou remplacé
    if old_id and t.external_id != old_id:
        old = (await db.execute(select(CmVideo).where(CmVideo.platform == t.platform, CmVideo.account_id == t.account_id,
                                                      CmVideo.external_id == old_id, CmVideo.target_id == t.id))).scalar_one_or_none()
        if old is not None:
            if old.stats_updated_at is None:
                await db.delete(old)
            else:
                old.target_id = None
    elif t.external_id:
        row = (await db.execute(select(CmVideo).where(CmVideo.platform == t.platform, CmVideo.account_id == t.account_id,
                                                      CmVideo.external_id == t.external_id))).scalar_one_or_none()
        if row is not None:
            row.url = url
    if t.external_id and t.external_id != old_id:
        await db.flush()
        await cm_jobs._record_published(db, t, post)
    await db.commit()
    _, names = await _tenant_index(db, tenant)
    return _target_out(t, names)
