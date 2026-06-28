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
from html import escape

import pytest

from src.models.user import Organization, User
from src.services.email_service import (
    DEFAULT_THEME,
    LOGO_CID,
    LOGO_WHITE_CID,
    THEMES,
    _inline_logos_for,
    _theme_for,
    bot_owner_email,
    render_email_html,
)
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
    """Sans thème (compat), le rendu brandé échappe le texte injecté (nom avec
    « < » et « & ») et transforme un paragraphe = URL nue en bouton CTA neutre
    (accent par défaut + href + libellé « Ouvrir le lien »)."""
    text = ("Bonjour <Acme & Co>,\n\nVoici votre lien :"
            "\n\nhttps://chapote.fr/app")
    html = render_email_html(text)
    # Échappement : aucun « < » brut du contenu, l'entité HTML est présente.
    assert "<Acme" not in html
    assert "&lt;Acme &amp; Co&gt;" in html
    # URL nue -> bouton CTA (accent DEFAULT_THEME + URL en href + libellé).
    assert DEFAULT_THEME.accent in html
    assert 'href="https://chapote.fr/app"' in html
    assert "Ouvrir le lien" in html
    # Document HTML complet + footer de marque.
    assert html.startswith("<!doctype html>")
    assert "support@chapote.fr" in html


# --------------------- rendu « par catégorie » (themes/layouts) --------------

@pytest.mark.parametrize("kind", list(THEMES))
def test_render_each_theme_uses_accent_cta_and_one_inline_logo(kind):
    """Chaque kind rend son accent + son libellé de bouton, et référence
    EXACTEMENT un logo inline (blanc pour le bandeau, navy sinon) — l'attache
    inline correspondante est non vide."""
    theme = THEMES[kind]
    # URL nue seule sur sa ligne -> devient le bouton CTA themé.
    html = render_email_html("Bonjour,\n\nhttps://chapote.fr/app", theme=theme)
    assert theme.accent in html
    # Le libellé du bouton est HTML-échappé (ex. « l'équipe » -> « l&#x27;équipe »).
    assert escape(theme.cta) in html

    want = LOGO_WHITE_CID if theme.layout == "banner" else LOGO_CID
    other = LOGO_CID if theme.layout == "banner" else LOGO_WHITE_CID
    assert f'src="cid:{want}"' in html
    assert f'src="cid:{other}"' not in html
    # On n'attache que le logo référencé, et ses octets sont bien chargés.
    logos = _inline_logos_for(html)
    assert set(logos) == {want}
    assert logos[want]  # PNG non vide


def test_theme_for_known_default_and_unknown(caplog):
    """`_theme_for` : kind connu -> son thème ; « default »/omis -> DEFAULT_THEME
    sans warning ; kind inconnu -> DEFAULT_THEME + warning (dérive observable)."""
    assert _theme_for("welcome") is THEMES["welcome"]
    with caplog.at_level("WARNING"):
        assert _theme_for("default") is DEFAULT_THEME
    assert not caplog.records  # « default » ne loggue pas
    with caplog.at_level("WARNING"):
        assert _theme_for("welcom") is DEFAULT_THEME  # typo -> neutre
    assert any("inconnu" in r.message for r in caplog.records)


def test_logo_bytes_recovers_after_transient_miss(monkeypatch):
    """`_logo_bytes` ne fige PAS un échec : un miss transitoire (dossier absent)
    renvoie None mais n'est pas mémoïsé — la lecture suivante réussit."""
    from pathlib import Path

    import src.services.email_service as es

    es._LOGO_CACHE.pop("icon.png", None)
    monkeypatch.setattr(es, "_ASSETS_DIR", Path("/nonexistent-dir"))
    assert es._logo_bytes("icon.png") is None  # miss transitoire -> non caché
    monkeypatch.undo()                          # le dossier réapparaît
    data = es._logo_bytes("icon.png")
    assert data and data[:8] == b"\x89PNG\r\n\x1a\n"  # vrai PNG, lu cette fois


def test_themes_cover_every_kind_used_at_call_sites():
    """Parité anti-dérive : tout `kind` envoyé par les call-sites (auth, billing,
    widget, invitations) doit avoir une entrée THEMES. Si on renomme/supprime une
    clé sans mettre à jour un appel, ce test casse au lieu d'un rendu neutre muet."""
    used = {"verify", "password_changed", "welcome", "reset", "suspended",
            "overage", "added", "invite"}
    assert used <= set(THEMES), f"kinds sans thème : {used - set(THEMES)}"
