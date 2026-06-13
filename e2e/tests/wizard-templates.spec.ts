// Templates d'arbres dans le wizard (parcours E) — étape Arbre (mode tree) :
// galerie « Partir d'un modèle » (4 templates), aperçu local, application au
// builder. AUCUN bot créé (sortie avant le passage 3→4 qui déclenche la
// création réelle) → rien à nettoyer, 0 register.
//
// MOCK_AI=false : mode tree imposé, WidgetPreview = réplique React locale
// (navigue le tree_json en local, IA simulée) → aucun appel widget/provider.
// wizard-tree.spec (fichier séparé) reste intact.
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto('/app/bots/new')
})

test('mode tree : galerie 4 templates → aperçu → utiliser → builder peuplé, sortie sans création', async ({ page }) => {
  await expect(page.getByText('Nouveau chatbot')).toBeVisible()

  // --- Étape 0 : Les bases (nom + site + mode Arbre) ---
  await page.getByPlaceholder("ex. Assistant d'accueil").fill('Bot Templates E2E')
  await page.getByPlaceholder('www.mon-site.fr').fill('www.exemple-templates-e2e.fr')
  await page.locator('button.mode-card', { hasText: 'Menu guidé uniquement' }).click()
  await page.getByRole('button', { name: /Continuer/ }).click()

  // --- Étape Arbre : galerie + builder coexistent ---
  await expect(page.getByText("Partir d'un modèle")).toBeVisible()
  // Contrat strict : UN SEUL TreeBuilder monté
  await expect(page.getByText('Arbre de décision', { exact: true })).toHaveCount(1)

  // 4 templates avec leurs libellés
  await expect(page.locator('.tpl-card')).toHaveCount(4)
  const ecommerce = page.locator('.tpl-card', { hasText: 'E-commerce' })
  await expect(ecommerce).toBeVisible()
  await expect(page.locator('.tpl-card', { hasText: 'Cabinet & services' })).toBeVisible()
  await expect(page.locator('.tpl-card', { hasText: 'Restaurant' })).toBeVisible()
  await expect(page.locator('.tpl-card', { hasText: 'SaaS & logiciel' })).toBeVisible()

  // --- Aperçu E-commerce : WidgetPreview local (PreviewFrame), aucun réseau ---
  await ecommerce.getByRole('button', { name: 'Aperçu', exact: true }).click()
  await expect(page.locator('.preview-stage')).toBeVisible()
  await page.getByRole('button', { name: "Fermer l'aperçu" }).click()
  await expect(page.locator('.preview-stage')).toHaveCount(0)

  // --- Utiliser ce modèle : STARTER_TREE wizard a 2 nœuds → pas de confirm,
  // mais on l'accepte par sûreté ---
  page.on('dialog', d => d.accept())
  await ecommerce.getByRole('button', { name: 'Utiliser ce modèle' }).click()

  // Builder peuplé : un nœud du template E-commerce (libellé d'option racine)
  await expect(page.locator('.tree-node-btn', { hasText: 'Suivre ma commande' })).toBeVisible()

  // --- Sortie SANS création (la création réelle n'a lieu qu'au passage 3→4) ---
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app$/)
})
