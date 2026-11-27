// Captures fidèles de l'app cm.chapote.fr (cm/dist construit depuis le vrai code), avec des données fictives.
// Usage : node capture.js [clé…]   (sans clé : tous les écrans, mobile et ordinateur)
// Prérequis : cd /home/user/ChatBot_SASS/cm && npm run build
const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const D = require('./demo-data-pilote')

const DIST = process.env.CM_DIST || '/home/user/ChatBot_SASS/cm/dist'
const HERE = __dirname
const MEDIA = path.join(HERE, 'media')
const OUT = path.join(HERE, '..', 'pilotes', 'ecrans')
const PORT = 4789
const ORIGIN = `http://localhost:${PORT}`

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.mp4': 'video/mp4', '.webp': 'image/webp' }

// Serveur : dist/ avec la règle nginx (try_files $uri $uri/index.html /app.html) + médias de démo (vidéo avec Range).
function serveFile(req, res, file) {
  const stat = fs.statSync(file)
  const type = TYPES[path.extname(file)] || 'application/octet-stream'
  const range = req.headers.range
  if (range && type === 'video/mp4') {
    const [s, e] = range.replace('bytes=', '').split('-')
    const start = Number(s), end = e ? Number(e) : stat.size - 1
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 })
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
  fs.createReadStream(file).pipe(res)
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN)
  const p = decodeURIComponent(url.pathname)
  if (p.startsWith('/media/stream/') || /^\/api\/cm\/(assets|posts)\/\d+\/(stream|video)$/.test(p)) return serveFile(req, res, path.join(MEDIA, 'demo.mp4'))
  if (p.startsWith('/media/')) { const f = path.join(MEDIA, path.basename(p)); if (fs.existsSync(f)) return serveFile(req, res, f) }
  const cands = [path.join(DIST, p), path.join(DIST, p, 'index.html'), path.join(DIST, 'app.html')]
  for (const f of cands) if (f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) return serveFile(req, res, f)
  res.writeHead(404); res.end()
})

