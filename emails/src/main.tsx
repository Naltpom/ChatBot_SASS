import { lazy, StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import { Brand, BrandMark, Msg, Skeleton } from './components/ui'
import { goToSuite, SessionProvider, useSession } from './session'
import './styles.css'

const Login = lazy(() => import('./pages/Login'))
const Mailboxes = lazy(() => import('./pages/Mailboxes'))
const Access = lazy(() => import('./pages/Access'))
const Audit = lazy(() => import('./pages/Audit'))
const Consent = lazy(() => import('./pages/Consent'))

const TITLES: Record<string, string> = {
  '/': 'Boîtes mail', '/acces': 'Accès Claude', '/journal': 'Journal', '/connexion': 'Connexion', '/consentement': 'Autorisation',
}

function Splash() {
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Chargement"><BrandMark size={40} /></div>
}

/** Page protégée sans session : vers la connexion, en gardant la page demandée. */
function ToLogin() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/connexion?suite=${encodeURIComponent(pathname + search)}`} replace />
}

function AfterLogin() {
  const navigate = useNavigate()
  useEffect(() => { goToSuite(new URLSearchParams(window.location.search).get('suite'), navigate) }, [navigate])
  return <Splash />
}

/** Connecté, mais pas autorisé ici : explication et sortie. */
function Denied() {
  const { access, me, signOut, config } = useSession()
  const app = (config?.app_url || 'https://chapote.fr').replace(/\/$/, '')
  return (
    <div className="auth">
      <div className="auth-card card">
        <Brand />
        <h1>Accès refusé</h1>
        <Msg kind="err">{access?.message || 'Accès refusé.'}</Msg>
        <p className="small muted">Connecté en tant que {me?.email}.</p>
        {access?.reason === 'twofa_setup_required' && (
          <a className="btn btn-primary btn-block" href={`${app}/app/profile`}>Activer la 2FA sur chapote.fr</a>
        )}
        <button className="btn btn-block" onClick={signOut}>
          {access?.reason === 'twofa_session_required' ? 'Se reconnecter' : 'Se déconnecter'}
        </button>
      </div>
    </div>
  )
}

function Shell() {
  const { me, access, ready } = useSession()
  const { pathname } = useLocation()
  useEffect(() => { document.title = `${TITLES[pathname] ? TITLES[pathname] + ' · ' : ''}Chapote Emails` }, [pathname])

  if (!ready) return <Splash />
  if (!me) {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/connexion" element={<Login />} />
          <Route path="*" element={<ToLogin />} />
        </Routes>
      </Suspense>
    )
  }
  const consentError = pathname === '/consentement' && new URLSearchParams(window.location.search).has('erreur')
  if (!access?.allowed && !consentError) return <Denied />
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/connexion" element={<AfterLogin />} />
        <Route path="/consentement" element={<Consent />} />
        <Route element={<Layout fallback={<Skeleton n={3} />} />}>
          <Route path="/" element={<Mailboxes />} />
          <Route path="/acces" element={<Access />} />
          <Route path="/journal" element={<Audit />} />
          <Route path="*" element={<div className="col"><h1>Page introuvable</h1><Link to="/">Retour aux boîtes</Link></div>} />
        </Route>
      </Routes>
    </Suspense>
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
