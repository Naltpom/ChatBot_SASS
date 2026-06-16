// Page « Mes organisations » (parcours B) — compte principal du state (NON
// superadmin → le bouton « Quitter » est visible). Orgs jetables préfixées
// « E2E » : pas de DELETE /orgs, accumulation en DB dev acceptée.
import { expect, test } from '@playwright/test'
import { authenticate, authenticateWithToken, createOrg, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
})

test('créer une org depuis la page → elle devient active dans le switcher', async ({ page }) => {
  const name = `E2E Org UI ${Date.now()}`

  await page.goto('/app/orgs')
  await expect(page.locator('.section-title')).toHaveText('Mes organisations')

  const card = page.locator('.card', { hasText: 'Créer une organisation' })
  await card.getByLabel('Nom').fill(name)
  // exact OBLIGATOIRE : le type (« Personnel ») apparaît dans les lignes d'org
  await card.getByRole('button', { name: 'Personnel', exact: true }).click()
  await card.getByRole('button', { name: "Créer l'organisation" }).click()

  // Création → navigation /app, cbsaas_org posé → l'org est active dans le switcher
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('.orgsw-btn .orgsw-name')).toHaveText(name)
})

test('renommer, convertir perso→entreprise, garde-fou « Quitter » (dernier admin)', async ({ page, request }) => {
  // Org jetable via API (indépendant du test précédent), activée via cbsaas_org
  const org = await createOrg(request, state, `E2E Org ${Date.now()}`, 'perso')
  await authenticateWithToken(page, state.token, org.id)
  // window.confirm sur la conversion ET sur « Quitter » : accepter d'office
  page.on('dialog', d => d.accept())

  await page.goto('/app/orgs')
  const row = page.locator('.member-row', { hasText: org.name })
  await expect(row.getByText('active', { exact: true })).toBeVisible()
  await expect(row.getByText('Admin', { exact: true })).toBeVisible()
  await expect(row).toContainText('Personnel')

  // --- Renommage ---
  // En mode renommage la ligne PERD le texte du nom (remplacé par l'input,
  // dont la value n'est pas du texte DOM) : re-scoper la ligne par son input
  // (une seule ligne à la fois est en renommage).
  await row.getByRole('button', { name: 'Renommer' }).click()
  const renamingRow = page.locator('.member-row', { has: page.locator('input') })
  await renamingRow.locator('input').fill(`${org.name} v2`)
  await renamingRow.getByRole('button', { name: 'Valider' }).click()
  const row2 = page.locator('.member-row', { hasText: `${org.name} v2` })
  await expect(row2).toBeVisible()

  // --- Conversion perso → entreprise (définitive : le bouton disparaît) ---
  await row2.getByRole('button', { name: 'Passer en entreprise' }).click()
  await expect(row2).toContainText('Entreprise')
  await expect(row2.getByRole('button', { name: 'Passer en entreprise' })).toHaveCount(0)

  // --- Quitter : 422 « dernier admin » affiché tel quel, ligne conservée ---
  await row2.getByRole('button', { name: 'Quitter' }).click()
  await expect(page.locator('div.error'))
    .toContainText("Impossible de quitter l'organisation : vous en êtes le dernier admin")
  await expect(row2).toBeVisible()
})