// API fictive.
const unknown = new Set()
let apiCount = 0
function api(method, p, q, body) {
  if (process.env.DEBUG_API) console.log("API", method, p, q.toString())
  if (++apiCount > 5000) throw new Error("trop d’appels")
  const m = (re) => p.match(re)
  if (p === '/api/auth/me') return D.me
  if (p === '/api/cm/public-config') return { google_client_id: null, app_url: 'https://chapote.fr' }
  if (p === '/api/cm/config') return { tiktok: true, youtube: true, instagram_api: true, max_upload_bytes: 1024 ** 3, part_size: 8 * 1024 ** 2,
    tiktok_title_max: 2200, youtube_title_max: 100, youtube_max_duration_sec: 180, youtube_daily_posts: 6, instagram_caption_max: 2200, instagram_max_duration_sec: 900, tiktok_stats: true }
  if (p === '/api/cm/spaces') return D.spaces
  if (p === '/api/cm/groups') return D.groups
  if (p === '/api/cm/accounts') {
    let l = D.accounts
    if (q.get('q')) l = l.filter(a => a.name.toLowerCase().includes(q.get('q').toLowerCase()))
    return l
  }
  if (p === '/api/cm/me/capabilities') return { can_publish_any: true, accounts: D.accounts.map(a => ({ key: `${a.platform}:${a.id}`, platform: a.platform, id: a.id, org_id: null, role: 'admin', owner: null, mine: true })) }
  if (p === '/api/cm/invitations') return D.invitations
  if (p === '/api/cm/proposals/count') return { open: D.proposals.length, by_group: { 1: 1, 2: 1 } }
  if (p === '/api/cm/proposals') return D.proposals
  if (m(/^\/api\/cm\/proposals\/(\d+)$/)) return D.proposals.find(x => x.id === Number(m(/(\d+)$/)[1]))
  if (p === '/api/cm/profile') {
    const prof = { perso_name: 'Atelier Camille', palette: 'warm', theme: 'light', language: 'fr', prefs_rev: 7 }
    return prof
  }
  if (p === '/api/cm/calendar') {
    const s = new Date(q.get('start')), e = new Date(q.get('end'))
    let items = D.calendarItems.filter(i => new Date(i.at) >= s && new Date(i.at) < e)
    if (q.get('q')) items = D.calendarItems.filter(i => (i.title || '').toLowerCase().includes(q.get('q').toLowerCase()))
    return { start: q.get('start'), end: q.get('end'), items, days: D.days }
  }
  if (m(/^\/api\/cm\/posts\/(\d+)$/)) return D.postById(Number(m(/(\d+)$/)[1]))
  if (p === '/api/cm/posts') return []
  if (p === '/api/cm/stats') return D.detailedStats
  if (p === '/api/cm/overview') return D.overview
  if (p === '/api/cm/videos') {
    const sort = q.get('sort') || 'views'
    return [...D.videos].sort((a, b) => (b[sort] ?? b.views) - (a[sort] ?? a.views)).slice(0, Number(q.get('limit') || 12))
  }
  if (p === '/api/cm/transfers') return { incoming: [], outgoing: [] }
  if (p === '/api/cm/drive/storages') return { ...D.storage, storages: [{ ...D.storage, id: 1, name: 'Drive de Camille', position: 0, room_bytes: Math.round(37.6 * 1024 ** 3), error: null, assign: null }] }
  if (p === '/api/cm/drive/storage') return D.storage
  if (p === '/api/cm/drive/archive') return { oauth_enabled: true, connected: true, email: 'camille@example.com', error: null, folder_url: 'https://drive.google.com/', folder_name: 'cm.chapote.fr' }
  if (p === '/api/cm/library/robot') return { enabled: true, email: 'robot@example.com' }
  if (p === '/api/cm/library/elsewhere') return []
  if (p === '/api/cm/sources') return D.sources
  if (m(/^\/api\/cm\/sources\/(\d+)\/folders$/)) {
    const id = Number(m(/sources\/(\d+)/)[1])
    const fol = { 1: [['Coulisses', 8], ['Nouveautés', 6]], 2: [['Recettes', 9]], 3: [['Clips', 5]] }[id] || []
    return { source_id: id, name: D.sources.find(s => s.id === id)?.name, path: q.get('path') || '', videos: 0, folders: fol.map(([n, v]) => ({ name: n, path: n, videos: v })) }
  }
  if (p === '/api/cm/assets') {
    let l = D.assets
    const st = q.get('state')
    if (st === 'new') l = l.filter(a => !a.scheduled && !a.published)
    if (st === 'used') l = l.filter(a => a.scheduled || a.published)
    if (q.get('source_id')) l = l.filter(a => a.source_id === Number(q.get('source_id')))
    if (q.get('q')) l = l.filter(a => a.title.toLowerCase().includes(q.get('q').toLowerCase()))
    return l
  }
  if (m(/^\/api\/cm\/assets\/(\d+)$/)) return D.assets.find(a => a.id === Number(m(/(\d+)$/)[1]))
  if (p === '/api/cm/google-identities') return { account_email: 'camille@example.com', identities: [] }
  if (m(/^\/api\/cm\/groups\/(\d+)\/shares$/)) return D.groupShares[Number(m(/groups\/(\d+)/)[1])] || []
  if (p === '/api/cm/people') return { org_id: null, name: 'Espace perso', my_role: 'admin', can_manage: true, people: [] }
  if (m(/^\/api\/tiktok\/accounts\/(\d+)\/creator-info$/)) {
    const a = D.accounts.find(x => x.platform === 'tiktok' && x.id === Number(m(/accounts\/(\d+)/)[1]))
    return { can_post: true, creator: { nickname: a.name, username: a.handle, avatar_url: null, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
      comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 600 } }
  }
  if (p === '/api/auth/2fa/status') return { totp_enabled: true, passkeys: [{ id: 1, name: 'Téléphone' }], recovery_remaining: 8, required: false, enabled: true }
  if (p === '/api/auth/2fa/webauthn/credentials') return []
  if (p === '/api/cm/mobile/devices') return [{ id: 1, name: 'Pixel 9', platform: 'android', push: true, created_at: '2026-10-02T09:00:00Z', last_used_at: '2026-11-27T08:10:00Z' }]
  if (p === '/api/cm/assistant/public') return { enabled: true, provider: 'Anthropic', policy_version: '2026-10', retention_days: 30, min_age: 15 }
  if (p === '/api/cm/assistant/status') return D.aiStatus
  if (p === '/api/cm/inbox/accounts') return []
  if (p === '/api/cm/inbox/comments') return []
  if (p === '/api/cm/mobile/contact-config') return { enabled: false, turnstile_site_key: null }
  unknown.add(`${method} ${p}`)
  return method === 'GET' ? [] : { ok: true }
}

