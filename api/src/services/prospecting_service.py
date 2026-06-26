"""Service de prospection commerciale (back-office superadmin).

Trois etapes, toutes reutilisant l'existant :

1. RECHERCHE  : API publique recherche-entreprises (base SIRENE). Host FIXE et
   de confiance => httpx simple (le pinning anti-SSRF de safe_fetch est reserve
   aux URLs fournies par un tiers). `_normalize_company` conserve TOUTES les
   donnees legales utiles (dirigeants, forme, effectif, finances, complements),
   persistees des l'import dans `prospect.enrichment["sirene"]`.
2. ENRICHISSEMENT (scraping pousse, best-effort) : la base SIRENE ne donne ni
   site ni email. On devine le domaine (safe_probe sur des variantes), puis on
   CRAWLE les pages cles du site (home + contact/mentions/a-propos/equipe, meme
   domaine, ≤ N pages, redirections suivies via safe_get_follow). On extrait via
   BeautifulSoup (+ repli regex) : TOUS les emails et telephones, les reseaux
   sociaux, le JSON-LD/OpenGraph (description, logo, sameAs, horaires), le CMS et
   un chatbot existant. Tout va dans `prospect.enrichment["web"]`.
3. REDACTION : email de prospection redige par Claude (call_messages), nourri
   par tout l'enrichissement, avec fallback templaté en MOCK_AI. Le gabarit
   impose TOUJOURS l'identite de l'expediteur (Chapote) et une mention de
   desinscription (conformite CNIL / prospection B2B).
"""
import asyncio
import json
import logging
import re
import unicodedata
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from src.core.anthropic import call_messages
from src.core.config import settings
from src.core.constants import TREE_INSIGHTS_MODEL
from src.services.safe_fetch import FetchError, safe_get_follow, safe_probe

logger = logging.getLogger(__name__)

# Modele de redaction (meme que les outils config-time : Sonnet).
PROSPECTING_MODEL = TREE_INSIGHTS_MODEL
DRAFT_MAX_TOKENS = 1024

# Extraction d'emails : regex large, on filtre ensuite les images/exemples.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_EMAIL_IGNORE = ("example.com", "sentry", "wixpress", "@2x", ".png", ".jpg",
                 ".jpeg", ".gif", ".webp", ".svg", "votre-email", "your-email",
                 "email@", "domain.com", "nom@")
# Telephones FR / internationaux (best-effort, on dedoublonne ensuite).
_PHONE_RE = re.compile(r"(?:(?:\+|00)\d{1,3}[\s.\-]?)?(?:\(?\d\)?[\s.\-]?){8,}\d")
_PHONE_FR_RE = re.compile(r"(?:\+33|0033|0)\s*[1-9](?:[\s.\-]?\d{2}){4}")

# Reseaux sociaux : domaine -> plateforme.
_SOCIAL_PATTERNS = {
    "linkedin": re.compile(r"https?://(?:[\w.]*\.)?linkedin\.com/[^\s\"'<>]+", re.I),
    "facebook": re.compile(r"https?://(?:[\w.]*\.)?facebook\.com/[^\s\"'<>]+", re.I),
    "instagram": re.compile(r"https?://(?:[\w.]*\.)?instagram\.com/[^\s\"'<>]+", re.I),
    "twitter": re.compile(r"https?://(?:[\w.]*\.)?(?:twitter|x)\.com/[^\s\"'<>]+", re.I),
    "youtube": re.compile(r"https?://(?:[\w.]*\.)?youtube\.com/[^\s\"'<>]+", re.I),
    "tiktok": re.compile(r"https?://(?:[\w.]*\.)?tiktok\.com/[^\s\"'<>]+", re.I),
}

# Empreintes de widgets de chat tiers couramment integres.
_CHATBOT_HINTS = ("crisp.chat", "intercom", "tidio", "tawk.to", "livechat",
                  "drift.com", "hubspot", "zendesk", "chatbot", "botpress",
                  "smartsupp", "chapote")
