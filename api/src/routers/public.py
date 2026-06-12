"""Endpoints publics sans authentification : donnees de la landing (tarifs)."""
from fastapi import APIRouter

from src.models.user import PLANS, PLANS_META
from src.services import stripe_service

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/plans")
async def list_plans():
    """Plans + libelles, source unique pour le pricing front (remplace PLANS_INFO).
    billing_enabled=False -> le front affiche le bandeau paiement non configure."""
    return {
        "billing_enabled": stripe_service.billing_enabled(),
        "plans": [
            {"id": plan_id, **limits, **PLANS_META.get(plan_id, {})}
            for plan_id, limits in PLANS.items()
        ],
    }
