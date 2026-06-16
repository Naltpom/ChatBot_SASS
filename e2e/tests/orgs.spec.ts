// Page « Mes équipes » (MyOrgs.tsx) — compte principal du state (NON
// superadmin → le bouton « Quitter » est visible). Nouveau modèle : une
// organisation = une ÉQUIPE (plus de type perso/entreprise ni de conversion).
// Équipes jetables préfixées « E2E » : pas de DELETE /orgs, accumulation en DB
// dev acceptée (purge par le global-teardown).
import { expect, test } from '@playwright/test'
import { authenticate, authenticateWithToken, createOrg, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
})

test('créer une équipe depuis la page → elle devient active dans le switcher', async ({ page }) => {
  const name = `E2E Org UI ${Date.now()}`

  await page.goto('/app/orgs')
  await expect(page.locator('.section-title')).toHaveText('Mes équipes')

  const card = page.locator('.card', { hasText: 'Créer une équipe' })
  await card.getByLabel("Nom de l'équipe").fill(name)
  await card.getByRole('button', { name: "Créer l'équipe" }).click()

  // Création → navigation /app/team, cbsaas_org posé → l'équipe est active
  // dans le switcher.
  await expect(page).toHaveURL(/\/app\/team$/)
  await expect(page.locator('.orgsw-btn .orgsw-name')).toHaveText(name)
})

test('renommer une équipe et garde-fou « Quitter » (dernier admin)', async ({ page, request }) => {
  // Équipe jetable via API (indépendante du test précédent), activée via cbsaas_org.
  const org = await createOrg(request, state, `E2E Org ${Date.now()}`)
  await authenticateWithToken(page, state.token, org.id)
  // window.confirm sur « Quitter » : accepter d'office.
  page.on('dialog', d => d.accept())

  await page.goto('/app/orgs')
  const row = page.locator('.member-row', { hasText: org.name })
  await expect(row.getByText('active', { exact: true })).toBeVisible()
  await expect(row.getByText('Admin', { exact: true })).toBeVisible()
  // Chaque ligne porte le libellé « Équipe » (plus de « Personnel »/« Entreprise »).
  await expect(row).toContainText('Équipe')

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

  // --- Quitter : 422 « dernier admin » affiché tel quel, ligne conservée ---
  await row2.getByRole('button', { name: 'Quitter' }).click()
  await expect(page.locator('div.error'))
    .toContainText("Impossible de quitter l'organisation : vous en êtes le dernier admin")
  await expect(row2).toBeVisible()
})
