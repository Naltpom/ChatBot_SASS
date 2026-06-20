// Dégradation / activation des modules forfaitaires (spec §3.3 / §7.4).
//
// Un bot `tree` SANS module configuré (entitlement `free`, modules=[]) doit
// refuser la configuration des capacités payantes en 402 Payment Required
// (distinct du 403 perm et du 429 rate-limit) :
//   - PATCH actions_json (non vide)        → 402 module_required(actions) ;
//   - PATCH ab_split_pct=50                 → 402 module_required(ab) ;
//   - POST /kb/sources (ingestion RAG)      → 402 module_required(rag).
// Puis ACTIVATION via MOCK_BILLING (POST /api/billing/subscription/update
// applique directement l'entitlement, simulant checkout.session.completed) :
//   - mêmes PATCH / POST → 200.
// L'IA n'est JAMAIS exercée (bot mode tree, widget jamais ouvert) : on assert
// l'état uniquement via l'API (GET /api/bots/{id}/entitlement).
//
// PRÉREQUIS RUNTIME : ce gating n'existe que si le billing est ACTIF
// (billing_enabled() ⇐ clés Stripe présentes) ET en mode enforce
// (BILLING_ENFORCE=true). Clés absentes (CI par défaut) ⇒ resolver ALL_UNLOCKED
// ⇒ tout 200 (invariant D0, 32 e2e verts). Mode observe ⇒ 200 aussi (log-only).
// On SONDE l'état réel (un PATCH qui DEVRAIT 402) et on `skip` si l'enforcement
// n'est pas armé : le test ne fait JAMAIS échouer une CI billing-OFF.
//
// API-centré (aucune UI). Bot DÉDIÉ d'org (le compte du state est OWNER de l'org
// partagée ⇒ payeur ⇒ require_billing_owner OK), créé/supprimé via l'API.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()
let botId: number

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot Degrade E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

// Configure le bot via MOCK_BILLING : POST /api/billing/subscription/update
// projette directement l'entitlement (modules + plan IA) sans Stripe réel.
async function activate(
  request: APIRequestContext,
  config: { modules: string[]; ai_tier_id?: string | null; ai_byok?: boolean },
) {
  return request.post(`${state.apiUrl}/api/billing/subscription/update`, {
    headers: authHeaders(state.token),
    data: { bot_id: botId, config: { ai_tier_id: null, ai_byok: false, ...config } },
  })
}

// Sonde : tente un PATCH actions_json sur le bot `free`. 402 ⇒ enforcement armé
// (billing ON + enforce). Sinon (200) ⇒ billing OFF ou observe ⇒ on saute.
async function enforcementArmed(request: APIRequestContext): Promise<boolean> {
  const res = await request.patch(`${state.apiUrl}/api/bots/${botId}`, {
    headers: authHeaders(state.token),
    data: { actions_json: [{ type: 'webhook', name: 'probe', url: 'https://e2e.invalid' }] },
  })
  if (res.status() === 402) return true
  // Pas de 402 : on annule l'effet éventuel (mode observe a pu écrire) et on saute.
  await request.patch(`${state.apiUrl}/api/bots/${botId}`, {
    headers: authHeaders(state.token), data: { actions_json: [] },
  })
  return false
}

test('bot free : PATCH actions/ab → 402, POST KB → 402 ; activation MOCK_BILLING → 200 (IA jamais exercée)', async ({ request }) => {
  test.skip(!(await enforcementArmed(request)),
    'enforcement billing non armé (clés Stripe absentes ou BILLING_ENFORCE=false) — invariant D0 : tout gratuit.')

  const headers = authHeaders(state.token)
  const botUrl = `${state.apiUrl}/api/bots/${botId}`
  const entUrl = `${botUrl}/entitlement`

  // --- État initial : entitlement free, aucun module ---
  const ent0 = await (await request.get(entUrl, { headers })).json()
  expect(ent0.modules).not.toContain('actions')
  expect(ent0.modules).not.toContain('ab')
  expect(ent0.modules).not.toContain('rag')

  // --- 1. PATCH actions_json (non vide) sans module Actions → 402(actions) ---
  const patchActions = await request.patch(botUrl, {
    headers,
    data: { actions_json: [{ type: 'webhook', name: 'lead', url: 'https://e2e.invalid' }] },
  })
  expect(patchActions.status()).toBe(402)
  expect((await patchActions.json()).detail).toMatchObject({ error: 'module_required', module: 'actions' })

  // --- 2. PATCH ab_split_pct=50 sans module A/B → 402(ab) ---
  const patchAb = await request.patch(botUrl, { headers, data: { ab_split_pct: 50 } })
  expect(patchAb.status()).toBe(402)
  expect((await patchAb.json()).detail).toMatchObject({ error: 'module_required', module: 'ab' })

  // --- 3. POST /kb/sources (ingestion RAG) sans module RAG → 402(rag) ---
  const postKb = await request.post(`${botUrl}/kb/sources`, {
    headers,
    data: { type: 'text', title: 'Doc E2E', content: 'Contenu de test pour le gating RAG.' },
  })
  expect(postKb.status()).toBe(402)
  expect((await postKb.json()).detail).toMatchObject({ error: 'module_required', module: 'rag' })

  // --- 4. Activation via MOCK_BILLING : actions + ab + rag ---
  const act = await activate(request, { modules: ['actions', 'ab', 'rag'] })
  expect(act.ok()).toBe(true)

  const ent1 = await (await request.get(entUrl, { headers })).json()
  expect(ent1.modules).toEqual(expect.arrayContaining(['actions', 'ab', 'rag']))
  expect(ent1.status).toBe('active')

  // --- 5. Mêmes mutations → 200 désormais ---
  const okActions = await request.patch(botUrl, {
    headers,
    data: { actions_json: [{ type: 'webhook', name: 'lead', url: 'https://e2e.invalid' }] },
  })
  expect(okActions.ok()).toBe(true)

  const okAb = await request.patch(botUrl, { headers, data: { ab_split_pct: 50 } })
  expect(okAb.ok()).toBe(true)

  // KB : l'ingestion réelle peut être longue (fastembed). On vérifie SEULEMENT
  // que le gating ne bloque plus (≠402) ; l'indexation est testée par kb.spec.
  const okKb = await request.post(`${botUrl}/kb/sources`, {
    headers,
    data: { type: 'text', title: 'Doc E2E', content: 'Contenu de test pour le gating RAG.' },
  })
  expect(okKb.status()).not.toBe(402)
  expect(okKb.ok()).toBe(true)
})
