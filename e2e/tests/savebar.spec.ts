// Save bar sombre de l'éditeur de bot (refonte Chapote) — bot partagé du
// state. role="status", bouton « Enregistrer », pastille d'onglet dirty
// (.tab-dot dans .tabs + pill cliquable dans la barre), Annuler restaure,
// Ctrl+S sauvegarde et persiste. Les domaines ajoutés/sauvegardés sont remis
// à plat par le tryReuse du global-setup au run suivant ; « localhost » n'est
// jamais retiré → widget.spec reste vert dans le même run.
import { expect, test } from '@playwright/test'
import { authenticate, loadState } from '../helpers'

const state = loadState()

test.beforeEach(async ({ page }) => {
  await authenticate(page, state)
  await page.goto(`/app/bots/${state.botId}`)
  // Éditeur chargé : on attend la barre d'onglets (le nom du bot apparaît à
  // plusieurs endroits, donc input[value] serait ambigu).
  await expect(page.locator('.tabs').getByRole('button', { name: 'Apparence', exact: true })).toBeVisible()
})

test('dirty → barre visible à scroll 0, pastille d\'onglet, Annuler restaure', async ({ page }) => {
  // Rendre l'onglet Installation (sécurité) dirty : ajout d'un domaine (non sauvegardé)
  await page.locator('.tabs').getByRole('button', { name: 'Installation', exact: true }).click()
  await page.getByPlaceholder('autre-domaine.fr').fill('e2e-savebar.fr')
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  // La barre (role=status, fixée en bas) est visible même remonté en haut de page
  const bar = page.getByRole('status')
  await expect(bar).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(bar).toBeInViewport()
  await expect(bar).toContainText('Modifications non enregistrées')

  // Marqueur dirty sur l'onglet Sécurité (.tab-dot dans la barre d'onglets)
  await expect(page.locator('.tabs button', { hasText: 'Installation' }).locator('.tab-dot')).toBeVisible()

  // Pastille d'onglet dirty DANS la barre (bouton cliquable libellé « Sécurité »)
  const pill = bar.getByRole('button', { name: 'Installation', exact: true })
  await expect(pill).toBeVisible()

  // Depuis un autre onglet, la pastille ramène sur l'onglet dirty
  await page.locator('.tabs').getByRole('button', { name: 'Apparence', exact: true }).click()
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

  await page.locator('.tabs').getByRole('button', { name: 'Installation', exact: true }).click()
  await page.getByPlaceholder('autre-domaine.fr').fill(domain)
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  // La barre dirty est là avant le raccourci
  const bar = page.getByRole('status')
  await expect(bar).toContainText('Modifications non enregistrées')

  await page.keyboard.press('Control+s')
  // Web-first : la barre passe en état « Enregistré » (succès) ~2,5 s avant de
  // disparaître. Le bouton et le message portent tous deux « Enregistré ».
  await expect(bar).toContainText('Enregistré')

  // Persistance serveur : le domaine est toujours là après reload
  await page.reload()
  await page.locator('.tabs').getByRole('button', { name: 'Installation', exact: true }).click()
  await expect(page.locator('.domain-row', { hasText: domain })).toBeVisible()
})
