// Inscription UI d'un compte Personnel — SEUL test qui consomme une
// inscription via l'UI (rate-limit auth : 10 login+register / 15 min / IP).
// Email unique à chaque exécution (timestamp epoch).
import { expect, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

test.beforeEach(async ({ page }) => {
  await blockAutoLogin(page)
})

test('inscription compte Personnel : arrivée sur /app avec l\'org « Espace de … »', async ({ page }) => {
  const prenom = 'Testeur'
  const email = `e2e.perso.${Date.now()}@e2e-chapote.fr`

  await page.goto('/register')

  // Étape 0 : type de compte -> Personnel
  await page.getByRole('button', { name: /Personnel/ }).click()

  // Étape 1 : informations
  await page.getByLabel(/Prénom/).fill(prenom)
  await page.getByLabel(/E-mail/).fill(email)
  await page.getByLabel(/Mot de passe/).fill('MotDePasseE2E-1')
  await page.getByRole('button', { name: /Créer mon compte/ }).click()

  // Étape succès
  await expect(page.getByRole('heading', { name: /Bienvenue/ })).toBeVisible()
  await expect(page.getByText('Votre espace personnel est prêt.')).toBeVisible()

  // Ouverture de l'application
  await page.getByRole('button', { name: /Ouvrir l'application/ }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()

  // L'org perso « Espace de <prénom> » est visible dans le sélecteur d'org
  await expect(page.getByText(`Espace de ${prenom}`)).toBeVisible()
})
