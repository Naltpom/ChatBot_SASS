// Smoke responsive mobile (refonte Chapote) — viewport téléphone.
// Vérifie le menu burger de la landing et le drawer du shell applicatif.
import { expect, test } from '@playwright/test'
import { authenticate, blockAutoLogin, loadState } from '../helpers'

const state = loadState()

test.use({ viewport: { width: 390, height: 820 } })

test('landing mobile : nav repliée derrière le burger', async ({ page }) => {
  await blockAutoLogin(page)
  await page.goto('/')
  // La nav desktop est masquée (<920px), le burger est visible.
  await expect(page.locator('.ch-nav-links').first()).toBeHidden()
  const burger = page.locator('.ch-menu-btn')
  await expect(burger).toBeVisible()
  await expect(burger).toHaveAttribute('aria-expanded', 'false')
  await burger.click()
  await expect(burger).toHaveAttribute('aria-expanded', 'true')
})

test('app mobile : sidebar en drawer via le hamburger', async ({ page }) => {
  await authenticate(page, state)
  await page.goto('/app')
  // Barre haute mobile + hamburger présents ; drawer fermé au départ.
  await expect(page.locator('.topbar-mobile')).toBeVisible()
  const burger = page.getByRole('button', { name: 'Menu' })
  await expect(burger).toBeVisible()
  await expect(page.locator('aside.sidebar.open')).toHaveCount(0)
  // Ouverture du drawer → la sidebar et ses entrées apparaissent.
  await burger.click()
  await expect(page.locator('aside.sidebar.open')).toBeVisible()
  await expect(page.locator('aside.sidebar.open').getByRole('button', { name: 'Mes chatbots' })).toBeVisible()
  // Fermeture via le backdrop.
  await page.locator('.sidebar-backdrop').click()
  await expect(page.locator('aside.sidebar.open')).toHaveCount(0)
})
