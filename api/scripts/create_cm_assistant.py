"""Crée (ou met à jour) le bot « Assistant Chapote CM » — mode public seulement.

Idempotent : relancer met à jour le même bot (retrouvé par propriétaire + nom),
sans en créer un second. Aucun secret : rien n'est lu ni écrit d'autre que la base.

Ce que fait le script :
  1. retrouve le compte propriétaire (--owner-email, OBLIGATOIRE : aucune adresse
     n'est écrite dans le code) ; il doit être administrateur (is_superadmin) ;
  2. crée le bot perso s'il n'existe pas (inactif par défaut), puis règle :
     mode IA, consignes (scripts/cm_assistant/system_prompt.md), apparence,
     domaines autorisés (cm.chapote.fr + localhost), captcha Turnstile (clés
     existantes du serveur) ;
  3. pose l'override « offert » (sans Stripe) décidé à l'étape 1 : statut actif,
     modules IA + connaissances + MCP, quota de 3000 réponses IA / mois, dépassement
     bloqué. Tracé dans l'historique du bot (acteur staff = le propriétaire) ;
  4. remplace la base de connaissances par les textes de scripts/cm_assistant/kb/
     (sources « texte » ; ingestion locale, rien ne part chez un tiers).

Le connecteur MCP n'est PAS configuré ici (étape 4). Le bot n'est branché sur
aucune page : cm.chapote.fr n'affiche rien tant que le composant n'est pas activé.

Usage (sur le serveur, dans le conteneur api, depuis api/) :
    python -m scripts.create_cm_assistant --owner-email <adresse> --dry-run
    python -m scripts.create_cm_assistant --owner-email <adresse>
    python -m scripts.create_cm_assistant --owner-email <adresse> --activate
"""
import argparse
import asyncio
from pathlib import Path

from sqlalchemy import delete, func, select

from src.core.constants import MODULE_AI, MODULE_MCP, MODULE_RAG
from src.core.database import AsyncSessionLocal
from src.models.bot import DEFAULT_DESIGN, Bot
from src.models.kb import KbSource
from src.models.user import User
from src.routers.widget_helpers import sanitize_design
from src.services.entitlement_service import PlanState, set_bot_status
from src.services.kb_service import ingest_source
from src.services.stripe_service import billing_enabled

HERE = Path(__file__).resolve().parent / "cm_assistant"
BOT_NAME = "Assistant Chapote CM"
ALLOWED_DOMAINS = ["cm.chapote.fr", "localhost"]
AI_MONTHLY_QUOTA = 3000
MODULES = sorted([MODULE_AI, MODULE_RAG, MODULE_MCP])

# Apparence par défaut (orange clair de cm.chapote.fr). La page transmet ensuite
# la couleur et le thème choisis (data-color / data-theme, voir docs/WIDGET_CM.md).
DESIGN = {
    "title": "Assistant Chapote CM",
    "primaryColor": "#C93F17",
    "icon": "help",
    "position": "right",
    # Petite bulle (48 px, au-dessus des 44 px de zone de clic) : secondaire sur la
    # page d'accueil, qui garde un seul bouton principal.
    "size": "sm",
    "borderRadius": 16,
    "welcomeMessage": ("Bonjour ! Je réponds à vos questions sur Chapote CM : "
                       "publication, planning, statistiques, Google Drive, partage. "
                       "Que voulez-vous savoir ?"),
    "placeholder": "Écrivez votre question…",
    "locale": "fr",
    "headerStatus": False,
    "poweredBy": True,
    "launcherAnimation": "none",
    "greeting": False,
    "launcherBadge": False,   # pas de pastille rouge : la bulle reste secondaire
    "onPrimary": "#ffffff",
    "surfaceTone": "neutral",  # sombre neutre, accordé aux tons chauds de cm
    "headerStyle": "solid",    # en-tête à la couleur de marque
    "darkMode": False,         # clair par défaut ; la page impose son thème (data-theme)
}


