// Composer TikTok de l'Espace client (/app/tiktok/publish) : conformité aux
// Content Sharing Guidelines TikTok (ce que vérifie le relecteur TikTok).
// L'API Chapote est ENTIÈREMENT mockée (page.route) : aucun appel TikTok ni
// Chapote réel, pas de dépendance aux données du global-setup.
import { expect, Page, Route, test } from '@playwright/test'
import { blockAutoLogin } from '../helpers'

const USER = {
  id: 7, email: 'client@test.dev', name: 'Client', auth_source: 'local', email_verified: true,
  is_superadmin: false, organizations: [], billing_grouping: 'total', is_billing_enabled: false,
  owned_org_ids: [], twofa_enabled: false, twofa_required: false,
}
const ACCOUNT = {
  id: 1, display_name: 'studio.demo', avatar_url: null, can_publish: true, can_upload: true,
  needs_reconnect: false, connected_at: '2026-10-21T10:00:00', can_disconnect: true,
}
const CREATOR = {
  can_post: true,
  creator: {
    nickname: 'Studio Démo', username: 'studio.demo', avatar_url: null,
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    comment_disabled: false, duet_disabled: true, stitch_disabled: false,
    max_video_post_duration_sec: 600,
  },
}
const MUSIC = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
const BC = 'https://www.tiktok.com/legal/page/global/bc-policy/en'

interface Mock { creator: any; calls: { method: string; path: string }[] }

async function mockApi(page: Page, creator: any = CREATOR): Promise<Mock> {
  const mock: Mock = { creator, calls: [] }
  await page.route(/\/api\//, async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    mock.calls.push({ method: req.method(), path })
    const json = (body: any, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/auth/me') return json(USER)
    if (path === '/api/tiktok/config') {
      return json({ enabled: true, max_upload_bytes: 1024 ** 3, max_duration_sec: 600, part_size: 8 * 1024 * 1024,
                    title_max: 2200, formats: ['video/mp4', 'video/quicktime', 'video/webm'] })
    }
    if (path === '/api/tiktok/accounts') return json([ACCOUNT])
    if (path === '/api/tiktok/accounts/1/creator-info') return json(mock.creator)
    if (path === '/api/tiktok/posts' && req.method() === 'POST') return json({ post_id: 42, part_size: 8 * 1024 * 1024, part_count: 1 })
    if (path === '/api/tiktok/posts/42/parts/0') return json({ ok: true, received_bytes: 10 })
    const post = { id: 42, account_id: 1, account_name: 'studio.demo', mode: 'direct', title: 'Ma vidéo',
                   privacy_level: 'PUBLIC_TO_EVERYONE', brand_organic: false, brand_content: false,
                   file_name: 'clip.mp4', video_size: 10, fail_reason: null, error_message: null, post_ids: [],
                   created_at: null, updated_at: null }
    if (path === '/api/tiktok/posts/42/submit') return json({ ...post, status: 'QUEUED' })
    if (path === '/api/tiktok/posts/42') return json({ ...post, status: 'PROCESSING_UPLOAD' })
    return json(req.method() === 'GET' ? [] : {})
  })
  return mock
}

async function openComposer(page: Page, creator: any = CREATOR) {
  await blockAutoLogin(page)
  const mock = await mockApi(page, creator)
  await page.goto('/app/tiktok/publish?account=1')
  await expect(page.getByTestId('creator-nickname')).toContainText('Studio Démo')
  return mock
}

async function pickVideo(page: Page) {
  await page.getByLabel('Vidéo', { exact: true }).setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(10) })
}

const publishBtn = (page: Page) => page.getByRole('button', { name: 'Publier', exact: true })
const privacy = (page: Page) => page.getByLabel('Qui peut voir cette vidéo')

test('creator_info interrogé à l\'ouverture, pseudo affiché, aperçu de la vidéo', async ({ page }) => {
  const mock = await openComposer(page)
  expect(mock.calls.some(c => c.path === '/api/tiktok/accounts/1/creator-info')).toBe(true)
  await expect(page.getByTestId('creator-nickname')).toContainText('@studio.demo')
  await expect(page.getByTestId('video-preview')).toHaveCount(0)
  await pickVideo(page)
  const preview = page.getByTestId('video-preview')
  await expect(preview).toBeVisible()
  expect(await preview.getAttribute('src')).toMatch(/^blob:/)
  // Aucun texte imposé : titre vide.
  await expect(page.getByLabel('Titre')).toHaveValue('')
})

