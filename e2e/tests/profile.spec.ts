// Page Profil (parcours A) — joué avec le compte MEMBER du state : jetable et
// auth_source=local (l'admin dev est intranet → la carte mot de passe serait
// remplacée par l'InfoBox « Compte intranet »), et le compte principal doit
// rester stable pour le reste de la suite.
//
// Budget limiteur auth (10/15min/IP, partagé login+register+password) :
// flushRedis() en beforeAll remet le compteur à zéro ; ce spec consomme
// ensuite 4 hits POST /password (1 réparation + 2 happy/revert + 1 erreur),
// ×2 en cas de retry — marge garantie.
import { expect, test, request as pwRequest } from '@playwright/test'
import { STATE_PASSWORD, authHeaders, authenticateWithToken, flushRedis, loadState } from '../helpers'

const state = loadState()
const ALT_PASSWORD = 'MotDePasseE2E-2'

test.beforeAll(async () => {
  // Assurance budget : repart d'un limiteur vide quoi qu'aient consommé les
  // specs précédentes du run.
  flushRedis()
  // Auto-réparation : si un run précédent a crashé entre le changement de mot
  // de passe et son revert, le member est resté sur ALT_PASSWORD. Ce POST le
  // remet sur STATE_PASSWORD ; dans le cas nominal il répond 403 (« Mot de
  // passe actuel incorrect ») — ignoré, 1 hit de limiteur couvert par le flush.
  const ctx = await pwRequest.newContext({ baseURL: state.apiUrl })
  await ctx.post('/api/auth/password', {
    headers: authHeaders(state.memberToken!),
    data: { current_password: ALT_PASSWORD, new_password: STATE_PASSWORD },
  }).catch(() => {})
  await ctx.dispose()
})

test.beforeEach(async ({ page }) => {
  await authenticateWithToken(page, state.memberToken!, state.orgId)
  await page.goto('/app/profile')
  await expect(page.locator('.section-title')).toHaveText('Profil')
})

test('renommage du profil reflété dans la sidebar (puis revert)', async ({ page }) => {
  const nameInput = page.getByLabel('Nom')
  // Nouvelle sidebar (Layout.tsx) : le nom de l'utilisateur vit dans le bloc
  // user en bas — bouton .sidebar-user-main (title="Mon profil") qui contient
  // l'avatar (initiales), le nom (.sidebar-user-id .nm) et l'org (.org). On
  // cible la SEULE span du nom pour pouvoir asserter en texte exact (sinon les
  // initiales + le nom d'org polluent le texte du bouton). Le member n'est pas
  // superadmin → pas d'icône ShieldCheck dans .nm : c'est du texte pur.
  const sidebarName = page.locator('.sidebar-user-id .nm')

  await nameInput.fill('Membre E2E Renommé')
  await page.getByRole('button', { name: 'Mettre à jour' }).click()
  await expect(page.getByRole('button', { name: /Enregistré/ })).toBeVisible()
  await expect(sidebarName).toHaveText('Membre E2E Renommé')

  // REVERT dans le même test (le global-setup renormalise aussi en secours)
  await nameInput.fill(state.memberName!)
  await page.getByRole('button', { name: 'Mettre à jour' }).click()
  await expect(sidebarName).toHaveText(state.memberName!)
})

test('mot de passe : happy-path puis revert immédiat', async ({ page }) => {
  // On attend le 200 de l'API PUIS l'effet UI du succès (champs vidés), et on
  // REVERT aussitôt — le test reste ré-exécutable même interrompu au milieu
  // (beforeAll auto-répare ALT→STATE).
  const isPasswordPost = (r: { url(): string; request(): { method(): string } }) =>
    r.url().includes('/api/auth/password') && r.request().method() === 'POST'

  // 1. STATE_PASSWORD -> ALT_PASSWORD
  await page.getByLabel('Mot de passe actuel').fill(STATE_PASSWORD)
  await page.getByLabel('Nouveau mot de passe').fill(ALT_PASSWORD)
  await page.getByLabel('Confirmation').fill(ALT_PASSWORD)
  const change = page.waitForResponse(isPasswordPost)
  await page.getByRole('button', { name: 'Modifier le mot de passe' }).click()
  expect((await change).status()).toBe(200)

  // Anti-flake : Profile.tsx vide les 3 champs de façon ASYNCHRONE au resolve
  // du fetch (changePassword : setCurPw('')…, batché avec setPwDone(true)).
  // On attend cet effet UI AVANT de re-remplir, sinon le vidage peut
  // s'intercaler entre les fill() → bouton disabled → timeout au click.
  await expect(page.getByText('Mot de passe modifié.')).toBeVisible()
  await expect(page.getByLabel('Mot de passe actuel')).toHaveValue('')

  // 2. REVERT immédiat ALT_PASSWORD -> STATE_PASSWORD
  await page.getByLabel('Mot de passe actuel').fill(ALT_PASSWORD)
  await page.getByLabel('Nouveau mot de passe').fill(STATE_PASSWORD)
  await page.getByLabel('Confirmation').fill(STATE_PASSWORD)
  const revert = page.waitForResponse(isPasswordPost)
  await page.getByRole('button', { name: 'Modifier le mot de passe' }).click()
  expect((await revert).status()).toBe(200)

  // 3. Assertions UI (les JWT déjà émis restent valides : tokens stateless)
  await expect(page.getByText('Mot de passe modifié.')).toBeVisible()
})

test('« Mot de passe actuel incorrect » affiché SANS déconnexion silencieuse', async ({ page }) => {
  await page.getByLabel('Mot de passe actuel').fill('Mauvais-Mdp-9')
  await page.getByLabel('Nouveau mot de passe').fill('MotDePasseValide-3')
  await page.getByLabel('Confirmation').fill('MotDePasseValide-3')
  await page.getByRole('button', { name: 'Modifier le mot de passe' }).click()

  // Le 403 de /api/auth/* ne purge PAS le token (régression corrigée) :
  // l'erreur s'affiche, on reste sur la page, connecté.
  await expect(page.locator('div.error')).toHaveText('Mot de passe actuel incorrect')
  await expect(page).toHaveURL(/\/app\/profile/)
  await expect(page.locator('.sidebar')).toBeVisible()

  // Toujours connecté : la navigation app fonctionne, pas de redirect /login
  await page.goto('/app')
  await expect(page.getByText('Mes chatbots').first()).toBeVisible()
  await expect(page).toHaveURL(/\/app$/)
})
