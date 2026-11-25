import { lazy, StrictMode, Suspense, useEffect , type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { BrandMark, Skeleton } from './components/ui'
import { SessionProvider, useSession } from './session'
import './styles.css'

// Une page = un morceau de JavaScript chargé à la demande : la landing ne charge pas l'app,
// l'app ne charge pas la landing.
// Après une mise en ligne, les anciens morceaux de l'appli n'existent plus : une page ouverte avant
// ne peut plus charger un écran (écran blanc). On recharge alors la page, une fois, sur la nouvelle version.
const RELOAD_KEY = 'cm.reloaded-for-update'
function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load()
      try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* stockage indisponible */ }
      return mod
    } catch (e) {
      let already = false
      try { already = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1') } catch { /* idem */ }
      if (!already) {
        window.location.reload()
        return new Promise<{ default: T }>(() => {})   // la page se recharge
      }
      throw e
    }
  })
}

const Landing = lazyPage(() => import('./pages/Landing'))
const Login = lazyPage(() => import('./pages/auth/Login'))
const Register = lazyPage(() => import('./pages/auth/Register'))
const Forgot = lazyPage(() => import('./pages/auth/Forgot'))
const Dashboard = lazyPage(() => import('./pages/Dashboard'))
const Planning = lazyPage(() => import('./pages/Planning'))
const Composer = lazyPage(() => import('./pages/Composer'))
const Stats = lazyPage(() => import('./pages/Stats'))
const Videos = lazyPage(() => import('./pages/Videos'))
const Accounts = lazyPage(() => import('./pages/Accounts'))
const Library = lazyPage(() => import('./pages/Library'))
const People = lazyPage(() => import('./pages/People'))
const Drafts = lazyPage(() => import('./pages/Drafts'))
const Comments = lazyPage(() => import('./pages/Comments'))
const VideoSheet = lazyPage(() => import('./pages/VideoSheet'))
const Callback = lazyPage(() => import('./pages/Callback'))
const DriveCallback = lazyPage(() => import('./pages/DriveCallback'))
const Legal = lazyPage(() => import('./pages/Legal'))

const PUBLIC = ['/', '/connexion', '/inscription', '/mot-de-passe-oublie', '/privacy', '/terms']
const HINT = 'cm.session'
const hadSession = () => { try { return localStorage.getItem(HINT) === '1' } catch { return false } }

function Splash() {
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Chargement"><BrandMark size={40} /></div>
}
function PageLoading() {
  return <div className="col" aria-busy="true"><Skeleton h={40} style={{ maxWidth: 260 }} /><div className="kpis"><Skeleton h={104} n={4} /></div><Skeleton h={220} /></div>
}

const TITLES: Record<string, string> = {
  '/': 'Accueil', '/planning': 'Planning', '/stats': 'Statistiques', '/videos': 'Vidéos', '/comptes': 'Comptes', '/bibliotheque': 'Bibliothèque', '/partage': 'Partage', '/a-valider': 'À valider', '/commentaires': 'Commentaires',
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
    if ((pathname === '/' && !me) || pathname === '/privacy' || pathname === '/terms') return   // la landing et les pages légales posent leur titre
    document.title = `${TITLES[pathname] ? TITLES[pathname] + ' · ' : ''}Chapote CM`
  }, [pathname, me])

  useEffect(() => {
    if (!ready) return
    try { me ? localStorage.setItem(HINT, '1') : localStorage.removeItem(HINT) } catch { /* stockage indisponible */ }
  }, [ready, me])

  // Visiteur sans session connue : la landing et la connexion s'affichent tout de suite,
  // sans attendre la réponse de l'API (elle bascule vers l'app si une session existe).
  if (!ready && (hadSession() || !PUBLIC.includes(pathname))) return <Splash />
  if (!me) {
    return (
      <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/connexion" element={<Login />} />
        <Route path="/inscription" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<Forgot />} />
        <Route path="/privacy" element={<Legal doc="privacy" />} />
        <Route path="/terms" element={<Legal doc="terms" />} />
        <Route path="*" element={ready ? <ToLogin /> : <Splash />} />
      </Routes>
      </Suspense>
    )
  }
  return (
    <Routes>
      <Route path="/connexion" element={<AfterLogin />} />
      <Route path="/inscription" element={<AfterLogin />} />
      <Route path="/mot-de-passe-oublie" element={<Navigate to="/" replace />} />
      <Route path="/privacy" element={<Suspense fallback={<Splash />}><Legal doc="privacy" /></Suspense>} />
      <Route path="/terms" element={<Suspense fallback={<Splash />}><Legal doc="terms" /></Suspense>} />
      <Route element={<Layout fallback={<PageLoading />} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/nouvelle" element={<Composer />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/comptes" element={<Accounts />} />
        <Route path="/bibliotheque" element={<Library />} />
        <Route path="/partage" element={<People />} />
        <Route path="/invitations" element={<Navigate to="/partage" replace />} />
        <Route path="/personnes" element={<Navigate to="/partage" replace />} />
        <Route path="/a-valider" element={<Drafts />} />
        <Route path="/commentaires" element={<Comments />} />
        <Route path="/videos/:id" element={<VideoSheet />} />
        <Route path="/equipe" element={<Navigate to="/partage" replace />} />
        <Route path="/avis" element={<Navigate to="/?avis=1" replace />} />
        <Route path="/tiktok/callback" element={<Callback platform="tiktok" />} />
        <Route path="/youtube/callback" element={<Callback platform="youtube" />} />
        <Route path="/instagram/callback" element={<Callback platform="instagram" />} />
        <Route path="/drive/callback" element={<DriveCallback />} />
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
