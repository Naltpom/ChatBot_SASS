"""Back-office superadmin : outil de prospection commerciale.

Cycle : recherche (API SIRENE, non persistee) -> import en base -> enrichissement
best-effort (site + email) -> brouillon d'email IA -> edition manuelle -> envoi.
L'envoi reste MANUEL (jamais d'envoi de masse automatique) et chaque email
comporte l'identite de l'expediteur + une mention de desinscription (CNIL).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.models.prospect import (PROSPECT_STATUSES, Prospect, ProspectOut,
                                 ProspectPatch)
from src.models.user import User
from src.services.email_service import send_email
from src.services.prospecting_service import (ProspectingError, draft_email,
                                              enrich_prospect, search_companies)

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
    stmt = select(Prospect).order_by(Prospect.created_at.desc())
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
