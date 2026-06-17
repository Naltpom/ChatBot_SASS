// Base de connaissances RAG — refonte Chapote. La KB n'est PLUS un onglet
// « Connaissances » dédié : KbPanel vit désormais dans l'onglet « IA » de
// l'éditeur de bot (BotPage.tsx, section « Base de connaissances »). L'onglet
// IA n'est rendu que si l'IA est pertinente (bot.mode !== 'tree') → bot DÉDIÉ
// en mode hybrid, créé/supprimé via l'API.
//
// MOCK_AI=false : l'ingestion et la recherche KB sont 100 % LOCALES (fastembed
// ONNX CPU) — AUCUN appel provider IA. Le widget n'est jamais ouvert. Le
// panneau « Tester la recherche » est exactement ce que search_docs exécute,
// sans crédit IA.
//
// ATTENTION timing : après un reset DB, le cache fastembed est vide → le 1er
// embed télécharge le modèle (~240 Mo) puis le charge en ONNX CPU. La 1re
// source peut donc rester « Indexation… » plusieurs minutes — d'où le timeout
// généreux ci-dessous (l'attente interne « Prête » est à 180 s, on aligne).
import { expect, test } from '@playwright/test'
import { authenticate, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()
let botId: number

test.beforeAll(async ({ request }) => {
  // mode hybrid : REQUIS pour que l'onglet « IA » (qui héberge KbPanel) soit
  // rendu. Aucun chemin IA n'est exercé (widget jamais ouvert).
  const bot = await createBot(request, state, { name: `Bot KB E2E ${Date.now()}`, mode: 'hybrid' })
  botId = bot.id
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  // L'onglet IA dépend de aiTabRelevant (bot.mode !== 'tree'). On attend la
  // réponse du bot (GET /api/bots/{id}) — son arrivée monte/rerender les onglets
  // — pour ne pas cliquer pendant le re-render.
  const botSeen = page.waitForResponse(
    r => new RegExp(`/api/bots/${botId}(\\?|$)`).test(r.url()) && r.request().method() === 'GET',
  )
  await page.goto(`/app/bots/${botId}?tab=ai`)
  await botSeen
})

test('onglet IA → ajout source texte → Prête → recherche hybride/fts → suppression', async ({ page }) => {
  // Init paresseuse du modèle fastembed (chargement ONNX au 1er embed du
  // process API) + indexation : peut dépasser largement le timeout global.
  // L'attente interne « Prête » est à 180 s, on aligne le test (+ marge réseau).
  test.setTimeout(220_000)

  // Onglet IA (héberge la section « Base de connaissances »)
  await page.locator('.tabs').getByRole('button', { name: 'IA', exact: true }).click()
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

  // --- Statut pending → ready (polling auto KbPanel 4 s ; 1er embed = download
  // + chargement ONNX, timeout généreux) ---
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
