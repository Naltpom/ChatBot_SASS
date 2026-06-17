// Source de vérité UNIQUE des routes publiques PRÉRENDUES (SSG). Importée par :
//   - src/main.tsx          (PRERENDERED_PATHS : hydrate vs createRoot par route)
//   - scripts/prerender.mjs (PRERENDER_ROUTES via ssrLoadModule : génère le HTML)
// ⚠ Le script anti-flash INLINE de index.html ne peut PAS importer de module
//   (il s'exécute avant le bundle) : il garde une copie codée en dur du tableau
//   des chemins — la garder alignée avec PRERENDERED_PATHS ci-dessous.
export interface PrerenderRoute {
  path: string
  out: string            // chemin de sortie dans dist/ (ex. 'showcase/index.html')
  title?: string         // surcharge <title> (sinon défaut index.html)
  description?: string   // surcharge meta description + og/twitter
  canonical?: string     // surcharge <link canonical> + og:url
}

export const PRERENDER_ROUTES: PrerenderRoute[] = [
  // « / » : on garde le <head> par défaut de index.html.
  { path: '/', out: 'index.html' },
  {
    path: '/showcase', out: 'showcase/index.html',
    title: 'Ils utilisent Chapote — le chatbot hybride français',
    description: 'Chapote, le chatbot hybride français (arbre guidé, IA plafonnée, relais humain), s’installe en une balise sur les sites e-commerce, services, commerces locaux et SaaS. RGPD par défaut, hébergement français.',
    canonical: 'https://chapote.fr/showcase',
  },
]

// Chemins prérendus (ceux qu'on HYDRATE côté client ; ailleurs = createRoot).
export const PRERENDERED_PATHS: string[] = PRERENDER_ROUTES.map(r => r.path)
