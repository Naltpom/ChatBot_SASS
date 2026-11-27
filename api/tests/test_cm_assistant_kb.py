"""Base de connaissances de l'« Assistant Chapote CM » (scripts/cm_assistant/).

Garde-fous sur le CONTENU envoyé à l'IA :
- chaque réponse de la FAQ de la page d'accueil y figure mot pour mot (la page fait foi) ;
- aucune adresse e-mail, aucun mot « commentaire » (fonction non proposée) ;
- les faits clés sont présents ; les consignes tiennent dans la borne du system prompt.
"""
import re
from pathlib import Path

import pytest

from src.models.bot import MAX_SYSTEM_PROMPT_CHARS

API_DIR = Path(__file__).resolve().parents[1]
HERE = API_DIR / "scripts" / "cm_assistant"
LANDING = API_DIR.parent / "cm" / "src" / "pages" / "Landing.tsx"


def _norm(s: str) -> str:
    # Apostrophes typographiques de la page (’) = apostrophes droites de la base.
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip()


def _kb_text() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted((HERE / "kb").glob("*.md")))


def _sent_to_ai() -> str:
    return _kb_text() + "\n" + (HERE / "system_prompt.md").read_text(encoding="utf-8")


def test_faq_answers_are_verbatim():
    if not LANDING.exists():
        pytest.skip("cm/ absent (image api seule)")
    src = LANDING.read_text(encoding="utf-8")
    faq = re.search(r"const FAQ[^=]*=\s*\[(.*?)\n\]", src, re.S).group(1)
    pairs = re.findall(r"\['([^']+)',\s*'([^']+)'\]", faq)
    assert len(pairs) >= 6
    kb = _norm(_kb_text())
    for question, answer in pairs:
        assert _norm(question) in kb, question
        assert _norm(answer) in kb, question


def test_no_email_no_comments():
    text = _sent_to_ai()
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text), "aucune adresse e-mail vers l'IA"
    kb = _kb_text().lower()
    assert "commentaire" not in kb, "fonction commentaires désactivée : hors base"


def test_key_facts_present():
    kb = _norm(_kb_text()).lower()
    for fact in ("gratuit pendant la bêta", "google drive", "administrateur, éditeur ou lecteur",
                 "connexion officielle tiktok, google et meta", "https://cm.chapote.fr/avis"):
        assert fact in kb, fact


def test_system_prompt_bounds():
    prompt = (HERE / "system_prompt.md").read_text(encoding="utf-8")
    assert len(prompt) < MAX_SYSTEM_PROMPT_CHARS
    assert "vouvoy" in prompt and "https://cm.chapote.fr/avis" in prompt

