// Arbre de routes partagé entre l'entrée client (main.tsx : BrowserRouter +
// hydrateRoot) et l'entrée serveur (entry-server.tsx : StaticRouter pour le
// prérendu statique de « / »). Chaque entrée fournit son propre Router ;
// au prérendu, seule la route « / » (Landing) est matchée et sérialisée.
import React from 'react'
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import Landing from './pages/Landing'
import Showcase from './pages/Showcase'
import Demo from './pages/Demo'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Authorize from './pages/Authorize'
import BotList from './pages/BotList'
import BotWizard from './pages/BotWizard'
import BotPage from './pages/BotPage'
import Team from './pages/Team'
import Profile from './pages/Profile'
import MyOrgs from './pages/MyOrgs'
import Analytics from './pages/Analytics'
import Inbox from './pages/Inbox'
import Billing from './pages/Billing'
import Integrations from './pages/Integrations'
import AdminHome, { AdminClient } from './pages/Admin'
import AdminDashboard from './pages/AdminDashboard'
import AdminUsers from './pages/AdminUsers'
import AdminBilling from './pages/AdminBilling'
import AdminProspecting from './pages/AdminProspecting'
import AdminProspect from './pages/AdminProspect'
import AdminBillingInvoices from './pages/AdminBillingInvoices'
import AdminBillingCatalog from './pages/AdminBillingCatalog'
import LegalPage from './pages/LegalPage'
import mentionsMd from './legal/MENTIONS_LEGALES.md?raw'
import cguMd from './legal/CGU.md?raw'
import cgvMd from './legal/CGV.md?raw'
import confidMd from './legal/POLITIQUE_CONFIDENTIALITE.md?raw'
import Layout from './Layout'

// La 2FA n'est imposée côté front qu'en dehors des hôtes locaux (mirroir du
// gate dev-login : l'auto-login admin DEV et les e2e tournent sur localhost,
// où le serveur n'applique pas non plus l'obligation). En prod (chapote.fr),
// un superadmin sans 2FA est redirigé vers sa configuration.
function twofaEnforcedHere(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return !(h === 'localhost' || h === '127.0.0.1' || h === '[::1]')
}

// Écran-passerelle : superadmin devant configurer sa 2FA avant l'administration.
function TwoFAGate() {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <div className="section-title" style={{ marginBottom: 10 }}>Sécurisez votre accès staff</div>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 auto 18px', maxWidth: 440 }}>
        L'accès à l'administration exige une authentification à deux facteurs.
        Configurez une application d'authentification ou une passkey pour continuer.
      </p>
      <Link to="/app/profile" className="btn btn-primary" style={{ textDecoration: 'none' }}>
        Configurer la 2FA →
      </Link>
    </div>
  )
}

function Protected({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-page">Chargement…</div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !user.is_superadmin) return <Navigate to="/app" replace />
  // 2FA obligatoire pour le staff : tant qu'aucun 2nd facteur n'est configuré,
  // on présente la passerelle de configuration au lieu de la page admin.
  if (adminOnly && user.twofa_required && !user.twofa_enabled && twofaEnforcedHere()) {
    return <Layout><TwoFAGate /></Layout>
  }
  return <Layout>{children}</Layout>
}

// Scroll vers l'ancre après navigation. Indispensable pour les liens INTER-pages
// (« /#pricing » depuis /demo) : au chargement de la route d'accueil la section
// n'existe pas encore dans le DOM (rendu React asynchrone) et, juste après une
// nav SPA, le montage peut réinitialiser le scroll. On réaligne donc la section
// en tête à intervalles courts pendant ~800 ms ; une fois calée, les passages
// suivants sont des no-op (on ne lutte pas contre un scroll volontaire ensuite).
// No-op au prérendu (les effets ne tournent pas en SSR).
function ScrollToHash() {
  const { pathname, hash } = useLocation()
  React.useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let cancelled = false
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const el = document.getElementById(id)
      // Saut natif instantané (cohérent avec les ancres même-page) tant que la
      // section n'est pas alignée sous le header. scrollIntoView 'smooth' est
      // ignoré ici juste après le montage -> on garde le comportement 'auto'.
      if (el && Math.abs(el.getBoundingClientRect().top) > 4) {
        el.scrollIntoView({ block: 'start' })
      }
      if (++tries < 10) setTimeout(tick, 80)
    }
    setTimeout(tick, 0)
    return () => { cancelled = true }
  }, [pathname, hash])
  return null
}

