// Format de facture (User.billing_grouping) — spec §4 / §7.4.
//
// Le payeur choisit comment ses abonnements sont regroupés :
//   total (défaut) | per_bot | per_org
// PUT /api/billing/grouping change le format (procédure « créer-puis-résilier »
// préservant les entitlements). En MOCK_BILLING, aucun appel Stripe : le format
// bascule directement (les entitlements restent inchangés). `per_org` est refusé
// 409 si le payeur n'a NI bot d'org NI bot perso facturable.
//
// Côté UI (page Billing) : un Seg 3 options reflète le format courant ; changer
// d'option ouvre une modale de confirmation → PUT → refreshUser() → le Seg
// reflète le nouveau format.
//
// PRÉREQUIS : route active uniquement si billing ON (sinon {billing:disabled},
// invariant D0) ⇒ on `skip` quand le billing est OFF (CI par défaut). Le compte
// du state est OWNER de l'org partagée (≥1 bot facturable) ⇒ per_org autorisé,
// et « sans bot facturable » n'est PAS exercé (donc aucun appel Stripe attendu).
//
// IMPORTANT : on RESTAURE billing_grouping='total' en fin de test pour ne pas
// polluer les runs suivants (état partagé, worker unique).
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, authenticate, loadState } from '../helpers'

const state = loadState()

async function billingEnabled(request: APIRequestContext): Promise<boolean> {
  const me = await request.get(`${state.apiUrl}/api/auth/me`, { headers: authHeaders(state.token) })
  if (!me.ok()) return false
  return Boolean((await me.json()).billing_enabled)
}

async function putGrouping(request: APIRequestContext, grouping: string) {
  return request.put(`${state.apiUrl}/api/billing/grouping`, {
    headers: authHeaders(state.token), data: { grouping },
  })
}

async function currentGrouping(request: APIRequestContext): Promise<string> {
  const me = await request.get(`${state.apiUrl}/api/auth/me`, { headers: authHeaders(state.token) })
  return (await me.json()).billing_grouping
}

test.afterAll(async ({ request }) => {
  // Restaure le défaut (best-effort) — n'échoue pas si billing OFF.
  await putGrouping(request, 'total').catch(() => {})
})

test('PUT /api/billing/grouping : transitions total → per_bot → per_org → total (MOCK)', async ({ request }) => {
  test.skip(!(await billingEnabled(request)),
    'billing OFF (clés Stripe absentes) — PUT /api/billing/grouping renvoie {billing:disabled} (invariant D0).')

  // total → per_bot
  const toPerBot = await putGrouping(request, 'per_bot')
  expect(toPerBot.ok()).toBe(true)
  expect((await toPerBot.json()).billing_grouping).toBe('per_bot')
  expect(await currentGrouping(request)).toBe('per_bot')

  // per_bot → per_org : autorisé car le payeur possède ≥1 bot d'org facturable.
  const toPerOrg = await putGrouping(request, 'per_org')
  expect(toPerOrg.ok()).toBe(true)
  expect((await toPerOrg.json()).billing_grouping).toBe('per_org')
  expect(await currentGrouping(request)).toBe('per_org')

  // per_org → total
  const toTotal = await putGrouping(request, 'total')
  expect(toTotal.ok()).toBe(true)
  expect((await toTotal.json()).billing_grouping).toBe('total')
  expect(await currentGrouping(request)).toBe('total')

  // Idempotence : re-poser le format courant → changed:false (pas de mutation).
  const again = await putGrouping(request, 'total')
  expect(again.ok()).toBe(true)
  expect((await again.json()).changed).toBe(false)
})

test('UI : le Seg reflète le format après confirmation (refreshUser)', async ({ page, request }) => {
  test.skip(!(await billingEnabled(request)),
    'billing OFF — la page Billing n\'affiche que l\'InfoBox « bientôt disponible ».')

  // Point de départ déterministe : total.
  await putGrouping(request, 'total')

  await authenticate(page, state)
  await page.goto('/app/billing')

  // Le Seg « Format de vos factures » montre « Facture unique » (total) actif.
  await expect(page.getByText('Format de vos factures')).toBeVisible()
  const seg = page.locator('.seg').filter({ hasText: 'Par bot' })
  await expect(seg.locator('button.active')).toHaveText('Facture unique')

  // Clic « Par bot » → modale de confirmation → Confirmer → PUT → refreshUser.
  const putResp = page.waitForResponse(r =>
    r.url().includes('/api/billing/grouping') && r.request().method() === 'PUT' && r.ok())
  await seg.getByRole('button', { name: 'Par bot', exact: true }).click()
  await expect(page.getByText('Changer le format de facture ?')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click()
  await putResp

  // Après refreshUser, le Seg reflète « Par bot » (modale fermée).
  await expect(page.getByText('Changer le format de facture ?')).toHaveCount(0)
  await expect(seg.locator('button.active')).toHaveText('Par bot')

  // Persistance côté API.
  expect(await currentGrouping(request)).toBe('per_bot')
})
