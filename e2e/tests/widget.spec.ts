// Widget réel en mode iframe : /widget-frame?key=pk_… (servi par l'API).
// Bot du global-setup : mode arbre, captcha désactivé -> AUCUN captcha,
// AUCUN appel IA. On clique une option de l'arbre et on vérifie la réponse
// du nœud cible.
import { expect, test } from '@playwright/test'
import { loadState } from '../helpers'

const state = loadState()

test('le widget bootstrap, navigue l\'arbre et affiche la réponse du nœud cible', async ({ page }) => {
  await page.goto(`${state.apiUrl}/widget-frame?key=${state.publicKey}`)

  // Bootstrap : en-tête au nom du bot, mode arbre (badge TREE)
  await expect(page.locator('.kc-head-name')).toHaveText('Bot partagé E2E')
  await expect(page.locator('.kc-mode')).toHaveText('TREE')

  // Handshake session (captcha disabled) -> message d'accueil du nœud racine
  await expect(page.locator('.kc-row.bot .kc-msg').first())
    .toContainText('Bonjour ! Comment puis-je vous aider ?')

  // Options de l'arbre proposées
  const optHoraires = page.locator('.kc-opt', { hasText: 'Nos horaires' })
  await expect(optHoraires).toBeVisible()
  await expect(page.locator('.kc-opt', { hasText: 'Nos services' })).toBeVisible()

  // Mode arbre pur : pas de saisie libre (aucun chemin IA possible)
  await expect(page.locator('.kc-inputrow')).toBeHidden()

  // Clic sur une option -> réponse du nœud cible
  await optHoraires.click()
  await expect(page.locator('.kc-row.user .kc-msg').last()).toContainText('Nos horaires')
  await expect(page.locator('.kc-row.bot .kc-msg').last())
    .toContainText('du lundi au vendredi, de 9h à 18h')

  // Le nœud cible propose le retour au menu
  await expect(page.locator('.kc-opt', { hasText: 'Menu principal' })).toBeVisible()
})
