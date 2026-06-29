"""Intelligence de l'onboarding guidé du plugin WordPress (couche service).

Tout est DÉTERMINISTE et sans état (aucune persistance, aucune migration) :

1. `rank_wp_urls`     : classe des URLs de pages WP (liste fournie par le plugin)
                        par pertinence pour la génération d'arbre — réutilise les
                        indices de pages clés de prospecting_service.
2. `sitemap_fallback` : repli quand le plugin n'a pas pu lister les pages —
                        réutilise le résolveur de sitemap de kb_service
                        (wp-sitemap.xml / sitemap_index.xml / sitemap.xml).
3. `recommend`        : recommandation de palier IA + modules, PILOTÉE par le
                        catalogue (jamais de prix/seuil codé en dur) et par les
                        modules dérivés de l'arbre (tree_engine).
4. `run_bot_generation` : variante mince de tree_jobs.run_generation — collecte
                        le texte des URLs + génère l'arbre, publie la progression,
                        NE sauve PAS sur le bot (le résultat est lu via
                        generate-status). Élague selon `exclude_modules`.

Aucun appel à prospecting_service.score_prospect (IA non déterministe) : la
recommandation est une fonction pure du catalogue + de l'arbre.
"""
import logging
from typing import Optional
from urllib.parse import urlparse

from src.core.constants import MODULE_AI, MODULE_KEYS
from src.services.prospecting_service import _KEY_PAGE_HINTS
from src.services.tree_engine import prune_tree_for_modules, required_modules_for_tree

logger = logging.getLogger(__name__)

# Nombre d'URLs pré-cochées (`selected`) et plafond de suggestions renvoyées.
_SELECT_TOP = 8
_MAX_SUGGESTED = 15


# --------------------------------------------------------------------------
# 1. Classement des URLs WP
# --------------------------------------------------------------------------

