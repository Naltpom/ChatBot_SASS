"""Gestion des réseaux sociaux (cm.chapote.fr) : règles et outils communs.

- Comptes : lecture uniforme des comptes TikTok, YouTube et Instagram d'un tenant.
- Options d'une cible : validées et normalisées par plateforme (mêmes règles que
  les modules TikTok et YouTube de l'Espace client).
- Vidéos : stockées dans CM_MEDIA_DIR jusqu'à la fin de leurs publications ;
  Instagram les télécharge par un lien signé et temporaire.
- Statistiques : relevé d'un compte (abonnés, vues, j'aime, vidéos récentes).
"""
import hashlib
import hmac
import logging
import os
import re
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import (
    IG_MODE_API,
    IG_MODE_ROUTINE,
    CmAccountStat,
    CmPost,
    CmTarget,
    CmVideo,
    InstagramAccount,
)
from src.models.tiktok import TikTokAccount
from src.models.youtube import YouTubeAccount
from src.services import instagram_service as ig
from src.services import tiktok_service as tt
from src.services import youtube_service as yt

logger = logging.getLogger(__name__)

PART_SIZE = 8 * 1024 * 1024
DISK_MARGIN = 2 * 1024 * 1024 * 1024
MAX_SCHEDULE_AHEAD = timedelta(days=180)
MEDIA_LINK_TTL = timedelta(hours=2)

MODELS = {"tiktok": TikTokAccount, "youtube": YouTubeAccount, "instagram": InstagramAccount}
ACCOUNT_LABEL = {"tiktok": "Compte TikTok", "youtube": "Chaîne YouTube", "instagram": "Compte Instagram"}