async function setup(browser, { mobile, loggedIn = true }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme: 'light',
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  })
  await ctx.addInitScript(({ loggedIn }) => {
    try {
      if (loggedIn) localStorage.setItem('cm.session', '1'); else localStorage.removeItem('cm.session')
      localStorage.setItem('cm.appearance', JSON.stringify({ palette: 'warm', theme: 'light', language: 'fr', rev: 7 }))
      localStorage.setItem('cm.palette', 'warm')
    } catch { /* */ }
  }, { loggedIn })
  await ctx.route('https://**/*', r => r.abort())   // rien d'extérieur (widget.js, polices, images)
  await ctx.route('**/api/**', async route => {
    const req = route.request()
    const u = new URL(req.url())
    const p = u.pathname
    if (/^\/api\/cm\/(assets|posts)\/\d+\/(stream|video)$/.test(p)) return route.fallback()
    const th = p.match(/^\/api\/cm\/posts\/(\d+)\/thumbnail$/)
    if (th) {
      const post = D.postById(Number(th[1]))
      const item = D.calendarItems.find(i => i.group === `post:${post.id}` && i.kind === 'video') || D.calendarItems.find(i => i.group === `post:${post.id}`)
      const n = { 12: 2, 20: 10, 21: 3, 22: 8, 23: 2, 24: 9, 8: 6 }[post.id] || (item?.thumbnail_url?.match(/thumb(\d+)/)?.[1]) || 1
      return route.fulfill({ path: path.join(MEDIA, `thumb${n}.jpg`), contentType: 'image/jpeg' })
    }
    if (!loggedIn && p === '/api/auth/me') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Non connecté' }) })
    let body = null
    try { body = req.postDataJSON() } catch { /* */ }
    const data = api(req.method(), p, u.searchParams, body)
    const headers = {}
    if (Array.isArray(data)) headers['X-Next-Cursor'] = ''
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) })
  })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(D.NOW)
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('dialog', d => d.accept())
  return { ctx, page, errors }
}

const HIDE_CSS = `
  .cm-assistant, [class*="chapote-widget"], #chapote-widget, [data-chapote-widget] { display: none !important; }
  html { scroll-behavior: auto !important; }
  *, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; caret-color: transparent !important; }
`

async function settle(page) {
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {})
  await page.evaluate(async () => {
    await Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 2000))])
    const imgs = Promise.all([...document.images].map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r }))))
    await Promise.race([imgs, new Promise(r => setTimeout(r, 2500))])
  })
  await page.waitForTimeout(400)
}
async function go(page, route) {
  await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
}
const clickText = async (page, text, sel = 'button') => {
  const l = page.locator(sel, { hasText: text }).first()
  await l.scrollIntoViewIfNeeded().catch(() => {})
  await l.click()
  await settle(page)
}

// Composeur : vidéo de la bibliothèque (?video=101), titre et légende saisis, « Tout public ».
async function composerStep1(page) {
  await go(page, '/nouvelle?video=101')
  await page.waitForSelector('textarea.textarea')
  const title = page.locator('input.input').first()
  await title.fill('Coulisses de l’atelier : le vernissage')
  await page.locator('textarea.textarea').first().fill('Une couche, puis une autre : on vernit les pieds de lampe à la main avant l’assemblage 🪵\nVous préférez le bois brut ou ciré ?\n#atelier #coulisses #faitmain')
  await page.locator('.seg button', { hasText: 'Tout public' }).first().click()
  await settle(page)
}
async function composerStep2(page) {
  await composerStep1(page)
  await page.locator('.actionbar button', { hasText: 'Suivant' }).click()
  await settle(page)
  // Date : lundi 30 novembre à 12 h 30 si les champs le permettent (DateParts).
  await setDate(page)
}
async function setDate(page) {
  for (const [label, v] of [['Jour', '30'], ['Mois', '11'], ['Année', '2026'], ['Heure', '18'], ['Min', '00']]) {
    const f = page.locator(`.dparts input[aria-label="${label}"]`).first()
    if (await f.count()) { await f.fill(v); await f.blur() }
  }
  await settle(page)
}

