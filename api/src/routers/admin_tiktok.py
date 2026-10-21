"""Back-office : vue LECTURE SEULE du module TikTok (/admin/tiktok).

Nombre de comptes connectés et de publications par tenant. Aucun jeton, aucun
open_id, aucune action : l'usage du module se fait dans l'Espace client, par
chaque client, sur ses propres comptes.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import require_superadmin
from src.core.time import utcnow
from src.models.tiktok import POST_COMPLETE, POST_FAILED, POST_INBOX, TikTokAccount, TikTokPost
from src.models.user import Organization, User
from src.services import tiktok_service as tt

router = APIRouter(prefix="/api/admin/tiktok", tags=["admin-tiktok"],
                   dependencies=[Depends(require_superadmin)])


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)):
    since = utcnow() - timedelta(days=30)
    accounts = (await db.execute(
        select(TikTokAccount.organization_id, TikTokAccount.owner_user_id, TikTokAccount.needs_reconnect)
        .where(TikTokAccount.revoked_at.is_(None))
    )).all()
    posts = (await db.execute(
        select(TikTokPost.organization_id, TikTokPost.owner_user_id, TikTokPost.status)
        .where(TikTokPost.created_at >= since)
    )).all()

    rows: dict[tuple, dict] = {}

    def row(org_id, user_id):
        key = (org_id, user_id)
        if key not in rows:
            rows[key] = {"organization_id": org_id, "owner_user_id": user_id, "accounts": 0,
                         "needs_reconnect": 0, "posts_30d": 0, "published_30d": 0, "failed_30d": 0}
        return rows[key]

    for org_id, user_id, reconnect in accounts:
        r = row(org_id, user_id)
        r["accounts"] += 1
        r["needs_reconnect"] += int(bool(reconnect))
    for org_id, user_id, st in posts:
        r = row(org_id, user_id)
        r["posts_30d"] += 1
        r["published_30d"] += int(st in (POST_COMPLETE, POST_INBOX))
        r["failed_30d"] += int(st == POST_FAILED)

    org_ids = {k[0] for k in rows if k[0]}
    user_ids = {k[1] for k in rows if k[1]}
    orgs = {o.id: o.name for o in (await db.execute(
        select(Organization).where(Organization.id.in_(org_ids)))).scalars()} if org_ids else {}
    users = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    out = []
    for r in rows.values():
        if r["organization_id"]:
            r["tenant"] = orgs.get(r["organization_id"]) or f"Organisation #{r['organization_id']}"
            r["kind"] = "team"
        else:
            u = users.get(r["owner_user_id"])
            r["tenant"] = f"{u.name} ({u.email})" if u else f"Utilisateur #{r['owner_user_id']}"
            r["kind"] = "personal"
        out.append(r)
    out.sort(key=lambda r: (-r["accounts"], r["tenant"]))
    return {
        "enabled": tt.is_enabled(),
        "total_accounts": sum(r["accounts"] for r in out),
        "total_posts_30d": sum(r["posts_30d"] for r in out),
        "tenants": out,
    }
