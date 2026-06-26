"""Back-office superadmin : outil de prospection commerciale.

Cycle : recherche (API SIRENE, non persistee) -> import en base -> enrichissement
best-effort (site + email) -> brouillon d'email IA -> edition manuelle -> envoi.
L'envoi reste MANUEL (jamais d'envoi de masse automatique) et chaque email
comporte l'identite de l'expediteur + une mention de desinscription (CNIL).
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.constants import CODE_TO_MODULE, MODULE_KEYS
from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.models.billing import BillingProduct
from src.models.prospect import (PROSPECT_DECISIONS, PROSPECT_STATUSES,
                                 ProfileOut, Prospect, ProspectingProfile,
                                 ProspectOut, ProspectPatch)
from src.models.user import User
from src.services.email_service import send_email
from src.services.prospecting_service import (ProspectingError,
                                              _company_name_from_title,
                                              _set_scoring, _website_host,
                                              draft_email, enrich_prospect,
                                              generate_target_queries,
                                              score_prospect, search_companies,
                                              search_web)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/prospecting",
    tags=["admin-prospecting"],
    dependencies=[Depends(require_superadmin)],
)


class SearchBody(BaseModel):
    q: Optional[str] = None
    naf: Optional[str] = None
    section: Optional[str] = None
    departement: Optional[str] = None
    code_postal: Optional[str] = None
    page: int = 1


class ImportBody(BaseModel):
    """Candidats selectionnes a importer (forme renvoyee par /search)."""
    candidates: list[dict]


class DiscoverBody(BaseModel):
    """Criteres de decouverte autonome (SIRENE) : au moins un requis cote API."""
    sector: Optional[str] = None
    naf: Optional[str] = None
    departement: Optional[str] = None
    code_postal: Optional[str] = None
    count: int = 5


class DiscoverWebBody(BaseModel):
    """Decouverte web INTUITIVE : une seule description libre de la cible."""
    query: str
    count: int = 5


class AutoBody(BaseModel):
    """Prospection 100% automatique : l'IA genere elle-meme les cibles, l'operateur
    ne saisit RIEN (location optionnelle pour cibler une zone)."""
    count: int = 6
    location: Optional[str] = None


class ProfileBody(BaseModel):
    """Profil cible persistant du superadmin (prefille la decouverte + ses notes
    sont injectees dans le scoring IA)."""
    web_query: Optional[str] = None
    sector: Optional[str] = None
    departement: Optional[str] = None
    code_postal: Optional[str] = None
    notes: Optional[str] = None


class DecisionBody(BaseModel):
    """Validation de l'operateur (pouce haut/bas) -> apprentissage few-shot."""
    decision: str            # 'accepted' | 'rejected' (PROSPECT_DECISIONS)
    reason: Optional[str] = None


@router.post("/search")
async def search(body: SearchBody):
    """Recherche live dans l'annuaire des entreprises (non persistee)."""
    try:
        return await search_companies(
            q=body.q, naf=body.naf, section=body.section,
            departement=body.departement, code_postal=body.code_postal,
            page=body.page,
        )
    except ProspectingError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


