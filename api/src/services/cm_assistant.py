"""Assistant Chapote CM, mode « mes données » : jeton, accord IA, permissions, alias, outils.

Conception : docs/CM_MCP.md. Règle d'or : l'identité et le périmètre viennent du serveur, jamais
de l'IA. Aucun outil n'accepte d'identifiant d'utilisateur, d'espace ou de compte ; le seul filtre
« compte » est un alias (« Compte TikTok 1 ») résolu ici, dans le périmètre de l'utilisateur.

Ordre des contrôles, à CHAQUE appel d'outil, sans cache :
1. jeton assistant valide (signature, portée, audience, bot, domaine, expiration) -> user_id ;
2. accord IA actif, à la version courante de la politique et du prestataire, et `rev` du jeton ;
3. périmètre cm (cm_access : rôles, groupes) ;
4. permissions du compte, réglées par son possesseur (pas de ligne = rien) ;
5. choix de l'utilisateur (types de données, comptes exclus) et plateformes autorisées.

Jamais lus par les outils : nom, e-mail, téléphone, date de naissance, jetons et identifiants de
plateforme, pseudo, image, commentaires, liens des publications.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.time import utcnow
from src.models.bot import Bot
from src.models.cm import (
    T_AWAITING_ROUTINE,
    T_DISPATCHING,
    T_FAILED,
    T_INBOX,
    T_PUBLISHED,
    T_PUBLISHING,
    T_ROUTINE_CLAIMED,
    T_SCHEDULED,
    CmAccountStat,
    CmGroup,
    CmGroupAccount,
    CmPost,
    CmTarget,
    CmVideo,
)
from src.models.cm_assistant import CmAccountAiPermission, CmAiConsent, CmAiConsentEvent, CmAssistantAudit  # noqa: F401
from src.models.user import User
from src.services import cm_access

TOKEN_SCOPE = "cm_assistant:read"
TOKEN_TTL = timedelta(minutes=5)
TOKEN_ALG = "HS256"
KINDS = ("stats", "planning", "captions")
PLATFORM_LABEL = {"tiktok": "TikTok", "youtube": "YouTube", "instagram": "Instagram"}
PROVIDER_LABEL = {"anthropic": "Anthropic", "openai": "OpenAI", "gemini": "Google (Gemini)"}
PARIS = ZoneInfo("Europe/Paris")
MAX_ITEMS = 10
MAX_RESULT_CHARS = 2000

# Fabrique de sessions DB des outils (remplacée par les tests pour viser la base jetable). Les outils
# n'utilisent JAMAIS la session de la requête appelante (widget) : rien n'est validé à sa place.
SessionFactory = AsyncSessionLocal


class AssistantDenied(Exception):
    """Refus montrable (message FR) + code court pour le journal d'audit."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.message = message
        self.code = code


# --------------------------------------------------------------------------
# Réglages
# --------------------------------------------------------------------------

def enabled() -> bool:
    return bool(settings.CM_MCP_ENABLED and settings.CM_ASSISTANT_TOKEN_KEY and settings.CM_ASSISTANT_BOT_KEY)


def mcp_url() -> str:
    return f"{settings.CM_URL.rstrip('/')}/api/cm/mcp"


def cm_host() -> str:
    from urllib.parse import urlparse
    return urlparse(settings.CM_URL).hostname or ""


def platforms() -> set[str]:
    return {p.strip() for p in (settings.CM_MCP_PLATFORMS or "").split(",") if p.strip() in PLATFORM_LABEL}


def is_assistant_server(bot, server: dict) -> bool:
    """Le serveur MCP configuré sur ce bot est-il le serveur cm « mes données » ? Seulement pour le
    bot assistant ET l'adresse exacte du serveur cm : aucun autre bot ne relaie ces jetons."""
    if not enabled() or getattr(bot, "public_key", None) != settings.CM_ASSISTANT_BOT_KEY:
        return False
    return str(server.get("url") or "").rstrip("/") == mcp_url()


