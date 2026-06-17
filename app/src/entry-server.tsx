// Entrée de PRÉRENDU (SSG) — exécutée par scripts/prerender.mjs via le runtime
// SSR de Vite (Node, AUCUN navigateur headless). On rend l'arbre exact du
// client (AuthProvider + AppRoutes) mais avec StaticRouter figé sur « / » :
// seule la Landing est matchée et sérialisée en HTML statique. Les effets
// (fetch /api/auth, polices, IntersectionObserver) ne tournent pas au
// renderToString : la sortie est donc l'UI déconnectée (user=null), identique
// au 1er rendu client -> hydratation propre.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { AuthProvider } from './AuthContext'
import { AppRoutes } from './App'

export function render(url = '/'): string {
  return renderToString(
    <React.StrictMode>
      <AuthProvider>
        <StaticRouter location={url}>
          <AppRoutes />
        </StaticRouter>
      </AuthProvider>
    </React.StrictMode>,
  )
}
