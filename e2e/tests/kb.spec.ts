// Base de connaissances RAG (parcours A) — onglet « Connaissances » (perm
// context). Bot DÉDIÉ mode tree, créé/supprimé par bot via l'API.
//
// MOCK_AI=false : l'ingestion et la recherche KB sont 100 % LOCALES (fastembed
// ONNX CPU, modèle déjà en cache dans le volume fastembed_cache) — AUCUN appel
// provider IA. Le widget n'est jamais ouvert. Le panneau « Tester la recherche »
// est exactement ce que search_docs exécute, sans crédit IA.
import { expect, test } from '@playwright/test'
import { authenticate, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()
let botId: number

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot KB E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${botId}?tab=kb`)
})

test('ingestion texte locale → ready → recherche hybride/fts → suppression', async ({ page }) => {
  // L'init paresseuse du modèle fastembed (chargement ONNX depuis le cache au
  // 1er embed du process API) + l'indexation peuvent dépasser le timeout global
  // de 45 s — l'attente interne « Prête » est à 180 s, on aligne le test.
  test.setTimeout(220_000)

  await page.locator('.tabs').getByRole('button', { name: 'Connaissances' }).click()
  await expect(page.getByText('Base de connaissances')).toBeVisible()

  // --- Ajout d'une source TEXTE ---
  // Seg « Texte libre » (dans une Card, hors Field → pas de piège label, mais
  // exact:true par prudence sur les sous-chaînes)
  await page.getByRole('button', { name: 'Texte libre', exact: true }).click()
  await page.getByLabel('Titre (optionnel)').fill('Doc E2E KB')
  await page.getByLabel('Contenu').fill(
    'Nos délais de livraison sont de 48 heures ouvrées en France métropolitaine. '
    + 'Les retours sont acceptés sous 30 jours à compter de la réception du colis. '
    + 'Notre service client est joignable du lundi au vendredi, de 9h à 18h.',
  )
  await page.getByRole('button', { name: /Ajouter la source/ }).click()

  // --- Statut pending → ready (polling auto KbPanel 4 s ; modèle en cache →
  // rapide, timeout généreux par sûreté) ---
  const row = page.locator('tr', { hasText: 'Doc E2E KB' })
  await expect(row.getByText('Prête')).toBeVisible({ timeout: 180_000 })
  // Au moins un extrait indexé (colonne Extraits = td.mono)
  await expect(row.locator('td.mono')).toContainText(/\d/)

  // --- Tester la recherche : badge hybride OU dégradée + ≥1 résultat ---
  await page.getByPlaceholder('ex. quels sont vos délais de livraison ?').fill('délais de livraison')
  await page.getByRole('button', { name: /Tester la recherche/ }).click()
  await expect(
    page.getByText(/hybride \(vecteurs|dégradée \(texte/),
  ).toBeVisible()
  await expect(page.locator('.num').first()).toBeVisible()

  // --- Suppression (window.confirm) ---
  page.on('dialog', d => d.accept())
  await row.getByRole('button', { name: 'Supprimer la source' }).click()
  await expect(page.locator('tr', { hasText: 'Doc E2E KB' })).toHaveCount(0)
})