def user_hash(user_id: int) -> str:
    """Empreinte stable de l'utilisateur pour chapote.fr (jamais son id)."""
    key = (settings.CM_ASSISTANT_TOKEN_KEY or "").encode()
    return hmac.new(key, f"cm-user:{user_id}".encode(), hashlib.sha256).hexdigest()[:32]


async def assistant_bot(db: AsyncSession) -> Optional[Bot]:
    if not settings.CM_ASSISTANT_BOT_KEY:
        return None
    return (await db.execute(select(Bot).where(Bot.public_key == settings.CM_ASSISTANT_BOT_KEY))).scalar_one_or_none()


async def provider(db: AsyncSession) -> Optional[str]:
    """Prestataire d'IA réellement configuré sur le bot assistant (chapote.fr), affiché à l'accord."""
    bot = await assistant_bot(db)
    if bot is None:
        return None
    return PROVIDER_LABEL.get(bot.ai_provider, bot.ai_provider)


# --------------------------------------------------------------------------
# Accord IA
# --------------------------------------------------------------------------

def consent_view(c: Optional[CmAiConsent]) -> dict:
    if c is None:
        return {"enabled": False, "stats": True, "planning": True, "captions": False, "excluded_accounts": [],
                "policy_version": None, "provider": None}
    return {"enabled": c.enabled, "stats": c.stats, "planning": c.planning, "captions": c.captions,
            "excluded_accounts": list(c.excluded_accounts or []), "policy_version": c.policy_version,
            "provider": c.provider}


def consent_active(c: Optional[CmAiConsent], current_provider: Optional[str]) -> bool:
    """Actif = activé, à la version courante de la politique IA ET pour le prestataire actuel
    (changer de prestataire sur le bot fait repasser l'accord « à revoir »)."""
    return bool(c and c.enabled and c.policy_version == settings.CM_AI_POLICY_VERSION
                and current_provider and c.provider == current_provider)


async def set_consent(db: AsyncSession, user: User, change: dict, source: str) -> CmAiConsent:
    """Applique un changement d'accord (champs connus seulement), journalise avant / après, et
    augmente `rev` (les jetons déjà émis deviennent invalides). Activer enregistre la version de la
    politique IA et le prestataire affichés, et propose les permissions par défaut sur les comptes
    dont l'utilisateur est le possesseur (s'ils n'en ont pas encore)."""
    c = await db.get(CmAiConsent, user.id)
    before = consent_view(c)
    if c is None:
        c = CmAiConsent(user_id=user.id, enabled=False, rev=0, stats=True, planning=True, captions=False,
                        excluded_accounts=[])
        db.add(c)
    if "enabled" in change:
        c.enabled = bool(change["enabled"])
    for k in KINDS:
        if k in change:
            setattr(c, k, bool(change[k]))
    if "excluded_accounts" in change:
        keys = [str(x) for x in (change["excluded_accounts"] or []) if isinstance(x, str)][:500]
        c.excluded_accounts = sorted(set(keys))
    current = await provider(db)
    if c.enabled:
        c.policy_version = settings.CM_AI_POLICY_VERSION
        c.provider = current
    c.rev = (c.rev or 0) + 1
    db.add(CmAiConsentEvent(user_id=user.id, source=source[:20], policy_version=settings.CM_AI_POLICY_VERSION,
                            provider=current, change={"avant": before, "apres": consent_view(c)}))
    if c.enabled and not before["enabled"]:
        for ref in await account_scope(db, user):
            if ref.owner and ref.perm is None:
                db.add(CmAccountAiPermission(platform=ref.platform, account_id=ref.id, stats=True, planning=True,
                                             captions=False, updated_by=user.id))
    await db.flush()
    return c


# --------------------------------------------------------------------------
# Jeton assistant
# --------------------------------------------------------------------------

def issue_token(user_id: int, rev: int) -> tuple[str, int]:
    now = int(time.time())
    exp = now + int(TOKEN_TTL.total_seconds())
    claims = {"scope": TOKEN_SCOPE, "sub": str(user_id), "aud": mcp_url(), "bot": settings.CM_ASSISTANT_BOT_KEY,
              "origin": cm_host(), "crev": rev, "iat": now, "exp": exp, "jti": uuid.uuid4().hex}
    return jwt.encode(claims, settings.CM_ASSISTANT_TOKEN_KEY, algorithm=TOKEN_ALG), exp


