import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SessionProvider } from './session'
import './styles.css'
import { applyAppearance, getAppearance } from './palette'
import { Shell } from './App'

// Apparence (couleur, clair / sombre) : copie locale avant le premier affichage ; celle du compte ensuite.
applyAppearance(getAppearance())

const tree = (
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>
)

// Pages publiques prérendues (scripts/prerender.mjs) : le HTML est déjà là, on l'hydrate (pas de flash).
// Ailleurs (ou session connue : le script de index.html a vidé #root), rendu normal.
const root = document.getElementById('root')!
if (root.hasChildNodes()) hydrateRoot(root, tree)
else createRoot(root).render(tree)
