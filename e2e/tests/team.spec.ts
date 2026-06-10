// Page Équipe & permissions (org entreprise du global-setup) : inviter un
// email sans compte -> la ligne « invitation en attente » apparaît.
// (POST /orgs/{id}/members n'est pas concerné par le rate-limit auth.)
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
})

test('inviter un email sans compte crée une invitation en attente', async ({ page }) => {
  const email = `invite.${Date.now()}@e2e-kertios.fr`

  await page.goto('/app/team')
  await expect(page.getByText('Équipe & permissions')).toBeVisible()
  await expect(page.getByText("Inviter quelqu'un")).toBeVisible()

  await page.getByPlaceholder('collegue@entreprise.fr').fill(email)
  await page.getByRole('button', { name: /Envoyer l'invitation/ }).click()

  // Confirmation + ligne d'invitation en attente avec l'email invité
  await expect(page.getByText(`Invitation enregistrée : ${email}`)).toBeVisible()
  const row = page.locator('.member-row', { hasText: email })
  await expect(row).toBeVisible()
  await expect(row.getByText('invitation en attente')).toBeVisible()
})
