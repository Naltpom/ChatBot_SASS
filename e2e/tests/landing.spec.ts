// Landing publique « Chapote » : hero + comparatif + installation visibles,
// CTA vers /register. Sans auth — l'auto-login dev est neutralisé.
import { expect, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

test.beforeEach(async ({ page }) => {
  await blockAutoLogin(page)
})

test('la landing Chapote affiche hero/comparatif/installation, le CTA mène à /register', async ({ page }) => {
  await page.goto('/')

  // Hero
  await expect(page.getByRole('heading', { level: 1 })).toContainText('hybride français')
  await expect(page.getByRole('link', { name: /Démarrer maintenant/ })).toBeVisible()

  // Comparatif (design : pas de cartes tarifs, « Tarifs » renvoie à l'installation)
  await expect(page.locator('#why').getByRole('heading', { name: /Ni Intercom/ })).toBeVisible()
  await expect(page.locator('#why').getByText('ILLIMITÉ', { exact: true })).toBeVisible()

  // Installation : snippet copiable
  const install = page.locator('#install')
  await expect(install.getByRole('heading', { name: /Une minute/ })).toBeVisible()
  await expect(install.getByRole('button', { name: 'Copier' })).toBeVisible()

  // Déconnecté : la nav propose connexion + installation
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()

  // CTA hero -> inscription
  await page.getByRole('link', { name: /Démarrer maintenant/ }).click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Créez votre compte' })).toBeVisible()
})
