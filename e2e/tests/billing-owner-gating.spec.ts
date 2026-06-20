// Gating « payeur seul » de la facturation (spec §3.6 / §5.4, corrige C3/E2/E3).
//
// Le PAYEUR (owner d'org / propriétaire perso) est seul à gérer la facturation
// d'un bot. require_billing_owner (api/src/core/security.py) :
//   - owner du bot/de l'org        → 200 ;
//   - admin NON-owner de l'org     → 403 (il n'est pas le payeur, distinct du
//                                    403 perm « équipe » classique) ;
//   - member de l'org              → 403 (idem : pas owner) ;
//   - superadmin                   → court-circuite (200).
//
// GET /api/bots/{id}/entitlement applique require_billing_owner SANS dépendre de
// billing_enabled (l'invariant D0 ne s'applique qu'à l'enforcement des modules,
// pas au contrôle d'accès payeur). Les assertions API tournent donc même clés
// Stripe absentes (CI). Le volet UI (nav + page visibles pour le payeur,
// masquées sinon) n'a de sens que billing ACTIF (is_billing_enabled) : il est
// gardé par un skip quand le billing est OFF.
//
// 3 acteurs viennent du GLOBAL-SETUP (zéro register ici) :
//   - state.token     : owner de l'org partagée (= payeur des bots de l'org) ;
//   - state.adminToken: admin NON-owner de l'org partagée ;
//   - state.memberToken: member de l'org partagée.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, authenticate, authenticateWithToken, createBot, deleteBot, loadState } from '../helpers'

const state = loadState()

async function billingEnabled(request: APIRequestContext): Promise<boolean> {
  const me = await request.get(`${state.apiUrl}/api/auth/me`, { headers: authHeaders(state.token) })
  if (!me.ok()) return false
  return Boolean((await me.json()).billing_enabled)
}

test.describe('Gating facturation par bot (require_billing_owner)', () => {
  test('owner 200 / admin non-owner 403 / member 403 sur GET /api/bots/{id}/entitlement', async ({ request }) => {
    const url = `${state.apiUrl}/api/bots/${state.botId}/entitlement`

    // Owner de l'org partagée (= payeur) : 200 + entitlement lisible.
    const asOwner = await request.get(url, { headers: authHeaders(state.token) })
    expect(asOwner.status()).toBe(200)
    const ent = await asOwner.json()
    expect(ent.bot_id).toBe(state.botId)
    // Le contrat d'entitlement expose au minimum modules + statut.
    expect(Array.isArray(ent.modules)).toBe(true)
    expect(typeof ent.status).toBe('string')

    // Admin NON-owner : 403 (pas le payeur). Message « réservé au propriétaire ».
    expect(state.adminToken).toBeTruthy()
    const asAdmin = await request.get(url, { headers: authHeaders(state.adminToken!) })
    expect(asAdmin.status()).toBe(403)
    expect(JSON.stringify(await asAdmin.json())).toMatch(/propriétaire/i)

    // Member : 403 (pas le payeur non plus).
    expect(state.memberToken).toBeTruthy()
    const asMember = await request.get(url, { headers: authHeaders(state.memberToken!) })
    expect(asMember.status()).toBe(403)
  })

  test('POST /api/billing/checkout : owner accepté (≠403) / admin non-owner 403 / member 403', async ({ request }) => {
    const url = `${state.apiUrl}/api/billing/checkout`
    // Bot DÉDIÉ (le checkout en MOCK_BILLING peut projeter un entitlement : on ne
    // mute pas le bot partagé). Owné par l'org partagée ⇒ payeur = compte state.
    const bot = await createBot(request, state, { name: `Bot Gating E2E ${Date.now()}`, mode: 'tree' })
    const body = { bot_id: bot.id, config: { modules: [], ai_tier_id: null, ai_byok: false } }
    try {
      // Owner : route accessible (require_billing_owner OK). Selon billing OFF/ON
      // la réponse varie ({billing:disabled} 200 OU {free:true}/{checkout_url}),
      // mais elle n'est JAMAIS 403/404 (le payeur a le droit d'y accéder).
      const asOwner = await request.post(url, { headers: authHeaders(state.token), data: body })
      expect(asOwner.status()).not.toBe(403)
      expect(asOwner.status()).not.toBe(404)

      // Admin non-owner / member : 403. Mais le checkout court-circuite billing
      // OFF ({billing:disabled} 200) AVANT require_billing_owner ⇒ on n'assert le
      // 403 que lorsque le billing est ACTIF.
      if (await billingEnabled(request)) {
        const asAdmin = await request.post(url, { headers: authHeaders(state.adminToken!), data: body })
        expect(asAdmin.status()).toBe(403)
        const asMember = await request.post(url, { headers: authHeaders(state.memberToken!), data: body })
        expect(asMember.status()).toBe(403)
      }
    } finally {
      await deleteBot(request, state, bot.id)
    }
  })

  test('UI owner : entrée nav « Facturation » + page accessible (configurateur de format)', async ({ page, request }) => {
    test.skip(!(await billingEnabled(request)), 'billing OFF (clés Stripe absentes) — l\'UI facturation est masquée pour tous (InfoBox « bientôt disponible »).')

    await authenticate(page, state)
    await page.goto('/app')
    const navBilling = page.getByRole('button', { name: 'Facturation', exact: true })
    await expect(navBilling).toBeVisible()
    await navBilling.click()
    await expect(page).toHaveURL(/\/app\/billing$/)
    await expect(page.getByRole('heading', { name: 'Facturation' })).toBeVisible()
    // Le payeur voit le configurateur de format (Seg), pas l'InfoBox « bientôt ».
    await expect(page.getByText('Format de vos factures')).toBeVisible()
  })

  test('UI admin non-owner : pas d\'entrée nav « Facturation » (canSeeBilling=false)', async ({ page, request }) => {
    test.skip(!(await billingEnabled(request)), 'billing OFF (clés Stripe absentes) — l\'UI facturation est masquée pour tous.')

    // Page fraîche : seul le token admin non-owner est injecté (un acteur/test).
    await authenticateWithToken(page, state.adminToken!, state.orgId)
    await page.goto('/app')
    await expect(page.getByText('Mes chatbots').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Facturation', exact: true })).toHaveCount(0)
  })
})
