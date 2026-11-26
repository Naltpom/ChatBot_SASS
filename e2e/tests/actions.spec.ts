// Éditeur d'actions IA (parcours F) — bot DÉDIÉ en mode hybrid (requis pour
// que l'onglet Actions soit rendu : aiTabRelevant), créé en beforeAll ; nom
// unique, purgé par le tryReuse du global-setup au run suivant.
//
// Refonte charte Chapote : l'éditeur d'actions vit dans l'onglet « Actions »
// de BotPage (titre de section « Actions & outils »). Les libellés, hints et
// placeholders sont lus dans app/src/pages/BotPage.tsx.
//
// MOCK_AI=false : le WIDGET de ce bot n'est JAMAIS ouvert et l'édition
// d'actions n'appelle jamais l'IA (l'exécution d'une action = conversation IA
// uniquement). L'URL webhook pointe sur https://e2e.invalid/… (TLD réservé
// RFC 2606, jamais résolu) : aucun appel sortant possible.
import { expect, test } from '@playwright/test'
import { authHeaders, authenticate, createBot, loadState } from '../helpers'

const state = loadState()
let botId: number

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, { name: `Bot actions E2E ${Date.now()}`, mode: 'hybrid' })
  botId = bot.id
})

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${botId}`)
  await page.locator('.tabs').getByRole('button', { name: 'IA et actions', exact: true }).click()
  await expect(page.getByText('Actions & MCP')).toBeVisible()
})

test('éditeur webhook : hints, save, secret jamais re-affiché', async ({ page, request }) => {
  await page.getByRole('button', { name: /Ajouter une action/ }).click()

  // Nom invalide → hint, corrigé → hint disparu
  const nameInput = page.getByPlaceholder('nom_de_l_action')
  const nameHint = page.getByText('minuscules, chiffres, _ — unique')
  await nameInput.fill('Nom Invalide!')
  await expect(nameHint).toBeVisible()
  await nameInput.fill('webhook_e2e')
  await expect(nameHint).toBeHidden()

  // URL http → hint, corrigée en https://e2e.invalid (jamais résolue)
  const urlInput = page.getByPlaceholder('https://api.votre-site.fr/hooks/chapote')
  const urlHint = page.getByText("L'URL doit commencer par https://")
  await urlInput.fill('http://e2e.invalid/hook')
  await expect(urlHint).toBeVisible()
  await urlInput.fill('https://e2e.invalid/hook')
  await expect(urlHint).toBeHidden()

  await page.getByLabel("Description (pour l'IA)").fill('Webhook e2e — jamais exécuté.')
  // Piège documenté Seg-dans-Field : exact:true obligatoire sur les boutons du Seg
  await page.getByRole('button', { name: 'Webhook', exact: true }).click()
  // La saisie du secret rend l'onglet dirty (actionSecrets)
  await page.getByPlaceholder('Optionnel — signe chaque appel').fill('secret-e2e-hmac')

  // Save bar SOMBRE (role=status) : bouton « Enregistrer », passe à « Enregistré »
  const bar = page.getByRole('status')
  await bar.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(bar).toContainText('Enregistré')

  // Pas de fuite après reload (l'URL garde ?tab=actions) : placeholder masqué,
  // champ VIDE — le secret n'est jamais re-servi par l'API
  await page.reload()
  await expect(page.getByText('Actions & MCP')).toBeVisible()
  const secretInput = page.getByPlaceholder('•••• (laisser vide pour conserver)')
  await expect(secretInput).toBeVisible()
  await expect(secretInput).toHaveValue('')

  // Assert API : secret_set=true, mais ni secret ni secret_encrypted en sortie
  const res = await request.get(`${state.apiUrl}/api/bots/${botId}`, { headers: authHeaders(state.token) })
  expect(res.ok()).toBeTruthy()
  const action = (await res.json()).actions_json[0]
  expect(action.name).toBe('webhook_e2e')
  expect(action.secret_set).toBe(true)
  expect('secret' in action).toBeFalsy()
  expect('secret_encrypted' in action).toBeFalsy()
})

test('renommage avec secret_set : warning affiché, Annuler ne persiste rien', async ({ page, request }) => {
  // Auto-suffisant (anti-flake) : un retry relance le test dans un worker NEUF
  // dont le beforeAll crée un bot SANS action — on seed donc webhook_e2e via
  // l'API (PATCH idempotent, identique à ce que sauvegarde le test précédent,
  // secret chiffré côté serveur → secret_set=true) puis on recharge la page.
  const seeded = await request.patch(`${state.apiUrl}/api/bots/${botId}`, {
    headers: authHeaders(state.token),
    data: {
      actions_json: [{
        name: 'webhook_e2e',
        description: 'Webhook e2e — jamais exécuté.',
        type: 'webhook',
        url: 'https://e2e.invalid/hook',
        secret: 'secret-e2e-hmac',
      }],
    },
  })
  expect(seeded.ok()).toBeTruthy()
  await page.reload() // l'URL garde ?tab=actions
  await expect(page.getByText('Actions & MCP')).toBeVisible()

  const nameInput = page.getByPlaceholder('nom_de_l_action')
  await expect(nameInput).toHaveValue('webhook_e2e')

  const warning = page.getByText('Renommer sans ressaisir le secret le supprimera (le secret est rattaché au nom).')
  await nameInput.fill('webhook_e2e_v2')
  await expect(warning).toBeVisible()

  // Annuler (save bar role=status) : retour à savedBot, rien n'est persisté.
  // On attend que la save bar soit stable (état dirty affiché) avant de cliquer
  // pour éviter un clic sur un bouton encore en train de (re)monter.
  const saveBar = page.getByRole('status')
  await expect(saveBar).toContainText('Modifications non enregistrées')
  // dispatchEvent : « Annuler » démonte la save bar (dirty=false) DÈS le clic ;
  // un click() classique re-vérifie l'actionabilité et voit le bouton se détacher
  // en boucle. On déclenche directement le handler onClick (revert fiable).
  await saveBar.getByRole('button', { name: 'Annuler', exact: true }).dispatchEvent('click')
  await expect(nameInput).toHaveValue('webhook_e2e')
  await expect(warning).toBeHidden()
})
