// Landing publique « Chapote » : hero + comparatif + installation + tarifs
// visibles, CTA vers /register. Sans auth — l'auto-login dev est neutralisé.
import { expect, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

test.beforeEach(async ({ page }) => {
  await blockAutoLogin(page)
})

test('la landing Chapote affiche hero/comparatif/installation/tarifs, le CTA mène à /register', async ({ page }) => {
  await page.goto('/')

  // Hero « Aiguillage »
  const h1 = page.getByRole('heading', { level: 1 })
  await expect(h1).toContainText('Une question.')
  await expect(h1).toContainText('d’y répondre.')
  const heroCta = page.locator('main').getByRole('link', { name: 'Installer la balise →' }).first()
  await expect(heroCta).toBeVisible()

  // Comparatif (tableau sans icônes)
  const cmp = page.locator('#comparatif')
  await expect(cmp.getByRole('heading', { name: /Ni Intercom/ })).toBeVisible()
  await expect(cmp.getByText('Illimité, sans surcoût')).toBeVisible()

  // Installation : snippet copiable
  const install = page.locator('#install')
  await expect(install.getByRole('heading', { name: /Collez une ligne/ })).toBeVisible()
  await expect(install.getByRole('button', { name: 'Copier' })).toBeVisible()

  // Tarifs : carte avec le socle
  await expect(page.locator('#tarifs').getByText('Bot en arbre')).toBeVisible()

  // Déconnecté : la nav propose connexion + installation
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()

  // CTA hero -> inscription
  await page.goto('/')
  await heroCta.click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Créez votre compte' })).toBeVisible()
})
