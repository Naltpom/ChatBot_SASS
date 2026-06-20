// Test A/B de l'arbre (parcours F) — onglet « Arbre » (perm context). Bot
// DÉDIÉ mode tree (createBot pose un STARTER_TREE serveur par défaut),
// créé/supprimé par l'API.
//
// Refonte charte Chapote : l'éditeur d'arbre est le composant partagé
// TreeFlow.tsx (carte « Arbre de conversation »), monté UNE SEULE FOIS (vue A
// OU vue B) ; le bloc « Test A/B de l'arbre » (Activer/Désactiver la variante,
// chip « A/B actif », slider de répartition) vit au-dessus dans l'onglet Arbre.
// Libellés lus dans app/src/pages/BotPage.tsx et components/TreeFlow.tsx.
//
// MOCK_AI=false : aucun chemin IA (édition d'arbre + variante en mode tree).
// Plus aucune notion de plan : la variante n'est jamais bloquée (pas de
// 403/422). On assert l'effet via l'API.
import { expect, test } from '@playwright/test'
import { authHeaders, authenticate, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()
let botId: number

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot AB E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

test.beforeEach(async ({ page }) => {
  // window.confirm de « Désactiver la variante B » : accepté d'office.
  page.on('dialog', d => d.accept())
  await authenticate(page, state)
  // On attend la réponse du bot (GET /api/bots/{id}) avant d'agir : son arrivée
  // monte/rerender l'onglet Arbre. Sans cette attente, un clic « Activer » peut
  // tomber pendant le re-render et être avalé (flake observé : le chip « A/B
  // actif » n'apparaît jamais). Le toPass ci-dessous reste la garde principale.
  const botSeen = page.waitForResponse(
    r => new RegExp(`/api/bots/${botId}(\\?|$)`).test(r.url()) && r.request().method() === 'GET',
  )
  await page.goto(`/app/bots/${botId}?tab=tree`)
  await botSeen
})

test('activer variante B + split → assert API non-null → désactiver → assert API null/0', async ({ page, request }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Arbre' }).click()

  // UN SEUL TreeFlow monté (contrat strict mode) : vue A. La carte éditeur
  // porte le titre « Arbre de conversation » (h3), unique par vue. Ce titre vit
  // dans le wrapper TOUJOURS monté (hors du chunk lazy @xyflow).
  await expect(page.getByText('Arbre de conversation', { exact: true })).toHaveCount(1)
  // Attendre que le canvas LAZY (chunk dynamique) soit chargé avant de toucher au
  // bloc A/B : son montage re-render l'onglet Arbre et pourrait avaler un clic.
  // (Le bouton « Réorganiser » de la barre d'outils est rendu par le canvas.)
  await expect(page.getByRole('button', { name: 'Réorganiser' })).toBeVisible()

  // --- Activer la variante B ---
  // Clic + assert du chip enveloppés dans un retry (toPass) : le re-render de
  // l'onglet Arbre peut survenir juste à l'instant du clic et l'avaler — on
  // re-tente l'activation tant que le chip « A/B actif » n'est pas monté.
  const activate = page.getByRole('button', { name: 'Activer une variante B' })
  await expect(async () => {
    if (await activate.isVisible()) await activate.click()
    await expect(page.getByText('A/B actif')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  // Toujours un seul TreeFlow (vue B après activation)
  await expect(page.getByText('Arbre de conversation', { exact: true })).toHaveCount(1)

  // --- Régler le split à 40 % (input[type=range], unique sur l'onglet) ---
  const slider = page.locator('input[type="range"]')
  await slider.fill('40')

  // --- Save (save bar SOMBRE, role=status) ---
  const bar = page.getByRole('status')
  await bar.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(bar).toContainText('Enregistré')

  // --- Assert API : variante posée + split 40 ---
  const b1 = await (await request.get(`${state.apiUrl}/api/bots/${botId}`, { headers: authHeaders(state.token) })).json()
  expect(b1.tree_variant_json).not.toBeNull()
  expect(b1.ab_split_pct).toBe(40)

  // --- Désactiver la variante B (window.confirm accepté) ---
  // Même garde anti-race que l'activation : on re-tente tant que le bouton
  // « Activer » n'est pas revenu (preuve que la variante est null en local).
  const deactivate = page.getByRole('button', { name: 'Désactiver la variante B' })
  await expect(async () => {
    if (await deactivate.isVisible()) await deactivate.click()
    await expect(page.getByRole('button', { name: 'Activer une variante B' })).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })

  // --- Save à nouveau ---
  const bar2 = page.getByRole('status')
  await bar2.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(bar2).toContainText('Enregistré')

  // --- Assert API : variante null + split 0 ---
  const b2 = await (await request.get(`${state.apiUrl}/api/bots/${botId}`, { headers: authHeaders(state.token) })).json()
  expect(b2.tree_variant_json).toBeNull()
  expect(b2.ab_split_pct).toBe(0)
})
