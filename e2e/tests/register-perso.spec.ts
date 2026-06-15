// Inscription UI d'un compte Personnel — SEUL test qui consomme une
// inscription via l'UI (rate-limit auth : 10 login+register / 15 min / IP).
// Email unique à chaque exécution (timestamp epoch).
// Design Chapote (pages/Register.tsx) : carte centrée + stepper.
//   Étape 0 « Créez votre compte » : cartes Personnel / Entreprise.
//   Étape 1 (perso) : Prénom / Nom / E-mail professionnel / Mot de passe,
//     bouton « Créer mon compte ».
//   Étape succès : « Compte créé 🎉 » + « Configurer mon premier bot »
//     (/app/bots/new) ou « Plus tard, aller au tableau de bord » (/app).
import { expect, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

test.beforeEach(async ({ page }) => {
  await blockAutoLogin(page)
})

test('inscription compte Personnel : arrivée sur /app avec l\'org « Espace de … »', async ({ page }) => {
  // Le prénom devient le nom complet (Nom laissé vide) → org « Espace de <prénom> ».
  const prenom = 'Testeur'
  const email = `e2e.perso.${Date.now()}@e2e-chapote.fr`

  await page.goto('/register')

  // Étape 0 : titre + choix du type de compte -> carte Personnel
  await expect(page.getByRole('heading', { name: 'Créez votre compte' })).toBeVisible()
  await page.getByRole('button', { name: /Personnel/ }).click()

  // Étape 1 : informations (Nom volontairement laissé vide)
  await page.getByLabel(/Prénom/).fill(prenom)
  await page.getByLabel(/E-mail/).fill(email)
  await page.getByLabel(/Mot de passe/).fill('MotDePasseE2E-1')
  await page.getByRole('button', { name: /Créer mon compte/ }).click()

  // Étape succès : compte réellement créé + connecté
  await expect(page.getByRole('heading', { name: /Compte créé/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Configurer mon premier bot/ })).toBeVisible()

  // « Plus tard » -> tableau de bord
  await page.getByRole('button', { name: /Plus tard, aller au tableau de bord/ }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()

  // L'org perso « Espace de <prénom> » est visible dans le sélecteur d'org
  await expect(page.getByText(`Espace de ${prenom}`).first()).toBeVisible()
})
