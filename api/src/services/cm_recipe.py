"""Brouillons automatiques : comprendre le rangement d'un dossier Drive, puis proposer chaque
nouvelle vidéo comme brouillon à valider.

Une « recette » (JSON, par dossier) dit où lire chaque information. Elle ne contient que des
choix dans des listes fermées (jamais d'expression régulière fournie par l'IA) :

    {"version": 1,
     "account": {"from": "source" | "folder", "level": 1, "map": {"<nom de sous-dossier>": ["tiktok:12", "group:3"]}},
     "when":    {"pattern": "ymd_hm" | "ymd" | "dmy_hm" | "dmy" | "compact" | "none", "default_time": "18:00",
                 "timezone": "Europe/Paris"},
     "title":   {"from": "folder" | "file" | "txt_first_line"},
     "caption": {"from": "txt" | "none"},
     "cover":   {"from": "image" | "none"}}

L'analyse (une fois par dossier, à la demande) : Gemini 2.5 Flash reçoit SEULEMENT les chemins et
noms de fichiers (jamais les vidéos) et la liste des comptes / groupes ; il choisit dans ces listes.
Sans clé Gemini ou en cas d'erreur : règles déterministes. L'application de la recette à chaque
vidéo est déterministe (pas d'IA par vidéo).
"""
import json
import logging
import re
from collections import Counter
from datetime import datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.models.cm import CmAsset, CmGroup, CmGroupAccount, CmPost, CmProposal, CmSource

logger = logging.getLogger(__name__)

PATTERNS = {
    "ymd_hm": re.compile(r"(?<!\d)(\d{4})[-._ ](\d{2})[-._ ](\d{2})[ _T-]{1,3}(\d{1,2})\s?[hH:._](\d{2})(?!\d)"),
    "ymd": re.compile(r"(?<!\d)(\d{4})[-._](\d{2})[-._](\d{2})(?!\d)"),
    "dmy_hm": re.compile(r"(?<!\d)(\d{2})[-._/](\d{2})[-._/](\d{4})[ _T-]{1,3}(\d{1,2})\s?[hH:._](\d{2})(?!\d)"),
    "dmy": re.compile(r"(?<!\d)(\d{2})[-._/](\d{2})[-._/](\d{4})(?!\d)"),
    "compact": re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2}))?(?!\d)"),
}
PATTERN_LABEL = {"ymd_hm": "2026-11-24 18h30", "ymd": "2026-11-24", "dmy_hm": "24-11-2026 18h30",
                 "dmy": "24-11-2026", "compact": "20261124_1830", "none": "aucune date"}
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
TEXT_EXT = (".txt",)
DATE_STRIP = re.compile(r"^[\s\-–—_.:|]+|[\s\-–—_.:|]+$")
MAX_PROPOSALS_PER_SCAN = 200


def default_recipe() -> dict:
    return {"version": 1, "account": {"from": "source", "level": 1, "map": {}},
            "when": {"pattern": "none", "default_time": "18:00", "timezone": "Europe/Paris"},
            "title": {"from": "file"}, "caption": {"from": "txt"}, "cover": {"from": "image"}}


# --------------------------------------------------------------------------
# Validation (la recette vient d'une IA ou du navigateur : on ne garde que le connu)
# --------------------------------------------------------------------------

def clean(recipe: dict, valid_keys: set[str]) -> dict:
    r = default_recipe()
    if not isinstance(recipe, dict):
        return r
    acc = recipe.get("account") or {}
    if acc.get("from") in ("source", "folder"):
        r["account"]["from"] = acc["from"]
    try:
        r["account"]["level"] = max(1, min(3, int(acc.get("level") or 1)))
    except (TypeError, ValueError):
        pass
    amap = {}
    for folder, keys in (acc.get("map") or {}).items():
        if not isinstance(folder, str) or len(folder) > 200:
            continue
        keys = [keys] if isinstance(keys, str) else keys
        ok = [k for k in (keys or []) if isinstance(k, str) and k in valid_keys]
        if ok:
            amap[folder.strip()] = sorted(set(ok))
    r["account"]["map"] = dict(list(amap.items())[:200])
    when = recipe.get("when") or {}
    if when.get("pattern") in PATTERNS or when.get("pattern") == "none":
        r["when"]["pattern"] = when["pattern"]
    if isinstance(when.get("default_time"), str) and re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", when["default_time"]):
        r["when"]["default_time"] = when["default_time"]
    tz = when.get("timezone")
    if isinstance(tz, str):
        try:
            ZoneInfo(tz)
            r["when"]["timezone"] = tz
        except Exception:
            pass
    if (recipe.get("title") or {}).get("from") in ("folder", "file", "txt_first_line"):
        r["title"]["from"] = recipe["title"]["from"]
    if (recipe.get("caption") or {}).get("from") in ("txt", "none"):
        r["caption"]["from"] = recipe["caption"]["from"]
    if (recipe.get("cover") or {}).get("from") in ("image", "none"):
        r["cover"]["from"] = recipe["cover"]["from"]
    return r