def verify_token(token: str) -> dict:
    """Vérifie signature, portée, audience, bot, domaine et expiration. Lève AssistantDenied."""
    if not enabled() or not token or len(token) > 2000:
        raise AssistantDenied("Jeton assistant absent.", "no_token")
    try:
        claims = jwt.decode(token, settings.CM_ASSISTANT_TOKEN_KEY, algorithms=[TOKEN_ALG], audience=mcp_url())
    except JWTError:
        raise AssistantDenied("Jeton assistant invalide ou expiré.", "bad_token")
    if (claims.get("scope") != TOKEN_SCOPE or claims.get("bot") != settings.CM_ASSISTANT_BOT_KEY
            or claims.get("origin") != cm_host() or not str(claims.get("sub", "")).isdigit()):
        raise AssistantDenied("Jeton assistant invalide.", "bad_token")
    return claims


def jti_hash(claims: dict) -> str:
    return hashlib.sha256(str(claims.get("jti", "")).encode()).hexdigest()[:16]


async def authorize(db: AsyncSession, token: str) -> tuple[User, CmAiConsent, dict]:
    """Jeton + accord, vérifiés à chaque appel. Un accord retiré ou modifié après l'émission du jeton
    (rev différent) le rend inutilisable tout de suite."""
    claims = verify_token(token)
    user = await db.get(User, int(claims["sub"]))
    if user is None or not user.is_active:
        raise AssistantDenied("Compte introuvable.", "no_user")
    c = await db.get(CmAiConsent, user.id)
    if not consent_active(c, await provider(db)):
        raise AssistantDenied("Accord IA absent ou à revoir : activez l'assistant dans Réglages → Assistant IA.",
                              "no_consent")
    if claims.get("crev") != c.rev:
        raise AssistantDenied("Votre accord IA a changé : la page va redemander un jeton.", "stale_token")
    return user, c, claims


# --------------------------------------------------------------------------
# Périmètre : comptes visibles, possesseur, permissions, alias
# --------------------------------------------------------------------------

@dataclass
class AccountRef:
    platform: str
    id: int
    alias: str = ""
    name: Optional[str] = None          # vrai nom : JAMAIS envoyé vers l'IA (seulement à la page cm)
    owner: bool = False                 # possesseur = administrateur de l'espace qui contient le compte
    role: str = "viewer"
    perm: Optional[CmAccountAiPermission] = None
    groups: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.platform}:{self.id}"


