// Landing publique : hero + section tarifs visibles, CTA vers /register.
// Sans auth — l'auto-login dev est neutralisé pour rester déconnecté.
import { expect, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

test.beforeEach(async ({ page }) => {
  await blockAutoLogin(page)
})

test('la landing affiche le hero et les tarifs, le CTA mène à /register', async ({ page }) => {
  await page.goto('/')

  // Hero
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Un chatbot qui')
  await expect(page.getByRole('link', { name: /Créer mon chatbot/ }).first()).toBeVisible()

  // Section tarifs : les 3 plans payants de la landing
  const tarifs = page.locator('#tarifs')
  await expect(tarifs.getByRole('heading', { name: /Prévisible/ })).toBeVisible()
  for (const plan of ['Starter', 'Pro', 'Agence']) {
    await expect(tarifs.getByText(plan, { exact: true })).toBeVisible()
  }
  await expect(tarifs.getByText('19 €', { exact: true })).toBeVisible()

  // Déconnecté : la nav propose la création de compte
  await expect(page.getByRole('link', { name: 'Créer mon compte' })).toBeVisible()

  // CTA hero -> inscription
  await page.getByRole('link', { name: /Créer mon chatbot/ }).first().click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Créez votre compte' })).toBeVisible()
})
