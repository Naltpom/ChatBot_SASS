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
  // Fermeture via le backdrop. On clique dans la PARTIE VISIBLE du backdrop (à
  // droite, hors du drawer) : le drawer ouvert (248px, z-index 210) recouvre le
  // centre du backdrop (390px de large), donc un clic au centre par défaut est
  // intercepté par le drawer et n'aboutit jamais. Sur une machine rapide le clic
  // tombait pendant le slide-in (.25s) tant que le centre était encore dégagé ;
  // sur un runner CI froid l'animation était finie et le clic restait bloqué
  // (timeout). Viser la zone réellement exposée (comme un vrai tap) supprime la
  // course au timing — c'est aussi le geste utilisateur réel.
  await page.locator('.sidebar-backdrop').click({ position: { x: 360, y: 410 } })
  await expect(page.locator('aside.sidebar.open')).toHaveCount(0)
})