def _origin(url: str) -> tuple[Optional[str], Optional[str]]:
    """(scheme, host) minuscule d'une URL, ou (None, None) si non http(s)."""
    p = urlparse((url or "").strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        return None, None
    return p.scheme, p.hostname.lower()


def _label_from_path(path: str) -> str:
    """Libellé lisible dérivé du dernier segment de chemin ('/nous-contacter/'
    -> 'Nous contacter'). Repli 'Page'."""
    seg = [s for s in (path or "").split("/") if s]
    if not seg:
        return "Accueil"
    raw = seg[-1].replace("-", " ").replace("_", " ").strip()
    return (raw[:80].capitalize() or "Page")


def _score_url(site_host: Optional[str], url: str) -> Optional[tuple[int, str]]:
    """(score, label) d'une URL, ou None si non http(s) (ou hors site quand
    site_host est connu). Heuristique déterministe : bonus home, bonus pages clés
    (contact/mentions/à-propos/équipe…), malus de profondeur."""
    _scheme, host = _origin(url)
    if host is None:
        return None
    if site_host and host != site_host and host.removeprefix("www.") != site_host.removeprefix("www."):
        return None
    path = urlparse(url).path or "/"
    norm = path.rstrip("/") or "/"
    low = url.lower()

    score = 10
    if norm == "/":
        score += 50
        label = "Accueil"
    else:
        label = _label_from_path(norm)
    if any(h in low for h in _KEY_PAGE_HINTS):
        score += 30
    # Pages peu profondes (proches de la racine) d'abord.
    depth = norm.strip("/").count("/")
    score += max(0, 12 - depth * 4)
    return score, label


def rank_wp_urls(site_url: str, urls: list[str]) -> list[dict]:
    """Classe les URLs (dédupliquées, http(s), même hôte que site_url si connu)
    par pertinence décroissante. Renvoie au plus _MAX_SUGGESTED entrées
    {url, label, score, selected} ; les _SELECT_TOP premières sont pré-cochées.

    Tri STABLE et déterministe : (score desc, url asc)."""
    _scheme, site_host = _origin(site_url)
    scored: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for u in urls or []:
        u = (u or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        res = _score_url(site_host, u)
        if res is None:
            continue
        score, label = res
        scored.append((score, u, label))
    scored.sort(key=lambda t: (-t[0], t[1]))
    out: list[dict] = []
    for i, (score, u, label) in enumerate(scored[:_MAX_SUGGESTED]):
        out.append({"url": u, "label": label, "score": score, "selected": i < _SELECT_TOP})
    return out


# --------------------------------------------------------------------------
# 2. Repli sitemap (réutilise kb_service)
# --------------------------------------------------------------------------

class _SitemapRef:
    """Stand-in minimal de KbSource pour _resolve_sitemap_page_urls (n'accède
    qu'à `.ref` et `.id`). Évite de fabriquer une ligne ORM hors session."""

    def __init__(self, ref: str):
        self.ref = ref
        self.id = 0


async def sitemap_fallback(site_url: str) -> list[str]:
    """URLs de pages HTML découvertes via le sitemap du site (best-effort) :
    teste /wp-sitemap.xml (WordPress), /sitemap_index.xml puis /sitemap.xml, et
    renvoie la première liste non vide (cap MAX_SITEMAP_PAGES côté kb_service).
    Jamais d'exception : un sitemap inaccessible -> [] (l'appelant retombe sur
    `source='none'`)."""
    _scheme, host = _origin(site_url)
    if host is None:
        return []
    # _origin renvoie le hostname sans port ; on repart de l'URL d'origine pour
    # préserver un éventuel port non standard.
    parsed = urlparse(site_url.strip())
    origin = f"{parsed.scheme}://{parsed.netloc}"
    # Import paresseux : kb_service charge embeddings au chargement de module.
    from src.services.kb_service import _resolve_sitemap_page_urls
    from src.services.safe_fetch import FetchError

    for candidate in ("/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml"):
        try:
            urls = await _resolve_sitemap_page_urls(_SitemapRef(origin + candidate))
        except FetchError:
            continue
        except Exception as exc:  # robustesse : un sitemap exotique ne casse rien
            logger.warning("onboarding sitemap %s : erreur inattendue %r", candidate, exc)
            continue
        if urls:
            return urls
    return []


# --------------------------------------------------------------------------
# 3. Recommandation (déterministe, pilotée catalogue)
# --------------------------------------------------------------------------

def _pick_tier(catalog: dict, visitors: Optional[int]) -> tuple[str, int]:
    """(id du palier IA recommandé, réponses incluses), PILOTÉ par les
    `included_replies` réels du catalogue. Plus petit palier dont le quota couvre
    `visitors` ; le plus grand si aucun ne suffit ; le plus petit si visitors est
    None. Repli 'ai_starter'/0 si le catalogue n'expose aucun palier."""
    tiers = sorted(
        [t for t in (catalog.get("ai_tiers") or []) if t.get("id")],
        key=lambda t: (t.get("included_replies") or 0),
    )
    if not tiers:
        return "ai_starter", 0
    if visitors is None:
        first = tiers[0]
        return first["id"], int(first.get("included_replies") or 0)
    for t in tiers:
        if int(t.get("included_replies") or 0) >= visitors:
            return t["id"], int(t.get("included_replies") or 0)
    last = tiers[-1]
    return last["id"], int(last.get("included_replies") or 0)


def recommend(catalog: dict, tree: Optional[dict], description: Optional[str],
              visitors: Optional[int], mode: Optional[str]) -> dict:
    """Recommandation DÉTERMINISTE de formule pour un bot.

    - required_modules : modules IMPOSÉS par l'arbre (handoff->inbox, __ai__->ai).
    - recommended_ai_tier : palier piloté par les `included_replies` du catalogue
      et le trafic estimé (`visitors`).
    - recommended_modules : required ∪ {ai} (l'IA est toujours recommandée — le
      socle arbre seul reste possible mais l'IA est la valeur du produit).
    - recommended_byok : False (le managé est le défaut ; le BYOK est un opt-in
      avancé, jamais recommandé automatiquement).
    - expected_replies : réponses incluses du palier recommandé.
    - reason : phrase lisible (FR)."""
    required = required_modules_for_tree(tree or {})
    tier_id, included = _pick_tier(catalog, visitors)
    recommended_modules = sorted(required | {MODULE_AI})

    bits = []
    if visitors:
        bits.append(f"Pour environ {visitors} visiteurs/mois")
    else:
        bits.append("Pour démarrer")
    bits.append(f"le palier IA « {tier_id} » ({included} réponses incluses/mois) est conseillé")
    if "inbox" in required:
        bits.append("avec la mise en relation conseiller (module Inbox détecté dans l'arbre)")
    reason = ", ".join(bits) + "."

    return {
        "required_modules": sorted(required),
        "recommended_ai_tier": tier_id,
        "recommended_modules": recommended_modules,
        "recommended_byok": False,
        "expected_replies": included,
        "reason": reason,
    }


# --------------------------------------------------------------------------
# 4. Génération d'arbre liée à un bot (job éphémère, sans sauvegarde)
# --------------------------------------------------------------------------

def _infer_type(url: str) -> str:
    """Type de source pour build_source_text (en-têtes de section). contact ->
    'contact', FAQ -> 'qr', aide/support -> 'aide', home -> 'site', sinon 'autre'."""
    low = (url or "").lower()
    path = (urlparse(url).path or "/").rstrip("/") or "/"
    if any(h in low for h in ("contact", "mentions", "nous-contacter", "nous_contacter")):
        return "contact"
    if "faq" in low or "question" in low:
        return "qr"
    if any(h in low for h in ("aide", "help", "support", "assistance")):
        return "aide"
    if path == "/":
        return "site"
    return "autre"


async def run_bot_generation(job_id: str, urls: list[str], context: Optional[str],
                             exclude_modules: Optional[list[str]] = None) -> None:
    """Tâche de fond de l'onboarding : collecte le texte des URLs (build_source_text)
    -> génère l'arbre (generate_tree) -> élague selon `exclude_modules` -> publie le
    résultat dans le job (lu par generate-status). NE sauve PAS sur le bot.

    Variante mince de tree_jobs.run_generation (pas de PDF) ; même bande de
    progression et même contrat d'erreur (TreeGenerationError -> message FR ;
    inattendu -> message générique)."""
    from src.services import tree_jobs
    from src.services.tree_generator import TreeGenerationError, generate_tree

    async def progress(stage: str, pct: int) -> None:
        await tree_jobs._update(job_id, stage=stage, pct=pct)

    parsed = [{"url": (u or "").strip(), "type": _infer_type(u)} for u in (urls or []) if (u or "").strip()]
    try:
        combined = await tree_jobs.build_source_text(parsed, [], context, on_progress=progress)
        await tree_jobs._update(job_id, stage="Construction de l'arbre par l'IA…", pct=78)
        tree = await generate_tree(combined)
        # Élagage par modules exclus (ex. parcours « sans IA ») : generate_tree
        # ajoute quasi toujours une option vers __ai__ -> on la retire ici si l'IA
        # est exclue, en rebranchant proprement (prune_tree_for_modules).
        excluded = set(exclude_modules or [])
        if excluded:
            kept = set(MODULE_KEYS) - excluded
            tree = prune_tree_for_modules(tree, kept)
        await tree_jobs._update(job_id, status="done", stage="Terminé", pct=100, tree_json=tree)
    except TreeGenerationError as exc:
        await tree_jobs._update(job_id, status="error", error=str(exc))
    except Exception:
        logger.exception("onboarding: échec inattendu du job %s", job_id)
        await tree_jobs._update(job_id, status="error", error="La génération a échoué, réessayez.")