async def account_scope(db: AsyncSession, user: User) -> list[AccountRef]:
    """Comptes visibles par l'utilisateur dans cm (mêmes règles que les routes /api/cm), avec rôle,
    possesseur, permissions IA et alias stables (numérotés par réseau, ordre de création)."""
    from src.services.cm_service import account_name
    refs: dict[tuple[str, int], AccountRef] = {}
    tenants = await cm_access._all_tenants(db, user)
    group_rows: list[tuple[CmGroup, Any]] = []
    for t in tenants:
        for p, a in await cm_access._visible(db, t):
            role = cm_access.role_for(t, p, a)
            prev = refs.get((p, a))
            if prev is None or cm_access.LEVEL.get(role, 0) > cm_access.LEVEL.get(prev.role, 0):
                refs[(p, a)] = AccountRef(platform=p, id=a, role=role, owner=role == "admin")
        for g in (await db.execute(select(CmGroup).where(t.where(CmGroup)).order_by(CmGroup.id))).scalars():
            if cm_access.group_allowed(t, g.id):
                group_rows.append((g, t))
    if not refs:
        return []
    # Vrais noms (pour la page cm seulement) et permissions.
    for p, model in cm_access.MODELS.items():
        ids = [a for (pp, a) in refs if pp == p]
        if ids:
            for acc in (await db.execute(select(model).where(model.id.in_(ids)))).scalars():
                refs[(p, acc.id)].name = account_name(p, acc)
    for perm in (await db.execute(select(CmAccountAiPermission).where(
            _cond(CmAccountAiPermission, list(refs.values()))))).scalars():
        ref = refs.get((perm.platform, perm.account_id))
        if ref is not None:
            ref.perm = perm
    # Alias : « Compte TikTok 1 », « Compte YouTube 1 »… dans l'ordre des id (création).
    out = sorted(refs.values(), key=lambda r: (list(PLATFORM_LABEL).index(r.platform), r.id))
    counters: dict[str, int] = {}
    for r in out:
        counters[r.platform] = counters.get(r.platform, 0) + 1
        r.alias = f"Compte {PLATFORM_LABEL[r.platform]} {counters[r.platform]}"
    # Groupes : « Groupe 1 »… (seulement ceux qui contiennent au moins un compte visible).
    gnum = 0
    seen: set[int] = set()
    for g, _t in group_rows:
        if g.id in seen:
            continue
        seen.add(g.id)
        members = (await db.execute(select(CmGroupAccount.platform, CmGroupAccount.account_id)
                                    .where(CmGroupAccount.group_id == g.id))).all()
        inside = [refs[(p, a)] for p, a in members if (p, a) in refs]
        if not inside:
            continue
        gnum += 1
        for r in inside:
            r.groups.append(f"Groupe {gnum}")
    return out


def allowed(ref: AccountRef, consent: CmAiConsent, kind: str) -> bool:
    """Il faut TOUT : plateforme autorisée, permission du compte (possesseur), choix de l'utilisateur."""
    return bool(ref.platform in platforms() and ref.perm is not None and getattr(ref.perm, kind)
                and getattr(consent, kind) and ref.key not in (consent.excluded_accounts or []))


def _pick(refs: list[AccountRef], consent: CmAiConsent, kind: str,
          account: Optional[str], group: Optional[str]) -> list[AccountRef]:
    out = [r for r in refs if allowed(r, consent, kind)]
    if account:
        a = account.strip().lower()
        out = [r for r in out if r.alias.lower() == a]
        if not out:
            raise AssistantDenied("Aucun compte de ce nom dans votre périmètre autorisé. "
                                  "Appelez my_accounts pour connaître les alias.", "unknown_alias")
    if group:
        gname = group.strip().lower()
        out = [r for r in out if gname in (x.lower() for x in r.groups)]
        if not out:
            raise AssistantDenied("Aucun groupe de ce nom dans votre périmètre autorisé. "
                                  "Appelez my_accounts pour connaître les alias.", "unknown_alias")
    return out


def _cond(model, refs: list[AccountRef]):
    from sqlalchemy import and_, false, or_
    by: dict[str, list[int]] = {}
    for r in refs:
        by.setdefault(r.platform, []).append(r.id)
    conds = [and_(model.platform == p, model.account_id.in_(ids)) for p, ids in by.items()]
    return or_(*conds) if conds else false()


# --------------------------------------------------------------------------
# Outils (lecture seule). Retour : dict borné, alias seulement.
# --------------------------------------------------------------------------

PERIODS = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
UPCOMING = (T_SCHEDULED, T_AWAITING_ROUTINE, T_DISPATCHING, T_PUBLISHING, T_ROUTINE_CLAIMED)
STATUS_FR = {T_SCHEDULED: "programmée", T_AWAITING_ROUTINE: "programmée", T_DISPATCHING: "en cours d'envoi",
             T_PUBLISHING: "en cours d'envoi", T_ROUTINE_CLAIMED: "en cours d'envoi", T_PUBLISHED: "publiée",
             T_INBOX: "envoyée en brouillon", T_FAILED: "en échec"}


