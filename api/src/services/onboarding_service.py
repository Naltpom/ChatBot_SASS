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
from typing import Callable, Optional
from urllib.parse import urlparse

from src.core.constants import MODULE_AI, MODULE_KEYS, MODULE_RAG
from src.services.prospecting_service import _KEY_PAGE_HINTS
from src.services.tree_engine import prune_tree_for_modules, required_modules_for_tree

logger = logging.getLogger(__name__)

# Nombre d'URLs pré-cochées (`selected`) et plafond de suggestions renvoyées.
_SELECT_TOP = 8
_MAX_SUGGESTED = 15


# --------------------------------------------------------------------------
# 1. Classement des URLs WP
# --------------------------------------------------------------------------

def _origin(url: str) -> Optional[str]:
    """host minuscule d'une URL http(s), ou None si non http(s)."""
    p = urlparse((url or "").strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        return None
    return p.hostname.lower()


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
    host = _origin(url)
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
    site_host = _origin(site_url)
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
    host = _origin(site_url)
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
              visitors: Optional[int], mode: Optional[str],
              has_kb: bool = False) -> dict:
    """Recommandation DÉTERMINISTE de formule pour un bot.

    - required_modules : modules IMPOSÉS par l'arbre (handoff->inbox, lead->actions,
      __ai__->ai ; appointment = socle, aucun module).
    - recommended_ai_tier : palier piloté par les `included_replies` du catalogue
      et le trafic estimé (`visitors`).
    - recommended_modules : required ∪ {ai} (+ {rag} si le bot a une base de
      connaissances `has_kb` — sinon la base ingérée à l'onboarding ne serait pas
      exploitée, le RAG étant gaté au runtime par le module). L'IA est toujours
      recommandée (la valeur du produit).
    - recommended_byok : False (le managé est le défaut ; le BYOK est un opt-in
      avancé, jamais recommandé automatiquement).
    - expected_replies : réponses incluses du palier recommandé.
    - reason : phrase lisible (FR)."""
    required = required_modules_for_tree(tree or {})
    tier_id, included = _pick_tier(catalog, visitors)
    recommended = set(required) | {MODULE_AI}
    if has_kb:
        recommended.add(MODULE_RAG)  # base de connaissances présente -> RAG pour l'exploiter
    recommended_modules = sorted(recommended)

    bits = []
    if visitors:
        bits.append(f"Pour environ {visitors} visiteurs/mois")
    else:
        bits.append("Pour démarrer")
    bits.append(f"le palier IA « {tier_id} » ({included} réponses incluses/mois) est conseillé")
    if "inbox" in required:
        bits.append("avec la mise en relation conseiller (module Inbox détecté dans l'arbre)")
    if has_kb:
        bits.append("et le module RAG pour répondre depuis le contenu de votre site")
    reason = ", ".join(bits) + "."

    # Explications PÉDAGOGIQUES par module (affichées au-dessus du configurateur) :
    # chaque « why » est rattaché à CE bot (arbre / site) pour que l'utilisateur
    # comprenne à quoi sert ce qu'il paie. L'ordre suit l'importance produit.
    explanations = [{
        "module": MODULE_AI,
        "title": "Assistant IA",
        "why": "Répond tout seul aux questions ouvertes que votre arbre ne couvre pas "
               "(l'option « Autre question ») — c'est le cœur de l'assistant.",
    }]
    if "inbox" in required:
        explanations.append({
            "module": "inbox", "title": "Mise en relation conseiller",
            "why": "Votre arbre propose de parler à un conseiller : ce module permet à "
                   "un humain de reprendre la conversation en direct quand l'IA ne suffit pas.",
        })
    if "actions" in required:
        explanations.append({
            "module": "actions", "title": "Capture de contacts",
            "why": "Votre arbre contient un formulaire de contact : ce module l'active et "
                   "enregistre les coordonnées (leads) que laissent vos visiteurs.",
        })
    if has_kb:
        explanations.append({
            "module": "rag", "title": "Base de connaissances",
            "why": "Les pages de votre site ont été analysées : l'IA puise ses réponses dans "
                   "VOTRE contenu (tarifs, horaires, services…) au lieu de répondre au hasard.",
        })

    return {
        "required_modules": sorted(required),
        "recommended_ai_tier": tier_id,
        "recommended_modules": recommended_modules,
        "recommended_byok": False,
        "expected_replies": included,
        "reason": reason,
        "explanations": explanations,
    }


_MODULE_PITCH_LABELS = {
    "ai": "l'IA (réponses automatiques aux questions ouvertes)",
    "inbox": "la mise en relation avec un conseiller humain en direct",
    "actions": "la capture de contacts / leads",
    "rag": "la base de connaissances (réponses tirées du contenu du site)",
    "mcp": "les intégrations avancées (MCP)",
    "ab": "l'A/B testing des messages",
    "white_label": "la marque blanche (sans mention Chapote)",
}


