"""PR-02 — anti consent-phishing OAuth : allowlist redirect_uri PAR utilisateur.

Deux niveaux de couverture :

1. `validated_redirect_host` (fonction PURE, sans DB) : durcissement de la FORME
   du redirect_uri (page admin du plugin WP). Comparaison EXACTE du paramètre
   `page` (anti match par sous-chaîne), https imposé (http toléré seulement sur
   localhost en dev), pas d'userinfo. Renvoie l'hôte minuscule ou None.

2. POST /api/oauth/authorize : enforcement de l'allowlist par utilisateur. On
   réutilise le gabarit des tests billing (conftest : FakeSession en mémoire +
   app.dependency_overrides pour get_current_user/get_db). Cas DoD :
     (a) 1er consentement (aucun domaine)            -> 200 + auto-enregistrement
     (b) 2e domaine NOUVEAU sans confirm             -> 400 « non enregistré »
     (c) même 2e domaine AVEC confirm_unregistered   -> 200
     (d) domaine DÉJÀ enregistré                     -> 200
     (e) redirect_uri de forme invalide (http evil)  -> 400 « invalide »
"""
import pytest

from src.models.oauth import OAuthRedirectDomain
from src.services import oauth_service as svc


# --------------------------------------------------------------------------
# 1. validated_redirect_host (fonction pure)
# --------------------------------------------------------------------------

_VALID = "https://shop.example.com/wp-admin/admin.php?page=chapote-chatbot"


def test_validated_host_accepts_valid_https():
    assert svc.validated_redirect_host(_VALID, allow_insecure_localhost=False) == "shop.example.com"


def test_validated_host_lowercases_host():
    uri = "https://Shop.Example.COM/wp-admin/admin.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) == "shop.example.com"


def test_validated_host_rejects_http_non_localhost():
    uri = "http://evil.example.com/wp-admin/admin.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=True) is None


def test_validated_host_rejects_page_substring_suffix():
    # Anti match par sous-chaîne : 'chapote-chatbotXXX' != 'chapote-chatbot'.
    uri = "https://shop.example.com/wp-admin/admin.php?page=chapote-chatbotXXX"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) is None


def test_validated_host_rejects_page_value_injection():
    # 'page' n'est PAS une clé de query ici (c'est la valeur de 'foo') -> rejeté.
    uri = "https://shop.example.com/wp-admin/admin.php?foo=page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) is None


def test_validated_host_rejects_userinfo():
    uri = "https://user:pass@shop.example.com/wp-admin/admin.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) is None


def test_validated_host_rejects_wrong_path():
    uri = "https://shop.example.com/wp-admin/options.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) is None


def test_validated_host_accepts_localhost_http_in_dev():
    uri = "http://localhost/wp-admin/admin.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=True) == "localhost"


def test_validated_host_rejects_localhost_http_when_disallowed():
    uri = "http://localhost/wp-admin/admin.php?page=chapote-chatbot"
    assert svc.validated_redirect_host(uri, allow_insecure_localhost=False) is None


# --------------------------------------------------------------------------
# 2. POST /api/oauth/authorize — enforcement de l'allowlist
# --------------------------------------------------------------------------

def _body(redirect_uri: str, *, confirm: bool = False) -> dict:
    return {
        "client_id": "chapote_wp",
        "redirect_uri": redirect_uri,
        "state": "xyz",
        "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        "code_challenge_method": "S256",
        "scope": "plugin",
        "confirm_unregistered": confirm,
    }


@pytest.mark.asyncio
async def test_authorize_first_consent_auto_registers(client, db, overrides):
    """(a) Aucun domaine : bootstrap -> 200 + hôte auto-enregistré."""
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(_VALID))
    assert resp.status_code == 200, resp.text
    assert "code=" in resp.json()["redirect_url"]
    domains = {d.domain for d in db.rows(OAuthRedirectDomain)}
    assert domains == {"shop.example.com"}


@pytest.mark.asyncio
async def test_authorize_new_domain_without_confirm_rejected(client, db, overrides, current_user):
    """(b) L'user a déjà un site ; un NOUVEAU site sans confirm -> 400."""
    db.seed(OAuthRedirectDomain(user_id=current_user.id, domain="known.example.com"))
    new_uri = "https://new.example.com/wp-admin/admin.php?page=chapote-chatbot"
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(new_uri))
    assert resp.status_code == 400
    assert "non enregistré" in resp.json()["detail"]
    # Le domaine refusé n'a PAS été ajouté.
    domains = {d.domain for d in db.rows(OAuthRedirectDomain)}
    assert domains == {"known.example.com"}


@pytest.mark.asyncio
async def test_authorize_new_domain_with_confirm_accepted(client, db, overrides, current_user):
    """(c) Même nouveau site AVEC confirm_unregistered -> 200 + enregistré."""
    db.seed(OAuthRedirectDomain(user_id=current_user.id, domain="known.example.com"))
    new_uri = "https://new.example.com/wp-admin/admin.php?page=chapote-chatbot"
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(new_uri, confirm=True))
    assert resp.status_code == 200, resp.text
    domains = {d.domain for d in db.rows(OAuthRedirectDomain)}
    assert domains == {"known.example.com", "new.example.com"}


@pytest.mark.asyncio
async def test_authorize_known_domain_accepted(client, db, overrides, current_user):
    """(d) Domaine déjà enregistré -> 200 (pas de doublon)."""
    db.seed(OAuthRedirectDomain(user_id=current_user.id, domain="shop.example.com"))
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(_VALID))
    assert resp.status_code == 200, resp.text
    domains = [d.domain for d in db.rows(OAuthRedirectDomain)]
    assert domains == ["shop.example.com"]  # pas de doublon


@pytest.mark.asyncio
async def test_authorize_forged_subdomain_rejected(client, db, overrides, current_user):
    """Sous-domaine forgé : l'allowlist matche l'hôte EXACT. `evil.site-a.com`
    n'est PAS couvert par `site-a.com` enregistré -> 400 sans confirm + non ajouté."""
    db.seed(OAuthRedirectDomain(user_id=current_user.id, domain="site-a.com"))
    forged = "https://evil.site-a.com/wp-admin/admin.php?page=chapote-chatbot"
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(forged))
    assert resp.status_code == 400
    assert "non enregistré" in resp.json()["detail"]
    domains = {d.domain for d in db.rows(OAuthRedirectDomain)}
    assert domains == {"site-a.com"}


@pytest.mark.asyncio
async def test_authorize_invalid_form_rejected(client, db, overrides):
    """(e) redirect_uri de forme invalide (http non-localhost) -> 400 « invalide »."""
    bad = "http://evil.example.com/wp-admin/admin.php?page=chapote-chatbot"
    async with client as c:
        resp = await c.post("/api/oauth/authorize", json=_body(bad))
    assert resp.status_code == 400
    assert "invalide" in resp.json()["detail"]
    assert db.rows(OAuthRedirectDomain) == []
