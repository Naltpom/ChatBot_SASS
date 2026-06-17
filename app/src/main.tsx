import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { AppRoutes } from './App'
import './styles.css'

const root = document.getElementById('root')!

const app = (
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
)

// Routes PRÉRENDUES (doivent rester alignées avec prerender.mjs et le script
// anti-flash de index.html). Chacune est servie avec son propre HTML pré-rendu.
const PRERENDERED = ['/', '/showcase']
const path = window.location.pathname.replace(/\/+$/, '') || '/'
// - Sur une route prérendue : on HYDRATE (réutilise le DOM serveur).
// - Ailleurs : la route est servie via le fallback SPA nginx (même index.html
//   que « / »), donc #root contient le markup Landing -> hydrater provoquerait
//   un mismatch. Le script anti-flash de index.html a déjà vidé #root ; on monte
//   proprement avec createRoot.
const isPrerenderedRoute = root.hasChildNodes() && PRERENDERED.includes(path)

if (isPrerenderedRoute) {
  hydrateRoot(root, app)
} else {
  root.innerHTML = ''
  createRoot(root).render(app)
}
