// Prérendu statique des routes PUBLIQUES (Landing « / » + « /showcase ») — SANS
// navigateur headless. On charge l'entrée serveur (src/entry-server.tsx) via le
// runtime SSR de Vite (ssrLoadModule), on rend chaque route en HTML et on
// l'injecte dans le dist/index.html buildé (à la place de <div id="root">).
// Pour les routes ≠ « / » on écrit un fichier dédié (dist/<route>/index.html,
// servi par nginx via $uri/) et on adapte le <head> (title/canonical/og) pour
// un SEO propre par page. Les autres routes restent client-only (fallback SPA).
//
// Lancé après `vite build` par le script "build" (sous bun en prod, node en local).
// La liste ROUTES doit rester alignée avec PRERENDERED (main.tsx) et le script
// anti-flash de index.html.
import { createServer } from 'vite'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')
const ROOT_DIV = '<div id="root"></div>'

// Valeurs du <head> de base (index.html) — remplacées par page si surchargées.
const BASE_TITLE = 'Chapote — Le chatbot hybride français'
const BASE_SHORT_DESC = 'Arbre guidé illimité + IA plafonnée + relais humain, en une seule balise. RGPD par défaut, hébergement français.'

const ROUTES = [
  // « / » : on garde le <head> par défaut de index.html.
  { path: '/', out: 'index.html' },
  {
    path: '/showcase', out: 'showcase/index.html',
    title: 'Ils utilisent Chapote — le chatbot hybride français',
    description: 'Chapote, le chatbot hybride français (arbre guidé, IA plafonnée, relais humain), s’installe en une balise sur les sites e-commerce, services, commerces locaux et SaaS. RGPD par défaut, hébergement français.',
    canonical: 'https://chapote.fr/showcase',
  },
]

// Surcharge ciblée du <head> (remplacements exacts — index.html est sous notre
// contrôle). Idempotent : une route sans surcharge laisse le <head> intact.
function applyMeta(html, r) {
  if (r.title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${r.title}</title>`)
    // og:title + twitter:title
    html = html.split(`content="${BASE_TITLE}"`).join(`content="${r.title}"`)
  }
  if (r.canonical) {
    html = html.replace('href="https://chapote.fr/"', `href="${r.canonical}"`)   // <link canonical>
    html = html.replace('content="https://chapote.fr/"', `content="${r.canonical}"`) // og:url
  }
  if (r.description) {
    // meta name=description (longue) + og/twitter description (courte) -> unifiées
    html = html.replace(/(<meta name="description" content=")[\s\S]*?(" \/>)/, `$1${r.description}$2`)
    html = html.split(`content="${BASE_SHORT_DESC}"`).join(`content="${r.description}"`)
  }
  return html
}

async function main() {
  // Serveur Vite en mode middleware (pas d'écoute réseau) : transpile l'entrée
  // serveur TSX côté Node/Bun avec la même résolution de modules que le build.
  const vite = await createServer({
    root,
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'warn',
  })

  try {
    const { render } = await vite.ssrLoadModule('/src/entry-server.tsx')
    const base = readFileSync(resolve(dist, 'index.html'), 'utf-8')
    if (!base.includes(ROOT_DIV)) {
      throw new Error(`Marqueur "${ROOT_DIV}" introuvable dans dist/index.html — prérendu impossible.`)
    }
    for (const r of ROUTES) {
      const appHtml = render(r.path)
      let html = base.replace(ROOT_DIV, `<div id="root">${appHtml}</div>`)
      html = applyMeta(html, r)
      const outPath = resolve(dist, r.out)
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, html)
      console.log(`✓ Prérendu « ${r.path} » -> dist/${r.out} (${appHtml.length} octets de markup).`)
    }
  } finally {
    await vite.close()
  }
}

main().catch((err) => {
  console.error('Échec du prérendu :', err)
  process.exit(1)
})
