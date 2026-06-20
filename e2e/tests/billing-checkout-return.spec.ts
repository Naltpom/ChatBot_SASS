// Retour de Checkout Stripe sur /app/billing (spec §5.3 / §7.4).
//
// Au retour de la session hébergée, Stripe redirige vers
//   /app/billing?checkout=success   (paiement pris en compte)
//   /app/billing?checkout=cancelled (paiement annulé)
// La page Billing (app/src/pages/Billing.tsx) parse le query param
// (useSearchParams), affiche une InfoBox dédiée, rafraîchit le user et NETTOIE
// le param (replace:true) au clic « OK ».
//
// PRÉREQUIS : ces bannières ne s'affichent que si le billing est ACTIF
// (user.is_billing_enabled). Clés Stripe absentes (CI par défaut) ⇒ la page
// rend UNIQUEMENT l'InfoBox « Bientôt disponible » (invariant D0) ⇒ on `skip`
// (le test ne casse jamais une CI billing-OFF). Le compte du state est OWNER de
// l'org partagée ⇒ payeur ⇒ canSeeBilling, page accessible.
//
// Aucun appel Stripe : on simule juste le RETOUR (le query param) — aucun
// checkout réel n'est créé.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, authenticate, loadState } from '../helpers'

const state = loadState()

async function billingEnabled(request: APIRequestContext): Promise<boolean> {
  const me = await request.get(`${state.apiUrl}/api/auth/me`, { headers: authHeaders(state.token) })
  if (!me.ok()) return false
  return Boolean((await me.json()).billing_enabled)
}

test.beforeEach(async ({ page, request }) => {
  test.skip(!(await billingEnabled(request)),
    'billing OFF (clés Stripe absentes) — la page n\'affiche que l\'InfoBox « bientôt disponible ».')
  await authenticate(page, state)
})

test('?checkout=success → bannière « Abonnement confirmé » puis nettoyage du param', async ({ page }) => {
  await page.goto('/app/billing?checkout=success')

  const banner = page.getByText('Abonnement confirmé')
  await expect(banner).toBeVisible()
  await expect(page.getByText(/paiement a été pris en compte/i)).toBeVisible()

  // Clic « OK » : la bannière disparaît et le query param est retiré (replace).
  await page.locator('.btn', { hasText: 'OK' }).first().click()
  await expect(banner).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/billing$/)
})

test('?checkout=cancelled → bannière « Paiement annulé » (aucun prélèvement)', async ({ page }) => {
  await page.goto('/app/billing?checkout=cancelled')

  await expect(page.getByText('Paiement annulé')).toBeVisible()
  await expect(page.getByText(/Aucun montant n'a été prélevé/i)).toBeVisible()

  await page.locator('.btn', { hasText: 'OK' }).first().click()
  await expect(page.getByText('Paiement annulé')).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/billing$/)
})
