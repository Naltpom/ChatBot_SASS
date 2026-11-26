// Prérendu des pages PUBLIQUES de cm.chapote.fr (référencement Google et moteurs IA, qui souvent n'exécutent
// pas le JavaScript). Lancé après `vite build` : rend chaque page (src/entry-server.tsx) et l'écrit dans
// dist/<page>/index.html, servi par nginx avant le repli SPA. Le <head> est adapté par page (titre,
// description, canonique, Open Graph). Les autres adresses restent rendues dans le navigateur.
// ⚠ Le script anti-flash de index.html garde une copie de la liste des chemins : la garder alignée.
import { createServer } from 'vite'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Writable } from 'node:stream'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const ROOT_DIV = '<div id="root"></div>'
const SITE = 'https://cm.chapote.fr'

const ROUTES = [
  { path: '/', out: 'index.html', chunk: 'src/pages/Landing.tsx' },
  {
    path: '/privacy', out: 'privacy/index.html', chunk: 'src/pages/Legal.tsx',
    title: 'Politique de confidentialité · Chapote CM',
    description: 'Politique de confidentialité de Chapote CM, l’outil gratuit de planification de vidéos sur TikTok, YouTube Shorts et Instagram Reels : données traitées, Google Drive, durées de conservation, vos droits.',
  },
  {
    path: '/terms', out: 'terms/index.html', chunk: 'src/pages/Legal.tsx',
    title: 'Conditions d’utilisation · Chapote CM',
    description: 'Conditions d’utilisation de Chapote CM, l’outil gratuit de planification et de statistiques pour TikTok, YouTube Shorts et Instagram Reels.',
  },
]

// Flux React -> texte HTML.
const toHtml = stream => new Promise((done, fail) => {
  let html = ''
  const sink = new Writable({ write(c, _e, next) { html += c.toString(); next() } })
  sink.on('finish', () => done(html)).on('error', fail)
  stream.pipe(sink)
})

const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function applyHead(html, r, manifest) {
  if (r.title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`)
    html = html.replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*(")/g, `$1${esc(r.title)}$2`)
  }
  if (r.description) {
    html = html.replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*(")/g, `$1${esc(r.description)}$2`)
  }
  if (r.path !== '/') {
    const url = SITE + r.path
    html = html.replace(`<link rel="canonical" href="${SITE}/" />`, `<link rel="canonical" href="${url}" />`)
    html = html.replace(`<meta property="og:url" content="${SITE}/" />`, `<meta property="og:url" content="${url}" />`)
    // Les données structurées (FAQ, application) décrivent l'accueil : retirées des autres pages.
    html = html.replace(/<script type="application\/ld\+json" data-home>[\s\S]*?<\/script>\s*/, '')
  }
  // Styles et code de la page (chargés à la demande) annoncés tout de suite : pas d'affichage sans style.
  const entry = manifest[r.chunk]
  if (entry) {
    const css = (entry.css || []).map(f => `<link rel="stylesheet" href="/${f}" />`)
    const js = [`<link rel="modulepreload" href="/${entry.file}" />`]
    html = html.replace('</head>', `    ${[...css, ...js].join('\n    ')}\n  </head>`)
  }
  return html
}

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'warn' })
try {
  const { render } = await vite.ssrLoadModule('/src/entry-server.tsx')
  const base = readFileSync(resolve(dist, 'index.html'), 'utf-8')
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf-8'))
  if (!base.includes(ROOT_DIV)) throw new Error(`Marqueur ${ROOT_DIV} introuvable dans dist/index.html`)
  // Repli SPA (adresses non prérendues : app, connexion…) : #root vide, et pas à indexer (sinon des
  // dizaines d'adresses de l'app en doublon de l'accueil, avec sa canonique et ses données structurées).
  const spa = base
    .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex,follow" />')
    .replace(/\s*<link rel="canonical" [^>]*\/>/, '')
    .replace(/\s*<script type="application\/ld\+json" data-home>[\s\S]*?<\/script>/, '')
  if (spa.includes('data-home') || !spa.includes('noindex')) throw new Error('spa.html : en-tête non adapté')
  writeFileSync(resolve(dist, 'spa.html'), spa)
  for (const r of ROUTES) {
    const app = await toHtml(await render(r.path))
    if (app.length < 500) throw new Error(`Prérendu de ${r.path} vide (${app.length} octets)`)
    const html = applyHead(base.replace(ROOT_DIV, `<div id="root">${app}</div>`), r, manifest)
    const out = resolve(dist, r.out)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, html)
    console.log(`✓ Prérendu ${r.path} -> dist/${r.out} (${app.length} octets)`)
  }
} finally {
  await vite.close()
}
