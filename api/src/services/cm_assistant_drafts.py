"""Assistant Chapote CM : préparer une publication en discutant (brouillons, jamais de publication directe).

Outils (appelés par cm_assistant.run_tool, mêmes contrôles que les outils de lecture : jeton, accord IA,
périmètre, permissions du compte, choix de l'utilisateur) :
- library_search : vidéos de la bibliothèque (dossiers Drive reliés ou partagés avec Chapote) par nom,
  dossier ou légende ; recherche plein texte sans accents (pas besoin d'embeddings pour des noms de fichiers) ;
- suggest_slots : créneaux libres par compte (planning, une heure d'écart, 15 minutes d'avance) classés par
  les meilleures heures de publication du compte ;
- account_style : style des dernières publications d'un compte (longueur de légende, hashtags, réglages) ;
- create_draft : crée (ou met à jour) le brouillon « à valider » de la vidéo et renvoie deux liens construits
  par le serveur : « Lancer la programmation » (signé, lié au brouillon et à l'utilisateur, invalide si le
  brouillon change) et « Ouvrir le brouillon ». L'IA ne fait que relayer ces liens : un lien abîmé ne fait rien.
Créer un brouillon demande « Peut publier » sur chaque compte et les permissions planning du compte.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmAsset, CmProposal, CmSource, CmTarget, CmVideo, CmPost
from src.services import cm_access

PARIS = ZoneInfo("Europe/Paris")
EDIT_ROLES = ("admin", "editor")
LEAD = timedelta(minutes=15)
GAP = timedelta(minutes=60)
DEFAULT_HOURS = (12 * 60 + 30, 18 * 60 + 30, 20 * 60 + 30)


class DraftError(Exception):
    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.message, self.code = message, code


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _paris(dt: datetime) -> datetime:
    return dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(PARIS)


def _fmt(dt: datetime) -> str:
    return _paris(dt).strftime("%Y-%m-%d %H:%M")


# --------------------------------------------------------------------------
# Bibliothèque : vidéos visibles par l'utilisateur
# --------------------------------------------------------------------------

async def _visible_assets(db: AsyncSession, user) -> list[tuple[CmAsset, CmSource]]:
    out = []
    for t in await cm_access._all_tenants(db, user):
        srcs = [s for s in (await db.execute(select(CmSource).where(t.where(CmSource), CmSource.revoked_at.is_(None)))).scalars()
                if cm_access.group_allowed(t, s.group_id)]
        if not srcs:
            continue
        by = {s.id: s for s in srcs}
        for a in (await db.execute(select(CmAsset).where(CmAsset.source_id.in_(list(by)), CmAsset.removed_at.is_(None))
                                   .order_by(CmAsset.drive_created_at.desc().nullslast()).limit(5000))).scalars():
            out.append((a, by[a.source_id]))
    return out


async def library_search(db, user, refs, consent, query: str = "", limit: int = 5) -> dict:
    """Vidéos de la bibliothèque dont le nom, le dossier ou la légende contient les mots demandés."""
    if not getattr(consent, "captions", False):
        raise DraftError("Pour chercher une vidéo par son nom, autorisez les titres et légendes dans les réglages "
                         "de l'assistant (Réglages → Assistant IA).", "no_captions")
    words = [w for w in _fold(query).split() if len(w) > 1]
    scored = []
    for a, src in await _visible_assets(db, user):
        hay = _fold(" ".join(x for x in (a.title, a.name, a.folder_path, src.name, (a.caption or "")[:300]) if x))
        score = sum(3 if f" {w} " in f" {hay} " else 1 if w in hay else 0 for w in words) if words else 1
        if words and score < len(words):          # chaque mot doit apparaître
            continue
        scored.append((score, a, src))
    scored.sort(key=lambda x: (-x[0], -(x[1].drive_created_at or datetime.min).timestamp()))
    used = {pid for pid in (await db.execute(select(CmPost.asset_id).where(
        CmPost.asset_id.in_([a.id for _, a, _ in scored[:limit]] or [-1])))).scalars()}
    return {"videos": [{
        "video_id": a.id, "titre": (a.title or a.name)[:120], "dossier": " / ".join(x for x in (src.name, a.folder_path) if x)[:120],
        "duree_s": round(a.duration_sec) if a.duration_sec else None,
        "ajoutee": _fmt(a.drive_created_at) if a.drive_created_at else None,
        "deja_programmee": a.id in used, "legende_du_dossier": bool(a.caption)}
        for _, a, src in scored[:max(1, min(limit, 10))]]}


# --------------------------------------------------------------------------
# Créneaux
# --------------------------------------------------------------------------

def _resolve(refs, aliases: list[str]):
    out = []
    for name in aliases:
        r = next((x for x in refs if x.alias.lower() == str(name).strip().lower()), None)
        if r is None:
            raise DraftError("Aucun compte de ce nom dans votre périmètre autorisé. "
                             "Appelez my_accounts pour connaître les alias.", "unknown_alias")
        out.append(r)
    return out


async def _best_minutes(db, ref) -> list[int]:
    """Heures (minutes après minuit, Paris) des publications du compte qui ont fait le plus de vues."""
    rows = (await db.execute(select(CmVideo.published_at, CmVideo.views).where(
        CmVideo.platform == ref.platform, CmVideo.account_id == ref.id, CmVideo.published_at.is_not(None),
        CmVideo.views.is_not(None)).order_by(CmVideo.published_at.desc()).limit(60))).all()
    by: Counter = Counter()
    for at, views in rows:
        p = _paris(at)
        by[(p.hour * 60 + (p.minute // 15) * 15)] += views or 0
    best = [m for m, _ in by.most_common(3)]
    return best or list(DEFAULT_HOURS)


async def suggest_slots(db, user, refs, consent, accounts: list[str] | None = None, start: str = "", days: int = 3,
                        count: int = 5) -> dict:
    from src.services.cm_assistant import allowed
    chosen = _resolve(refs, accounts or [])
    if not chosen:
        raise DraftError("Indiquez au moins un compte (alias).", "no_account")
    for r in chosen:
        if not allowed(r, consent, "planning"):
            raise DraftError(f"{r.alias} : planning non autorisé pour l'assistant.", "not_allowed")
    now = utcnow()
    try:
        first_day = datetime.strptime(start, "%Y-%m-%d").date() if start else _paris(now).date()
    except ValueError:
        raise DraftError("Date de début attendue au format AAAA-MM-JJ.", "bad_date")
    days = max(1, min(int(days or 3), 14))
    busy: dict[str, list[datetime]] = {}
    for r in chosen:
        busy[r.key] = list((await db.execute(select(CmTarget.scheduled_at).where(
            CmTarget.platform == r.platform, CmTarget.account_id == r.id, CmTarget.scheduled_at.is_not(None),
            CmTarget.scheduled_at >= now - GAP, CmTarget.scheduled_at <= now + timedelta(days=days + 15)))).scalars())
    minutes = []
    for r in chosen:
        for m in await _best_minutes(db, r):
            if m not in minutes:
                minutes.append(m)
    for m in DEFAULT_HOURS:
        if m not in minutes:
            minutes.append(m)
    slots = []
    for d in range(days):
        day = first_day + timedelta(days=d)
        for m in minutes:
            local = datetime(day.year, day.month, day.day, m // 60, m % 60, tzinfo=PARIS)
            utc = local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
            if utc < now + LEAD:
                continue
            if any(abs(b - utc) < GAP for r in chosen for b in busy[r.key]):
                continue
            slots.append({"quand": local.strftime("%Y-%m-%d %H:%M"), "jour": local.strftime("%A"),
                          "raison": "meilleure heure du compte" if m in minutes[:3] else "heure courante"})
    return {"fuseau": "Europe/Paris", "creneaux": slots[:max(1, min(int(count or 5), 10))]}


# --------------------------------------------------------------------------
# Style d'un compte
# --------------------------------------------------------------------------

HASHTAG = re.compile(r"#[\wÀ-ÿ]+")


async def account_style(db, user, refs, consent, account: str = "") -> dict:
    from src.services.cm_assistant import allowed
    [r] = _resolve(refs, [account])
    if not allowed(r, consent, "captions"):
        raise DraftError(f"{r.alias} : titres et légendes non autorisés pour l'assistant.", "not_allowed")
    rows = (await db.execute(select(CmTarget, CmPost).join(CmPost, CmPost.id == CmTarget.post_id).where(
        CmTarget.platform == r.platform, CmTarget.account_id == r.id).order_by(CmTarget.id.desc()).limit(8))).all()
    caps = [((t.options or {}).get("caption") or (t.options or {}).get("title") or p.caption or "") for t, p in rows]
    tags = Counter(h.lower() for c in caps for h in HASHTAG.findall(c))
    last = (rows[0][0].options or {}) if rows else {}
    keep = {k: last.get(k) for k in ("privacy_level", "allow_comment", "allow_duet", "allow_stitch", "privacy_status",
                                       "category_id", "made_for_kids", "share_to_feed") if last.get(k) is not None}
    return {"compte": r.alias, "publications_lues": len(rows),
            "longueur_legende_moyenne": round(sum(len(c) for c in caps) / len(caps)) if caps else None,
            "hashtags_frequents": [h for h, _ in tags.most_common(10)],
            "exemples_legende": [c[:220] for c in caps[:2]],
            "reglages_habituels": keep}


# --------------------------------------------------------------------------
# Brouillon + liens
# --------------------------------------------------------------------------

def launch_sig(proposal_id: int, user_id: int, version: datetime) -> str:
    msg = f"cm-launch:{proposal_id}:{user_id}:{version.isoformat()}".encode()
    return hmac.new(settings.JWT_SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:40]


def links(p: CmProposal, user_id: int) -> list[dict]:
    base = settings.CM_URL.rstrip("/")
    return [{"label": "Lancer la programmation", "url": f"{base}/brouillon/{p.id}/lancer?s={launch_sig(p.id, user_id, p.updated_at)}"},
            {"label": "Ouvrir le brouillon", "url": f"{base}/brouillon/{p.id}"}]


async def _account_tenant(db, ref) -> tuple[Optional[int], Optional[int]]:
    model = cm_access.MODELS[ref.platform]
    acc = await db.get(model, ref.id)
    return (acc.organization_id, acc.owner_user_id) if acc else (None, None)


def _clean_options(platform: str, o: dict, kids: Optional[bool], ai: Optional[bool]) -> dict:
    o = {k: v for k, v in (o or {}).items() if v is not None}
    if platform == "tiktok":
        out = {"mode": "direct"}
        for k in ("privacy_level", "allow_comment", "allow_duet", "allow_stitch", "caption", "title", "cover_timestamp_ms"):
            if k in o:
                out[k] = o[k]
        if ai is not None:
            out["is_aigc"] = bool(ai)
        return out
    if platform == "youtube":
        out = {"privacy_status": o.get("privacy_status") or "public", "category_id": str(o.get("category_id") or "10")}
        for k in ("title", "description", "tags"):
            if k in o:
                out[k] = o[k]
        if kids is not None:
            out["made_for_kids"] = bool(kids)
        if ai is not None:
            out["synthetic_media"] = bool(ai)
        return out
    out = {"share_to_feed": bool(o.get("share_to_feed", True))}
    for k in ("caption", "thumb_offset_ms"):
        if k in o:
            out[k] = o[k]
    return out


async def create_draft(db, user, refs, consent, video_id: int = 0, accounts: list[str] | None = None, when: str = "",
                       title: str = "", caption: str = "", per_account: dict | None = None,
                       made_for_kids: Optional[bool] = None, ai_generated: Optional[bool] = None) -> dict:
    from src.services.cm_assistant import allowed
    chosen = _resolve(refs, accounts or [])
    if not chosen:
        raise DraftError("Indiquez au moins un compte (alias).", "no_account")
    for r in chosen:
        if r.role not in EDIT_ROLES:
            raise DraftError(f"{r.alias} : vous êtes en lecture seule sur ce compte, impossible d'y préparer une publication.",
                             "read_only")
        if not allowed(r, consent, "planning"):
            raise DraftError(f"{r.alias} : planning non autorisé pour l'assistant.", "not_allowed")
    pair = next(((a, s) for a, s in await _visible_assets(db, user) if a.id == int(video_id or 0)), None)
    if pair is None:
        raise DraftError("Vidéo introuvable dans votre bibliothèque. Cherchez-la avec library_search.", "unknown_video")
    asset, src = pair
    try:
        local = datetime.strptime(when.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=PARIS)
    except ValueError:
        raise DraftError("Heure attendue au format « AAAA-MM-JJ HH:MM » (heure de Paris).", "bad_date")
    at = local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
    if at < utcnow() + LEAD:
        raise DraftError("Heure trop proche ou passée : 15 minutes d'avance au minimum.", "too_soon")
    for r in chosen:
        if await _account_tenant(db, r) != (src.organization_id, src.owner_user_id):
            raise DraftError(f"{r.alias} n'est pas dans le même espace que cette vidéo : une publication par espace.",
                             "other_space")
    if any(r.platform == "youtube" for r in chosen) and made_for_kids is None:
        raise DraftError("YouTube demande si la vidéo est conçue pour les enfants (made_for_kids : true ou false). "
                         "Demandez-le à l'utilisateur.", "kids_required")
    per = {str(k).strip().lower(): v for k, v in (per_account or {}).items() if isinstance(v, dict)}
    for r in chosen:
        if r.platform == "tiktok" and not (per.get(r.alias.lower()) or {}).get("privacy_level"):
            raise DraftError(f"{r.alias} : TikTok demande qui peut voir la vidéo (privacy_level, par ex. "
                             "PUBLIC_TO_EVERYONE). Demandez-le à l'utilisateur.", "privacy_required")
    keys = [r.key for r in chosen]
    opts = {r.key: _clean_options(r.platform, per.get(r.alias.lower()) or {}, made_for_kids, ai_generated) for r in chosen}
    p = (await db.execute(select(CmProposal).where(CmProposal.asset_id == asset.id))).scalar_one_or_none()
    if p is None:
        p = CmProposal(organization_id=src.organization_id, owner_user_id=src.owner_user_id, source_id=src.id,
                       asset_id=asset.id)
        db.add(p)
    p.title = (title or asset.title or asset.name)[:200]
    p.caption = caption or asset.caption or ""
    p.scheduled_at, p.when_from, p.accounts, p.options = at, "assistant", keys, opts
    p.origin, p.status = "assistant", "open"
    p.updated_at = utcnow()
    await db.commit()
    await db.refresh(p)
    return {"brouillon": p.id, "video": (asset.title or asset.name)[:120], "quand": local.strftime("%Y-%m-%d %H:%M"),
            "comptes": [r.alias for r in chosen],
            "liens": links(p, user.id),
            "consigne": ("Montrez ces deux liens tels quels (sans les modifier) sous forme de liens markdown, avec un "
                         "court récapitulatif. « Lancer la programmation » programme tout de suite ce brouillon ; "
                         "« Ouvrir le brouillon » permet de le vérifier et de le modifier avant.")}
