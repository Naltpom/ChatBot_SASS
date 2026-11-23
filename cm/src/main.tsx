import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { BrandMark } from './components/ui'
import Accounts from './pages/Accounts'
import Forgot from './pages/auth/Forgot'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Callback from './pages/Callback'
import Composer from './pages/Composer'
import Dashboard from './pages/Dashboard'
import Landing from './pages/Landing'
import Planning from './pages/Planning'
import Stats from './pages/Stats'
import Videos from './pages/Videos'
import { SessionProvider, useSession } from './session'
import './styles.css'

const TITLES: Record<string, string> = {
  '/': 'Accueil', '/planning': 'Planning', '/stats': 'Statistiques', '/videos': 'Vidéos', '/comptes': 'Comptes',
  '/nouvelle': 'Nouvelle publication', '/connexion': 'Connexion', '/inscription': 'Créer un compte',
  '/mot-de-passe-oublie': 'Mot de passe oublié',
}

/** Page protégée sans session : vers la connexion, en gardant la page demandée (et ses paramètres OAuth). */
function ToLogin() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/connexion?suite=${encodeURIComponent(pathname + search)}`} replace />
}

/** Déjà connecté sur /connexion ou /inscription : vers la page demandée (?suite=), sinon l'accueil. */
function AfterLogin() {
  const n = new URLSearchParams(useLocation().search).get('suite') || '/'
  return <Navigate to={n.startsWith('/') && !n.startsWith('//') ? n : '/'} replace />
}

function Shell() {
  const { me, ready } = useSession()
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname === '/' && !me) return            // la landing pose son propre titre
    document.title = `${TITLES[pathname] ? TITLES[pathname] + ' · ' : ''}Chapote CM`
  }, [pathname, me])

  if (!ready) {
    return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Chargement"><BrandMark size={44} /></div>
  }
  if (!me) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<Forgot />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route path="/connexion" element={<AfterLogin />} />
      <Route path="/inscription" element={<AfterLogin />} />
      <Route path="/mot-de-passe-oublie" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/nouvelle" element={<Composer />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/comptes" element={<Accounts />} />
        <Route path="/tiktok/callback" element={<Callback platform="tiktok" />} />
        <Route path="/youtube/callback" element={<Callback platform="youtube" />} />
        <Route path="/instagram/callback" element={<Callback platform="instagram" />} />
        <Route path="*" element={<div className="col"><h1>Page introuvable</h1><Link to="/">Retour à l’accueil</Link></div>} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
)
