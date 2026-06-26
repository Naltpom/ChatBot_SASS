// Révélé progressif (« machine à écrire ») des bulles BOT du widget réel
// (widget/widget.js : typeInto). Bot DÉDIÉ mode tree (jamais le bot partagé),
// créé en beforeAll / supprimé en afterAll, captcha désactivé + localhost posés
// par createBot. MOCK_AI=false : tree pur, AUCUN chemin IA exercé.
//
// Deux garanties vérifiées :
//  1. Animation ON (défaut) : la bulle bot démarre sur un PRÉFIXE non vide et
//     plus court que le message complet, puis converge vers le texte EXACT
//     (état final identique au rendu direct -> sélecteurs e2e intacts ailleurs).
//  2. prefers-reduced-motion: reduce : AUCUN état partiel — la bulle porte le
//     texte complet dès sa première observation (repli accessibilité instantané).
import { expect, test } from '@playwright/test'
import { createBot, deleteBot, loadState } from '../helpers'
import { openFrame } from '../widget-helpers'

const state = loadState()
let botId: number
let publicKey: string

// Message long (≈90 mots) en texte BRUT (aucun token markdown, une seule ligne)
// -> le découpage par mots reconstruit un préfixe EXACT et toHaveText (qui
// normalise les espaces) matche l'identique. Assez long pour que l'animation
// dure largement plus que la capture du premier instantané (anti-flake).
const LONG_MSG =
  'Merci de votre message, voici une réponse volontairement longue afin de ' +
  'rendre le dévoilement progressif bien visible mot après mot. Notre service ' +
  'accompagne les artisans et les commerces de proximité dans la mise en place ' +
  'de leur assistant conversationnel, depuis la configuration initiale jusqu au ' +
  'suivi des conversations au quotidien. Chaque réponse apparait désormais de ' +
  'manière fluide et naturelle, par petits groupes de mots, ce qui rend la ' +
  'lecture nettement plus agréable que lorsque le texte tombait en un seul bloc ' +
  'compact et difficile a parcourir pour vos visiteurs pressés.'

const TYPE_TREE = {
  start: 'root',
  nodes: {
    root: {
      message: 'Bonjour ! Que souhaitez-vous ?',
      options: [{ label: 'Voir le détail', next: 'detail' }],
    },
    detail: {
      message: LONG_MSG,
      options: [{ label: 'Menu principal', next: 'root' }],
    },
  },
}

test.beforeAll(async ({ request }) => {
  const bot = await createBot(request, state, {
    name: `Bot typewriter E2E ${Date.now()}`,
    mode: 'tree',
    tree: TYPE_TREE,
    design: { title: 'Bot typewriter E2E' },
  })
  botId = bot.id
  publicKey = bot.publicKey
})

test.afterAll(async ({ request }) => {
  await deleteBot(request, state, botId)
})

test('animation ON : la bulle bot se dévoile par préfixes puis affiche le texte exact', async ({ page }) => {
  // Forçage explicite (indépendant d'une éventuelle config globale) : animations
  // autorisées -> typeInto s'exécute.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openFrame(page, state, publicKey)

  await expect(page.locator('.kc-head-name')).toHaveText('Bot typewriter E2E')
  await expect(page.locator('.kc-mode')).toHaveText('TREE')

  // Le corps de message vit dans le conteneur dédié .kc-msg-body (preuve que le
  // refactor est en place). 1 bulle bot après l'accueil (nœud racine).
  const bodies = page.locator('.kc-row.bot .kc-msg .kc-msg-body')
  await expect(bodies).toHaveCount(1)

  // Déclenche le nœud long -> 2e bulle bot animée.
  await page.locator('.kc-opt', { hasText: 'Voir le détail' }).click()
  await expect(bodies).toHaveCount(2)
  const answer = bodies.nth(1)

  // Instantané précoce : la 1re salve (1..5 mots) est peinte de façon synchrone
  // dès l'ajout de la bulle -> au moment où elle existe, le texte est un PRÉFIXE
  // non vide et strictement plus court que le message complet.
  const partial = (await answer.textContent()) ?? ''
  expect(partial.length).toBeGreaterThan(0)
  expect(partial.length).toBeLessThan(LONG_MSG.length)
  expect(LONG_MSG.startsWith(partial.trimEnd())).toBe(true)

  // Convergence : l'état FINAL est le texte EXACT (renderMd complet).
  await expect(answer).toHaveText(LONG_MSG)
})

test('prefers-reduced-motion : repli instantané, aucun état partiel', async ({ page }) => {
  // Réduction d'animations posée AVANT navigation : matchMedia renvoie reduce
  // au moment du rendu -> addMsg fait un renderMd direct (pas de typeInto).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openFrame(page, state, publicKey)

  const bodies = page.locator('.kc-row.bot .kc-msg .kc-msg-body')
  await expect(bodies).toHaveCount(1)

  await page.locator('.kc-opt', { hasText: 'Voir le détail' }).click()
  await expect(bodies).toHaveCount(2)
  const answer = bodies.nth(1)

  // Dès la 1re observation, le texte est COMPLET (le rendu direct est synchrone :
  // aucun préfixe partiel n'est jamais observable).
  const firstSeen = (await answer.textContent()) ?? ''
  expect(firstSeen).toBe(LONG_MSG)
  await expect(answer).toHaveText(LONG_MSG)
})
