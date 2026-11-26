// Pré-rendu des pages publiques de cm.chapote.fr, après `vite build` (client) et `vite build --ssr src/prerender.tsx`.
// Sans lui, le HTML servi n'est qu'un <div id="root"> vide : Google et l'import d'URL de la base de connaissances
// du chatbot (api/src/services/kb_service.py, sans JavaScript) ne voient aucun texte.
//   dist/index.html            → « / » (landing)
//   dist/<route>/index.html    → /privacy, /terms, /politique-ia, /avis
//   dist/app.html              → la coquille vide d'origine : repli de nginx pour toutes les autres routes de l'app
// Chaque page : <title>, description, lien canonique, Open Graph, CSS de la page (manifeste de Vite).
// Dans le navigateur, main.tsx (createRoot) remplace ce contenu : le comportement de l'app ne change pas.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const ssr = join(root, 'dist-ssr')
const SITE = 'https://cm.chapote.fr'

const META = {
  '/': {
    // Mots des recherches visées : planifier / programmer, TikTok, YouTube Shorts, Instagram Reels, community manager, gratuit.
    title: 'Chapote CM · Planifier ses vidéos TikTok, YouTube Shorts et Instagram Reels (gratuit)',
    description: 'Chapote CM, l’outil gratuit du community manager : programmez vos vidéos courtes sur TikTok, YouTube Shorts et Instagram Reels, sur tous vos comptes en une fois. Planning, statistiques, Google Drive et équipe au même endroit.',
  },
  '/privacy': {
    title: 'Politique de confidentialité · Chapote CM',
    description: 'Données traitées par Chapote CM (cm.chapote.fr), conformément au RGPD : comptes TikTok, YouTube et Instagram, vidéos, Google Drive, durées de conservation et vos droits.',
  },
  '/terms': {
    title: 'Conditions d’utilisation · Chapote CM',
    description: 'Conditions d’utilisation de Chapote CM (cm.chapote.fr), l’outil de Chapote pour programmer et publier vos vidéos sur TikTok, YouTube et Instagram.',
  },
  '/politique-ia': {
    title: 'Politique IA · Chapote CM',
    description: 'Comment l’Assistant Chapote CM utilise l’intelligence artificielle : données envoyées, prestataire, conservation et vos choix.',
    // Texte encore en brouillon : pas dans le sitemap ni dans Google tant qu'il n'est pas validé.
    noindex: true,
  },
  '/avis': {
    title: 'Donner mon avis · Chapote CM',
    description: 'Écrivez à Nathan, le créateur de Chapote CM : vos retours sur la planification de vos vidéos TikTok, YouTube et Instagram.',
  },
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function replaceOnce(html, from, to, what) {
  if (!from.test(html)) throw new Error(`prerender : ${what} introuvable dans dist/index.html`)
  return html.replace(from, to)
}

const template = readFileSync(join(dist, 'index.html'), 'utf8')
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'))
const { render, PAGES, FAQ } = await import(pathToFileURL(join(ssr, 'prerender.js')).href)

// Données structurées de l'accueil (Google, moteurs IA). Rien d'inventé : pas d'avis ni de note (aggregateRating)
// tant qu'il n'y en a pas de réels. ⚠ À compléter : "sameAs" (réseaux officiels de Chapote, fiche Google Play).
function homeJsonLd() {
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'Chapote CM', alternateName: 'Chapote Content Manager', inLanguage: 'fr-FR', publisher: { '@id': 'https://chapote.fr/#organization' } },
      { '@type': 'Organization', '@id': 'https://chapote.fr/#organization', name: 'Chapote', url: 'https://chapote.fr/', logo: 'https://chapote.fr/brand/logo-horizontal.svg', email: 'contact@chapote.fr' },
      {
        '@type': 'SoftwareApplication', '@id': `${SITE}/#software`, name: 'Chapote CM', alternateName: ['Chapote Content Manager', 'Chapote Community Manager'],
        url: `${SITE}/`, applicationCategory: 'BusinessApplication', applicationSubCategory: 'Planificateur de réseaux sociaux', operatingSystem: 'Web', inLanguage: ['fr-FR', 'en'],
        publisher: { '@id': 'https://chapote.fr/#organization' },
        description: META['/'].description,
        featureList: [
          'Publication programmée sur TikTok, YouTube Shorts et Instagram Reels',
          'Plusieurs comptes par réseau, une vidéo envoyée une seule fois',
          'Planning de la semaine avec le statut de chaque publication',
          'Statistiques réunies : vues, abonnés, j’aime, partages, engagement',
          'Bibliothèque Google Drive : les vidéos restent dans votre Drive',
          'Groupes de comptes et partage en équipe (administrateur, éditeur, lecteur)',
          'Connexion officielle TikTok, Google et Meta',
        ],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
      },
      { '@type': 'FAQPage', '@id': `${SITE}/#faq`, mainEntity: FAQ.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })) },
    ],
  }
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
}

/** CSS et morceau JS d'une page chargée à la demande (et de ses imports statiques), hors point d'entrée. */
function assetsOf(src) {
  const css = new Set(), seen = new Set()
  const walk = key => {
    const c = manifest[key]
    if (!c || seen.has(key) || c.isEntry) return
    seen.add(key)
    for (const f of c.css || []) css.add(f)
    for (const k of c.imports || []) walk(k)
  }
  walk(src)
  const file = manifest[src]?.file
  if (!file) throw new Error(`prerender : ${src} absent du manifeste de Vite`)
  return { css: [...css], js: file }
}

// La coquille d'origine, avant d'écraser index.html.
writeFileSync(join(dist, 'app.html'), template)

for (const [route, page] of Object.entries(PAGES)) {
  const m = META[route]
  if (!m) throw new Error(`prerender : pas de titre pour ${route}`)
  const body = render(route)
  if (body.length < 500) throw new Error(`prerender : ${route} presque vide (${body.length} caractères)`)
  const url = SITE + (route === '/' ? '/' : route)
  const { css, js } = assetsOf(page.src)
  const head = [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Chapote CM" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    ...(route === '/' ? [homeJsonLd()] : []),
    ...css.map(f => `<link rel="stylesheet" crossorigin href="/${f}" />`),
    `<link rel="modulepreload" crossorigin href="/${js}" />`,
    // Session connue sur l'accueil : la landing pré-rendue reste cachée (l'app s'ouvre comme avant).
    `<style>.cm-session [data-prerender="/"]{display:none}</style>`,
    `<script src="/prerender-hint.js"></script>`,
  ].map(x => '    ' + x).join('\n')
  let html = template
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`, '<title>')
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(m.description)}" />${m.noindex ? '\n    <meta name="robots" content="noindex" />' : ''}`, 'meta description')
  html = replaceOnce(html, /\s*<\/head>/, `\n${head}\n  </head>`, "</head>")
  html = replaceOnce(html, /<div id="root"><\/div>/, `<div id="root"><div data-prerender="${route}">${body}</div></div>`, '<div id="root">')
  const out = route === '/' ? join(dist, 'index.html') : join(dist, route.slice(1), 'index.html')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, html)
  console.log(`prerender : ${route} → ${out.slice(root.length + 1)} (${Math.round(html.length / 1024)} Kio)`)
}

// Le manifeste ne sert qu'ici : pas publié par nginx. Le build SSR non plus.
rmSync(join(dist, '.vite'), { recursive: true, force: true })
rmSync(ssr, { recursive: true, force: true })
