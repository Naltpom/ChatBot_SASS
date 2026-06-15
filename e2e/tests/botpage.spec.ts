// Éditeur de bot (refonte Chapote) — onglets visibles selon le mode, et
// l'onglet Arbre (TreeFlow) : ajout d'une branche + enregistrement via la
// save bar, puis vérification de la persistance après reload.
// Bot DÉDIÉ jetable (createBot, mode arbre) → deleteBot en afterAll : aucune
// interférence avec le bot partagé / les autres specs.
import { expect, test } from '@playwright/test'
import { authenticate, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()

let botId = 0
let publicKey = ''

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: 'E2E BotPage' })
  botId = bot.id
  publicKey = bot.publicKey
})

test.afterAll(async ({ request }) => {
  await deleteBot(request, state, botId)
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${botId}`)
  // Éditeur chargé : on attend la barre d'onglets (le nom du bot apparaît à
  // plusieurs endroits — header + AppearanceForm — donc input[value] serait ambigu).
  await expect(page.locator('.tabs').getByRole('button', { name: 'Apparence', exact: true })).toBeVisible()
})

test('les 7 onglets de l\'éditeur en mode arbre (IA et Actions masqués)', async ({ page }) => {
  const tabs = page.locator('.tabs')
  // Bot mode arbre sur un plan non tree_only → aiTabRelevant=false : les
  // onglets « IA » et « Actions » n'ont pas lieu d'être.
  for (const label of ['Apparence', 'Arbre', 'Humain', 'Intégration', 'Sécurité']) {
    await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await expect(tabs.getByRole('button', { name: 'IA', exact: true })).toHaveCount(0)
  await expect(tabs.getByRole('button', { name: 'Actions', exact: true })).toHaveCount(0)
})

test('onglet Arbre : ajouter une branche, voir le flowchart, enregistrer puis persister', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Arbre', exact: true }).click()

  // Carte éditeur de TreeFlow présente (racine + bouton d'ajout)
  await expect(page.getByText('Arbre de conversation', { exact: true })).toBeVisible()
  await expect(page.getByText("Message d'accueil")).toBeVisible()

  // Ajout d'une branche -> une ligne d'édition apparaît (input « Réponse »
  // pré-rempli « Nouvelle réponse ») et la branche se reflète dans le canvas.
  await page.getByRole('button', { name: '+ Branche' }).click()
  const answerInput = page.locator('input[placeholder="Réponse"]').last()
  await expect(answerInput).toBeVisible()
  await answerInput.fill('Choix E2E')
  // La destination du nœud cible (placeholder « Destination »)
  const destInput = page.locator('input[placeholder="Destination"]').last()
  await destInput.fill('Réponse E2E')

  // Le flowchart reflète la nouvelle branche (pastille de réponse dans le canvas)
  await expect(page.getByText('Choix E2E').first()).toBeVisible()

  // L'état devient dirty -> la save bar sombre (role=status) apparaît
  const bar = page.getByRole('status')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Modifications non enregistrées')

  // Enregistrement via le bouton « Enregistrer » de la save bar
  await bar.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(bar).toContainText('Enregistré')

  // Persistance serveur : après reload, la branche est toujours là
  await page.reload()
  await page.locator('.tabs').getByRole('button', { name: 'Arbre', exact: true }).click()
  await expect(page.locator('input[value="Choix E2E"]')).toBeVisible()
})

test('onglet Sécurité : la zone de danger expose le bouton de suppression', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Sécurité', exact: true }).click()
  await expect(page.getByText('Domaines autorisés').first()).toBeVisible()
  await expect(page.getByText('Zone de danger')).toBeVisible()
  // Présence seulement — la suppression réelle est gérée par deleteBot (afterAll)
  await expect(page.getByRole('button', { name: /Supprimer ce chatbot/ })).toBeVisible()
})
