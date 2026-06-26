// Bots PERSO (nouveau modèle d'appartenance) — un bot appartient à un USER
// (perso) OU à une ORGANISATION (équipe). Ce spec est API-centré (zéro
// register : il réutilise le compte principal du state) + 1 vérif UI du badge
// « Perso » dans « Mes chatbots ».
//
// Parcours :
//   - POST /api/bots → bot perso (scope:'personal', organization_id:null,
//     owner_user_id = moi) ;
//   - GET /api/bots le contient ;
//   - /app → la card porte le badge « Perso » ;
//   - POST /api/bots/{id}/move {organization_id: state.orgId} → scope:'team' ;
//   - re-move → 422 « appartient déjà à une organisation » ;
//   - DELETE du bot (nettoyage).
import { expect, test } from '@playwright/test'
import { authHeaders, authenticate, createPersonalBot, deleteBot, loadState } from '../helpers'

const state = loadState()

// Bot créé dans le test (perso) → suppression best-effort (le bot finit en
// équipe après le move, mais le state principal en est admin → DELETE OK).
let createdBotId: number | null = null

test.afterAll(async ({ request }) => {
  if (createdBotId) await deleteBot(request, state, createdBotId)
})

test('création d\'un bot perso, badge « Perso », déplacement vers une équipe (sens unique)', async ({ page, request }) => {
  const headers = authHeaders(state.token)
  const name = `E2E Perso Bot ${Date.now()}`

  // --- Identité du compte principal (owner attendu) ---
  const meRes = await request.get(`${state.apiUrl}/api/auth/me`, { headers })
  expect(meRes.ok()).toBeTruthy()
  const myId = (await meRes.json()).id

  // --- 1. Création perso : POST /api/bots ---
  const { bot } = await createPersonalBot(request, state, { name, mode: 'tree' })
  createdBotId = bot.id
  expect(bot.scope).toBe('personal')
  expect(bot.organization_id).toBeNull()
  expect(bot.owner_user_id).toBe(myId)

  // --- 2. GET /api/bots (tous mes bots) le contient ---
  const listRes = await request.get(`${state.apiUrl}/api/bots`, { headers })
  expect(listRes.ok()).toBeTruthy()
  const list = await listRes.json()
  const mine = list.find((b: any) => b.id === createdBotId)
  expect(mine).toBeTruthy()
  expect(mine.scope).toBe('personal')

  // --- 3. UI : la card du bot porte le badge « Perso » ---
  await authenticate(page, state)
  await page.goto('/app')
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()
  // « Mes chatbots » a migré dans l'aside (BotNav) : le bot perso est un bouton
  // de navigation (plus de grille .bot-card ni de badge « Perso » dans cette vue).
  const card = page.getByRole('navigation').getByRole('button', { name })
  await expect(card).toBeVisible()

  // --- 4. Déplacement vers l'équipe partagée du state → scope:'team' ---
  const moveRes = await request.post(`${state.apiUrl}/api/bots/${createdBotId}/move`, {
    headers,
    data: { organization_id: state.orgId },
  })
  expect(moveRes.ok()).toBeTruthy()
  const moved = await moveRes.json()
  expect(moved.scope).toBe('team')
  expect(moved.organization_id).toBe(state.orgId)
  expect(moved.owner_user_id).toBeNull()

  // --- 5. Re-move (sens unique) → 422 ---
  const reMove = await request.post(`${state.apiUrl}/api/bots/${createdBotId}/move`, {
    headers,
    data: { organization_id: state.orgId },
  })
  expect(reMove.status()).toBe(422)
})
