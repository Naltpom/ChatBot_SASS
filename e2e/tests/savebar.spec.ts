// Save bar sticky de BotPage (parcours I) — bot partagé du state ; les
// modifications saved (domaine ajouté en I2) sont remises à plat par le
// tryReuse du global-setup au run suivant. « localhost » n'est jamais retiré
// → widget.spec reste vert dans le même run.
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${state.botId}`)
  await expect(page.getByText('Bot partagé E2E').first()).toBeVisible()
})

test('dirty → barre visible à scroll 0, pastille d\'onglet, Annuler restaure', async ({ page }) => {
  // Rendre l'onglet Sécurité dirty : ajout d'un domaine (non sauvegardé)
  await page.locator('.tabs').getByRole('button', { name: 'Sécurité' }).click()
  await page.getByPlaceholder('autre-domaine.fr').fill('e2e-savebar.fr')
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  // La barre (role=status) est sticky : visible même remonté en haut de page
  const bar = page.getByRole('status')
  await expect(bar).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(bar).toBeInViewport()
  await expect(bar).toContainText('Modifications non enregistrées')

  // Pastille de l'onglet dirty — scopée à la barre (même libellé dans .tabs)
  const pill = bar.locator('button.chip.chip-warn', { hasText: 'Sécurité' })
  await expect(pill).toBeVisible()

  // Depuis un autre onglet, la pastille ramène sur l'onglet dirty
  await page.locator('.tabs').getByRole('button', { name: 'Stats' }).click()
  await pill.click()
  await expect(page.getByText('Domaines autorisés').first()).toBeVisible()

  // Annuler = deep-clone de savedBot : barre masquée, domaine disparu
  await bar.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(bar).toBeHidden()
  await expect(page.locator('.domain-row', { hasText: 'e2e-savebar.fr' })).toHaveCount(0)
})

test('Ctrl+S sauvegarde et la modification persiste après reload', async ({ page }) => {
  // Domaine unique par tentative : l'ajout d'un doublon serait ignoré par
  // l'UI (pas de dirty) et casserait le retry — tryReuse purge au run suivant.
  const domain = `e2e-ctrls-${Date.now()}.fr`

  await page.locator('.tabs').getByRole('button', { name: 'Sécurité' }).click()
  await page.getByPlaceholder('autre-domaine.fr').fill(domain)
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  await page.keyboard.press('Control+s')
  // Assertions immédiates (web-first) : la barre s'efface ~2,5 s après le save
  await expect(page.getByText('Modifications enregistrées')).toBeVisible()
  await expect(page.getByRole('button', { name: /Enregistré/ })).toBeVisible()

  // Persistance serveur : le domaine est toujours là après reload
  await page.reload()
  await expect(page.locator('.domain-row', { hasText: domain })).toBeVisible()
})