# Empreintes CMS / e-commerce -> libelle.
_CMS_HINTS = {
    "WordPress": ("wp-content", "wp-includes", 'content="wordpress'),
    "Shopify": ("cdn.shopify.com", "shopify"),
    "Wix": ("wix.com", "wixstatic", "x-wix"),
    "PrestaShop": ("prestashop",),
    "Webflow": ("webflow",),
    "Squarespace": ("squarespace",),
    "Joomla": ('content="joomla',),
    "Drupal": ("/sites/default/files", 'content="drupal'),
}
# Mots-cles des liens internes a crawler (pages cles).
_KEY_PAGE_HINTS = ("contact", "mentions", "legal", "propos", "qui-sommes",
                   "qui_sommes", "about", "equipe", "team", "nous-contacter")

# Tags retires avant resume (on garde le texte lisible).
_TAG_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_HTML_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class ProspectingError(Exception):
    """Erreur metier montrable a l'utilisateur (message FR)."""


# --------------------------------------------------------------------------
# 1. Recherche d'entreprises (API publique recherche-entreprises / SIRENE)
# --------------------------------------------------------------------------

async def search_companies(
    *,
    q: str | None = None,
    naf: str | None = None,
    section: str | None = None,
    departement: str | None = None,
    code_postal: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> list[dict]:
    """Interroge l'API gouv et renvoie des candidats normalises (non persistes).

    Au moins un critere parmi q / naf / section / departement / code_postal est
    requis par l'API ; on leve une erreur metier explicite sinon."""
    params: dict[str, object] = {
        "page": max(1, page),
        "per_page": min(25, max(1, per_page)),
    }
    if q:
        params["q"] = q
    if naf:
        params["activite_principale"] = naf
    if section:
        params["section_activite_principale"] = section
    if departement:
        params["departement"] = departement
    if code_postal:
        params["code_postal"] = code_postal

    if not any(k in params for k in
               ("q", "activite_principale", "section_activite_principale",
                "departement", "code_postal")):
        raise ProspectingError(
            "Précisez au moins un critère (mots-clés, secteur, département ou code postal)")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(settings.RECHERCHE_ENTREPRISES_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error("Recherche entreprises : erreur API %s", e)
        raise ProspectingError("Annuaire des entreprises momentanément indisponible, réessayez")

    return [_normalize_company(r) for r in data.get("results", [])]


def _dirigeants(r: dict) -> list[dict]:
    """Liste normalisee des dirigeants (personnes physiques ou morales)."""
    out: list[dict] = []
    for d in r.get("dirigeants") or []:
        if d.get("denomination"):
            nom = d["denomination"]
        else:
            nom = " ".join(filter(None, [d.get("prenoms"), d.get("nom")])).strip()
        if nom:
            out.append({"nom": nom, "qualite": d.get("qualite") or d.get("type_dirigeant")})
    return out


def _normalize_company(r: dict) -> dict:
    """Aplati un resultat de l'API en candidat exploitable, en conservant TOUTES
    les donnees legales utiles dans `sirene` (persistees des l'import)."""
    siege = r.get("siege") or {}
    dirigeants = _dirigeants(r)
    complements = r.get("complements") or {}
    finances = r.get("finances") or {}
    sirene = {
        "siren": r.get("siren"),
        "siret_siege": siege.get("siret"),
        "forme_juridique": r.get("nature_juridique"),
        "date_creation": r.get("date_creation"),
        "tranche_effectif": r.get("tranche_effectif_salarie"),
        "annee_effectif": r.get("annee_tranche_effectif_salarie"),
        "etat_administratif": r.get("etat_administratif") or siege.get("etat_administratif"),
        "naf_code": siege.get("activite_principale") or r.get("activite_principale"),
        "naf_libelle": r.get("libelle_activite_principale")
        or siege.get("libelle_activite_principale"),
        "adresse": siege.get("adresse"),
        "code_postal": siege.get("code_postal"),
        "commune": siege.get("libelle_commune"),
        "latitude": siege.get("latitude"),
        "longitude": siege.get("longitude"),
        "nombre_etablissements": r.get("nombre_etablissements"),
        "dirigeants": dirigeants,
        "finances": finances,
        "complements": {
            "est_rge": complements.get("est_rge"),
            "est_ess": complements.get("est_ess"),
            "est_qualiopi": complements.get("est_qualiopi"),
            "est_bio": complements.get("est_bio"),
        },
    }
    return {
        "siren": r.get("siren"),
        "siret": siege.get("siret"),
        "company_name": r.get("nom_complet") or r.get("nom_raison_sociale") or "—",
        "naf_code": sirene["naf_code"],
        "sector_label": sirene["naf_libelle"],
        "city": siege.get("libelle_commune"),
        "postal_code": siege.get("code_postal"),
        "contact_name": dirigeants[0]["nom"] if dirigeants else None,
        "sirene": sirene,
    }


# --------------------------------------------------------------------------
# 2. Enrichissement (scraping pousse : crawl + extraction riche)
# --------------------------------------------------------------------------

def _slug(name: str) -> str:
    """Nom d'entreprise -> slug minuscule sans accent ni separateur."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = nfkd.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]", "", ascii_name)


def _slug_hyphen(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = nfkd.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", ascii_name)).strip("-")


def _candidate_domains(name: str) -> list[str]:
    """Domaines candidats derives du nom (slug colle ET avec tirets, .fr/.com/
    .net/.eu). Best-effort : le superadmin corrige a la main si besoin."""
    slug = _slug(name)
    hyphen = _slug_hyphen(name)
    bases = [b for b in dict.fromkeys([slug, hyphen]) if b and len(b) >= 3]
    tlds = (".fr", ".com", ".net", ".eu")
    urls: list[str] = []
    for base in bases:
        for tld in tlds:
            urls.append(f"https://www.{base}{tld}")
            urls.append(f"https://{base}{tld}")
    return urls


async def discover_website(company_name: str) -> str | None:
    """Best-effort : teste des domaines derives du nom, renvoie le premier 2xx."""
    for url in _candidate_domains(company_name):
        try:
            if 200 <= await safe_probe(url) < 300:
                return url
        except FetchError:
            continue
    return None


def _same_site(base: str, candidate: str) -> bool:
    """True si `candidate` est sur le meme domaine que `base` (www ignore)."""
    def host(u: str) -> str:
        return (urlparse(u).hostname or "").lower().removeprefix("www.")
    return host(base) == host(candidate)


async def _crawl_site(base_url: str) -> list[tuple[str, str]]:
    """Crawl borne des pages cles : home (suit la redirection) + pages internes
    contact/mentions/a-propos/equipe, MEME domaine. Renvoie [(url, html)]."""
    max_bytes = settings.PROSPECT_FETCH_MAX_BYTES
    max_redirects = settings.PROSPECT_CRAWL_MAX_REDIRECTS
    try:
        home_html, home_url = await safe_get_follow(base_url, max_bytes, max_redirects)
    except FetchError:
        return []

    pages: list[tuple[str, str]] = [(home_url, home_html)]
    # Selection des liens internes pertinents depuis la home.
    soup = BeautifulSoup(home_html, "html.parser")
    targets: list[str] = []
    seen = {_norm_url(home_url)}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = (a.get_text() or "").lower()
        if not any(h in href.lower() or h in text for h in _KEY_PAGE_HINTS):
            continue
        full = urljoin(home_url, href)
        if not full.startswith("https://") or not _same_site(home_url, full):
            continue
        key = _norm_url(full)
        if key in seen:
            continue
        seen.add(key)
        targets.append(full)
        if len(targets) >= settings.PROSPECT_CRAWL_MAX_PAGES - 1:
            break

    async def _fetch(url: str) -> tuple[str, str] | None:
        try:
            html, final = await safe_get_follow(url, max_bytes, max_redirects)
            return (final, html)
        except FetchError:
            return None

    extra = await asyncio.gather(*(_fetch(u) for u in targets))
    pages.extend(p for p in extra if p)
    return pages


def _norm_url(u: str) -> str:
    p = urlparse(u)
    return f"{(p.hostname or '').lower().removeprefix('www.')}{p.path.rstrip('/')}"


def _email_ok(addr: str) -> bool:
    low = addr.lower()
    return "@" in low and "." in low.split("@")[-1] and not any(b in low for b in _EMAIL_IGNORE)


def _extract_emails(html: str, soup: BeautifulSoup) -> list[str]:
    found: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip()
            if _email_ok(addr):
                found.append(addr.lower())
    for m in _EMAIL_RE.findall(html):
        if _email_ok(m):
            found.append(m.lower())
    return list(dict.fromkeys(found))


def _normalize_phone(raw: str) -> str:
    return re.sub(r"[^\d+]", "", raw)


def _extract_phones(html: str, soup: BeautifulSoup) -> list[str]:
    found: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().startswith("tel:"):
            n = _normalize_phone(href[4:])
            if len(n) >= 9:
                found.append(n)
    text = _clean_text(html)
    for m in _PHONE_FR_RE.findall(text):
        n = _normalize_phone(m)
        if len(n) >= 9:
            found.append(n)
    return list(dict.fromkeys(found))


def _extract_socials(html: str) -> dict:
    socials: dict[str, str] = {}
    for platform, pat in _SOCIAL_PATTERNS.items():
        m = pat.search(html)
        if m:
            url = m.group(0).rstrip('".,)\'')
            # Ignore les liens de partage/widget generiques.
            if "/sharer" in url or "intent/tweet" in url or "plugins/" in url:
                continue
            socials[platform] = url
    return socials


def _extract_jsonld(soup: BeautifulSoup) -> dict:
    """Parse les blocs JSON-LD et renvoie les champs Organization/LocalBusiness
    interessants (description, logo, telephone, email, sameAs, horaires)."""
    out: dict = {}
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in _iter_jsonld_nodes(data):
            t = node.get("@type", "")
            types = t if isinstance(t, list) else [t]
            if not any("Organization" in str(x) or "LocalBusiness" in str(x) for x in types):
                continue
            out.setdefault("description", node.get("description"))
            logo = node.get("logo")
            if isinstance(logo, dict):
                logo = logo.get("url")
            out.setdefault("logo", logo)
            out.setdefault("telephone", node.get("telephone"))
            out.setdefault("email", node.get("email"))
            same = node.get("sameAs")
            if same:
                out.setdefault("sameAs", same if isinstance(same, list) else [same])
            hours = node.get("openingHours") or node.get("openingHoursSpecification")
            out.setdefault("opening_hours", hours)
    return {k: v for k, v in out.items() if v}


def _iter_jsonld_nodes(data):
    if isinstance(data, list):
        for item in data:
            yield from _iter_jsonld_nodes(item)
    elif isinstance(data, dict):
        if "@graph" in data and isinstance(data["@graph"], list):
            for item in data["@graph"]:
                yield from _iter_jsonld_nodes(item)
        else:
            yield data


def _extract_meta(soup: BeautifulSoup) -> dict:
    out: dict = {}
    if soup.title and soup.title.string:
        out["title"] = soup.title.string.strip()
    for name, key in (("description", "description"), ("og:description", "description"),
                      ("og:image", "logo"), ("og:site_name", "site_name")):
        tag = soup.find("meta", attrs={"name": name}) or soup.find("meta", attrs={"property": name})
        if tag and tag.get("content"):
            out.setdefault(key, tag["content"].strip())
    return out


def _detect_cms(html: str) -> str | None:
    low = html.lower()
    for label, hints in _CMS_HINTS.items():
        if any(h in low for h in hints):
            return label
    return None


def _detect_chatbot(html: str) -> list[str]:
    low = html.lower()
    return [h for h in _CHATBOT_HINTS if h in low]


def _clean_text(html: str) -> str:
    txt = _TAG_RE.sub(" ", html)
    txt = _HTML_RE.sub(" ", txt)
    return _WS_RE.sub(" ", txt).strip()


async def enrich_prospect(prospect) -> dict:
    """Scraping pousse : crawl des pages cles + extraction riche. Mute l'objet
    ORM (l'appelant commit) et renvoie le bloc `web`. Jamais d'exception."""
    website = prospect.website or await discover_website(prospect.company_name)
    if not website:
        prospect.status = "enriched"
        _set_web(prospect, {"pages_crawled": [], "note": "site introuvable automatiquement"})
        return {"website": None}

    pages = await _crawl_site(website)
    if not pages:
        prospect.website = website
        prospect.status = "enriched"
        _set_web(prospect, {"pages_crawled": [], "note": "site injoignable"})
        return {"website": website, "pages": 0}

    emails: list[dict] = []
    phones: list[str] = []
    socials: dict = {}
    chatbot: list[str] = []
    cms: str | None = None
    description: str | None = None
    logo: str | None = None
    opening_hours = None
    seen_emails: set[str] = set()
    home_url = pages[0][0]

    for url, html in pages:
        soup = BeautifulSoup(html, "html.parser")
        for e in _extract_emails(html, soup):
            if e not in seen_emails:
                seen_emails.add(e)
                emails.append({"value": e, "page": url})
        for p in _extract_phones(html, soup):
            if p not in phones:
                phones.append(p)
        for k, v in _extract_socials(html).items():
            socials.setdefault(k, v)
        chatbot = chatbot or _detect_chatbot(html)
        cms = cms or _detect_cms(html)

        ld = _extract_jsonld(soup)
        meta = _extract_meta(soup)
        description = description or ld.get("description") or meta.get("description")
        logo = logo or ld.get("logo") or meta.get("logo")
        opening_hours = opening_hours or ld.get("opening_hours")
        # sameAs du JSON-LD complete les reseaux sociaux.
        for same in ld.get("sameAs") or []:
            for platform, pat in _SOCIAL_PATTERNS.items():
                if pat.match(str(same)):
                    socials.setdefault(platform, str(same))
        if ld.get("telephone"):
            tel = _normalize_phone(ld["telephone"])
            if len(tel) >= 9 and tel not in phones:
                phones.append(tel)
        if ld.get("email") and ld["email"].lower() not in seen_emails and _email_ok(ld["email"]):
            seen_emails.add(ld["email"].lower())
            emails.append({"value": ld["email"].lower(), "page": url})

    if not description:
        # Repli : premier texte lisible de la home.
        description = _clean_text(pages[0][1])[:500] or None

    tech = list(dict.fromkeys([*( [cms] if cms else [] ), *chatbot]))
    web = {
        "emails": emails,
        "phones": phones,
        "socials": socials,
        "description": description,
        "logo": logo,
        "cms": cms,
        "tech": tech,
        "opening_hours": opening_hours,
        "pages_crawled": [u for u, _ in pages],
    }

    # Valeurs « principales » pour le flux email.
    prospect.website = home_url
    if emails and not prospect.contact_email:
        prospect.contact_email = emails[0]["value"]
    prospect.has_existing_chatbot = bool(chatbot)
    if description:
        prospect.site_summary = description[:600]
    prospect.status = "enriched"
    _set_web(prospect, web)
    return web


def _set_web(prospect, web: dict) -> None:
    """Fusionne `web` dans enrichment (en preservant `sirene`). Reassigne un
    nouvel objet : la colonne JSON ne detecte pas les mutations en place."""
    enr = dict(prospect.enrichment or {})
    enr["web"] = web
    prospect.enrichment = enr


# --------------------------------------------------------------------------
# 3. Redaction de l'email de prospection (Claude, fallback MOCK_AI)
# --------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "Tu es l'assistant commercial de Chapote (chapote.fr), un SaaS qui permet "
    "d'ajouter en quelques minutes un chatbot intelligent (arbre de décision + "
    "IA) sur le site web d'une entreprise pour capter des leads et répondre aux "
    "visiteurs 24/7. Tu rédiges un email de PROSPECTION B2B court, personnalisé "
    "et professionnel, en français, vouvoiement. Objectif : présenter Chapote et "
    "proposer un rendez-vous visio de découverte (15 min). "
    "Contraintes IMPÉRATIVES : ton humain et concret (pas de jargon ni de "
    "superlatifs), 120 mots maximum pour le corps, une accroche personnalisée "
    "selon le secteur/la ville/le constat sur le site, un seul appel à l'action "
    "(proposer la visio). "
    "Termine TOUJOURS par une formule signée « L'équipe Chapote — chapote.fr » "
    "suivie d'une phrase de désinscription claire "
    "(« Si vous ne souhaitez plus être contacté, répondez STOP à cet email. »). "
    "Réponds STRICTEMENT au format JSON : {\"subject\": \"...\", \"body\": \"...\"} "
    "sans texte autour ni bloc markdown."
)


def _prospect_context(prospect) -> str:
    lines = [f"Entreprise : {prospect.company_name}"]
    if prospect.sector_label:
        lines.append(f"Secteur : {prospect.sector_label}")
    if prospect.city:
        lines.append(f"Ville : {prospect.city}")
    if prospect.contact_name:
        lines.append(f"Contact (dirigeant) : {prospect.contact_name}")
    if prospect.website:
        lines.append(f"Site web : {prospect.website}")

    web = (prospect.enrichment or {}).get("web") or {}
    if web.get("description"):
        lines.append(f"Description du site : {web['description'][:400]}")
    if web.get("cms"):
        lines.append(f"Techno du site : {web['cms']}")
    if web.get("socials"):
        lines.append("Réseaux sociaux : " + ", ".join(web["socials"].keys()))
    if prospect.has_existing_chatbot is True:
        lines.append("Constat : un outil de chat semble déjà présent sur le site "
                     "(argumenter sur une alternative plus simple/française).")
    elif prospect.has_existing_chatbot is False:
        lines.append("Constat : aucun chatbot détecté sur le site (argument clé).")
    return "\n".join(lines)


def _mock_draft(prospect) -> tuple[str, str]:
    """Brouillon deterministe (dev sans cle IA). Inclut bien la desinscription."""
    who = prospect.company_name
    where = f" à {prospect.city}" if prospect.city else ""
    subject = f"Un chatbot pour {who} ?"
    body = (
        f"Bonjour,\n\n"
        f"Je me permets de vous contacter car {who}{where} pourrait gagner des "
        f"contacts qualifiés en ajoutant un chatbot sur son site. Chapote "
        f"(chapote.fr) permet de le mettre en place en quelques minutes : un "
        f"assistant qui répond aux visiteurs 24/7 et capte les demandes.\n\n"
        f"Seriez-vous disponible pour un court échange en visio (15 min) afin de "
        f"vous le montrer ?\n\n"
        f"L'équipe Chapote — chapote.fr\n"
        f"Si vous ne souhaitez plus être contacté, répondez STOP à cet email."
    )
    return subject, body


async def draft_email(prospect) -> tuple[str, str]:
    """Renvoie (subject, body). MOCK_AI ou clé absente => brouillon templaté."""
    if settings.MOCK_AI or not settings.ANTHROPIC_API_KEY:
        return _mock_draft(prospect)

    try:
        result = await call_messages(
            api_key=settings.ANTHROPIC_API_KEY,
            model=PROSPECTING_MODEL,
            max_tokens=DRAFT_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": f"Rédige l'email de prospection pour :\n\n{_prospect_context(prospect)}",
            }],
        )
    except httpx.HTTPError as e:
        logger.error("Brouillon prospection : erreur API %s", e)
        raise ProspectingError("Le service IA est momentanément indisponible, réessayez") from e

    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", result.text.strip())
    try:
        data = json.loads(raw)
        subject = str(data["subject"]).strip()
        body = str(data["body"]).strip()
    except (json.JSONDecodeError, KeyError, TypeError):
        logger.warning("Brouillon prospection : sortie non-JSON, fallback templaté")
        return _mock_draft(prospect)
    return subject, body
