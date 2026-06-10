// Wizard de création en mode ARBRE (aucun chemin IA) : Les bases -> Arbre ->
// Apparence -> Sécurité -> création réelle -> Intégration (snippet <script>)
// -> page du bot. Auth : token du global-setup injecté via addInitScript.
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
})

test('parcours complet du wizard en mode arbre jusqu\'à l\'intégration', async ({ page }) => {
  const botName = `Bot Wizard E2E ${Date.now()}`

  await page.goto('/app/bots/new')
  await expect(page.getByText('Nouveau chatbot')).toBeVisible()

  // --- Étape 1/5 : Les bases ---
  await page.getByPlaceholder("ex. Assistant d'accueil").fill(botName)
  await page.getByPlaceholder('www.mon-site.fr').fill('www.exemple-e2e.fr')
  // Type « Arbre » — carte identifiée par sa description (les boutons étant
  // imbriqués dans un <label>, leur nom accessible n'est pas fiable)
  await page.locator('button.mode-card', { hasText: 'Menu guidé uniquement' }).click()
  await page.getByRole('button', { name: /Continuer/ }).click()

  // --- Étape 2/5 : Arbre (builder visuel) ---
  await expect(page.getByText('Arbre de décision', { exact: true })).toBeVisible()
  await expect(page.getByText("Message d'accueil").first()).toBeVisible()
  await page.getByRole('button', { name: /Continuer/ }).click()

  // --- Étape 3/5 : Apparence (aperçu live) ---
  await expect(page.getByText('Couleur de marque')).toBeVisible()
  await page.getByRole('button', { name: /Continuer/ }).click()

  // --- Étape 4/5 : Sécurité (Turnstile imposé par défaut) ---
  await expect(page.getByText('Cloudflare Turnstile')).toBeVisible()
  await expect(page.getByText('www.exemple-e2e.fr').first()).toBeVisible()

  // Création réelle du bot au passage 4 -> 5
  await page.getByRole('button', { name: /Créer le chatbot/ }).click()

  // --- Étape 5/5 : Intégration ---
  await expect(page.getByText('est prêt. Ajoutez-le à votre site')).toBeVisible()
  const snippet = page.locator('pre.snippet')
  await expect(snippet).toContainText('<script')
  await expect(snippet).toContainText('data-bot-key="pk_')
  await expect(snippet).toContainText('/widget.js')

  // Arrivée sur la page du bot
  await page.getByRole('button', { name: /Terminer/ }).click()
  await expect(page).toHaveURL(/\/app\/bots\/\d+$/)
  await expect(page.getByText(botName).first()).toBeVisible()
})