async def generate_plan_pitch(bot_name: Optional[str], description: Optional[str],
                              recommended_modules: list[str], visitors: Optional[int],
                              expected_replies: int) -> Optional[str]:
    """Paragraphe PERSONNALISÉ (généré par l'IA) expliquant pourquoi la formule
    recommandée convient à CE commerce — à afficher au-dessus du configurateur.
    Best-effort : renvoie None sur toute erreur / MOCK_AI / clé absente (l'offre
    retombe alors sur les explications statiques de `recommend`)."""
    from src.services.tree_generator import generate_text_gemini
    mods = ", ".join(_MODULE_PITCH_LABELS.get(m, m) for m in recommended_modules)
    system = (
        "Tu es un conseiller de Chapote (assistants conversationnels pour sites web). "
        "En 2 ou 3 phrases chaleureuses, concrètes et VOUVOYÉES (texte brut : pas de "
        "markdown, pas d'emoji, pas de liste, pas de prix), tu expliques au commerçant "
        "pourquoi la formule recommandée pour SON assistant lui convient et à quoi elle "
        "sert pour SON activité. Reste factuel, sans superlatifs creux."
    )
    bits = [f"Commerce : {bot_name or 'ce site'}."]
    if description:
        bits.append(f"Ce que le propriétaire veut de l'assistant : {description[:600]}.")
    bits.append(f"Trafic estimé : {visitors} visiteurs/mois." if visitors else "Trafic non précisé.")
    bits.append(f"Formule recommandée : {mods}. Palier IA : {expected_replies} réponses incluses/mois.")
    user = " ".join(bits) + " Explique pourquoi cette formule est adaptée à cette activité."
    return await generate_text_gemini(system, user)


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


async def _persist_generated_tree(job_id: str) -> None:
    """Sauve l'arbre généré (publié dans le job) SUR LE BOT lié, pour que la vue
    d'arbre du wizard, l'aperçu et la recommandation reflètent le contenu RÉEL
    (sinon le bot garde l'arbre PAR DÉFAUT tant que l'éditeur n'a pas sauvé ->
    incohérence vue ≠ éditeur). Best-effort : un échec n'invalide pas la génération
    (le job reste la source de seed pour l'éditeur). Imports paresseux."""
    from src.core.database import AsyncSessionLocal
    from src.models.bot import Bot
    from src.services import tree_jobs
    from src.services.bot_service import apply_tree_update

    job = await tree_jobs.get(job_id)
    if not job or job.get("status") != "done":
        return
    tree = job.get("tree_json")
    bot_id = job.get("bot_id")
    if not isinstance(tree, dict) or not bot_id:
        return
    try:
        async with AsyncSessionLocal() as db:
            bot = await db.get(Bot, bot_id)
            if bot is not None:
                await apply_tree_update(bot, tree, db)  # valide + persiste + updated_at
    except Exception:
        # Échec OBSERVABLE (logger.error + trace) : si la persistance échoue, le bot
        # reste sur l'arbre PAR DÉFAUT et la recommandation d'offre serait alors
        # calculée dessus (le front n'envoie plus tree_json) -> offre potentiellement
        # fausse. On veut donc le détail complet dans les logs, pas un warning discret.
        logger.error("onboarding: persistance de l'arbre généré échouée (bot %s)", bot_id, exc_info=True)


def _system_prompt_from_brief(brief: str) -> str:
    """Construit le `system_prompt` d'un bot à partir du brief libre du propriétaire
    (la description « rôle » saisie dans l'onboarding) : situe l'assistant
    (« assistant de ce site »), intègre le ton/persona/rôle demandé, reste concis.

    ⚠ NE duplique PAS le garde-fou de PÉRIMÈTRE serveur : `ai_service.
    build_system_prompt` ajoute déjà un PÉRIMÈTRE STRICT prioritaire au runtime —
    ce prompt n'est que la couche TON/RÔLE, qui coexiste avec lui."""
    brief = " ".join((brief or "").split())[:600]
    return (
        "Tu es l'assistant conversationnel de ce site web. Le propriétaire décrit "
        f"l'assistant souhaité ainsi : « {brief} ». Adopte fidèlement le ton, la "
        "personnalité et le rôle qui en découlent dans toutes tes réponses, tout en "
        "restant utile et concis."
    )


