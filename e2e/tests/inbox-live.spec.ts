// LOT 2 — Live chat (widget réel + staff) + CSAT remonté dans l'Inbox.
//
// Parcours B (handoff → take/reply/close → retour tree) + point C (CSAT sur une
// bulle assistant tree, vérifié dans le transcript Inbox), réunis en UN seul
// test déterministe (workers:1, deux pages d'un même context).
//
// RÈGLE MOCK_AI=false : bot 100 % tree (input masqué hors mode humain, aucun
// chemin IA). handoff = nœud d'arbre opt-in (aucun appel IA). reply staff =
// source 'human' (exclu de l'historique IA/quotas). Calendly non sollicité
// (HANDOFF_TREE ne porte aucun nœud appointment). Limiteurs par session :
// 1 handoff (cap 3/h), 1 feedback (cap 30/h), poll natif 2,5 s (cap 60/min) —
// très en deçà des plafonds.
import { expect, test } from '@playwright/test'
import { authHeaders, authenticate, deleteBot, loadState } from '../helpers'
import { createBot } from '../helpers'
import { HANDOFF_TREE, openFrame } from '../widget-helpers'

const state = loadState()

let bot: { id: number; publicKey: string }

test.beforeAll(async ({ request }) => {
  // Idempotent par nom de toute façon jetable : le tryReuse du global-setup
  // purge les bots id !== state.botId à chaque run, et createBot n'est pas
  // rate-limité. Nom unique = pas de collision même si un afterAll a sauté.
  bot = await createBot(request, state, {
    name: `Bot Live E2E ${Date.now()}`,
    mode: 'tree',
    tree: HANDOFF_TREE,
  })
})

test.afterAll(async ({ request }) => {
  if (bot) await deleteBot(request, state, bot.id)
})

test('handoff widget → Inbox take/reply/close → retour tree ; 409 ; CSAT', async ({ context, request }) => {
  const visitor = await context.newPage() // widget-frame : ne lit pas cbsaas_token
  const staff = await context.newPage()

  // ----- ÉTAPE WIDGET (visiteur) -----
  await openFrame(visitor, state, bot.publicKey)

  // Bootstrap : mode arbre + message d'accueil rendu (renderResponse du nœud
  // racine → bulle tree porteuse d'un message_id → ligne .kc-rate présente).
  await expect(visitor.locator('.kc-mode')).toHaveText('TREE')
  await expect(visitor.locator('.kc-row.bot .kc-msg').first()).toContainText('Comment puis-je aider')

  // CSAT (point C) sur la bulle d'accueil tree : 1 feedback, attente du 200.
  const rateBtn = visitor.locator('.kc-rate button').first()
  await expect(rateBtn).toBeVisible()
  const [fbResp] = await Promise.all([
    visitor.waitForResponse(r => r.url().includes('/api/widget/feedback') && r.request().method() === 'POST'),
    rateBtn.click(),
  ])
  expect(fbResp.status()).toBe(200)
  await expect(rateBtn).toHaveClass(/kc-on/)

  // Déclenche le handoff : clic de l'option vers le nœud handoff. renderResponse
  // rend l'intro puis enchaîne requestHandoff() (widget.js : resp.type==='handoff').
  await visitor.locator('.kc-opt', { hasText: 'Parler à un conseiller' }).click()

  // Mode LIVE + saisie active (input démasqué en mode humain même sur bot tree).
  await expect(visitor.locator('.kc-mode')).toHaveText('LIVE', { timeout: 15_000 })
  await expect(visitor.locator('.kc-inputrow')).toBeVisible()

  // ----- ÉTAPE INBOX (staff) -----
  await authenticate(staff, state)
  await staff.goto(`/app/bots/${bot.id}`)
  await staff.locator('.tabs').getByRole('button', { name: 'Inbox' }).click()

  // La conv remonte (refetch 5 s). Liste = .inbox-row (préfixes « Visiteur : »/
  // « Conseiller : » côté liste, distincts des headers transcript).
  const row = staff.locator('.inbox-row').first()
  await expect(row).toContainText('À prendre', { timeout: 15_000 })
  await row.click()

  // CSAT remonté côté staff (point C) : ThumbsUp (title) dans le transcript.
  await expect(staff.getByTitle('Le visiteur a jugé cette réponse utile')).toBeVisible()

  // Récupère le convId pour le test 409 (route /api/bots/{id}/conversations/{cid}/take).
  const convList = await request.get(
    `${state.apiUrl}/api/bots/${bot.id}/conversations?status=human_requested&limit=10`,
    { headers: authHeaders(state.token) },
  )
  expect(convList.ok()).toBeTruthy()
  const convId = (await convList.json()).conversations[0].id as string

  // Prendre en main → human.
  await staff.getByRole('button', { name: 'Prendre en main', exact: true }).click()
  await expect(staff.getByRole('button', { name: 'Prendre en main', exact: true })).toBeHidden()

  // Répondre (Entrée) → POST /reply, source human.
  await staff.getByPlaceholder('Votre réponse au visiteur…').fill('Bonjour, je prends le relais.')
  await staff.getByPlaceholder('Votre réponse au visiteur…').press('Enter')

  // Côté widget : le message « Conseiller » remonte via le poll natif (2,5 s).
  await expect(visitor.locator('.kc-human-tag')).toBeVisible({ timeout: 15_000 })
  await expect(visitor.locator('.kc-row.bot', { hasText: 'je prends le relais' })).toBeVisible({ timeout: 15_000 })

  // Clôturer (window.confirm) → closed.
  staff.once('dialog', d => d.accept())
  await staff.getByRole('button', { name: 'Clôturer', exact: true }).click()
  await expect(staff.getByRole('button', { name: 'Clôturer', exact: true })).toBeHidden()

  // 409 : un take APRÈS clôture (status=closed ≠ human_requested) → 409 géré.
  const r409 = await request.post(
    `${state.apiUrl}/api/bots/${bot.id}/conversations/${convId}/take`,
    { headers: authHeaders(state.token) },
  )
  expect(r409.status()).toBe(409)

  // Retour tree côté widget : applyStatus repasse en TREE, input re-caché.
  await expect(visitor.locator('.kc-mode')).toHaveText('TREE', { timeout: 15_000 })
  await expect(visitor.locator('.kc-inputrow')).toBeHidden()
})