def _paris(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    from datetime import timezone
    return dt.replace(tzinfo=timezone.utc).astimezone(PARIS)


def _rate(likes, shares, saves, views) -> Optional[float]:
    v = int(views or 0)
    if v <= 0:
        return None
    return round(100 * (int(likes or 0) + int(shares or 0) + int(saves or 0)) / v, 1)


async def _followers(db: AsyncSession, refs: list[AccountRef], since) -> dict:
    out = {}
    for r in refs:
        last = (await db.execute(select(CmAccountStat.followers, CmAccountStat.day)
                                 .where(CmAccountStat.platform == r.platform, CmAccountStat.account_id == r.id,
                                        CmAccountStat.followers.isnot(None))
                                 .order_by(CmAccountStat.day.desc()).limit(1))).first()
        before = (await db.execute(select(CmAccountStat.followers)
                                   .where(CmAccountStat.platform == r.platform, CmAccountStat.account_id == r.id,
                                          CmAccountStat.followers.isnot(None), CmAccountStat.day <= since.date())
                                   .order_by(CmAccountStat.day.desc()).limit(1))).scalar_one_or_none()
        if last is not None:
            out[r.key] = (int(last[0]), (int(last[0]) - int(before)) if before is not None else None)
    return out


async def tool_stats_summary(db, refs, consent, period: str = "7d", account: Optional[str] = None,
                             group: Optional[str] = None) -> dict:
    days = PERIODS.get(period)
    if days is None:
        raise AssistantDenied("Période inconnue : 7d, 30d, 90d ou 365d.", "invalid")
    picked = _pick(refs, consent, "stats", account, group)
    if not picked:
        return {"periode_jours": days, "comptes": [], "note": "Aucun compte avec les statistiques autorisées."}
    since = utcnow() - timedelta(days=days)
    rows = (await db.execute(
        select(CmVideo.platform, CmVideo.account_id, func.count(CmVideo.id), func.sum(CmVideo.views),
               func.sum(CmVideo.likes), func.sum(CmVideo.shares), func.sum(CmVideo.saves))
        .where(_cond(CmVideo, picked), CmVideo.published_at >= since)
        .group_by(CmVideo.platform, CmVideo.account_id))).all()
    agg = {f"{r[0]}:{r[1]}": r[2:] for r in rows}
    fol = await _followers(db, picked, since)
    total = [0, 0, 0, 0, 0]
    comptes = []
    for r in picked[:MAX_ITEMS * 3]:
        n, views, likes, shares, saves = agg.get(r.key, (0, 0, 0, 0, 0))
        vals = [int(n or 0), int(views or 0), int(likes or 0), int(shares or 0), int(saves or 0)]
        total = [a + b for a, b in zip(total, vals)]
        f = fol.get(r.key)
        comptes.append({"compte": r.alias, "reseau": PLATFORM_LABEL[r.platform], "publications": vals[0],
                        "vues": vals[1], "jaime": vals[2], "partages": vals[3], "enregistrements": vals[4],
                        "engagement_pct": _rate(vals[2], vals[3], vals[4], vals[1]),
                        "abonnes": f[0] if f else None, "abonnes_evolution": f[1] if f else None})
    comptes.sort(key=lambda x: x["vues"], reverse=True)
    return {"periode_jours": days, "total": {"publications": total[0], "vues": total[1], "jaime": total[2],
                                             "partages": total[3], "enregistrements": total[4],
                                             "engagement_pct": _rate(total[2], total[3], total[4], total[1])},
            "comptes": comptes[:MAX_ITEMS]}


async def tool_schedule(db, refs, consent, when: str = "upcoming", days: int = 7, account: Optional[str] = None,
                        group: Optional[str] = None) -> dict:
    if when not in ("upcoming", "published", "failed"):
        raise AssistantDenied("`when` : upcoming, published ou failed.", "invalid")
    days = max(1, min(31, int(days or 7)))
    picked = _pick(refs, consent, "planning", account, group)
    if not picked:
        return {"quand": when, "jours": days, "nombre": 0, "publications": [],
                "note": "Aucun compte avec le planning autorisé."}
    by_key = {r.key: r for r in picked}
    now = utcnow()
    q = select(CmTarget.platform, CmTarget.account_id, CmTarget.scheduled_at, CmTarget.published_at,
               CmTarget.status, CmTarget.fail_reason, CmPost.title).join(CmPost, CmPost.id == CmTarget.post_id) \
        .where(_cond(CmTarget, picked))
    if when == "upcoming":
        q = q.where(CmTarget.status.in_(UPCOMING), CmTarget.scheduled_at >= now,
                    CmTarget.scheduled_at <= now + timedelta(days=days)).order_by(CmTarget.scheduled_at)
    elif when == "published":
        q = q.where(CmTarget.status.in_((T_PUBLISHED, T_INBOX)),
                    func.coalesce(CmTarget.published_at, CmTarget.scheduled_at) >= now - timedelta(days=days)) \
            .order_by(func.coalesce(CmTarget.published_at, CmTarget.scheduled_at).desc())
    else:
        q = q.where(CmTarget.status == T_FAILED, CmTarget.scheduled_at >= now - timedelta(days=days)) \
            .order_by(CmTarget.scheduled_at.desc())
    rows = (await db.execute(q.limit(500))).all()
    per_day: dict[str, int] = {}
    items = []
    for p, a, sched, pub, st, reason, title in rows:
        ref = by_key.get(f"{p}:{a}")
        if ref is None:
            continue
        dt = _paris(pub if when == "published" and pub else sched)
        day = dt.strftime("%Y-%m-%d")
        per_day[day] = per_day.get(day, 0) + 1
        if len(items) < MAX_ITEMS:
            item = {"jour": day, "heure": dt.strftime("%H:%M"), "reseau": PLATFORM_LABEL[p], "compte": ref.alias,
                    "statut": STATUS_FR.get(st, "autre")}
            if st == T_FAILED:
                item["motif"] = _fail_label(reason)
            if allowed(ref, consent, "captions") and title:
                item["titre"] = str(title)[:80]
            items.append(item)
    return {"quand": when, "jours": days, "nombre": sum(per_day.values()), "par_jour": per_day,
            "publications": items}


FAIL_FR = {"auth": "connexion au réseau à refaire", "quota": "limite d'envoi du réseau atteinte",
           "media": "vidéo refusée par le réseau", "timeout": "réseau trop lent", "internal_error": "erreur interne"}


def _fail_label(reason: Optional[str]) -> str:
    r = (reason or "").lower()
    for k, label in FAIL_FR.items():
        if k in r:
            return label
    return "échec de l'envoi (détail dans l'app)"


async def tool_top_videos(db, refs, consent, period: str = "30d", metric: str = "views", limit: int = 5,
                          account: Optional[str] = None) -> dict:
    days = PERIODS.get(period)
    if days is None:
        raise AssistantDenied("Période inconnue : 7d, 30d, 90d ou 365d.", "invalid")
    if metric not in ("views", "engagement", "shares"):
        raise AssistantDenied("`metric` : views, engagement ou shares.", "invalid")
    limit = max(1, min(MAX_ITEMS, int(limit or 5)))
    picked = _pick(refs, consent, "stats", account, None)
    if not picked:
        return {"periode_jours": days, "videos": [], "note": "Aucun compte avec les statistiques autorisées."}
    by_key = {r.key: r for r in picked}
    since = utcnow() - timedelta(days=days)
    order = {"views": func.coalesce(CmVideo.views, 0).desc(), "shares": func.coalesce(CmVideo.shares, 0).desc(),
             "engagement": ((func.coalesce(CmVideo.likes, 0) + func.coalesce(CmVideo.shares, 0)
                             + func.coalesce(CmVideo.saves, 0)) * 1.0 / func.greatest(func.coalesce(CmVideo.views, 0), 1)).desc()}[metric]
    rows = (await db.execute(
        select(CmVideo.platform, CmVideo.account_id, CmVideo.published_at, CmVideo.views, CmVideo.likes,
               CmVideo.shares, CmVideo.saves, CmVideo.title)
        .where(_cond(CmVideo, picked), CmVideo.published_at >= since).order_by(order).limit(limit))).all()
    videos = []
    for p, a, pub, views, likes, shares, saves, title in rows:
        ref = by_key[f"{p}:{a}"]
        v = {"date": _paris(pub).strftime("%Y-%m-%d") if pub else None, "reseau": PLATFORM_LABEL[p],
             "compte": ref.alias, "vues": int(views or 0), "jaime": int(likes or 0), "partages": int(shares or 0),
             "enregistrements": int(saves or 0), "engagement_pct": _rate(likes, shares, saves, views)}
        if allowed(ref, consent, "captions") and title:
            v["titre"] = str(title)[:80]
        videos.append(v)
    return {"periode_jours": days, "classement": metric, "videos": videos}


async def tool_my_accounts(db, refs, consent) -> dict:
    out = []
    for r in refs:
        kinds = [k for k in KINDS if allowed(r, consent, k)]
        if not kinds:
            continue
        n = (await db.execute(select(func.count(CmVideo.id)).where(CmVideo.platform == r.platform,
                                                                   CmVideo.account_id == r.id))).scalar() or 0
        last = (await db.execute(select(func.max(CmAccountStat.day)).where(
            CmAccountStat.platform == r.platform, CmAccountStat.account_id == r.id))).scalar()
        out.append({"compte": r.alias, "reseau": PLATFORM_LABEL[r.platform], "groupes": r.groups[:5],
                    "donnees_autorisees": kinds, "videos_suivies": int(n),
                    "dernier_releve": last.isoformat() if last else None})
    return {"comptes": out[:30]}


TOOLS: dict[str, dict] = {
    "stats_summary": {
        "fn": tool_stats_summary, "kind": "stats",
        "description": ("Bilan des statistiques de MES comptes sur une période (vues, j'aime, partages, "
                        "enregistrements, engagement, abonnés). Comptes désignés par leur alias."),
        "schema": {"type": "object", "properties": {
            "period": {"type": "string", "enum": list(PERIODS), "description": "7d, 30d, 90d ou 365d."},
            "account": {"type": "string", "description": "Alias d'un compte (ex. « Compte YouTube 1 »), facultatif."},
            "group": {"type": "string", "description": "Alias d'un groupe (ex. « Groupe 1 »), facultatif."}},
            "additionalProperties": False},
    },
    "schedule": {
        "fn": tool_schedule, "kind": "planning",
        "description": "Planning de MES publications : à venir, publiées ou en échec, par jour.",
        "schema": {"type": "object", "properties": {
            "when": {"type": "string", "enum": ["upcoming", "published", "failed"]},
            "days": {"type": "integer", "minimum": 1, "maximum": 31},
            "account": {"type": "string"}, "group": {"type": "string"}}, "additionalProperties": False},
    },
    "top_videos": {
        "fn": tool_top_videos, "kind": "stats",
        "description": "Meilleures vidéos de MES comptes sur une période (vues, engagement ou partages).",
        "schema": {"type": "object", "properties": {
            "period": {"type": "string", "enum": list(PERIODS)},
            "metric": {"type": "string", "enum": ["views", "engagement", "shares"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_ITEMS},
            "account": {"type": "string"}}, "additionalProperties": False},
    },
    "my_accounts": {
        "fn": tool_my_accounts, "kind": "accounts",
        "description": "MES comptes et groupes autorisés pour l'assistant, sous leurs alias.",
        "schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}


def _categories(name: str, result: dict) -> list[str]:
    cats = {"stats_summary": ["stats", "accounts"], "schedule": ["planning", "accounts"],
            "top_videos": ["stats", "accounts"], "my_accounts": ["accounts"]}[name]
    text = json.dumps(result, ensure_ascii=False)
    if '"titre"' in text:
        cats = cats + ["captions"]
    return cats


def _count(result: dict) -> int:
    for k in ("comptes", "publications", "videos"):
        if isinstance(result.get(k), list):
            return len(result[k])
    return 1


async def run_tool(token: str, name: str, args: Optional[dict]) -> tuple[str, bool]:
    """Point d'entrée unique des outils (serveur MCP HTTP et appel interne depuis chapote.fr).
    Retour (texte JSON borné, is_error). Journalise chaque appel, sans contenu."""
    async with SessionFactory() as db:
        return await _run_tool(db, token, name, args)


async def _run_tool(db: AsyncSession, token: str, name: str, args: Optional[dict]) -> tuple[str, bool]:
    started = time.monotonic()
    user_id, claims, status, code, items, cats = None, {}, "ok", None, None, None
    try:
        spec = TOOLS.get(name)
        if spec is None:
            raise AssistantDenied("Outil inconnu.", "unknown_tool")
        user, consent, claims = await authorize(db, token)
        user_id = user.id
        from src.services.rate_limit import cm_assistant_day_limiter, cm_assistant_limiter
        if not (await cm_assistant_limiter.check(str(user.id)) and await cm_assistant_day_limiter.check(str(user.id))):
            raise AssistantDenied("Trop de questions sur vos données pour le moment. Réessayez un peu plus tard.",
                                  "rate_limited")
        args = args if isinstance(args, dict) else {}
        props = spec["schema"]["properties"]
        clean = {k: v for k, v in args.items() if k in props and isinstance(v, (str, int)) and not isinstance(v, bool)}
        refs = await account_scope(db, user)
        result = await spec["fn"](db, refs, consent, **clean)
        items, cats = _count(result), _categories(name, result)
        text = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS - 20] + "…(tronqué)"
        return text, False
    except AssistantDenied as e:
        status, code = ("denied" if e.code in ("no_token", "bad_token", "no_user", "no_consent", "stale_token")
                        else "error"), e.code
        return e.message, True
    except Exception as e:  # jamais de trace ni de donnée vers l'IA
        status, code = "error", "internal"
        import logging
        logging.getLogger(__name__).error("cm assistant : erreur dans %s (%s)", name, type(e).__name__)
        return "Erreur interne de l'assistant. Réessayez plus tard.", True
    finally:
        try:
            db.add(CmAssistantAudit(user_id=user_id, tool=(name or "?")[:40], status=status, error_code=code,
                                    duration_ms=int((time.monotonic() - started) * 1000), items=items,
                                    categories=cats, jti_hash=jti_hash(claims) if claims else None))
            await db.commit()
        except Exception:
            await db.rollback()
            import logging
            logging.getLogger(__name__).error("cm assistant : journal d'audit indisponible")


# --------------------------------------------------------------------------
# Conservation des conversations « mes données » (chapote.fr)
# --------------------------------------------------------------------------

async def erase_for_account(db: AsyncSession, acc) -> int:
    """Compte déconnecté (YouTube : suppression sous 7 jours exigée par Google ; idem Meta, TikTok) :
    supprime TOUT DE SUITE les conversations « mes données » des personnes de l'espace du compte
    (possesseur de l'espace perso, ou membres de l'équipe). Ne valide pas : l'appelant commit."""
    from sqlalchemy import delete as sa_delete
    from src.models.conversation import Conversation
    from src.models.user import Membership
    if not settings.CM_ASSISTANT_TOKEN_KEY:
        return 0
    if getattr(acc, "organization_id", None):
        ids = list((await db.execute(select(Membership.user_id)
                                     .where(Membership.organization_id == acc.organization_id))).scalars())
    else:
        ids = [acc.owner_user_id] if getattr(acc, "owner_user_id", None) else []
    hashes = [user_hash(i) for i in ids if i]
    if not hashes:
        return 0
    res = await db.execute(sa_delete(Conversation).where(Conversation.data_mode.is_(True),
                                                         Conversation.user_hash.in_(hashes)))
    return res.rowcount or 0


async def purge_expired(db: AsyncSession) -> int:
    """Conversations « mes données » inactives depuis CM_ASSISTANT_RETENTION_DAYS : supprimées."""
    from sqlalchemy import delete as sa_delete
    from src.models.conversation import Conversation
    limit = utcnow() - timedelta(days=settings.CM_ASSISTANT_RETENTION_DAYS)
    res = await db.execute(sa_delete(Conversation).where(Conversation.data_mode.is_(True),
                                                         Conversation.last_activity_at < limit))
    return res.rowcount or 0