async def _persist_system_prompt_from_brief(bot_id: int, brief: Optional[str]) -> None:
    """Dérive et persiste le `system_prompt` du bot depuis le brief libre du
    propriétaire (ton/persona voulu), pour que le mode IA réponde DANS ce ton (le
    défaut du modèle Bot — « assistant utile et concis » — ignore le brief).

    Opt-in & best-effort : un brief vide laisse le défaut INTACT (pas de
    régression) et un échec n'invalide pas la génération déjà publiée (à côté de
    `_persist_generated_tree`, jamais à sa place). Imports paresseux + session
    dédiée (cf. `_persist_generated_tree`)."""
    cleaned = " ".join((brief or "").split())
    if not cleaned or not bot_id:
        return
    from src.core.database import AsyncSessionLocal
    from src.core.time import utcnow
    from src.models.bot import Bot

    try:
        async with AsyncSessionLocal() as db:
            bot = await db.get(Bot, bot_id)
            if bot is None:
                return
            # Garde-fou anti-écrasement : on ne pose le prompt dérivé du brief que
            # si l'utilisateur n'a PAS déjà personnalisé le sien — c.-à-d. s'il est
            # vide/None OU encore égal au défaut du modèle Bot (« assistant utile et
            # concis »). Un prompt saisi via le dashboard/l'éditeur est préservé.
            default_prompt = str(getattr(Bot.__table__.c.system_prompt.default, "arg", "") or "").strip()
            current = (bot.system_prompt or "").strip()
            if current and current != default_prompt:
                return
            bot.system_prompt = _system_prompt_from_brief(cleaned)
            bot.updated_at = utcnow()
            await db.commit()
    except Exception as exc:
        logger.warning("onboarding: persistance du system_prompt échouée (bot %s): %s", bot_id, exc)


async def run_bot_generation(job_id: str, urls: list[str], context: Optional[str],
                             exclude_modules: Optional[list[str]] = None) -> None:
    """Tâche de fond de l'onboarding : collecte le texte des URLs (build_source_text)
    -> génère l'arbre (generate_tree) -> élague selon `exclude_modules` -> publie le
    résultat dans le job (lu par generate-status) PUIS persiste l'arbre sur le bot.

    Wrapper mince de tree_jobs.run_generation (pas de PDF) : même bande de
    progression et même contrat d'erreur. Seule l'intelligence propre à
    l'onboarding reste ici — typage des sources (_infer_type) + élagage par
    modules exclus (post_process)."""
    from src.services import tree_jobs

    parsed = [{"url": (u or "").strip(), "type": _infer_type(u)} for u in (urls or []) if (u or "").strip()]
    # Élagage par modules exclus (ex. parcours « sans IA ») : generate_tree ajoute
    # quasi toujours une option vers __ai__ -> on la retire si l'IA est exclue, en
    # rebranchant proprement (prune_tree_for_modules), via le post_process du job.
    post_process: Optional[Callable[[dict], dict]] = None
    excluded = set(exclude_modules or [])
    if excluded:
        kept = set(MODULE_KEYS) - excluded
        post_process = lambda t: prune_tree_for_modules(t, kept)
    await tree_jobs.run_generation(job_id, parsed, context, [], post_process=post_process)
    # Persiste l'arbre généré sur le bot : aligne vue d'arbre / aperçu / reco sur
    # le contenu réel (sinon le bot reste sur l'arbre par défaut jusqu'à un save
    # éditeur). Best-effort -> n'invalide jamais la génération déjà publiée.
    await _persist_generated_tree(job_id)
    # Dérive AUSSI le system_prompt du bot depuis le brief libre (ton/persona),
    # pour que le mode IA réponde dans le ton demandé. On NE le dérive QUE si le
    # job a RÉUSSI (status 'done'), comme _persist_generated_tree — sinon un échec
    # de génération écraserait quand même le prompt. bot_id lu sur le job déjà relu
    # (pas de 2e lecture). Opt-in (brief vide -> défaut conservé) & best-effort.
    job = await tree_jobs.get(job_id)
    if job and job.get("status") == "done":
        bot_id = job.get("bot_id")
        if bot_id:
            await _persist_system_prompt_from_brief(bot_id, context)


# --------------------------------------------------------------------------
# 5. Ingestion RAG des pages sources (base de connaissances du bot)
# --------------------------------------------------------------------------

