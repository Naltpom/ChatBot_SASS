// Split admin / user (parcours C) — le superadmin (dev-login, NON rate-limité)
// bascule entre l'espace client et le back-office ; un compte client qui force
// /admin est renvoyé vers /app par le Protected adminOnly.
import { expect, test } from '@playwright/test'
import { authenticate, authenticateWithToken, devLoginToken, loadState } from '../helpers'

const state = loadState()

test('superadmin : aller-retour Espace client ↔ Back-office (4 pages admin)', async ({ page, request }) => {
  const adminToken = await devLoginToken(request, state.apiUrl)
  await authenticateWithToken(page, adminToken) // sans cbsaas_org : pickActiveOrg choisit
  await page.goto('/app')

  // --- Bascule vers le back-office ---
  await page.getByRole('button', { name: 'Back-office' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.locator('.brand-sub')).toHaveText('Opérateur')

  // Dashboard opérateur chargé (GET /api/admin/stats). La facturation/les plans
  // ayant été supprimés, on n'assert plus de métrique « MRR » : seulement le
  // titre de section et un bloc non-billing toujours présent.
  await expect(page.getByText('Chargement…')).toHaveCount(0)
  await expect(page.locator('.section-title')).toHaveText('Dashboard')
  await expect(page.getByText('Inscriptions (6 mois)', { exact: true })).toBeVisible()

  // --- Clients : table opérateur ---
  await page.getByRole('button', { name: 'Clients', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/clients$/)
  await expect(page.getByRole('columnheader', { name: 'Client', exact: true })).toBeVisible()

  // (La page « Factures » a été supprimée avec la facturation : plus de bascule.)

  // --- Utilisateurs : lecture seule avec recherche ---
  await page.getByRole('button', { name: 'Utilisateurs', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByPlaceholder('Rechercher par nom ou email…')).toBeVisible()

  // --- Retour espace client ---
  await page.getByRole('button', { name: 'Espace client' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()
})

test('non-superadmin forcé sur /admin → redirigé vers /app, sans lien Back-office', async ({ page }) => {
  await authenticate(page, state) // compte client du state

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()

  // La nav client ne propose pas la bascule back-office
  await expect(page.getByRole('button', { name: 'Back-office' })).toHaveCount(0)
})
