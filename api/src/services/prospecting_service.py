"""Service de prospection commerciale (back-office superadmin).

Trois etapes, toutes reutilisant l'existant :

1. RECHERCHE  : API publique recherche-entreprises (base SIRENE). Host FIXE et
   de confiance => httpx simple (le pinning anti-SSRF de safe_fetch est reserve
   aux URLs fournies par un tiers). Renvoie des candidats normalises, non
   persistes.
2. ENRICHISSEMENT (best-effort) : la base SIRENE ne donne ni site ni email. On
   devine le domaine a partir du nom (safe_probe sur quelques candidats), puis
   on lit la home + /contact (safe_get) pour extraire un email et detecter un
   chatbot deja installe.
3. REDACTION : email de prospection redige par Claude (call_messages), avec
   fallback templaté en MOCK_AI. Le gabarit impose TOUJOURS l'identite de
   l'expediteur (Chapote) et une mention de desinscription (conformite CNIL/
   prospection B2B).
"""
import logging
import re
import unicodedata

import httpx

from src.core.anthropic import call_messages
from src.core.config import settings
from src.core.constants import TREE_INSIGHTS_MODEL
from src.services.safe_fetch import FetchError, safe_get, safe_probe

logger = logging.getLogger(__name__)

# Modele de redaction (meme que les outils config-time : Sonnet).
PROSPECTING_MODEL = TREE_INSIGHTS_MODEL
DRAFT_MAX_TOKENS = 1024

# Extraction d'emails : regex large, on filtre ensuite les images/exemples.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Adresses a ignorer (placeholders, assets, antispam evident).
_EMAIL_IGNORE = ("example.com", "sentry", "wixpress", "@2x", ".png", ".jpg",
                 ".gif", ".webp", "votre-email", "your-email", "email@")
# Empreintes de widgets de chat tiers couramment integres.
_CHATBOT_HINTS = ("crisp.chat", "intercom", "tidio", "tawk.to", "livechat",
                  "drift.com", "hubspot", "zendesk", "chatbot", "botpress",
                  "smartsupp", "chapote")

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


def _normalize_company(r: dict) -> dict:
    """Aplati un resultat de l'API en candidat exploitable cote front/import."""
    siege = r.get("siege") or {}
    dirigeants = r.get("dirigeants") or []
    contact_name = None
    for d in dirigeants:
        nom = " ".join(filter(None, [d.get("prenoms"), d.get("nom")])).strip()
        if nom:
            contact_name = nom
            break
        if d.get("denomination"):
            contact_name = d["denomination"]
            break
    return {
        "siren": r.get("siren"),
        "siret": siege.get("siret"),
        "company_name": r.get("nom_complet") or r.get("nom_raison_sociale") or "—",
        "naf_code": siege.get("activite_principale") or r.get("activite_principale"),
        "sector_label": r.get("libelle_activite_principale")
        or siege.get("libelle_activite_principale"),
        "city": siege.get("libelle_commune"),
        "postal_code": siege.get("code_postal"),
        "contact_name": contact_name,
    }


# --------------------------------------------------------------------------
# 2. Enrichissement best-effort (site web + email + detection chatbot)
# --------------------------------------------------------------------------

def _slug(name: str) -> str:
    """Nom d'entreprise -> slug minuscule sans accent ni separateur, pour
    deriver des domaines candidats."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = nfkd.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]", "", ascii_name)


def _candidate_domains(name: str) -> list[str]:
    slug = _slug(name)
    if not slug or len(slug) < 3:
        return []
    return [f"https://www.{slug}.fr", f"https://www.{slug}.com",
            f"https://{slug}.fr", f"https://{slug}.com"]


async def discover_website(company_name: str) -> str | None:
    """Best-effort : teste quelques domaines derives du nom, renvoie le premier
    qui repond 2xx. Tres approximatif — le superadmin corrige a la main."""
    for url in _candidate_domains(company_name):
        try:
            if 200 <= await safe_probe(url) < 300:
                return url
        except FetchError:
            continue
    return None


def _clean_text(html: str) -> str:
    txt = _TAG_RE.sub(" ", html)
    txt = _HTML_RE.sub(" ", txt)
    return _WS_RE.sub(" ", txt).strip()


def _extract_email(html: str) -> str | None:
    # mailto: d'abord (le plus fiable), puis texte brut.
    for m in re.findall(r'mailto:([^"\'?\s>]+)', html, re.IGNORECASE):
        if _email_ok(m):
            return m.lower()
    for m in _EMAIL_RE.findall(html):
        if _email_ok(m):
            return m.lower()
    return None


def _email_ok(addr: str) -> bool:
    low = addr.lower()
    return "@" in low and not any(bad in low for bad in _EMAIL_IGNORE)


async def enrich_prospect(prospect) -> dict:
    """Renseigne website / contact_email / site_summary / has_existing_chatbot.

    Mutation in place de l'objet ORM (l'appelant commit). Renvoie un dict de
    diagnostic (champs trouves) — jamais d'exception : best-effort."""
    website = prospect.website or await discover_website(prospect.company_name)
    if not website:
        prospect.status = "enriched"
        return {"website": None, "reason": "site introuvable automatiquement"}

    prospect.website = website
    found_email = None
    found_chatbot = False
    summary_parts: list[str] = []

    # Home + page contact (best-effort, on ignore les pages absentes).
    for path in ("", "/contact", "/contactez-nous"):
        url = website.rstrip("/") + path
        try:
            html = await safe_get(url, max_bytes=200_000)
        except FetchError:
            continue
        low = html.lower()
        if not found_email:
            found_email = _extract_email(html)
        if not found_chatbot:
            found_chatbot = any(h in low for h in _CHATBOT_HINTS)
        if path == "" and not summary_parts:
            text = _clean_text(html)
            if text:
                summary_parts.append(text[:600])

    if found_email and not prospect.contact_email:
        prospect.contact_email = found_email
    prospect.has_existing_chatbot = found_chatbot
    if summary_parts:
        prospect.site_summary = summary_parts[0]
    prospect.status = "enriched"
    return {
        "website": website,
        "contact_email": prospect.contact_email,
        "has_existing_chatbot": found_chatbot,
    }


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
    "selon le secteur/la ville, un seul appel à l'action (proposer la visio). "
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
    if prospect.has_existing_chatbot is True:
        lines.append("Constat : un outil de chat semble déjà présent sur le site "
                     "(argumenter sur une alternative plus simple/française).")
    elif prospect.has_existing_chatbot is False:
        lines.append("Constat : aucun chatbot détecté sur le site (argument clé).")
    if prospect.site_summary:
        lines.append(f"Extrait du site : {prospect.site_summary[:400]}")
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
    import json
    try:
        data = json.loads(raw)
        subject = str(data["subject"]).strip()
        body = str(data["body"]).strip()
    except (json.JSONDecodeError, KeyError, TypeError):
        logger.warning("Brouillon prospection : sortie non-JSON, fallback templaté")
        return _mock_draft(prospect)
    return subject, body