async def run_kb_ingestion(bot_id: int, urls: list[str]) -> None:
    """Tâche de fond de l'onboarding : ingère le texte des pages choisies dans
    la BASE DE CONNAISSANCES du bot (KB/RAG), pour que le mode IA libre réponde
    DEPUIS le site au lieu d'inventer. Lancée EN PARALLÈLE de la génération
    d'arbre (run_bot_generation) — embeddings LOCAUX, zéro coût externe, donc
    toujours active (pas de gating module à l'ingestion ; la recherche RAG, elle,
    reste gatée au runtime côté widget).

    Best-effort & IDEMPOTENT : la dédup (par `ref`) ne saute QUE les URLs dont une
    source est déjà RÉUSSIE ou EN COURS (ready/pending) — une URL dont la seule
    source est en 'error' est RÉESSAYÉE en réutilisant la ligne existante (repassée
    à 'pending') plutôt qu'en créant un doublon (respect du plafond
    MAX_SOURCES_PER_BOT). Chaque URL est isolée — une page injoignable (FetchError)
    bascule SA source en 'error' et n'interrompt pas les autres.

    ⚠ ANTI-SSRF : le texte est récupéré via `fetch_user_url` (porte unique
    anti-SSRF, avec le bypass DEV loopback pour le WP local), PUIS passé à
    `ingest_source(text_content=…)` — la source 'url' n'est donc JAMAIS re-fetchée
    par l'anti-SSRF (qui refuserait localhost en dev). En prod, `fetch_user_url`
    applique l'anti-SSRF normal (https imposé, IP publiques uniquement)."""
    # Imports paresseux : kb_service charge le modèle d'embeddings au chargement
    # de module (cf. sitemap_fallback) — on n'y touche qu'au moment d'ingérer.
    from src.core.database import AsyncSessionLocal
    from src.models.kb import KbSource
    from src.services import kb_service
    from src.services.safe_fetch import FetchError
    from sqlalchemy import select

    cleaned = [u for u in ((u or "").strip() for u in (urls or [])) if u]
    if not cleaned:
        return

    async with AsyncSessionLocal() as db:
        # État des sources DÉJÀ présentes, indexé par `ref` (idempotence + plafond).
        # On garde, par URL, la « meilleure » source : une source réussie/en cours
        # (ready/pending) PRIME sur une source en 'error' (doublons historiques) —
        # ainsi on ne réessaie que si TOUTE source de l'URL est en erreur.
        rows = (await db.execute(
            select(KbSource).where(KbSource.bot_id == bot_id)
        )).scalars().all()
        by_ref: dict[str, KbSource] = {}
        for s in rows:
            prev = by_ref.get(s.ref)
            if prev is None or (prev.status == "error" and s.status != "error"):
                by_ref[s.ref] = s
        total_sources = len(rows)
        capped_warned = False

        for url in cleaned:
            existing_source = by_ref.get(url)
            if existing_source is not None and existing_source.status != "error":
                # Déjà réussie ou en cours d'ingestion -> best-effort, on ne refait rien.
                continue
            if existing_source is not None:
                # Seule source de l'URL en 'error' : on la RÉUTILISE (repassée à
                # 'pending') au lieu de créer un 2e enregistrement -> respecte le
                # plafond et évite les doublons. Ne consomme pas de quota supplémentaire.
                source = existing_source
                source.status = "pending"
                source.error = None
                await db.commit()
                await db.refresh(source)
            else:
                # Nouvelle URL : soumise au plafond (les réessais ci-dessus, eux, ne
                # créent rien donc ne s'y heurtent pas). On saute les nouvelles URLs
                # au-delà du plafond sans interrompre d'éventuels réessais suivants.
                if total_sources >= kb_service.MAX_SOURCES_PER_BOT:
                    if not capped_warned:
                        logger.info("KB onboarding bot %s : plafond %s sources atteint, "
                                    "nouvelles URLs ignorées", bot_id, kb_service.MAX_SOURCES_PER_BOT)
                        capped_warned = True
                    continue
                total_sources += 1
                source = KbSource(bot_id=bot_id, type="url", ref=url, status="pending")
                db.add(source)
                await db.commit()
                await db.refresh(source)
                by_ref[url] = source

            # Fetch via la porte anti-SSRF (bypass DEV loopback) PUIS ingestion
            # SANS re-fetch (text_content). Une page en échec -> source en error,
            # on continue les autres (best-effort).
            try:
                page_text = await kb_service.fetch_user_url(url)
            except FetchError as exc:
                source.status = "error"
                source.error = str(exc)
                await db.commit()
                logger.warning("KB onboarding bot %s : %s injoignable (%s)", bot_id, url, exc)
                continue
            except Exception as exc:  # robustesse : un parse foireux n'arrête pas le lot
                source.status = "error"
                source.error = "Lecture de la page échouée"
                await db.commit()
                logger.warning("KB onboarding bot %s : %s erreur inattendue %r", bot_id, url, exc)
                continue

            # ingest_source ouvre SA propre session, met la source en ready/error
            # et gère le cap MAX_CHUNKS_PER_BOT. La source est déjà committée -> ok.
            await kb_service.ingest_source(source.id, text_content=page_text)
