"""Tests ciblés des e‑mails compte/facturation ajoutés (cf. docs/EMAILS.md) :

- `email_service.bot_owner_email` : résolution du payeur d'un bot (perso vs
  équipe, None si introuvable) — accès db couverts par la FakeSession du conftest.
- Limiteur de dédoublonnage du mail « plafond IA atteint » : 2 appels -> 1 seul
  autorisé (config 1 / ~31 j).

Aucun SMTP : on ne teste pas l'envoi (fire-and-forget, log sans SMTP_HOST), mais
la résolution du destinataire et la garde anti-spam.
"""
import types
import uuid

import pytest

from src.models.user import Organization, User
from src.services.email_service import bot_owner_email, render_email_html
from src.services.rate_limit import overage_cap_email_limiter


def _bot(**kw) -> types.SimpleNamespace:
    base = dict(id=1, owner_user_id=None, organization_id=None, name="Bot")
    base.update(kw)
    return types.SimpleNamespace(**base)


# ------------------------------- bot_owner_email ----------------------------

@pytest.mark.asyncio
async def test_bot_owner_email_personal(db):
    """Bot perso : l'email du propriétaire (owner_user_id)."""
    db.seed(User(id=7, email="owner@test.dev", hashed_password="h", name="O"))
    assert await bot_owner_email(db, _bot(owner_user_id=7)) == "owner@test.dev"


@pytest.mark.asyncio
async def test_bot_owner_email_team(db):
    """Bot d'équipe : l'email de l'owner de l'organisation."""
    db.seed(User(id=9, email="boss@test.dev", hashed_password="h", name="B"))
    db.seed(Organization(id=3, name="Acme", owner_user_id=9))
    assert await bot_owner_email(db, _bot(organization_id=3)) == "boss@test.dev"


@pytest.mark.asyncio
async def test_bot_owner_email_none_when_owner_missing(db):
    """Owner introuvable -> None (la tâche d'envoi ne part pas)."""
    assert await bot_owner_email(db, _bot(owner_user_id=999)) is None


@pytest.mark.asyncio
async def test_bot_owner_email_none_when_no_scope(db):
    """Ni owner ni org (cas dégénéré) -> None."""
    assert await bot_owner_email(db, _bot()) is None


# ------------------------- limiteur plafond IA (dédoublonnage) ---------------

@pytest.mark.asyncio
async def test_overage_cap_email_limiter_dedups():
    """1 mail / ~mois / bot : 2 appels sur la même clé -> seul le 1er passe."""
    key = f"bot-{uuid.uuid4().hex}"  # clé unique : pas d'état résiduel inter-tests
    assert await overage_cap_email_limiter.check(key) is True
    assert await overage_cap_email_limiter.check(key) is False


# ------------------------------ render_email_html ---------------------------

def test_render_email_html_escapes_and_builds_cta():
    """Le rendu HTML brandé échappe le texte injecté (nom avec « < » et « & »)
    et transforme un paragraphe = URL nue en bouton CTA (couleur mint + href)."""
    text = ("Bonjour <Acme & Co>,\n\nVoici votre lien :"
            "\n\nhttps://chapote.fr/app")
    html = render_email_html(text)
    # Échappement : aucun « < » brut du contenu, l'entité HTML est présente.
    assert "<Acme" not in html
    assert "&lt;Acme &amp; Co&gt;" in html
    # URL nue -> bouton CTA (couleur MINT + URL en href + libellé).
    assert "#2F9E79" in html
    assert 'href="https://chapote.fr/app"' in html
    assert "Ouvrir le lien" in html
    # Document HTML complet + footer de marque.
    assert html.startswith("<!doctype html>")
    assert "support@chapote.fr" in html
