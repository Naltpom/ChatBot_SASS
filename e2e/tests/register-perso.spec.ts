// Inscription UI d'un compte Personnel — SEUL test qui consomme une
// inscription via l'UI (rate-limit auth : 10 login+register / 15 min / IP).
// Email unique à chaque exécution (timestamp epoch).
//
// Nouveau modèle d'appartenance : un compte « Personnel » n'a PLUS d'org
// « Espace de … ». Il arrive sur /app sans aucune équipe (organizations vide)
// → l'OrgSwitcher du shell affiche l'encart « Espace perso / Aucune équipe »
// (Layout.tsx, orgs.length === 0). Le bot perso se crée via le wizard.
//
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

test('inscription compte Personnel : arrivée sur /app sans équipe (« Espace perso »)', async ({ page }) => {
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

  // Aucune équipe (organizations vide) : l'OrgSwitcher rend l'encart « Espace
  // perso / Aucune équipe » et JAMAIS d'org « Espace de … » (plus créée).
  await expect(page.locator('.orgsw-name')).toHaveText('Espace perso')
  await expect(page.locator('.orgsw-sub')).toHaveText('Aucune équipe')
  await expect(page.getByText(`Espace de ${prenom}`)).toHaveCount(0)
})
