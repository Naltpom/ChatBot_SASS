"""Journal d'accès d'uvicorn : aucun paramètre d'URL écrit (codes OAuth, liens signés, jetons)."""
import logging

from src.main import _MasqueCles


def _record(path: str) -> logging.LogRecord:
    return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                             ("1.2.3.4:5", "GET", path, "1.1", 200), None)


def test_query_string_dropped():
    r = _record("/api/cm/drive/callback?code=4/SECRET&state=abc")
    _MasqueCles().filter(r)
    assert r.args[2] == "/api/cm/drive/callback?…" and "SECRET" not in r.getMessage()
    r = _record("/api/cm/posts")
    _MasqueCles().filter(r)
    assert r.args[2] == "/api/cm/posts"
