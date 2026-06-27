// Blocage admin d'un bot (statut 'suspended') — spec billing/widget.
//
// Vérifie le modèle de statut unifié (docs/BILLING_STATUS_MODEL.md) bout-en-bout :
//   1. un bot servable répond au bootstrap widget (200) ;
//   2. POST /api/admin/bots/{id}/block (superadmin) -> status 'suspended' ;
//   3. le widget est COUPÉ : GET /api/widget/bootstrap -> 404 (cut serveur,
//      _assert_bot_servable, avant toute vérif d'origine) ;
//   4. STICKY : un (ré)abonnement projeté (MOCK, actor=stripe) NE débloque PAS —
//      status reste 'suspended', widget toujours 404 (décision produit #1) ;
//   5. DÉBLOCAGE = DELETE /api/admin/bots/{id}/entitlement (reset, re-dérivation) :
//      status n'est plus 'suspended', widget de nouveau servable (200) ;
//   6. le journal GET /api/admin/bots/{id}/status-history trace la transition.
//
// PRÉREQUIS RUNTIME : ce chemin n'existe que si le billing est ACTIF
// (billing_enabled() ⇐ clés Stripe présentes). Clés absentes (CI par défaut) ⇒
// le blocage renvoie { billing: 'disabled' } (resolver ALL_UNLOCKED, invariant
// D0) ⇒ on SKIP : la spec ne fait jamais échouer une CI billing-OFF.
//
// API-centré (aucune UI). Bot DÉDIÉ d'org créé/supprimé via l'API ; token
// superadmin via dev-login pour les endpoints /api/admin/*.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, createBot, deleteBot, devLoginToken, loadState } from '../helpers'

const state = loadState()
let botId: number
let publicKey: string
let adminToken: string

test.beforeAll(async ({ request }) => {
  adminToken = await devLoginToken(request, state.apiUrl)
  const bot = await createBot(request, state, { name: `Bot Suspend E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
  publicKey = bot.publicKey
})

test.afterAll(async ({ request }) => {
  if (botId) await deleteBot(request, state, botId)
})

// Bootstrap public du widget. Origin localhost (allowed_domains=['localhost'] +
// ENV=dev) -> 200 si servable. Un bot 'suspended' renvoie 404 AVANT la vérif
// d'origine (_assert_bot_servable), l'origin n'a alors aucune importance.
function bootstrap(request: APIRequestContext) {
  return request.get(`${state.apiUrl}/api/widget/bootstrap?key=${publicKey}`, {
    headers: { Origin: 'http://localhost' },
  })
}

// Statut d'éligibilité courant (vue superadmin).
async function adminStatus(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${state.apiUrl}/api/admin/bots/${botId}/entitlement`, {
    headers: authHeaders(adminToken),
  })
  return (await r.json()).status
}

// Active le bot via MOCK_BILLING (projette l'entitlement, actor=stripe), comme un
// checkout/paiement réel — sert à tester que le STICKY tient face à Stripe.
function mockActivate(request: APIRequestContext, modules: string[]) {
  return request.post(`${state.apiUrl}/api/billing/subscription/update`, {
    headers: authHeaders(state.token),
    data: { bot_id: botId, config: { ai_tier_id: null, ai_byok: false, modules } },
  })
}

test('blocage admin : widget coupé (404), sticky face à Stripe, déblocage = re-dérivation', async ({ request }) => {
  // --- 0. Bot fraîchement créé : servable (bootstrap 200) ---
  expect((await bootstrap(request)).status()).toBe(200)

  // --- 1. Blocage superadmin -> 'suspended' (skip si billing OFF) ---
  const blockRes = await request.post(`${state.apiUrl}/api/admin/bots/${botId}/block`, {
    headers: authHeaders(adminToken),
    data: { reason: 'e2e_abuse' },
  })
  const blockBody = await blockRes.json()
  test.skip(
    blockBody && blockBody.billing === 'disabled',
    'billing OFF (clés Stripe absentes) — blocage inerte, invariant D0 (tout gratuit).',
  )
  expect(blockRes.ok()).toBe(true)
  expect(blockBody.status).toBe('suspended')

  // --- 2. Widget COUPÉ : 404 (anti-énumération) ---
  expect((await bootstrap(request)).status()).toBe(404)

  // --- 3. STICKY : un (ré)abonnement projeté ne débloque PAS ---
  await mockActivate(request, ['actions'])
  expect(await adminStatus(request)).toBe('suspended') // toujours collé
  expect((await bootstrap(request)).status()).toBe(404) // widget toujours coupé

  // --- 4. DÉBLOCAGE = reset (baseline staff + re-dérivation Stripe) ---
  const reset = await request.delete(`${state.apiUrl}/api/admin/bots/${botId}/entitlement`, {
    headers: authHeaders(adminToken),
  })
  expect(reset.ok()).toBe(true)
  expect(await adminStatus(request)).not.toBe('suspended') // verrou levé

  // --- 5. Widget de nouveau servable ---
  expect((await bootstrap(request)).status()).toBe(200)

  // --- 6. Journal : la transition vers 'suspended' est tracée (qui/quand/comment) ---
  const hist = await request.get(`${state.apiUrl}/api/admin/bots/${botId}/status-history`, {
    headers: authHeaders(adminToken),
  })
  expect(hist.ok()).toBe(true)
  const rows = await hist.json()
  expect(Array.isArray(rows)).toBe(true)
  const blockEntry = rows.find((r: { new_status: string }) => r.new_status === 'suspended')
  expect(blockEntry).toBeTruthy()
  expect(blockEntry.actor_kind).toBe('staff')
})