test('aucune confidentialité présélectionnée, options issues de creator_info', async ({ page }) => {
  await openComposer(page)
  await pickVideo(page)
  await expect(privacy(page)).toHaveValue('')
  const options = await privacy(page).locator('option:not([value=""])').allTextContents()
  expect(options).toEqual(['Tout le monde', 'Amis', 'Moi uniquement'])
  await expect(publishBtn(page)).toBeDisabled()
  await privacy(page).selectOption('PUBLIC_TO_EVERYONE')
  await expect(publishBtn(page)).toBeEnabled()
})

test('interactions décochées par défaut, grisées si coupées chez le créateur', async ({ page }) => {
  await openComposer(page)
  const comments = page.getByLabel('Autoriser les commentaires')
  const duet = page.getByLabel('Autoriser les Duos')
  const stitch = page.getByLabel('Autoriser les Collages')
  for (const box of [comments, duet, stitch]) await expect(box).not.toBeChecked()
  await expect(duet).toBeDisabled()          // duet_disabled: true
  await expect(comments).toBeEnabled()
  await expect(stitch).toBeEnabled()
})

test('divulgation commerciale : bouton bloqué, libellés, « Moi uniquement » interdit pour le contenu de marque', async ({ page }) => {
  await openComposer(page)
  await pickVideo(page)
  await privacy(page).selectOption('SELF_ONLY')
  await expect(publishBtn(page)).toBeEnabled()

  // Interrupteur désactivé par défaut ; activé sans case cochée -> Publier bloqué + infobulle.
  const toggle = page.getByRole('switch', { name: 'Divulgation de contenu commercial' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(publishBtn(page)).toBeDisabled()
  await expect(page.getByTestId('publish-wrap')).toHaveAttribute('title',
    "Vous devez indiquer si votre contenu fait la promotion de vous-même, d'un tiers, ou des deux.")

  // « Votre marque » seule -> Contenu promotionnel, Music Usage seule.
  await page.getByLabel('Votre marque').check()
  await expect(page.getByTestId('commercial-label')).toHaveText('Votre vidéo sera étiquetée « Contenu promotionnel ».')
  await expect(publishBtn(page)).toBeEnabled()
  await expect(page.getByTestId('consent')).toHaveText('En publiant, vous acceptez la Music Usage Confirmation de TikTok.')

  // « Contenu de marque » -> Partenariat rémunéré, SELF_ONLY retiré et désactivé.
  await page.getByLabel('Contenu de marque').check()
  await expect(page.getByTestId('commercial-label')).toHaveText('Votre vidéo sera étiquetée « Partenariat rémunéré ».')
  await expect(privacy(page)).toHaveValue('')
  const selfOnly = privacy(page).locator('option[value="SELF_ONLY"]')
  expect(await selfOnly.evaluate(o => (o as HTMLOptionElement).disabled)).toBe(true)
  await privacy(page).selectOption('SELF_ONLY', { force: true })   // même forcé : refusé
  await expect(privacy(page)).toHaveValue('')
  await expect(selfOnly).toHaveAttribute('title', "La visibilité d'un contenu de marque ne peut pas être privée.")
  await expect(page.getByTestId('branded-private-hint')).toHaveText("La visibilité d'un contenu de marque ne peut pas être privée.")
  await expect(publishBtn(page)).toBeDisabled()        // confidentialité à re-choisir

  // Les deux cochées : toujours « Partenariat rémunéré ».
  await expect(page.getByLabel('Votre marque')).toBeChecked()
  await expect(page.getByTestId('commercial-label')).toHaveText('Votre vidéo sera étiquetée « Partenariat rémunéré ».')

  // « Contenu de marque » seule.
  await page.getByLabel('Votre marque').uncheck()
  await expect(page.getByTestId('commercial-label')).toHaveText('Votre vidéo sera étiquetée « Partenariat rémunéré ».')
})

test('déclaration de consentement et liens TikTok selon la divulgation', async ({ page }) => {
  await openComposer(page)
  const consent = page.getByTestId('consent')
  await expect(consent).toHaveText('En publiant, vous acceptez la Music Usage Confirmation de TikTok.')
  await expect(consent.getByRole('link', { name: 'Music Usage Confirmation' })).toHaveAttribute('href', MUSIC)
  await expect(consent.getByRole('link', { name: 'Branded Content Policy' })).toHaveCount(0)

  await page.getByRole('switch', { name: 'Divulgation de contenu commercial' }).click()
  await page.getByLabel('Contenu de marque').check()
  await expect(consent).toHaveText('En publiant, vous acceptez la Branded Content Policy et la Music Usage Confirmation de TikTok.')
  await expect(consent.getByRole('link', { name: 'Branded Content Policy' })).toHaveAttribute('href', BC)
  await expect(consent.getByRole('link', { name: 'Music Usage Confirmation' })).toHaveAttribute('href', MUSIC)
})

test('rien n\'est envoyé avant le clic sur Publier, puis message de traitement', async ({ page }) => {
  const mock = await openComposer(page)
  await pickVideo(page)
  await page.getByLabel('Titre').fill('Ma vidéo')
  await privacy(page).selectOption('PUBLIC_TO_EVERYONE')
  await page.waitForTimeout(300)
  expect(mock.calls.filter(c => c.method !== 'GET')).toEqual([])
  await publishBtn(page).click()
  await expect(page.getByTestId('publish-status')).toContainText(
    'Le traitement peut prendre quelques minutes avant que la vidéo soit visible sur votre profil.')
  const writes = mock.calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${c.path}`)
  expect(writes).toEqual(['POST /api/tiktok/posts', 'PUT /api/tiktok/posts/42/parts/0', 'POST /api/tiktok/posts/42/submit'])
})

test('créateur ne pouvant pas publier : composer bloqué', async ({ page }) => {
  await blockAutoLogin(page)
  await mockApi(page, { can_post: false, reason_code: 'spam_risk_too_many_posts',
                        message: 'Ce compte a atteint le nombre maximal de publications autorisées pour aujourd\'hui.', creator: null })
  await page.goto('/app/tiktok/publish?account=1')
  await expect(page.getByText('Publication impossible pour le moment')).toBeVisible()
  await expect(page.getByText('Réessayez plus tard.')).toBeVisible()
  await expect(publishBtn(page)).toHaveCount(0)
})

test('mode brouillon : explication, pas de réglages Direct Post', async ({ page }) => {
  await openComposer(page)
  await page.getByRole('button', { name: 'Envoyer en brouillon' }).click()
  await expect(page.getByText(/boîte de réception TikTok de ce compte/)).toBeVisible()
  await expect(privacy(page)).toHaveCount(0)
  await expect(page.getByTestId('consent')).toHaveCount(0)
  const send = page.getByRole('button', { name: 'Envoyer en brouillon' }).last()
  await expect(send).toBeDisabled()
  await pickVideo(page)
  await expect(send).toBeEnabled()
})

test('page TikTok de l\'Espace client : comptes, conseil multi-comptes, liens légaux', async ({ page }) => {
  await blockAutoLogin(page)
  await mockApi(page)
  await page.goto('/app/tiktok')
  await expect(page.getByRole('button', { name: 'Se connecter avec TikTok' })).toBeEnabled()
  await expect(page.getByTestId('tiktok-account')).toContainText('studio.demo')
  await expect(page.getByTestId('tiktok-account')).toContainText('Connecté')
  await expect(page.getByRole('button', { name: 'Déconnecter' })).toBeVisible()
  await expect(page.getByText("Pour connecter un autre compte, connectez-vous d'abord à ce compte sur tiktok.com dans ce navigateur.")).toBeVisible()
  await expect(page.getByRole('link', { name: "Conditions d'utilisation du module TikTok" })).toHaveAttribute('href', '/legal/tiktok-cgu')
  await expect(page.getByRole('link', { name: 'Politique de confidentialité du module TikTok' })).toHaveAttribute('href', '/legal/tiktok-confidentialite')
  await page.getByRole('link', { name: 'Publier une vidéo' }).click()
  await expect(page).toHaveURL(/\/app\/tiktok\/publish\?account=1$/)
  await expect(page.getByTestId('creator-nickname')).toContainText('Studio Démo')
})
