"""Bibliothèque « comme dans le Drive » : sous-dossiers d'un dossier relié, vidéos d'un sous-dossier,
et, quand l'espace affiché est vide, les autres espaces de la personne qui ont des vidéos."""
import pytest

from src.models.cm import CmAsset, CmSource

from test_cm import cmenv  # noqa: F401  (fixture)
from test_tiktok import Client, _org, _user, tiktok  # noqa: F401  (fixture)


@pytest.mark.real_db
@pytest.mark.asyncio
async def test_folders_tree_and_elsewhere(pg_session, cmenv, tiktok):
    a = await _user(pg_session, "alice@t.dev")
    b = await _user(pg_session, "bob@t.dev")
    org = await _org(pg_session, a)
    src = CmSource(organization_id=org.id, created_by_user_id=a.id, folder_id="fo", provider="gdrive", name="Équipe")
    bob = CmSource(owner_user_id=b.id, created_by_user_id=b.id, folder_id="fb", provider="gdrive", name="bob")
    pg_session.add_all([src, bob])
    await pg_session.flush()
    for i, path in enumerate([None, "Piano", "Piano/Lent", "Piano/Lent", "Guitare", "Publié"]):
        pg_session.add(CmAsset(source_id=src.id, file_id=f"f{i}", name=f"v{i}.mp4", folder_path=path, size=1))
    pg_session.add(CmAsset(source_id=bob.id, file_id="fb1", name="b.mp4", size=1))
    await pg_session.commit()
    async with Client(pg_session) as c:
        root = (await c.as_(a).get(f"/api/cm/sources/{src.id}/folders?org_id={org.id}")).json()
        assert root["videos"] == 1
        assert [(f["name"], f["videos"]) for f in root["folders"]] == [("Guitare", 1), ("Piano", 3), ("Publié", 1)]
        piano = (await c.as_(a).get(f"/api/cm/sources/{src.id}/folders?org_id={org.id}&path=Piano")).json()
        assert piano["videos"] == 1 and piano["folders"] == [{"name": "Lent", "path": "Piano/Lent", "videos": 2}]
        lent = (await c.as_(a).get(f"/api/cm/assets?org_id={org.id}&source_id={src.id}&folder=Piano/Lent")).json()
        assert len(lent) == 2
        top = (await c.as_(a).get(f"/api/cm/assets?org_id={org.id}&source_id={src.id}&folder=")).json()
        assert [x["name"] for x in top] == ["v0.mp4"]
        # Espace perso vide : on montre l'espace d'équipe où sont les vidéos (jamais ceux des autres).
        assert (await c.as_(a).get("/api/cm/assets")).json() == []
        assert (await c.as_(a).get("/api/cm/library/elsewhere")).json() == [{"org_id": org.id, "folders": 1, "videos": 6}]
        assert (await c.as_(b).get(f"/api/cm/sources/{src.id}/folders")).status_code == 404
        assert (await c.as_(b).get("/api/cm/library/elsewhere")).json() == []
