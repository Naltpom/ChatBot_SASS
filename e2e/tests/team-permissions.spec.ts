// Matrice « Permissions par bot » (parcours H) — le member « Membre E2E »
// vient du GLOBAL-SETUP (zéro register ici), ses permissions sont remises à {}
// à chaque run. team.spec.ts (invitation) reste intouché.
import { expect, test } from '@playwright/test'
import { authenticate, authenticateWithToken, createOrg, loadState } from '../helpers'

const state = loadState()

test('état vide : section toujours rendue, avec la légende des 5 permissions', async ({ page, request }) => {
  // Org entreprise fraîche : un seul membre (l'admin créateur) → état vide
  const org = await createOrg(request, state, `E2E Team ${Date.now()}`, 'entreprise')
  await authenticateWithToken(page, state.token, org.id)
  await page.goto('/app/team')

  await expect(page.getByText('Équipe & permissions')).toBeVisible()
  // La section est TOUJOURS rendue, même sans membre au rôle « member »
  await expect(page.getByText('Permissions par bot', { exact: true })).toBeVisible()

  const emptyCard = page.locator('.card', { hasText: 'Aucun membre avec permissions fines' })
  await expect(emptyCard.getByText("Aucun membre avec permissions fines pour l'instant")).toBeVisible()
  for (const label of ['Copier le script', 'Tester', 'Apparence', 'Contexte (arbre + IA)', 'Sécurité']) {
    await expect(emptyCard.getByText(label, { exact: true })).toBeVisible()
  }
})

test('toggle d\'une permission : PATCH optimiste persisté après reload', async ({ page }) => {
  // Org du state : « Membre E2E » (global-setup) est l'unique member → il est
  // sélectionné par défaut dans la matrice.
  await authenticate(page, state)
  await page.goto('/app/team')

  // D'autres bots dédiés du run peuvent peupler la matrice → scoper par nom
  const row = page.locator('table.perm-matrix tr', { hasText: 'Bot partagé E2E' })
  const cell = row.locator('button.perm-check').first() // 1re colonne (ordre PERMS : copy)
  await expect(cell).toBeVisible()

  // Toggle-depuis-l'état-courant : idempotent même en retry
  const was = await cell.getAttribute('aria-pressed')
  const target = String(was !== 'true')

  const patched = page.waitForResponse(r =>
    r.url().includes(`/api/orgs/${state.orgId}/members/`)
    && r.request().method() === 'PATCH' && r.ok())
  await cell.click()
  await patched
  await expect(cell).toHaveAttribute('aria-pressed', target)

  // Persistance : après reload, la valeur basculée est toujours là
  await page.reload()
  const cellAfter = page.locator('table.perm-matrix tr', { hasText: 'Bot partagé E2E' })
    .locator('button.perm-check').first()
  await expect(cellAfter).toHaveAttribute('aria-pressed', target)
})
