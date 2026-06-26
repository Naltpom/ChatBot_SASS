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

test('les onglets de l\'éditeur en mode arbre (Actions masqué, IA visible)', async ({ page }) => {
  const tabs = page.locator('.tabs')
  // Bot en mode arbre : l'onglet « IA » reste visible (la config IA est
  // accessible), seul « Actions » est masqué (aiTabRelevant=false).
  for (const label of ['Apparence', 'Arbre', 'IA', 'Humain', 'Intégration', 'Sécurité']) {
    await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await expect(tabs.getByRole('button', { name: 'Actions', exact: true })).toHaveCount(0)
})

test('onglet Arbre : ajouter une branche, l\'éditer via l\'inspecteur, enregistrer puis persister', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Arbre', exact: true }).click()

  // Éditeur React Flow chargé en LAZY (chunk dynamique @xyflow) : le titre <h3>
  // « Arbre de conversation » vit dans le wrapper (toujours monté), mais le canvas
  // (nœud d'accueil, barre d'outils) n'apparaît qu'après le chargement du chunk.
  await expect(page.getByText('Arbre de conversation', { exact: true })).toBeVisible()
  // Carte du nœud d'accueil (« 🌿 Message d'accueil ») rendue par le canvas.
  const rootNode = page.locator('[data-testid="tree-node"]').filter({ hasText: "Message d'accueil" })
  await expect(rootNode).toBeVisible()

  // Ajout d'une branche via l'inspecteur (le bouton « + Branche » de la barre
  // d'outils a été retiré : on ajoute depuis un nœud sélectionné, ou par drag de
  // poignée). Sélectionner le nœud d'accueil -> « + Ajouter une réponse » crée
  // une arête {label:'Réponse'} + un nœud cible {message:'Destination'}.
  await rootNode.click()
  const addResp = page.getByRole('button', { name: '+ Ajouter une réponse' })
  await expect(addResp).toBeVisible()
  await addResp.click()

  // 1) Sélectionner l'ARÊTE créée (clic sur son label « Réponse », unique dans le
  //    canvas — l'arbre de départ n'utilise jamais ce libellé) -> l'inspecteur
  //    d'arête affiche l'input « Intitulé du bouton ». On y écrit « Choix E2E ».
  const newEdgeLabel = page.locator('[data-testid="tree-edge-label"]').filter({ hasText: 'Réponse' })
  await expect(newEdgeLabel).toBeVisible()
  await newEdgeLabel.click()
  const labelInput = page.locator('input[placeholder="Intitulé du bouton"]')
  await expect(labelInput).toBeVisible()
  await labelInput.fill('Choix E2E')

  // 2) Sélectionner le NŒUD cible (carte « Destination », unique) -> l'inspecteur
  //    de nœud affiche la <textarea> « Message affiché… ». On y écrit la réponse.
  const destNode = page.locator('[data-testid="tree-node"]').filter({ hasText: 'Destination' })
  await expect(destNode).toBeVisible()
  await destNode.click()
  const msgInput = page.locator('textarea[placeholder^="Message affiché"]')
  await expect(msgInput).toBeVisible()
  await msgInput.fill('Réponse E2E')

  // Le canvas reflète le nouvel intitulé de l'arête (label « Choix E2E » visible).
  await expect(page.locator('[data-testid="tree-edge-label"]').filter({ hasText: 'Choix E2E' })).toBeVisible()

  // L'état devient dirty -> la save bar sombre (role=status) apparaît
  const bar = page.getByRole('status')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Modifications non enregistrées')

  // Enregistrement via le bouton « Enregistrer » de la save bar
  await bar.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(bar).toContainText('Enregistré')

  // Persistance serveur : après reload, l'arête « Choix E2E » est toujours là.
  // React Flow ne re-sélectionne rien au montage -> on re-sélectionne l'arête
  // (clic sur son label « Choix E2E ») pour que l'inspecteur réaffiche l'input.
  await page.reload()
  await page.locator('.tabs').getByRole('button', { name: 'Arbre', exact: true }).click()
  const savedEdgeLabel = page.locator('[data-testid="tree-edge-label"]').filter({ hasText: 'Choix E2E' })
  await expect(savedEdgeLabel).toBeVisible()
  await savedEdgeLabel.click()
  await expect(page.locator('input[value="Choix E2E"]')).toBeVisible()
})

test('onglet Sécurité : domaines autorisés, limites de débit et captcha', async ({ page }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Sécurité', exact: true }).click()
  await expect(page.getByText('Domaines autorisés').first()).toBeVisible()
  await expect(page.getByText('Limites de débit')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Vérification anti-bot (captcha)' })).toBeVisible()
})
