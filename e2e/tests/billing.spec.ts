// Facturation (parcours D) — billing OFF en dev (STRIPE_* vides) : on teste le
// chemin applied:true, le bandeau « Paiement en ligne non configuré », le 422
// de downgrade et le retour ?checkout=cancelled. JAMAIS le checkout réel ni
// ?checkout=success (polling 2 s × 10).
//
// CHAQUE test crée SA propre org jetable (POST /api/orgs, non rate-limité) :
// l'org du state doit RESTER en plan agence (contrat tryReuse du global-setup).
import { expect, test, type Page } from '@playwright/test'
import { authHeaders, authenticateWithToken, createBot, createOrg, loadState } from '../helpers'

const state = loadState()

// Card d'un plan dans la grille : seule la card du plan contient son label en
// texte EXACT (la card « Plan actuel » affiche « Plan Starter », non exact).
function planCard(page: Page, label: string) {
  return page.locator('.card').filter({ has: page.getByText(label, { exact: true }) })
}

test('grille des 4 plans depuis /api/public/plans + bandeau billing off', async ({ page, request }) => {
  const org = await createOrg(request, state, `E2E Billing ${Date.now()}`, 'entreprise')
  await authenticateWithToken(page, state.token, org.id)

  // La grille est servie par GET /api/public/plans (source unique du pricing)
  const plansLoaded = page.waitForResponse(r => r.url().includes('/api/public/plans') && r.ok())
  await page.goto('/app/billing')
  await plansLoaded

  await expect(page.locator('.section-title')).toHaveText('Facturation')
  for (const label of ['Free', 'Starter', 'Pro', 'Agence']) {
    await expect(planCard(page, label)).toBeVisible()
  }
  await expect(planCard(page, 'Free').getByText('Plan actuel', { exact: true })).toBeVisible()
  await expect(planCard(page, 'Pro').getByText('Populaire', { exact: true })).toBeVisible()
  await expect(page.getByText('Paiement en ligne non configuré', { exact: true })).toBeVisible()
})

test('changement de plan applied:true (billing off → effet immédiat)', async ({ page, request }) => {
  const org = await createOrg(request, state, `E2E Billing ${Date.now()}`, 'entreprise')
  await authenticateWithToken(page, state.token, org.id)
  await page.goto('/app/billing')

  const starter = planCard(page, 'Starter')
  await starter.getByRole('button', { name: /Passer à ce plan/ }).click()
  await expect(starter.getByText('Passer au plan Starter (19 €/mois) ? Effet immédiat.')).toBeVisible()
  // SCOPER à la card : « Annuler »/« Confirmer » existent ailleurs (save bar…)
  await starter.getByRole('button', { name: 'Confirmer' }).click()

  await expect(page.getByText(`Plan Starter activé pour ${org.name}.`)).toBeVisible()
  await expect(starter.getByText('Plan actuel', { exact: true })).toBeVisible()
})

test('downgrade impossible : le 422 est affiché tel quel', async ({ page, request }) => {
  // Org agence avec 2 bots (mode TREE, aucun chemin IA) : Starter (max_bots=1)
  // viole max_bots — AUCUNE conso IA nécessaire pour déclencher le garde-fou.
  const org = await createOrg(request, state, `E2E Billing ${Date.now()}`, 'entreprise')
  const plan = await request.post(`${state.apiUrl}/api/orgs/${org.id}/plan`, {
    headers: authHeaders(state.token),
    data: { plan: 'agence' },
  })
  if (!plan.ok()) throw new Error(`POST /api/orgs/{id}/plan : HTTP ${plan.status()}`)
  if ((await plan.json()).applied !== true) {
    throw new Error('POST /api/orgs/{id}/plan : applied=false (billing Stripe actif ? videz STRIPE_*)')
  }
  await createBot(request, state, { name: `E2E Downgrade A ${Date.now()}`, orgId: org.id })
  await createBot(request, state, { name: `E2E Downgrade B ${Date.now()}`, orgId: org.id })

  await authenticateWithToken(page, state.token, org.id)
  await page.goto('/app/billing')

  const starter = planCard(page, 'Starter')
  await starter.getByRole('button', { name: /Passer à ce plan/ }).click()
  await starter.getByRole('button', { name: 'Confirmer' }).click()

  // Préfixe exact du detail 422 de orgs.py, affiché tel quel par Billing.tsx
  await expect(page.locator('div.error')).toContainText('Changement de plan impossible : ')
})

test('retour ?checkout=cancelled : bannière affichée, paramètre nettoyé', async ({ page, request }) => {
  const org = await createOrg(request, state, `E2E Billing ${Date.now()}`, 'entreprise')
  await authenticateWithToken(page, state.token, org.id)

  await page.goto('/app/billing?checkout=cancelled')
  await expect(page.getByText('Paiement annulé — aucun changement effectué.')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/billing$/)
})