# --------------------------------------------------------------------------
# Application à une vidéo (déterministe)
# --------------------------------------------------------------------------

def _parse_when(text: str, pattern: str, tz: str, default_time: str) -> tuple[Optional[datetime], bool]:
    """(heure UTC naïve, heure trouvée dans le nom ?)"""
    rx = PATTERNS.get(pattern)
    if not rx:
        return None, False
    m = None
    for m in rx.finditer(text):
        pass                                        # la plus profonde (la dernière du chemin)
    if not m:
        return None, False
    g = m.groups()
    try:
        if pattern.startswith("dmy"):
            y, mo, d = int(g[2]), int(g[1]), int(g[0])
        else:
            y, mo, d = int(g[0]), int(g[1]), int(g[2])
        hm = (int(g[3]), int(g[4])) if len(g) > 3 and g[3] is not None else None
        h, mi = hm if hm else map(int, default_time.split(":"))
        local = datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(tz))
    except (ValueError, TypeError):
        return None, False
    return local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None), hm is not None


def _strip_dates(text: str) -> str:
    for rx in PATTERNS.values():
        text = rx.sub(" ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return DATE_STRIP.sub("", text).strip()


def _stem(name: str) -> str:
    return name.rsplit(".", 1)[0] if "." in name else name


def apply(recipe: dict, asset: CmAsset, group_accounts: dict[int, list[str]], source_group: list[str]) -> dict:
    """Ce que la recette lit pour une vidéo : comptes, heure, titre, légende."""
    path = (asset.folder_path or "").strip("/")
    parts = [p for p in path.split("/") if p]
    # Comptes
    keys: list[str] = []
    folder = None
    if recipe["account"]["from"] == "folder":
        lvl = recipe["account"]["level"]
        folder = parts[lvl - 1] if len(parts) >= lvl else None
        for k in recipe["account"]["map"].get(folder or "", []):
            keys += group_accounts.get(int(k[6:]), []) if k.startswith("group:") else [k]
    else:
        keys = list(source_group)
    # Heure
    w = recipe["when"]
    when, has_time = _parse_when(f"{path}/{asset.name}", w["pattern"], w["timezone"], w["default_time"])
    # Titre
    tf = recipe["title"]["from"]
    title = None
    if tf == "folder" and parts:
        title = _strip_dates(parts[-1])
    elif tf == "txt_first_line" and asset.caption:
        title = asset.caption.strip().splitlines()[0][:200]
    title = (asset.title or title or _strip_dates(_stem(asset.name)) or _stem(asset.name))[:200]
    caption = asset.caption if recipe["caption"]["from"] == "txt" else None
    return {"accounts": sorted(set(keys)), "folder": folder, "scheduled_at": when,
            "when_from": ("path" if has_time else "date") if when else None, "title": title, "caption": caption}


# --------------------------------------------------------------------------
# Règles (sans IA) et analyse par Gemini
# --------------------------------------------------------------------------

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def heuristic(paths: list[str], accounts: dict[str, str], groups: dict[str, str]) -> dict:
    """`paths` : chemins des vidéos (« sous/dossier/nom.mp4 ») ; `accounts`/`groups` : clé -> nom."""
    r = default_recipe()
    counts = Counter()
    for p in paths:
        for name, rx in PATTERNS.items():
            if rx.search(p):
                counts[name] += 1
                break
    if counts:
        best, n = counts.most_common(1)[0]
        if n >= max(1, len(paths) // 3):
            r["when"]["pattern"] = best
    # Un sous-dossier de premier niveau qui ressemble à un compte ou à un groupe -> compte par dossier.
    firsts = Counter(p.split("/")[0] for p in paths if "/" in p)
    amap = {}
    for folder in firsts:
        nf = _norm(folder)
        if not nf:
            continue
        hit = [k for k, n in {**accounts, **groups}.items() if nf and (_norm(n) == nf or (len(nf) > 3 and nf in _norm(n)))]
        if hit:
            amap[folder] = hit[:5]
    if amap:
        r["account"] = {"from": "folder", "level": 1, "map": amap}
    # Une vidéo par dossier, nommé avec du texte : le titre vient du dossier.
    per_folder = Counter(p.rsplit("/", 1)[0] for p in paths if "/" in p)
    if per_folder and sum(1 for c in per_folder.values() if c == 1) >= 0.7 * len(per_folder):
        named = [f for f in per_folder if _strip_dates(f.rsplit("/", 1)[-1])]
        if len(named) >= 0.7 * len(per_folder):
            r["title"]["from"] = "folder"
    return r


SYSTEM = """Tu analyses le RANGEMENT d'un dossier Google Drive de vidéos courtes d'une équipe de réseaux sociaux.
Tu ne vois que des chemins et des noms de fichiers. Réponds UNIQUEMENT par un objet JSON (aucun texte autour) :
{"account": {"from": "source"|"folder", "level": 1|2|3, "map": {"<nom exact du sous-dossier>": ["<clé>", ...]}},
 "when": {"pattern": "ymd_hm"|"ymd"|"dmy_hm"|"dmy"|"compact"|"none", "default_time": "HH:MM"},
 "title": {"from": "folder"|"file"|"txt_first_line"},
 "caption": {"from": "txt"|"none"},
 "cover": {"from": "image"|"none"},
 "explication": "<2 phrases en français pour l'utilisateur>"}
Règles : "folder" pour account seulement si un niveau de sous-dossiers correspond clairement à des comptes ou groupes
de la liste fournie (clés exactes uniquement, sinon "source"). Formats de date : ymd_hm = 2026-11-24 18h30,
ymd = 2026-11-24, dmy_hm = 24-11-2026 18h30, dmy = 24-11-2026, compact = 20261124_1830. "folder" pour title si
chaque vidéo a son propre dossier dont le nom porte le titre. caption "txt" si des .txt accompagnent les vidéos.
cover "image" si des images accompagnent les vidéos."""


async def ask_gemini(listing: str, accounts: dict[str, str], groups: dict[str, str]) -> Optional[dict]:
    from src.services.tree_generator import GEMINI_TREE_MODEL, GEMINI_URL
    api_key = settings.GEMINI_API_KEY
    if not api_key or settings.MOCK_AI:
        return None
    user = ("Comptes (clé = nom) :\n" + "\n".join(f"{k} = {v}" for k, v in accounts.items())
            + "\nGroupes :\n" + ("\n".join(f"{k} = {v}" for k, v in groups.items()) or "(aucun)")
            + "\n\nFichiers du dossier (chemins relatifs) :\n" + listing)
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            resp = await client.post(
                GEMINI_URL.format(model=GEMINI_TREE_MODEL), headers={"x-goog-api-key": api_key},
                json={"system_instruction": {"parts": [{"text": SYSTEM}]},
                      "contents": [{"role": "user", "parts": [{"text": user[:30000]}]}],
                      "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2000,
                                           "responseMimeType": "application/json",
                                           "thinkingConfig": {"thinkingBudget": 0}}})
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except httpx.HTTPStatusError as e:
        logger.info("cm : analyse Gemini refusée (HTTP %s)", e.response.status_code)   # jamais l'URL
    except Exception as e:                       # réseau, JSON, structure
        logger.info("cm : analyse Gemini en échec (%s)", type(e).__name__)
    return None


# --------------------------------------------------------------------------
# Brouillons
# --------------------------------------------------------------------------

async def group_members(db: AsyncSession, tenant_where) -> dict[int, list[str]]:
    rows = (await db.execute(select(CmGroupAccount.group_id, CmGroupAccount.platform, CmGroupAccount.account_id)
                             .join(CmGroup, CmGroup.id == CmGroupAccount.group_id).where(tenant_where))).all()
    out: dict[int, list[str]] = {}
    for gid, p, aid in rows:
        out.setdefault(gid, []).append(f"{p}:{aid}")
    return out


async def propose(db: AsyncSession, src: CmSource) -> int:
    """Crée un brouillon pour chaque nouvelle vidéo du dossier (une seule fois par vidéo)."""
    if not src.auto_drafts or not src.recipe or src.revoked_at is not None:
        return 0
    recipe = src.recipe
    where = (CmGroup.organization_id == src.organization_id) if src.organization_id else (
        (CmGroup.owner_user_id == src.owner_user_id) & CmGroup.organization_id.is_(None))
    groups = await group_members(db, where)
    source_group = groups.get(src.group_id, []) if src.group_id else []
    used = select(CmPost.id).where(CmPost.asset_id == CmAsset.id).exists()
    known = select(CmProposal.id).where(CmProposal.asset_id == CmAsset.id).exists()
    stmt = select(CmAsset).where(CmAsset.source_id == src.id, CmAsset.removed_at.is_(None), ~used, ~known)
    if src.drafts_since:
        stmt = stmt.where(CmAsset.created_at >= src.drafts_since)
    assets = (await db.execute(stmt.order_by(CmAsset.id).limit(MAX_PROPOSALS_PER_SCAN))).scalars().all()
    now = utcnow()
    made = 0
    for a in assets:
        got = apply(recipe, a, groups, source_group)
        when = got["scheduled_at"]
        if when is not None and when < now:
            when = None                              # date passée : heure à choisir
        db.add(CmProposal(organization_id=src.organization_id, owner_user_id=src.owner_user_id, source_id=src.id,
                          asset_id=a.id, title=got["title"], caption=got["caption"], scheduled_at=when,
                          when_from=got["when_from"] if when else None, accounts=got["accounts"]))
        made += 1
    if made:
        await db.commit()
        logger.info("cm : %s brouillon(s) proposé(s) pour le dossier %s", made, src.id)
    return made