def bad(msg: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(code, msg)


def to_utc_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


# --------------------------------------------------------------------------
# Comptes
# --------------------------------------------------------------------------

def account_name(platform: str, acc) -> Optional[str]:
    if acc is None:
        return None
    if platform == "tiktok":
        return acc.display_name
    if platform == "youtube":
        return acc.title or acc.handle
    return f"@{acc.username}" if acc.username else acc.name


def _slugify(text: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9._-]+", "-", t).strip("-") or "compte"


def account_slug(platform: str, acc) -> str:
    """Nom lisible et stable d'un compte : « instagram:@ghosthands.music », « tiktok:@pseudo »,
    « youtube:@chaine ». À défaut de pseudo connu : le nom, simplifié."""
    if platform == "instagram":
        handle = acc.username or _slugify(acc.name or "")
    elif platform == "tiktok":
        handle = acc.username or _slugify(acc.display_name or "")
    else:
        handle = (acc.handle or "").lstrip("@") or _slugify(acc.title or "")
    return f"{platform}:@{handle.lower()}"


def same_slug(slug: str, platform: str, acc) -> bool:
    p, _, h = (slug or "").strip().lower().partition(":")
    return p == platform and h.lstrip("@") == account_slug(platform, acc).split(":@", 1)[1]


def account_avatar(platform: str, acc) -> Optional[str]:
    if platform == "tiktok":
        return acc.avatar_url
    if platform == "youtube":
        return acc.thumbnail_url
    return acc.profile_picture_url


def stats_available(platform: str, acc) -> bool:
    if platform == "tiktok":
        return tt.has_scope(acc, tt.SCOPE_STATS) or tt.has_scope(acc, tt.SCOPE_VIDEO_LIST)
    if platform == "instagram":
        return acc.mode == IG_MODE_ROUTINE or ig.SCOPE_INSIGHTS in (acc.scopes or "").split(",") \
            or ig.SCOPE_BASIC in (acc.scopes or "").split(",")
    return True


def can_publish(platform: str, acc) -> bool:
    if acc is None or acc.revoked_at is not None or acc.needs_reconnect:
        return False
    if platform == "tiktok":
        return tt.is_enabled() and ("video.publish" in (acc.scopes or "").split(",")
                                    or "video.upload" in (acc.scopes or "").split(","))
    if platform == "youtube":
        return yt.is_enabled() and yt.can_upload(acc)
    if acc.mode == IG_MODE_API:
        return ig.is_enabled() and ig.can_publish(acc)
    return True


def account_view(platform: str, acc, stat: Optional[CmAccountStat] = None,
                 previous: Optional[CmAccountStat] = None) -> dict:
    out: dict[str, Any] = {
        "platform": platform,
        "id": acc.id,
        "name": account_name(platform, acc), "slug": account_slug(platform, acc),
        "avatar_url": account_avatar(platform, acc),
        "needs_reconnect": bool(acc.needs_reconnect),
        "can_publish": can_publish(platform, acc),
        "stats_available": stats_available(platform, acc),
        "connected_at": iso(acc.created_at),
        "mode": getattr(acc, "mode", "api"),
    }
    if platform == "tiktok":
        out["can_direct"] = "video.publish" in (acc.scopes or "").split(",")
        out["can_draft"] = "video.upload" in (acc.scopes or "").split(",")
    if platform == "youtube":
        out["handle"] = acc.handle
    if platform == "instagram":
        out["username"] = acc.username
    stats = None
    if stat is not None:
        stats = {"followers": stat.followers, "views": stat.views, "likes": stat.likes, "videos": stat.videos,
                 "updated_at": iso(stat.updated_at), "error": stat.error}
        if previous is not None:
            stats["delta_followers"] = _delta(stat.followers, previous.followers)
            stats["delta_views"] = _delta(stat.views, previous.views)
    out["stats"] = stats
    return out


def _delta(a, b):
    return a - b if a is not None and b is not None else None


async def tenant_accounts(db: AsyncSession, tenant) -> list[tuple[str, Any]]:
    """(plateforme, compte) actifs du tenant (non déconnectés)."""
    out = []
    for platform, model in MODELS.items():
        rows = (await db.execute(
            select(model).where(tenant.where(model), model.revoked_at.is_(None)).order_by(model.created_at)
        )).scalars().all()
        allowed = getattr(tenant, "allowed", None)     # membre limité à des groupes de comptes
        out += [(platform, r) for r in rows if allowed is None or (platform, r.id) in allowed]
    return out


async def get_account(db: AsyncSession, tenant, platform: str, account_id: int):
    model = MODELS.get(platform)
    if model is None:
        raise bad("Plateforme inconnue.")
    acc = await db.get(model, account_id)
    allowed = getattr(tenant, "allowed", None)
    if acc is None or acc.revoked_at is not None or not _same_tenant(acc, tenant) \
            or (allowed is not None and (platform, acc.id) not in allowed):
        raise bad(f"{ACCOUNT_LABEL[platform]} introuvable.", status.HTTP_404_NOT_FOUND)
    return acc


def _same_tenant(row, tenant) -> bool:
    if tenant.org_id:
        return row.organization_id == tenant.org_id
    return row.owner_user_id == tenant.owner_user_id


# --------------------------------------------------------------------------
# Options d'une cible
# --------------------------------------------------------------------------

def _utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _bool(v, default=False) -> bool:
    return bool(v) if v is not None else default


IG_USERNAME = re.compile(r"^[A-Za-z0-9._]{1,30}$")
LANG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


def _with_hashtags(text: str, tags) -> str:
    """Ajoute les hashtags (liste, avec ou sans #) absents du texte, à la fin."""
    if not tags:
        return text
    if not isinstance(tags, list):
        raise bad("hashtags : une liste est attendue.")
    have = {w.lower() for w in re.findall(r"#[^\s#]+", text or "")}
    add = []
    for t in tags:
        t = "#" + str(t).strip().lstrip("#").replace(" ", "")
        if len(t) > 1 and t.lower() not in have:
            have.add(t.lower())
            add.append(t)
    return f"{text.rstrip()}\n\n{' '.join(add)}".strip() if add else text


def normalize_options(platform: str, acc, options: dict, post_title: str, post_caption: str) -> dict:
    """Options validées d'une cible (lève HTTPException 400 en français). Champ propre absent : la
    légende commune du post (`caption`), sinon son titre."""
    o = options or {}
    if platform == "tiktok":
        mode = o.get("mode") or "direct"
        if mode not in ("direct", "draft"):
            raise bad("TikTok : mode de publication inconnu.")
        scopes = (acc.scopes or "").split(",")
        if (mode == "direct" and "video.publish" not in scopes) or (mode == "draft" and "video.upload" not in scopes):
            raise bad(tt.ERROR_MESSAGES["scope_not_authorized"])
        title = o.get("title") if o.get("title") is not None else o.get("caption")
        title = (post_caption or post_title or "") if title is None else str(title)
        title = _with_hashtags(title, o.get("hashtags"))
        out = {"mode": mode, "title": title if mode == "direct" else None,
               "privacy_level": o.get("privacy_level") if mode == "direct" else None,
               "allow_comment": _bool(o.get("allow_comment")), "allow_duet": _bool(o.get("allow_duet")),
               "allow_stitch": _bool(o.get("allow_stitch")),
               "brand_organic": mode == "direct" and _bool(o.get("brand_organic")),
               "brand_content": mode == "direct" and _bool(o.get("brand_content")),
               "fallback_draft": mode == "direct" and _bool(o.get("fallback_draft"))}
        if mode == "direct":
            if not out["privacy_level"]:
                raise bad("TikTok : choisissez qui peut voir cette vidéo.")
            if out["brand_content"] and out["privacy_level"] == "SELF_ONLY":
                raise bad("TikTok : la visibilité d'un contenu de marque ne peut pas être privée.")
            if _utf16_len(title) > tt.TITLE_MAX:
                raise bad(f"TikTok : légende trop longue ({tt.TITLE_MAX} caractères maximum).")
        return out

    if platform == "youtube":
        title = str(o.get("title") if o.get("title") is not None else post_title).strip()
        if not title or len(title) > yt.TITLE_MAX or "<" in title or ">" in title:
            raise bad(yt.ERROR_MESSAGES["invalidTitle"])
        desc = str(o.get("description") if o.get("description") is not None else (post_caption or ""))
        if len(desc.encode("utf-8")) > yt.DESCRIPTION_MAX_BYTES or "<" in desc or ">" in desc:
            raise bad(yt.ERROR_MESSAGES["invalidDescription"])
        tags = [str(t).strip().lstrip("#") for t in (o.get("tags") or []) if str(t).strip().lstrip("#")]
        tlen = sum(len(t) + (2 if " " in t else 0) for t in tags) + max(len(tags) - 1, 0)
        if tlen > yt.TAGS_MAX or any("<" in t or ">" in t or "," in t for t in tags):
            raise bad(yt.ERROR_MESSAGES["invalidTags"])
        privacy = o.get("privacy_status") or "public"
        if privacy not in ("public", "unlisted", "private"):
            raise bad("YouTube : visibilité inconnue.")
        if o.get("made_for_kids") is None:
            raise bad("YouTube : indiquez si la vidéo est conçue pour les enfants.")
        cat = str(o.get("category_id") or yt.DEFAULT_CATEGORY)
        if not cat.isdigit() or len(cat) > 3:
            raise bad(yt.ERROR_MESSAGES["invalidCategoryId"])
        lang = o.get("default_language") or None
        if lang is not None and not LANG.match(str(lang)):
            raise bad("YouTube : langue invalide (code comme « fr », « en » ou « pt-BR »).")
        return {"title": title, "description": desc, "tags": tags, "category_id": cat,
                "privacy_status": privacy, "made_for_kids": bool(o.get("made_for_kids")),
                "synthetic_media": _bool(o.get("synthetic_media")),
                "notify_subscribers": _bool(o.get("notify_subscribers"), True),
                "default_language": o.get("default_language") or None}

    # Instagram (Reel)
    caption = str(o.get("caption") if o.get("caption") is not None else (post_caption or ""))
    caption = _with_hashtags(caption, o.get("hashtags"))
    collab = [str(u).strip().lstrip("@") for u in (o.get("collaborators") or []) if str(u).strip()]
    if len(collab) > 3 or any(not IG_USERNAME.match(u) for u in collab):
        raise bad("Instagram : 3 collaborateurs au plus, nom d'utilisateur Instagram sans espace.")
    if len(caption) > ig.CAPTION_MAX:
        raise bad(f"Instagram : légende trop longue ({ig.CAPTION_MAX} caractères maximum).")
    if caption.count("#") > 30:
        raise bad("Instagram : 30 hashtags au plus.")
    thumb = o.get("thumb_offset_ms")
    if thumb is not None:
        try:
            thumb = max(0, int(thumb))
        except (TypeError, ValueError):
            raise bad("Instagram : position de la couverture invalide.")
    return {"caption": caption, "share_to_feed": _bool(o.get("share_to_feed"), True), "thumb_offset_ms": thumb,
            "collaborators": collab}


def check_schedule(when: Optional[datetime]) -> datetime:
    now = utcnow()
    when = to_utc_naive(when) or now
    if when < now - timedelta(minutes=1):
        raise bad("L'heure de publication est déjà passée.")
    if when > now + MAX_SCHEDULE_AHEAD:
        raise bad("La publication ne peut pas être programmée plus de 6 mois à l'avance.")
    return max(when, now)


def check_video_for(platform: str, acc, mime: str, duration: float, size: int) -> Optional[str]:
    """Message d'erreur si la vidéo ne convient pas à la plateforme, sinon None."""
    if platform == "tiktok":
        if mime not in tt.ALLOWED_MIME:
            return "TikTok : format non pris en charge (MP4, MOV ou WebM)."
        if duration > tt.MAX_DURATION_SEC:
            return f"TikTok : vidéo trop longue ({int(duration)} s pour {tt.MAX_DURATION_SEC} s maximum)."
        if size > tt.max_upload_bytes():
            return "TikTok : vidéo trop volumineuse."
    elif platform == "youtube":
        if mime not in yt.ALLOWED_MIME:
            return "YouTube : format non pris en charge (MP4, MOV ou WebM)."
        if duration > yt.MAX_DURATION_SEC:
            return f"YouTube : vidéo trop longue pour un Short ({int(duration)} s pour {yt.MAX_DURATION_SEC} s maximum)."
        if size > yt.max_upload_bytes():
            return "YouTube : vidéo trop volumineuse."
    else:
        if mime not in ig.ALLOWED_MIME:
            return "Instagram : format non pris en charge (MP4 ou MOV)."
        if duration < ig.MIN_DURATION_SEC or duration > ig.MAX_DURATION_SEC:
            return f"Instagram : un Reel dure de {ig.MIN_DURATION_SEC} s à {ig.MAX_DURATION_SEC // 60} min."
        if size > ig.MAX_VIDEO_SIZE:
            return "Instagram : vidéo trop volumineuse (300 Mo maximum)."
    return None


# --------------------------------------------------------------------------
# Fichiers
# --------------------------------------------------------------------------

def media_dir() -> Path:
    p = Path(settings.CM_MEDIA_DIR)
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    return p


def max_upload_bytes() -> int:
    return settings.CM_MAX_UPLOAD_MB * 1024 * 1024


def media_usage() -> int:
    total = 0
    for f in media_dir().iterdir():
        try:
            total += f.stat().st_size
        except OSError:
            pass
    return total


def check_space(size: int) -> None:
    folder = media_dir()
    if media_usage() + size > settings.CM_MEDIA_MAX_GB * 1024 ** 3:
        raise bad("L'espace réservé aux vidéos programmées est plein : attendez que des publications partent "
                  "ou annulez-en.", status.HTTP_507_INSUFFICIENT_STORAGE)
    if shutil.disk_usage(folder).free < size + DISK_MARGIN:
        logger.error("cm : espace disque insuffisant pour une vidéo de %s octets", size)
        raise bad("Envoi impossible pour le moment (capacité temporairement atteinte). Réessayez plus tard.",
                  status.HTTP_503_SERVICE_UNAVAILABLE)


def remove_cover(post: CmPost) -> None:
    if post.cover_path:
        try:
            os.unlink(post.cover_path)
        except OSError:
            pass
        post.cover_path = None


def remove_media(post: CmPost) -> None:
    remove_cover(post)
    if post.media_path:
        try:
            os.unlink(post.media_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("cm : suppression de la vidéo %s impossible (%s)", post.id, e)
        post.media_path = None


def _sign(target_id: int, exp: int) -> str:
    msg = f"cm-media:{target_id}:{exp}".encode()
    return hmac.new(settings.JWT_SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:40]


def media_url(target: CmTarget, mime: Optional[str]) -> str:
    """Lien public et temporaire de la vidéo, que Meta télécharge."""
    exp = int((utcnow() + MEDIA_LINK_TTL).replace(tzinfo=timezone.utc).timestamp())
    ext = "mov" if mime == "video/quicktime" else "mp4"
    return f"{settings.CM_URL.rstrip('/')}/api/cm/media/{target.id}/{exp}/{_sign(target.id, exp)}.{ext}"


def _sign_cover(target_id: int, exp: int) -> str:
    msg = f"cm-cover:{target_id}:{exp}".encode()
    return hmac.new(settings.JWT_SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:40]


def cover_url(target: CmTarget) -> str:
    """Lien public et temporaire de la couverture, que Meta télécharge."""
    exp = int((utcnow() + MEDIA_LINK_TTL).replace(tzinfo=timezone.utc).timestamp())
    return f"{settings.CM_URL.rstrip('/')}/api/cm/cover/{target.id}/{exp}/{_sign_cover(target.id, exp)}.jpg"


def check_cover_link(target_id: int, exp: int, sig: str) -> bool:
    if exp < utcnow().replace(tzinfo=timezone.utc).timestamp():
        return False
    return hmac.compare_digest(sig, _sign_cover(target_id, exp))


COVER_MAX_BYTES = 8 * 1024 * 1024


def image_kind(data: bytes) -> Optional[str]:
    """jpeg | png d'après les premiers octets (Instagram accepte JPEG ; PNG converti par Meta)."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    return None


def check_media_link(target_id: int, exp: int, sig: str) -> bool:
    if exp < utcnow().replace(tzinfo=timezone.utc).timestamp():
        return False
    return hmac.compare_digest(sig, _sign(target_id, exp))


# --------------------------------------------------------------------------
# Statistiques
# --------------------------------------------------------------------------

def _parse_time(v) -> Optional[datetime]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
    try:
        s = str(v).replace("Z", "+00:00")
        if len(s) >= 5 and s[-5] in "+-" and s[-3] != ":":   # +0000 (Instagram)
            s = s[:-2] + ":" + s[-2:]
        return to_utc_naive(datetime.fromisoformat(s))
    except ValueError:
        return None


def _num(v) -> Optional[int]:
    try:
        return None if v is None else int(v)
    except (TypeError, ValueError):
        return None


async def upsert_video(db: AsyncSession, platform: str, account_id: int, external_id: str, **fields) -> CmVideo:
    row = (await db.execute(select(CmVideo).where(
        CmVideo.platform == platform, CmVideo.account_id == account_id, CmVideo.external_id == external_id)
    )).scalar_one_or_none()
    if row is None:
        row = CmVideo(platform=platform, account_id=account_id, external_id=external_id)
        db.add(row)
    for k, v in fields.items():
        if v is not None:
            setattr(row, k, v)
    if any(k in fields for k in ("views", "likes", "comments", "shares", "saves")):
        row.stats_updated_at = utcnow()
    if row.target_id is None:
        target = (await db.execute(select(CmTarget.id).where(
            CmTarget.platform == platform, CmTarget.account_id == account_id,
            CmTarget.external_id == external_id).limit(1))).scalar_one_or_none()
        row.target_id = target
    return row


async def save_snapshot(db: AsyncSession, platform: str, account_id: int, *, followers=None, views=None,
                        likes=None, videos=None, error: Optional[str] = None, day: Optional[date] = None) -> CmAccountStat:
    day = day or utcnow().date()
    row = (await db.execute(select(CmAccountStat).where(
        CmAccountStat.platform == platform, CmAccountStat.account_id == account_id, CmAccountStat.day == day)
    )).scalar_one_or_none()
    if row is None:
        row = CmAccountStat(platform=platform, account_id=account_id, day=day)
        db.add(row)
    if error is None:
        row.followers, row.views, row.likes, row.videos = followers, views, likes, videos
    elif row.followers is None and row.views is None:
        row.followers, row.views, row.likes, row.videos = followers, views, likes, videos
    row.error = error
    row.updated_at = utcnow()
    return row


def _sum(values) -> Optional[int]:
    vals = [v for v in values if v is not None]
    return sum(vals) if vals else None


async def sync_account(db: AsyncSession, platform: str, acc, full: bool = False) -> CmAccountStat:
    """Relève les chiffres d'un compte et ses vidéos récentes. Ne lève pas :
    l'échec est noté sur le relevé du jour. `full` (bouton Actualiser) : Instagram relit les vues de
    TOUS les Reels d'un coup (sinon par tournées de INSIGHTS_PER_SYNC)."""
    try:
        if platform == "youtube":
            return await _sync_youtube(db, acc)
        if platform == "tiktok":
            return await _sync_tiktok(db, acc)
        return await _sync_instagram(db, acc, full)
    except (tt.ReconnectRequired, yt.ReconnectRequired, ig.ReconnectRequired):
        await db.rollback()
        row = await save_snapshot(db, platform, acc.id, error="Compte à reconnecter.")
        await db.commit()
        return row
    except (tt.TikTokError, yt.YouTubeError, ig.InstagramError) as e:
        await db.rollback()
        logger.info("cm : relevé %s du compte %s en échec (%s)", platform, acc.id, e.code)
        row = await save_snapshot(db, platform, acc.id, error=e.describe())
        await db.commit()
        return row


async def _sync_youtube(db: AsyncSession, acc: YouTubeAccount) -> CmAccountStat:
    token = await yt.valid_access_token(db, acc)
    ch = await yt.channel_stats(token)
    videos = await yt.recent_videos(token, ch["uploads_playlist"])
    for v in videos:
        if v.get("id"):
            await upsert_video(db, "youtube", acc.id, v["id"], title=v["title"], url=v["url"],
                               thumbnail_url=v["thumbnail_url"], published_at=_parse_time(v["published_at"]),
                               duration_sec=v["duration_sec"], views=v["views"], likes=v["likes"],
                               comments=v["comments"])
    row = await save_snapshot(db, "youtube", acc.id, followers=ch["subscribers"], views=ch["views"],
                              likes=_sum(v["likes"] for v in videos), videos=ch["videos"])
    await db.commit()
    return row


async def _sync_tiktok(db: AsyncSession, acc: TikTokAccount) -> CmAccountStat:
    if not stats_available("tiktok", acc):
        row = await save_snapshot(db, "tiktok", acc.id, error=(
            "Statistiques TikTok pas encore autorisées : elles arriveront quand TikTok aura validé "
            "l'accès aux chiffres et que le compte aura été reconnecté."))
        await db.commit()
        return row
    token = await tt.valid_access_token(db, acc)
    followers = likes = count = views = None
    if tt.has_scope(acc, tt.SCOPE_STATS):
        u = await tt.user_stats(token)
        followers, likes, count = _num(u.get("follower_count")), _num(u.get("likes_count")), _num(u.get("video_count"))
    if tt.has_scope(acc, tt.SCOPE_VIDEO_LIST):
        videos = await tt.list_videos(token)
        for v in videos:
            if v.get("id"):
                await upsert_video(db, "tiktok", acc.id, str(v["id"]),
                                   title=v.get("title") or v.get("video_description"), url=v.get("share_url"),
                                   thumbnail_url=v.get("cover_image_url"),
                                   published_at=_parse_time(v.get("create_time")),
                                   duration_sec=v.get("duration"), views=_num(v.get("view_count")),
                                   likes=_num(v.get("like_count")), comments=_num(v.get("comment_count")),
                                   shares=_num(v.get("share_count")))
        views = _sum(_num(v.get("view_count")) for v in videos)
    row = await save_snapshot(db, "tiktok", acc.id, followers=followers, views=views, likes=likes, videos=count)
    await db.commit()
    return row


INSIGHTS_PER_SYNC = 60


async def _sync_instagram(db: AsyncSession, acc: InstagramAccount, full: bool = False) -> CmAccountStat:
    if acc.mode != IG_MODE_API:     # chiffres envoyés par la routine
        row = (await db.execute(select(CmAccountStat).where(
            CmAccountStat.platform == "instagram", CmAccountStat.account_id == acc.id)
            .order_by(CmAccountStat.day.desc()).limit(1))).scalar_one_or_none()
        return row or await save_snapshot(db, "instagram", acc.id, error="En attente des chiffres de la routine.")
    token = await ig.valid_token(db, acc)
    prof = await ig.profile(token)
    media = await ig.all_media(token, acc.ig_user_id)
    # Vues (insights) : une requête par Reel, donc par tournées. D'abord ceux qui n'ont encore aucun
    # chiffre, puis les 15 plus récents, puis ceux dont le relevé est le plus ancien.
    reels = [m for m in media if m.get("media_type") == "VIDEO" or m.get("media_product_type") == "REELS"]
    known = {v.external_id: v for v in (await db.execute(select(CmVideo).where(
        CmVideo.platform == "instagram", CmVideo.account_id == acc.id))).scalars()}
    never = [m["id"] for m in reels if not known.get(str(m["id"])) or known[str(m["id"])].views is None]
    newest = [m["id"] for m in reels[:15]]
    stale = sorted((m["id"] for m in reels), key=lambda i: (known[str(i)].stats_updated_at or datetime.min) if str(i) in known else datetime.min)
    pick: list = []
    for i in never + newest + stale:
        if i not in pick:
            pick.append(i)
    pick = set(pick if full else pick[:INSIGHTS_PER_SYNC])
    views_total = []
    for m in reels:
        insights = {}
        if m["id"] in pick:
            try:
                insights = await ig.media_insights(token, m["id"])
            except ig.InstagramError as e:
                if e.code == "invalid_token":
                    raise
        v = _num(insights.get("views"))
        views_total.append(v if v is not None else (known[str(m["id"])].views if str(m["id"]) in known else None))
        await upsert_video(db, "instagram", acc.id, str(m["id"]), title=m.get("caption"), url=m.get("permalink"),
                           thumbnail_url=m.get("thumbnail_url"), published_at=_parse_time(m.get("timestamp")),
                           views=v, likes=_num(m.get("like_count")), comments=_num(m.get("comments_count")),
                           shares=_num(insights.get("shares")), saves=_num(insights.get("saved")))
    acc.username = prof.get("username") or acc.username
    acc.profile_picture_url = prof.get("profile_picture_url") or acc.profile_picture_url
    row = await save_snapshot(db, "instagram", acc.id, followers=_num(prof.get("followers_count")),
                              views=_sum(views_total), likes=_sum(_num(m.get("like_count")) for m in media),
                              videos=_num(prof.get("media_count")))
    await db.commit()
    return row


async def ingest_routine_stats(db: AsyncSession, acc: InstagramAccount, payload: dict) -> CmAccountStat:
    """Chiffres envoyés par la routine pour un compte Instagram."""
    videos = payload.get("videos") or []
    for v in videos:
        ext = str(v.get("external_id") or v.get("url") or "").strip()[:255]
        if not ext:
            continue
        await upsert_video(db, "instagram", acc.id, ext, title=v.get("caption"), url=v.get("url"),
                           thumbnail_url=v.get("thumbnail_url"), published_at=_parse_time(v.get("published_at")),
                           duration_sec=v.get("duration_sec"), views=_num(v.get("views")),
                           likes=_num(v.get("likes")), comments=_num(v.get("comments")),
                           shares=_num(v.get("shares")), saves=_num(v.get("saves")))
    await db.flush()
    views = _num(payload.get("views"))
    if views is None:
        views = _sum(_num(v.get("views")) for v in videos)
    likes = _num(payload.get("likes"))
    if likes is None:
        likes = _sum(_num(v.get("likes")) for v in videos)
    row = await save_snapshot(db, "instagram", acc.id, followers=_num(payload.get("followers")), views=views,
                              likes=likes, videos=_num(payload.get("media_count")))
    await db.commit()
    return row
