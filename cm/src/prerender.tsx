// Pré-rendu des pages publiques au build (scripts/prerender.mjs, `vite build --ssr src/prerender.tsx`).
// Le HTML produit n'est que le contenu initial de <div id="root"> : Google et l'import d'URL de la base de
// connaissances du chatbot (sans JavaScript) lisent ainsi le texte. Dans le navigateur, main.tsx garde
// createRoot et remplace ce contenu (aucune hydratation). État rendu : visiteur non connecté, en français ;
// les effets ne tournent pas côté serveur (pas d'appel à l'API, ni de document/window).
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { SessionProvider } from './session'
import Landing from './pages/Landing'
import Legal from './pages/Legal'
import AiPolicy from './pages/AiPolicy'
import Contact from './pages/Contact'

/** Route → page et module source (pour retrouver ses CSS dans le manifeste de Vite). */
export const PAGES: Record<string, { el: () => ReactElement; src: string }> = {
  '/': { el: () => <Landing />, src: 'src/pages/Landing.tsx' },
  '/privacy': { el: () => <Legal doc="privacy" />, src: 'src/pages/Legal.tsx' },
  '/terms': { el: () => <Legal doc="terms" />, src: 'src/pages/Legal.tsx' },
  '/politique-ia': { el: () => <AiPolicy />, src: 'src/pages/AiPolicy.tsx' },
  '/avis': { el: () => <Contact />, src: 'src/pages/Contact.tsx' },
}

export function render(url: string): string {
  const page = PAGES[url]
  if (!page) throw new Error(`Pas de pré-rendu pour ${url}`)
  return renderToString(
    <SessionProvider>
      <StaticRouter location={url}>{page.el()}</StaticRouter>
    </SessionProvider>,
  )
}