export function AppRoutes() {
  return (
    <>
    <ScrollToHash />
    <Routes>
      {/* Public (/ et /showcase sont prérendus pour le SEO) */}
      <Route path="/" element={<Landing />} />
      <Route path="/showcase" element={<Showcase />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* Vérification email (souple) + réinitialisation de mot de passe. Routes
          publiques à la racine : les liens des e-mails (APP_URL/...) pointent ici. */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      {/* Consentement OAuth du plugin WordPress (Authorization Code + PKCE).
          Auth gérée DANS la page : si non connecté, elle mémorise le retour
          puis renvoie vers /login (cbsaas_after_login). */}
      <Route path="/authorize" element={<Authorize />} />
      {/* Pages légales (publiques) — rendues depuis les .md de src/legal.
          URL canoniques sous /legal/… (référencées par le plugin WordPress,
          readme.txt). Les anciens chemins redirigent (compat liens/bookmarks). */}
      <Route path="/legal/mentions-legales" element={<LegalPage md={mentionsMd} />} />
      <Route path="/legal/cgu" element={<LegalPage md={cguMd} />} />
      <Route path="/legal/cgv" element={<LegalPage md={cgvMd} />} />
      <Route path="/legal/confidentialite" element={<LegalPage md={confidMd} />} />
      <Route path="/mentions-legales" element={<Navigate to="/legal/mentions-legales" replace />} />
      <Route path="/cgu" element={<Navigate to="/legal/cgu" replace />} />
      <Route path="/cgv" element={<Navigate to="/legal/cgv" replace />} />
      <Route path="/confidentialite" element={<Navigate to="/legal/confidentialite" replace />} />
      {/* Application (clients) */}
      <Route path="/app" element={<Protected><BotList /></Protected>} />
      <Route path="/app/bots/new" element={<Protected><BotWizard /></Protected>} />
      <Route path="/app/bots/:id" element={<Protected><BotPage /></Protected>} />
      <Route path="/app/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/app/inbox" element={<Protected><Inbox /></Protected>} />
      <Route path="/app/integrations" element={<Protected><Integrations /></Protected>} />
      <Route path="/app/billing" element={<Protected><Billing /></Protected>} />
      <Route path="/app/team" element={<Protected><Team /></Protected>} />
      <Route path="/app/orgs" element={<Protected><MyOrgs /></Protected>} />
      <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
      {/* Back-office superadmin */}
      <Route path="/admin" element={<Protected adminOnly><AdminDashboard /></Protected>} />
      <Route path="/admin/clients" element={<Protected adminOnly><AdminHome /></Protected>} />
      <Route path="/admin/clients/:orgId" element={<Protected adminOnly><AdminClient /></Protected>} />
      <Route path="/admin/users" element={<Protected adminOnly><AdminUsers /></Protected>} />
      <Route path="/admin/prospecting" element={<Protected adminOnly><AdminProspecting /></Protected>} />
      <Route path="/admin/prospecting/:id" element={<Protected adminOnly><AdminProspect /></Protected>} />
      <Route path="/admin/billing" element={<Protected adminOnly><AdminBilling /></Protected>} />
      <Route path="/admin/billing/invoices" element={<Protected adminOnly><AdminBillingInvoices /></Protected>} />
      <Route path="/admin/billing/catalog" element={<Protected adminOnly><AdminBillingCatalog /></Protected>} />
      {/* Alias historique demandé (/app/admin/billing) -> redirige vers la route admin canonique. */}
      <Route path="/app/admin/billing" element={<Navigate to="/admin/billing" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
