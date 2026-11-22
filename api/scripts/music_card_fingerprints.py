"""Boutique music : remplit l'empreinte de carte des abonnements créés avant l'audit du 22/11/2026.

Depuis cet audit, chaque abonnement garde l'empreinte de sa carte (`card_fingerprint`), pour que la même
carte n'ait droit qu'à un essai. Les abonnements plus anciens n'en ont pas : ce script la relit chez Stripe
(abonnement, moyen de paiement par défaut) et l'enregistre. Rien n'est modifié chez Stripe.

Idempotent : seules les lignes sans empreinte et avec un `stripe_subscription_id` sont traitées.

Usage (depuis api/, ou dans le conteneur de l'API) :
    python -m scripts.music_card_fingerprints           # applique
    python -m scripts.music_card_fingerprints --essai   # affiche seulement ce qui serait rempli
"""
import argparse
import asyncio
import logging

from sqlalchemy import select

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.models.music import MusicSubscription
from src.services import stripe_service
from src.services.stripe_service import StripeError

logger = logging.getLogger("music_card_fingerprints")


async def main(essai: bool) -> int:
    if settings.MOCK_BILLING or not settings.STRIPE_SECRET_KEY:
        print("Stripe non configuré (ou MOCK_BILLING) : rien à faire.")
        return 0
    remplis = erreurs = 0
    async with AsyncSessionLocal() as db:
        subs = (await db.execute(select(MusicSubscription).where(
            MusicSubscription.card_fingerprint.is_(None),
            MusicSubscription.stripe_subscription_id.is_not(None)))).scalars().all()
        print(f"{len(subs)} abonnement(s) sans empreinte de carte.")
        for sub in subs:
            try:
                obj = await stripe_service._stripe_request(
                    "GET", f"/subscriptions/{sub.stripe_subscription_id}",
                    params={"expand[]": "default_payment_method"})
            except StripeError as exc:
                erreurs += 1
                print(f"  #{sub.id} : abonnement non relu chez Stripe ({exc})")
                continue
            pm = obj.get("default_payment_method")
            fp = ((pm or {}).get("card") or {}).get("fingerprint") if isinstance(pm, dict) else None
            if not fp:
                print(f"  #{sub.id} : pas de carte par défaut chez Stripe, laissé vide")
                continue
            remplis += 1
            print(f"  #{sub.id} : empreinte trouvée{' (essai, non enregistrée)' if essai else ''}")
            if not essai:
                sub.card_fingerprint = fp[:64]
        if not essai:
            await db.commit()
    print(f"Terminé : {remplis} rempli(s), {erreurs} erreur(s).")
    return 1 if erreurs else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--essai", action="store_true", help="n'enregistre rien")
    raise SystemExit(asyncio.run(main(ap.parse_args().essai)))