@router.get("/prospects", response_model=list[ProspectOut])
async def list_prospects(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Prospect).order_by(
        Prospect.fit_score.desc().nullslast(), Prospect.created_at.desc())
    if status_filter:
        stmt = stmt.where(Prospect.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()
    return [ProspectOut.model_validate(p) for p in rows]


@router.post("/prospects", response_model=list[ProspectOut])
async def import_prospects(
    body: ImportBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Importe les candidats selectionnes. Dedoublonnage par SIREN : un SIREN
    deja present est ignore (pas de doublon, pas d'erreur)."""
    sirens = [c.get("siren") for c in body.candidates if c.get("siren")]
    existing = set()
    if sirens:
        existing = set((await db.execute(
            select(Prospect.siren).where(Prospect.siren.in_(sirens))
        )).scalars().all())

    created: list[Prospect] = []
    for c in body.candidates:
        siren = c.get("siren")
        if siren and siren in existing:
            continue
        if siren:
            existing.add(siren)  # evite les doublons au sein du meme lot
        # Donnees legales SIRENE completes stockees des l'import (l'API les
        # renvoie deja) ; le crawl du site remplira enrichment["web"] ensuite.
        enrichment = {"sirene": c["sirene"]} if c.get("sirene") else None
        p = Prospect(
            siren=siren,
            siret=c.get("siret"),
            company_name=c.get("company_name") or "—",
            naf_code=c.get("naf_code"),
            sector_label=c.get("sector_label"),
            city=c.get("city"),
            postal_code=c.get("postal_code"),
            contact_name=c.get("contact_name"),
            enrichment=enrichment,
            status="found",
            created_by_user_id=user.id,
        )
        db.add(p)
        created.append(p)
    await db.commit()
    for p in created:
        await db.refresh(p)
    return [ProspectOut.model_validate(p) for p in created]


def _criteria_summary(body: DiscoverBody) -> str:
    """Resume lisible des criteres de recherche -> Prospect.discovery_query."""
    parts: list[str] = []
    if body.sector:
        parts.append(body.sector)
    if body.naf:
        parts.append(f"NAF {body.naf}")
    if body.departement:
        parts.append(f"dép. {body.departement}")
    if body.code_postal:
        parts.append(f"CP {body.code_postal}")
    return " · ".join(parts) or "découverte"


async def _recent_decisions(db: AsyncSession, limit: int = 12) -> list[dict]:
    """Decisions passees de l'operateur (few-shot pour le scoring IA)."""
    rows = (await db.execute(
        select(Prospect)
        .where(Prospect.decision.is_not(None))
        .order_by(Prospect.decision_at.desc())
        .limit(limit)
    )).scalars().all()
    return [{
        "company_name": p.company_name,
        "sector": p.sector_label,
        "summary": p.site_summary,
        "decision": p.decision,
        "decision_reason": p.decision_reason,
    } for p in rows]


async def _load_catalog(db: AsyncSession) -> dict:
    """Catalogue facturable (paliers IA + modules) pour le scoring. Replie sur
    un catalogue minimal si la base est vide (modules = MODULE_KEYS)."""
    rows = (await db.execute(
        select(BillingProduct).where(BillingProduct.is_active.is_(True))
    )).scalars().all()
    modules: list[dict] = []
    ai_tiers: list[dict] = []
    for p in rows:
        if p.kind == "ai_tier":
            ai_tiers.append({
                "id": p.code,
                "included_replies": p.included_replies,
                "price_cents": p.unit_amount,
                "desc": p.description,
            })
        elif p.kind == "module" and p.code != "mod_ai_byok":
            key = CODE_TO_MODULE.get(p.code)
            if not key:
                continue
            modules.append({
                "key": key,
                "label": p.label,
                "price_cents": p.unit_amount,
                "requires": ["ai"] if key in ("rag", "mcp") else [],
            })
    if not modules and not ai_tiers:
        return {
            "modules": [{"key": k} for k in MODULE_KEYS],
            "ai_tiers": [{"id": "ai_starter"}, {"id": "ai_growth"}, {"id": "ai_scale"}],
        }
    return {"modules": modules, "ai_tiers": ai_tiers}


async def _load_profile_notes(db: AsyncSession, user: User) -> str | None:
    """Notes du profil cible du superadmin, injectees dans le scoring IA (None si
    pas de profil enregistre)."""
    profile = (await db.execute(
        select(ProspectingProfile).where(ProspectingProfile.user_id == user.id)
    )).scalar_one_or_none()
    return profile.notes if profile else None


@router.post("/discover", response_model=list[ProspectOut])
async def discover(
    body: DiscoverBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Decouverte autonome (A LA DEMANDE) : recherche SIRENE -> import dedoublonne
    par SIREN -> enrichissement + scoring IA en CONCURRENCE. Renvoie les prospects
    crees, tries par fit_score decroissant (non scores en dernier)."""
    n = min(body.count, settings.PROSPECT_DISCOVER_MAX)
    if n < 1:
        return []
    # Au moins un critère requis : sinon search_companies lèverait ProspectingError
    # (mappé en 502) — on renvoie un 422 explicite (erreur d'entrée, pas de panne).
    if not any((body.sector, body.naf, body.departement, body.code_postal)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Précisez au moins un critère (secteur, NAF, département ou code postal)")

    try:
        candidates = await search_companies(
            q=body.sector, naf=body.naf, departement=body.departement,
            code_postal=body.code_postal, per_page=min(25, n * 3),
        )
    except ProspectingError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    discovery_query = _criteria_summary(body)
    sirens = [c.get("siren") for c in candidates if c.get("siren")]
    existing: set = set()
    if sirens:
        existing = set((await db.execute(
            select(Prospect.siren).where(Prospect.siren.in_(sirens))
        )).scalars().all())

    created: list[Prospect] = []
    for c in candidates:
        if len(created) >= n:
            break
        siren = c.get("siren")
        if siren and siren in existing:
            continue
        if siren:
            existing.add(siren)  # evite les doublons au sein du meme lot
        enrichment = {"sirene": c["sirene"]} if c.get("sirene") else None
        p = Prospect(
            siren=siren,
            siret=c.get("siret"),
            company_name=c.get("company_name") or "—",
            naf_code=c.get("naf_code"),
            sector_label=c.get("sector_label"),
            city=c.get("city"),
            postal_code=c.get("postal_code"),
            contact_name=c.get("contact_name"),
            enrichment=enrichment,
            status="found",
            discovery_query=discovery_query,
            created_by_user_id=user.id,
        )
        db.add(p)
        created.append(p)
    await db.commit()
    for p in created:
        await db.refresh(p)

    catalog = await _load_catalog(db)
    examples = await _recent_decisions(db)
    notes = await _load_profile_notes(db, user)

    async def _enrich_and_score(p: Prospect) -> None:
        # Tout est best-effort : aucune erreur (réseau, IA, parsing) sur UN
        # prospect ne doit faire échouer le lot entier (le prospect reste créé,
        # juste non enrichi/non scoré). return_exceptions=True en renfort.
        try:
            await enrich_prospect(p)
            scoring = await score_prospect(p, catalog=catalog, examples=examples,
                                           profile_notes=notes)
            _set_scoring(p, scoring)
        except Exception:
            logger.warning("Enrichissement/scoring du prospect %s échoué", p.id,
                           exc_info=True)

    await asyncio.gather(*(_enrich_and_score(p) for p in created),
                         return_exceptions=True)
    await db.commit()
    for p in created:
        await db.refresh(p)

    # Tri : fit_score desc, non scores (None) en dernier, puis created_at desc.
    created.sort(key=lambda p: p.created_at, reverse=True)
    created.sort(key=lambda p: (p.fit_score is None, -(p.fit_score or 0)))
    return [ProspectOut.model_validate(p) for p in created]


@router.post("/discover-web", response_model=list[ProspectOut])
async def discover_web(
    body: DiscoverWebBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Decouverte web INTUITIVE (A LA DEMANDE) : une description libre de la cible
    (ex. « restaurants à Versailles ») -> Brave Search -> pour chaque URL :
    scraping + identification du nom de l'entreprise + scoring IA, en CONCURRENCE.
    Dedoublonnage par host. Renvoie les prospects crees, tries fit_score
    decroissant (non scores en dernier)."""
    q = body.query.strip()
    if not q:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Décrivez qui vous cherchez")
    if not settings.BRAVE_SEARCH_API_KEY:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Recherche web indisponible (clé Brave non configurée)")
    n = min(body.count, settings.PROSPECT_DISCOVER_MAX)
    if n < 1:
        return []
    created = await _discover_from_queries(db, user, [q], n, tag="web")
    return [ProspectOut.model_validate(p) for p in created]


async def _discover_from_queries(
    db: AsyncSession, user: User, queries: list[str], total: int, tag: str,
) -> list[Prospect]:
    """Cœur partagé de la découverte web (servi par /discover-web et /auto) :
    pour chaque requête -> Brave -> création des prospects (dédup par host),
    puis enrichissement + scoring IA en concurrence (best-effort). Renvoie les
    prospects créés triés par fit_score décroissant (non scorés en dernier)."""
    # Dedoublonnage par host : sites des prospects existants + set local.
    # On élague d'emblée les prospects SIRENE (website NULL) -> aucun host à dédup.
    websites = (await db.execute(
        select(Prospect.website).where(Prospect.website.is_not(None))
    )).scalars().all()
    seen_hosts = {h for h in (_website_host(w) for w in websites) if h}

    created: list[Prospect] = []
    for q in queries:
        if len(created) >= total:
            break
        # On demande large (total*2) car la dedup par host élaguera des résultats.
        for r in await search_web(q, total * 2):
            if len(created) >= total:
                break
            host = _website_host(r.get("url"))
            if not host or host in seen_hosts:
                continue
            seen_hosts.add(host)
            p = Prospect(
                company_name=_company_name_from_title(r.get("title"), r["url"]),
                website=r["url"],
                status="found",
                discovery_query=f"{tag}: {q}",
                created_by_user_id=user.id,
            )
            db.add(p)
            created.append(p)
    await db.commit()
    for p in created:
        await db.refresh(p)
    if not created:
        return []

    catalog = await _load_catalog(db)
    examples = await _recent_decisions(db)
    notes = await _load_profile_notes(db, user)

    async def _enrich_and_score(p: Prospect) -> None:
        # Best-effort : aucune erreur (réseau, IA, parsing) sur UN prospect ne
        # doit faire échouer le lot (prospect créé, juste non enrichi/non scoré).
        try:
            await enrich_prospect(p)
            web = (p.enrichment or {}).get("web") or {}
            # En mode web le nom du site (OG/JSON-LD) fait autorité sur le titre
            # Brave : on l'utilise pour affiner le nom de l'entreprise. Garde
            # isinstance(str) : une valeur non-str (JSON-LD malformé) ne doit
            # jamais atteindre la colonne String company_name.
            sn = web.get("site_name")
            if isinstance(sn, str) and sn.strip():
                p.company_name = sn[:120]
            scoring = await score_prospect(p, catalog=catalog, examples=examples,
                                           profile_notes=notes)
            _set_scoring(p, scoring)
        except Exception:
            logger.warning("Enrichissement/scoring du prospect %s échoué", p.id,
                           exc_info=True)

    await asyncio.gather(*(_enrich_and_score(p) for p in created),
                         return_exceptions=True)
    await db.commit()
    for p in created:
        await db.refresh(p)

    # Tri : fit_score desc, non scorés (None) en dernier, puis created_at desc.
    created.sort(key=lambda p: p.created_at, reverse=True)
    created.sort(key=lambda p: (p.fit_score is None, -(p.fit_score or 0)))
    return created


@router.post("/auto", response_model=list[ProspectOut])
async def auto_discover(
    body: AutoBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Prospection 100% AUTOMATIQUE : l'IA génère elle-même les cibles (client
    idéal de Chapote + profil de l'opérateur + ses décisions passées), cherche,
    scrape et score. L'opérateur ne saisit RIEN — il ne fait que valider 👍/👎,
    ce qui affine le ciblage suivant. Repli ICP déterministe sans clé IA."""
    if not settings.BRAVE_SEARCH_API_KEY:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Recherche web indisponible (clé Brave non configurée)")
    n = min(body.count, settings.PROSPECT_DISCOVER_MAX)
    if n < 1:
        return []

    examples = await _recent_decisions(db)
    notes = await _load_profile_notes(db, user)
    # Localisation : argument explicite, sinon dérivée du profil (CP puis dépt).
    profile = (await db.execute(
        select(ProspectingProfile).where(ProspectingProfile.user_id == user.id)
    )).scalar_one_or_none()
    loc = body.location or (profile and (profile.code_postal or profile.departement)) or None

    queries = await generate_target_queries(
        profile_notes=notes, examples=examples, location_hint=loc,
        n_queries=max(3, min(8, n)),
    )
    if not queries:
        return []
    created = await _discover_from_queries(db, user, queries, n, tag="auto")
    return [ProspectOut.model_validate(p) for p in created]


@router.get("/profile", response_model=ProfileOut)
async def get_profile(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Profil cible du superadmin (prefille la decouverte + injecte au scoring).
    Si absent, renvoie un profil vide SANS le creer en base."""
    profile = (await db.execute(
        select(ProspectingProfile).where(ProspectingProfile.user_id == user.id)
    )).scalar_one_or_none()
    if profile is None:
        return ProfileOut(web_query=None, sector=None, departement=None,
                          code_postal=None, notes=None)
    return ProfileOut.model_validate(profile)


@router.put("/profile", response_model=ProfileOut)
async def put_profile(
    body: ProfileBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Upsert du profil cible pour le superadmin courant (cree si absent, sinon
    met a jour les champs fournis)."""
    profile = (await db.execute(
        select(ProspectingProfile).where(ProspectingProfile.user_id == user.id)
    )).scalar_one_or_none()
    data = body.model_dump(exclude_unset=True)
    if profile is None:
        profile = ProspectingProfile(user_id=user.id, **data)
        db.add(profile)
        try:
            await db.commit()
        except IntegrityError:
            # Course (2 onglets) : la ligne unique user_id a été créée entre le
            # SELECT et l'INSERT -> on rebascule en update au lieu d'un 500.
            await db.rollback()
            profile = (await db.execute(
                select(ProspectingProfile).where(ProspectingProfile.user_id == user.id)
            )).scalar_one()
            for field, value in data.items():
                setattr(profile, field, value)
            await db.commit()
    else:
        for field, value in data.items():
            setattr(profile, field, value)
        await db.commit()
    await db.refresh(profile)
    return ProfileOut.model_validate(profile)


async def _get_prospect(prospect_id: int, db: AsyncSession) -> Prospect:
    p = await db.get(Prospect, prospect_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prospect introuvable")
    return p


@router.post("/prospects/{prospect_id}/enrich", response_model=ProspectOut)
async def enrich(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Enrichissement best-effort : site web + email de contact + detection
    d'un chatbot existant."""
    p = await _get_prospect(prospect_id, db)
    await enrich_prospect(p)
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.post("/prospects/{prospect_id}/score", response_model=ProspectOut)
async def score(
    prospect_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_superadmin),
):
    """Re-score un prospect (analyse IA : proba de besoin + formule/modules
    recommandes), en tenant compte des decisions passees de l'operateur et du
    profil cible."""
    p = await _get_prospect(prospect_id, db)
    catalog = await _load_catalog(db)
    examples = await _recent_decisions(db)
    notes = await _load_profile_notes(db, user)
    scoring = await score_prospect(p, catalog=catalog, examples=examples,
                                   profile_notes=notes)
    _set_scoring(p, scoring)
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.post("/prospects/{prospect_id}/decision", response_model=ProspectOut)
async def decide(
    prospect_id: int, body: DecisionBody, db: AsyncSession = Depends(get_db),
):
    """Validation de l'operateur (pouce haut/bas). La decision affine le scoring
    des recherches suivantes (apprentissage few-shot)."""
    if body.decision not in PROSPECT_DECISIONS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Décision invalide")
    p = await _get_prospect(prospect_id, db)
    p.decision = body.decision
    p.decision_reason = body.reason
    p.decision_at = utcnow()
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.post("/prospects/{prospect_id}/draft", response_model=ProspectOut)
async def draft(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Genere (ou regenere) le brouillon d'email de prospection par l'IA."""
    p = await _get_prospect(prospect_id, db)
    try:
        subject, body = await draft_email(p)
    except ProspectingError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    p.email_subject = subject
    p.email_body = body
    if p.status in ("found", "enriched"):
        p.status = "drafted"
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.patch("/prospects/{prospect_id}", response_model=ProspectOut)
async def patch_prospect(
    prospect_id: int, body: ProspectPatch, db: AsyncSession = Depends(get_db),
):
    """Edition manuelle (destinataire, objet, corps, site, statut)."""
    p = await _get_prospect(prospect_id, db)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in PROSPECT_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Statut invalide")
    for field, value in data.items():
        setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.post("/prospects/{prospect_id}/send", response_model=ProspectOut)
async def send(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Envoie l'email de prospection au contact. Envoi MANUEL, un prospect a la
    fois. Refuse si destinataire ou brouillon manquant."""
    p = await _get_prospect(prospect_id, db)
    if not p.contact_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Aucune adresse de destinataire renseignée")
    if not p.email_subject or not p.email_body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Aucun brouillon d'email à envoyer")
    ok = await send_email([p.contact_email], p.email_subject, p.email_body)
    if not ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Envoi impossible (SMTP non configuré ou erreur). Vérifiez la configuration email.")
    p.status = "sent"
    p.sent_at = utcnow()
    await db.commit()
    await db.refresh(p)
    return ProspectOut.model_validate(p)


@router.delete("/prospects/{prospect_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prospect(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Effacement d'un prospect (droit a l'effacement / RGPD)."""
    p = await _get_prospect(prospect_id, db)
    await db.delete(p)
    await db.commit()
