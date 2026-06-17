// Global teardown : purge en base TOUTES les données créées par la suite e2e,
// pour laisser la base aussi propre qu'avant le run (décision 2026-06-16 — on
// abandonne volontairement la réutilisation rapide de .state.json au profit
// d'une base toujours propre).
//
// Marqueur fiable : tous les comptes e2e utilisent le domaine d'email
// @e2e-chapote.fr (global-setup : e2e.setup.* / e2e.member.* ; register-perso :
// e2e.perso.*). On supprime donc :
//  - les organisations (équipes) préfixées « E2E » OU ayant au moins un membre
//    @e2e-chapote.fr (couvre « E2E Corp », « E2E Org … »). Note : un compte
//    perso ne crée plus d'org « Espace de … » — seuls les bots perso restent,
//    purgés par leur owner @e2e-chapote.fr ci-dessous.
//  - leurs bots (CASCADE FK → conversations/messages/leads/kb_*/tree_events/
//    insights_reports), memberships et invitations
//  - les utilisateurs @e2e-chapote.fr
// Le compte admin dev (ADMIN_EMAIL, superadmin, autre domaine) et toute donnée
// NON-e2e sont préservés.
//
// ⚠ Ordre de suppression imposé : les FK bots/memberships/invitations →
// organizations sont en NO ACTION (pas de cascade) ; seules les FK *→bots
// cascadent. On efface donc bots → memberships → invitations → organizations →
// users, le tout dans la transaction implicite du `psql -c`.
//
// Accès DB via `docker compose exec db psql` (même pattern que flushRedis du
// global-setup : aucune dépendance npm `pg`, credentials lus dans l'env du
// conteneur). Échec NON bloquant (le run reste vert ; avertissement loggé).
// .state.json est effacé (compte supprimé → invalide) pour forcer un setup frais.
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const STATE_PATH = path.join(__dirname, '.state.json')

// Une seule chaîne (transaction implicite du -c). Littéraux en quotes simples
// → le -c est entouré de quotes doubles côté shell (aucune quote double dans le SQL).
const SQL = [
  "CREATE TEMP TABLE _e2e_users ON COMMIT DROP AS",
  "  SELECT id FROM users WHERE email LIKE '%@e2e-chapote.fr';",
  "CREATE TEMP TABLE _e2e_orgs ON COMMIT DROP AS",
  "  SELECT id FROM organizations WHERE name LIKE 'E2E%'",
  "   OR id IN (SELECT organization_id FROM memberships WHERE user_id IN (SELECT id FROM _e2e_users));",
  "DELETE FROM bots        WHERE organization_id IN (SELECT id FROM _e2e_orgs);",
  // Bots PERSO (organization_id NULL) appartenant à un user e2e — sinon la FK
  // bots.owner_user_id (NO ACTION) bloquerait la suppression du user.
  "DELETE FROM bots        WHERE owner_user_id IN (SELECT id FROM _e2e_users);",
  "DELETE FROM memberships WHERE organization_id IN (SELECT id FROM _e2e_orgs) OR user_id IN (SELECT id FROM _e2e_users);",
  "DELETE FROM invitations WHERE organization_id IN (SELECT id FROM _e2e_orgs);",
  "DELETE FROM organizations WHERE id IN (SELECT id FROM _e2e_orgs);",
  "DELETE FROM users       WHERE id IN (SELECT id FROM _e2e_users);",
].join(' ')

export default async function globalTeardown() {
  try {
    execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'db', 'sh', '-c',
        `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "${SQL}"`],
      { cwd: path.join(__dirname, '..'), stdio: 'pipe', timeout: 30_000 },
    )
    console.log('[e2e] Teardown — données e2e (@e2e-chapote.fr / orgs « E2E ») purgées de la base.')
  } catch {
    console.warn(
      '[e2e] Teardown : purge DB impossible (docker indisponible ?) — '
      + 'données e2e laissées en base ; `docker compose down -v` pour réinitialiser.',
    )
  }
  try {
    if (fs.existsSync(STATE_PATH)) fs.rmSync(STATE_PATH)
  } catch { /* non bloquant */ }
}
