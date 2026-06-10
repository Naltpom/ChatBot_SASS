// Page du bot partagé (global-setup) : onglets visibles, ajout d'une bulle
// dans l'onglet Arbre + enregistrement, zone de danger dans Sécurité
// (le bouton Supprimer est présent mais N'EST PAS cliqué).
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${state.botId}`)
  await expect(page.getByText('Bot partagé E2E').first()).toBeVisible()
})

test('les onglets du bot s\'affichent (mode arbre : pas d\'onglet Bot & IA)', async ({ page }) => {
  const tabs = page.locator('.tabs')
  for (const label of ['Stats', 'Arbre', 'Apparence', 'Sécurité', 'Intégration']) {
    await expect(tabs.getByRole('button', { name: label })).toBeVisible()
  }
  // Bot en mode arbre -> l'onglet « Bot & IA » n'a pas lieu d'être
  await expect(tabs.getByRole('button', { name: 'Bot & IA' })).toHaveCount(0)
})

test('onglet Arbre : ajouter une bulle puis enregistrer', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Arbre' }).click()
  await expect(page.getByText('Arbre de décision', { exact: true })).toBeVisible()

  // Ajout d'une bulle (choix racine) -> l'option apparaît dans le canvas
  await page.getByRole('button', { name: /Ajouter un choix racine/ }).click()
  await expect(page.getByRole('button', { name: /Nouveau choix/ }).first()).toBeVisible()

  // L'état devient « dirty » -> bouton Enregistrer dans l'en-tête
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('button', { name: /Enregistré/ })).toBeVisible()
})

test('onglet Sécurité : la zone de danger expose le bouton de suppression', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Sécurité' }).click()
  await expect(page.getByText('Zone de danger')).toBeVisible()
  // Présence seulement — on ne supprime PAS le bot partagé
  await expect(page.getByRole('button', { name: /Supprimer ce chatbot/ })).toBeVisible()
  await expect(page.getByText('Domaines autorisés').first()).toBeVisible()
})
