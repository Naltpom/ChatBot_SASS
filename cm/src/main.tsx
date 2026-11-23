import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Accounts from './pages/Accounts'
import Callback from './pages/Callback'
import Composer from './pages/Composer'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Planning from './pages/Planning'
import Videos from './pages/Videos'
import { SessionProvider, useSession } from './session'
import './styles.css'

const TITLES: Record<string, string> = {
  '/': 'Tableau de bord', '/planning': 'Planning', '/videos': 'Vidéos', '/comptes': 'Comptes', '/nouvelle': 'Nouvelle publication',
}

function Shell() {
  const { me, ready } = useSession()
  const { pathname } = useLocation()
  useEffect(() => { document.title = `${TITLES[pathname] ? TITLES[pathname] + ' · ' : ''}Chapote CM` }, [pathname])
  if (!ready) return <div className="auth-wrap"><Loading /></div>
  if (!me) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/nouvelle" element={<Composer />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/comptes" element={<Accounts />} />
        <Route path="/tiktok/callback" element={<Callback platform="tiktok" />} />
        <Route path="/youtube/callback" element={<Callback platform="youtube" />} />
        <Route path="/instagram/callback" element={<Callback platform="instagram" />} />
        <Route path="*" element={<div className="col"><h1>Page introuvable</h1><Link to="/">Tableau de bord</Link></div>} />
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