def _kb_files() -> list[tuple[str, str]]:
    """(titre, texte) de chaque fichier de la base, dans l'ordre des noms."""
    out = []
    for path in sorted((HERE / "kb").glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        title = text.splitlines()[0].lstrip("# ").strip()[:120]
        out.append((title, text))
    return out


async def run(owner_email: str, dry_run: bool, activate: bool) -> int:
    system_prompt = (HERE / "system_prompt.md").read_text(encoding="utf-8").strip()
    kb = _kb_files()
    if not kb:
        print("Base de connaissances vide : rien à faire.")
        return 1

    async with AsyncSessionLocal() as db:
        owner = (await db.execute(
            select(User).where(func.lower(User.email) == owner_email.strip().lower())
        )).scalar_one_or_none()
        if owner is None:
            print("Compte introuvable pour cette adresse.")
            return 1
        if not owner.is_superadmin:
            # L'override « offert » est un geste staff : jamais pour un compte ordinaire.
            print("Ce compte n'est pas administrateur : arrêt (aucune gratuité hors staff).")
            return 1

        bot = (await db.execute(
            select(Bot).where(Bot.owner_user_id == owner.id, Bot.name == BOT_NAME)
        )).scalar_one_or_none()
        created = bot is None
        print(f"Bot : {'à créer' if created else f'existant (id {bot.id})'}")
        print(f"Base de connaissances : {len(kb)} textes ({sum(len(t) for _, t in kb)} caractères)")
        print(f"Consignes : {len(system_prompt)} caractères")
        if dry_run:
            print("--dry-run : aucune écriture.")
            return 0

        if created:
            bot = Bot(owner_user_id=owner.id, organization_id=None, name=BOT_NAME,
                      is_active=False)
            db.add(bot)
            await db.flush()

        bot.mode = "ai"
        bot.system_prompt = system_prompt
        bot.temperature = 30
        bot.api_key_mode = "managed"
        bot.allowed_domains = list(ALLOWED_DOMAINS)
        bot.captcha_provider = "turnstile"
        bot.captcha_site_key = None
        bot.captcha_secret_encrypted = None
        # Même validation que le bootstrap du widget (bornes, couleurs, listes fermées).
        bot.design_json = sanitize_design({**DEFAULT_DESIGN, **(bot.design_json or {}), **DESIGN})
        if activate:
            bot.is_active = True

        # Override « offert » (étape 1). Inerte si la facturation est éteinte
        # (tout est déjà débloqué), mais posé quand même pour le jour où elle s'allume.
        await set_bot_status(
            db, bot.id, new_status="active", actor_kind="staff",
            actor_user_id=owner.id, reason="override_staff",
            plan=PlanState(modules=MODULES, ai_monthly_quota=AI_MONTHLY_QUOTA),
        )

        # Base de connaissances : on remplace tout (les textes du dépôt font foi).
        old_ids = (await db.execute(
            select(KbSource.id).where(KbSource.bot_id == bot.id)
        )).scalars().all()
        if old_ids:  # les extraits suivent (clé étrangère ON DELETE CASCADE)
            await db.execute(delete(KbSource).where(KbSource.id.in_(old_ids)))
        sources = []
        for title, text in kb:
            src = KbSource(bot_id=bot.id, type="text", ref=title, status="pending")
            db.add(src)
            sources.append((src, text))
        await db.commit()
        bot_id, public_key, is_active = bot.id, bot.public_key, bot.is_active

    # Ingestion (session dédiée, comme l'endpoint) : découpage + embeddings locaux.
    for src, text in sources:
        await ingest_source(src.id, text_content=text)

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(KbSource.ref, KbSource.status, KbSource.error).where(KbSource.bot_id == bot_id)
        )).all()
    for ref, status, error in rows:
        print(f"  - {ref} : {status}{f' ({error})' if error else ''}")

    print(f"Bot {'créé' if created else 'mis à jour'} : id {bot_id}, actif : {'oui' if is_active else 'non'}")
    print(f"Clé publique (publique par nature, sert au widget) : {public_key}")
    print(f"Facturation : {'activée, override offert posé' if billing_enabled() else 'éteinte (tout est gratuit)'}"
          f" ; quota IA {AI_MONTHLY_QUOTA} / mois")
    if not is_active:
        print("Bot inactif : relancer avec --activate quand vous voulez le tester.")
    return 0 if all(s == "ready" for _, s, _ in rows) else 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--owner-email", required=True, help="adresse du compte administrateur propriétaire")
    parser.add_argument("--dry-run", action="store_true", help="affiche ce qui serait fait, sans écrire")
    parser.add_argument("--activate", action="store_true", help="active le bot (inactif par défaut)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.owner_email, args.dry_run, args.activate)))


if __name__ == "__main__":
    main()
