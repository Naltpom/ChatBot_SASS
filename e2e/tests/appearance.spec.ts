// Apparence (parcours G) — bot DÉDIÉ mode tree créé en beforeAll : on ne
// touche JAMAIS au design du bot partagé pendant le run (widget.spec peut
// tourner après). Nom unique, purgé par le tryReuse du global-setup au run
// suivant. Aucun chemin IA exercé (bot tree, aperçu local).
import { expect, test } from '@playwright/test'
import { authHeaders, authenticate, createBot, loadState } from '../helpers'

const state = loadState()
let botId: number
let publicKey: string

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot apparence E2E ${Date.now()}`, mode: 'tree' })
  botId = bot.id
  publicKey = bot.publicKey
})

test('preset Crépuscule + launcherText → aperçu (pilule) + bootstrap sanitisé', async ({ page, request }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${botId}`)
  await page.locator('.tabs').getByRole('button', { name: 'Apparence' }).click()

  // Refonte Apparence : sous-onglets Thème/Lanceur/Fenêtre/Messages (Seg). Le
  // sous-onglet « Thème » est actif par défaut → les presets y sont visibles.
  // Preset (merge partiel) : hex de botConstants.ts — Crépuscule =
  // primaryColor #4f46e5 / secondaryColor #be185d
  const preset = page.locator('button.preset-card', { hasText: 'Crépuscule' })
  await preset.click()
  await expect(preset).toHaveClass(/selected/)

  // « Texte du lanceur » vit désormais dans le sous-onglet « Lanceur ».
  await page.getByRole('button', { name: 'Lanceur', exact: true }).click()
  await page.getByLabel('Texte du lanceur').fill('Une question ?')

  // Aperçu : l'aperçu encadré latéral est supprimé ; la DÉMO FLOTTANTE (posée par
  // BotPage avec defaultOpen=false) est déjà fermée → le lanceur affiche la pilule
  // avec le texte, sans avoir à fermer le panneau au préalable.
  await expect(page.locator('[aria-label="Ouvrir le chat"]')).toContainText('Une question ?')

  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('button', { name: /Enregistré/ })).toBeVisible()

  // Assert API : GET /api/widget/bootstrap renvoie les clés sanitisées par
  // _sanitize_design (Origin localhost = toléré en ENV=dev)
  const res = await request.get(`${state.apiUrl}/api/widget/bootstrap?key=${publicKey}`, {
    headers: { Origin: 'http://localhost:3001' },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.mode).toBe('tree')
  expect(body.captcha).toBeTruthy()
  expect(body.captcha.provider).toBe('disabled')
  expect(body.design.primaryColor).toBe('#4f46e5')
  expect(body.design.secondaryColor).toBe('#be185d')
  expect(body.design.launcherText).toBe('Une question ?')
  expect(body.design.title).toBeTruthy() // titre du design, ou nom du bot si vide
})
