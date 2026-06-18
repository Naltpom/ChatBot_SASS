import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { AppRoutes } from './App'
import { PRERENDERED_PATHS } from './prerenderRoutes'
import './styles.css'

const root = document.getElementById('root')!

const app = (
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter future={{ v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
)

// Routes PRÉRENDUES : source unique dans prerenderRoutes.ts (partagée avec
// prerender.mjs ; le script anti-flash inline de index.html en garde une copie).
const path = window.location.pathname.replace(/\/+$/, '') || '/'
// - Sur une route prérendue : on HYDRATE (réutilise le DOM serveur).
// - Ailleurs : la route est servie via le fallback SPA nginx (même index.html
//   que « / »), donc #root contient le markup Landing -> hydrater provoquerait
//   un mismatch. Le script anti-flash de index.html a déjà vidé #root ; on monte
//   proprement avec createRoot.
const isPrerenderedRoute = root.hasChildNodes() && PRERENDERED_PATHS.includes(path)

if (isPrerenderedRoute) {
  hydrateRoot(root, app)
} else {
  root.innerHTML = ''
  createRoot(root).render(app)
}