const SCREENS = {
  planning: async page => { await go(page, '/planning') },
  publication: async page => {
    await go(page, '/planning')
    if (await page.locator('.daystrip').count()) { await page.locator('.daystrip button').nth(1).click(); await settle(page) }   // mardi 24
    await page.locator('.prow', { hasText: 'lampe Aube' }).first().click()
    await settle(page)
    await page.waitForTimeout(500)
  },
  'composer-1': async page => {
    await composerStep1(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
  },
  'composer-2': async page => { await composerStep2(page); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300) },
  'composer-2-date': async page => {
    await composerStep2(page)
    await page.locator('h2', { hasText: 'Quand' }).first().evaluate(e => window.scrollTo({ top: e.closest('section').getBoundingClientRect().top + window.scrollY - (innerWidth < 900 ? 380 : 260), behavior: 'instant' }))
    await page.waitForTimeout(300)
  },
  'publication-plateformes': async page => {
    await SCREENS.publication(page)
    await page.locator('#pub-plats').evaluate(e => e.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
  },
  'composer-reglages': async page => {
    await composerStep2(page)
    await page.locator('.actionbar button', { hasText: 'Suivant' }).click()
    await settle(page)
    // TikTok : « Tout le monde » pour la visibilité, commentaires autorisés.
    const priv = page.locator('select').filter({ has: page.locator('option[value="PUBLIC_TO_EVERYONE"]') }).first()
    if (await priv.count()) await priv.selectOption('PUBLIC_TO_EVERYONE').catch(() => {})
    else {
      const r = page.locator('label', { hasText: 'Tout le monde' }).first()
      if (await r.count()) await r.click()
    }
    for (const lbl of ['Commentaires', 'Duos', 'Collages']) {
      const c = page.locator('label.check', { hasText: lbl }).first().locator('input')
      if (await c.count() && !(await c.isChecked())) await c.check().catch(() => {})
    }
    await settle(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
  },
  stats: async page => { await go(page, '/stats') },
  bibliotheque: async page => {
    await go(page, '/bibliotheque')
    await page.locator('select[aria-label="Affichage"]').selectOption('flat')
    await settle(page)
  },
  'bibliotheque-videos': async page => {
    await SCREENS.bibliotheque(page)
    await page.locator('.chips button', { hasText: 'Toutes' }).click()
    await settle(page)
    await page.locator('.listbar').evaluate(e => window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }))
    await page.waitForTimeout(1500)
  },
  'a-valider': async page => { await go(page, '/a-valider') },
  comptes: async page => { await go(page, '/comptes') },
  partage: async page => { await go(page, '/partage') },
  'partage-groupe': async page => {
    await go(page, '/partage')
    await page.locator('li', { hasText: 'Atelier Lumen' }).locator('button', { hasText: 'Partager' }).first().click()
    await settle(page)
    await page.locator('input[type="email"]').blur().catch(() => {})
  },
  groupes: async page => {
    await go(page, '/comptes#groupes')
    await page.evaluate(() => document.getElementById('groupes')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
  },
  'groupe-edition': async page => {
    await go(page, '/comptes#groupes')
    await page.locator('button[aria-label="Modifier Atelier Lumen"]').click()
    await settle(page)
  },
  reglages: async page => { await go(page, '/reglages') },
  'reglages-apparence': async page => {
    await go(page, '/reglages')
    await page.locator('h2, .set-h, div', { hasText: /^Apparence$/i }).first().evaluate(e => window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }))
    await page.waitForTimeout(300)
  },
  assistant: async page => { await go(page, '/reglages/assistant-ia') },
  landing: async page => { await go(page, '/') },
}

;(async () => {
  const only = process.argv.slice(2)
  await new Promise(r => server.listen(PORT, r))
  const browser = await chromium.launch()
  const report = []
  for (const mobile of [true]) {
    const dir = path.join(OUT, mobile ? 'mobile' : 'desktop')
    fs.mkdirSync(dir, { recursive: true })
    for (const [key, fn] of Object.entries(SCREENS)) {
      if (only.length && !only.includes(key)) continue
      const { ctx, page, errors } = await setup(browser, { mobile, loggedIn: key !== 'landing' })
      try {
        await fn(page)
        await page.addStyleTag({ content: HIDE_CSS }).catch(() => {})
        const file = path.join(dir, `${key}.png`)
        const FULL = []
        if (FULL.includes(key)) await page.evaluate(() => { for (const e of document.querySelectorAll('*')) { const c = getComputedStyle(e); if (c.position === 'fixed' || c.position === 'sticky') e.dataset.fixe = c.position } })
        await page.screenshot({ path: file, fullPage: FULL.includes(key) })
        const boites = await page.evaluate(() => [...document.querySelectorAll('button, a, label, h1, h2, h3, input, textarea, select, .prow, li, [class*="chip"], [class*="badge"], [class*="status"], span')]
          .map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 60), texte: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })
          .filter(b => b.w > 0 && b.h > 0 && b.texte))
        fs.writeFileSync(file.replace('.png', '.boites.json'), JSON.stringify(boites))
        report.push(`${mobile ? 'mobile ' : 'desktop'} ${key}: ok${errors.length ? ` · console: ${errors.slice(0, 3).join(' | ')}` : ''}`)
      } catch (e) {
        report.push(`${mobile ? 'mobile ' : 'desktop'} ${key}: ÉCHEC ${e.message.split('\n')[0]}`)
        await page.screenshot({ path: path.join(dir, `${key}.FAILED.png`) }).catch(() => {})
      }
      await ctx.close()
    }
  }
  await browser.close()
  server.close()
  console.log(report.join('\n'))
  if (unknown.size) console.log('Routes inconnues :', [...unknown].join(', '))
})()
