// Nœuds typés du widget réel (parcours E) — bot DÉDIÉ mode tree (jamais le
// bot partagé : widget.spec peut tourner après), créé en beforeAll via
// createBot (captcha disabled + localhost posés par le helper) et supprimé en
// afterAll (deleteBot best-effort).
//
// MOCK_AI=false : bot tree → input masqué (asserté), AUCUN chemin IA exercé.
// Calendly : 100 % intercepté (interceptCalendly), aucun réseau sortant réel.
// Lead : UN SEUL envoi réel (lead_limiter 5/h/session), la validation email
// invalide est purement locale.
//
// NOUVELLE UI : les Leads ne sont plus un onglet de l'éditeur de bot — ils
// vivent sur /app/analytics (pages/Analytics.tsx : sélecteur de bot + tableau
// Leads + bouton « Exporter CSV »). La partie « lead » navigue donc vers
// Analytics, sélectionne le bot dédié et vérifie la ligne + l'export. Le widget
// (widget/widget.js) est INCHANGÉ : tous les sélecteurs .kc-* restent valides.
import { expect, test } from '@playwright/test'
import { authenticate, createBot, deleteBot, loadState } from '../helpers'
import { interceptCalendly, NODES_TREE, openFrame } from '../widget-helpers'

const state = loadState()
let botId: number
let botName: string
let publicKey: string

test.beforeAll(async ({ request }) => {
  botName = `Bot noeuds E2E ${Date.now()}`
  const bot = await createBot(request, state, {
    name: botName,
    mode: 'tree',
    tree: NODES_TREE,
    design: { title: 'Bot noeuds E2E' },
  })
  botId = bot.id
  publicKey = bot.publicKey
})

test.afterAll(async ({ request }) => {
  await deleteBot(request, state, botId)
})

test('appointment : bouton « Prendre rendez-vous » + overlay sans réseau réel', async ({ page }) => {
  // Routes posées AVANT toute navigation : l'iframe Calendly est stubée
  await interceptCalendly(page)
  await openFrame(page, state, publicKey)

  // Bootstrap : titre du design, badge TREE, et garde-fou IA (saisie masquée)
  await expect(page.locator('.kc-head-name')).toHaveText('Bot noeuds E2E')
  await expect(page.locator('.kc-mode')).toHaveText('TREE')
  await expect(page.locator('.kc-inputrow')).toBeHidden()

  // Nœud appointment : widget.js AJOUTE EN TÊTE le bouton « Prendre rendez-vous »
  await page.locator('.kc-opt', { hasText: 'Rendez-vous' }).click()
  await expect(page.locator('.kc-row.bot .kc-msg').last()).toContainText('Choisissez un créneau :')
  await page.locator('.kc-opt', { hasText: 'Prendre rendez-vous' }).click()

  // Overlay : iframe whitelistée (hôte calendly.com), requête interceptée
  const overlay = page.locator('.kc-overlay')
  await expect(overlay).toBeVisible()
  await expect(page.locator('.kc-overlay-head')).toContainText('Prendre rendez-vous')
  await expect(page.locator('.kc-overlay iframe[title="Prise de rendez-vous"]'))
    .toHaveAttribute('src', 'https://calendly.com/e2e-demo/intro')
  // Lien externe visible mais JAMAIS cliqué (une popup échapperait aux routes)
  await expect(page.locator('.kc-overlay-link')).toHaveText('Ouvrir dans un nouvel onglet')

  await page.locator('.kc-overlay-x').click()
  await expect(overlay).toHaveCount(0)
})

test('lead : validation → POST /lead 200 → page Analytics (tableau Leads + export CSV)', async ({ page }) => {
  // Auth posée DÈS MAINTENANT : addInitScript s'applique à toutes les
  // navigations suivantes (les clés cbsaas_* posées sur l'origine 8001 sont
  // inertes pour widget.js) — la bascule vers le dashboard se fait ensuite
  // dans la MÊME page.
  await authenticate(page, state)
  await openFrame(page, state, publicKey)

  // Nœud lead : formulaire à la place des options
  await page.locator('.kc-opt', { hasText: 'Contact' }).click()
  const form = page.locator('.kc-lead')
  await expect(form).toBeVisible()
  await expect(form.locator('.kc-lead-label')).toHaveText(['Email', 'Message'])
  const emailInput = form.locator('input.kc-lead-input[type="email"]')
  const messageInput = form.locator('textarea.kc-lead-input')

  // Email invalide : refus LOCAL (aucun réseau)
  await emailInput.fill('pas-un-email')
  await form.locator('.kc-lead-send').click()
  await expect(form.locator('.kc-lead-err')).toHaveText("Merci d'indiquer un email valide.")

  // UN SEUL envoi réel (lead_limiter 5/h/session)
  const email = `lead.${Date.now()}@e2e-chapote.fr`
  await emailInput.fill(email)
  await messageInput.fill('Demande envoyée par la suite e2e.')
  const leadResp = page.waitForResponse(r => r.url().includes('/api/widget/lead'))
  await form.locator('.kc-lead-send').click()
  expect((await leadResp).status()).toBe(200)
  await expect(page.locator('.kc-row.bot .kc-msg').last())
    .toHaveText('Merci ! Votre demande a bien été transmise.')

  // NOUVELLE UI : le lead apparaît sur /app/analytics (et non plus dans
  // l'éditeur). On navigue dans la MÊME page (auth déjà posée), on sélectionne
  // le bot dédié dans le sélecteur de la card « Chatbot analysé » puis on
  // vérifie la ligne dans le tableau Leads.
  await page.goto('/app/analytics')
  // Sélecteur de bot : pilule (button aria-pressed) dont le nom accessible est
  // le nom unique du bot dédié — clic explicite (le bot dédié n'est pas
  // forcément le 1er, donc pas auto-sélectionné). exact:true : le bouton de la
  // sidebar préfixe le nom par les initiales (« BN … ») et matcherait sinon aussi.
  await page.getByRole('button', { name: botName, exact: true }).click()

  // Titre de section Leads (sub = « N contact(s) capturé(s) par « <bot> ». ») —
  // scopé sur le sous-titre qui parle de leads (la page a un autre .section-sub).
  const leadsSub = page.locator('.section-sub', { hasText: 'contact(s) capturé(s)' })
  await expect(leadsSub).toContainText('1 contact(s) capturé(s)')

  // Ligne du lead : email en cellule mono + Source « Arbre » (Chip)
  const row = page.locator('table.kc tr', { hasText: email })
  await expect(row.locator('td.mono', { hasText: email })).toBeVisible()
  await expect(row.getByText('Arbre', { exact: true })).toBeVisible()

  // Export CSV (Blob + a.download → événement download en Chromium)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exporter CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/^leads-.*\.csv$/)
})
