// Déclencheurs proactifs (parcours D) — onglet « Apparence » (perm appearance).
// Bot DÉDIÉ mode tree, créé/supprimé par l'API.
//
// MOCK_AI=false : aucun chemin IA (édition d'apparence pure). Anti-flaky : on
// n'exerce JAMAIS le déclenchement temporisé côté navigateur ; on vérifie la
// sanitisation du trigger via GET /api/widget/bootstrap (assertion API).
import { expect, test } from '@playwright/test'
import { authenticate, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()
let botId: number
let publicKey: string

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot Triggers E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
  publicKey = bot.publicKey
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${botId}?tab=appearance`)
})

test('éditeur triggers : hints FR + types + save → bootstrap sanitisé', async ({ page, request }) => {
  await page.locator('.tabs').getByRole('button', { name: 'Apparence' }).click()
  await expect(page.getByText('Apparence du widget')).toBeVisible()

  // Les déclencheurs vivent dans le sous-onglet « Conversation » de l'apparence.
  await page.getByRole('button', { name: 'Conversation', exact: true }).click()
  // La carte « Déclencheurs proactifs » contient l'éditeur ; on scope dedans
  // pour éviter la collision « Message » avec « Message d'accueil (mode IA) »
  // d'AppearanceForm (getByLabel = sous-chaîne).
  const card = page.locator('.card', { hasText: 'Déclencheurs proactifs' })

  // --- Ajout d'un trigger (défaut : time_on_page value=30, message='') ---
  await card.getByRole('button', { name: /Ajouter un déclencheur/ }).click()

  // Hint message vide (le message initial est '')
  await expect(card.getByText('Message requis (1 à 300 caractères)')).toBeVisible()

  // Hint value : on vide « Après (secondes) »
  await page.getByLabel('Après (secondes)').fill('')
  await expect(card.getByText('Valeur requise (1-600)')).toBeVisible()

  // --- Type scroll_depth → champ % ---
  await card.locator('select').first().selectOption('scroll_depth')
  await expect(page.getByLabel('À partir de (% de page)')).toBeVisible()

  // --- Type exit_intent → mention mobile ---
  await card.locator('select').first().selectOption('exit_intent')
  await expect(card.getByText(/Désactivé sur mobile/)).toBeVisible()

  // --- Revenir time_on_page, renseigner value + message ---
  await card.locator('select').first().selectOption('time_on_page')
  await page.getByLabel('Après (secondes)').fill('30')
  // Le seul <textarea> de la carte = le champ Message du trigger
  await card.locator('textarea').fill('Besoin d aide ?')
  await expect(card.getByText('Message requis (1 à 300 caractères)')).toHaveCount(0)

  // --- Save (bouton unique « Enregistrer » dans la save bar role=status) ---
  await page.getByRole('status').getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Enregistré')

  // --- Assert API : bootstrap expose le trigger sanitisé ---
  const res = await request.get(`${state.apiUrl}/api/widget/bootstrap?key=${publicKey}`, {
    headers: { Origin: 'http://localhost:3001' },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(Array.isArray(body.triggers)).toBeTruthy()
  expect(body.triggers).toHaveLength(1)
  const tr = body.triggers[0]
  expect(tr.type).toBe('time_on_page')
  expect(tr.value).toBe(30)
  expect(tr.message).toBe('Besoin d aide ?')
  expect(tr.once_per_session).toBe(true)
})
