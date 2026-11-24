// Coque de l'interface : barre du haut (marque, navigation, compte). Mobile : navigation sous la barre.
import { Suspense, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../session'
import { Brand } from './ui'

const NAV = [
  { to: '/', label: 'Boîtes mail', end: true },
  { to: '/acces', label: 'Accès Claude' },
  { to: '/journal', label: 'Journal' },
]

export default function Layout({ fallback }: { fallback: ReactNode }) {
  const { me, signOut } = useSession()
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <Brand to="/" />
          <nav className="nav" aria-label="Navigation principale">
            {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
          </nav>
          <div className="row" style={{ gap: 10 }}>
            <span className="small muted only-desktop">{me?.email}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>Déconnexion</button>
          </div>
        </div>
      </header>
      <main className="content">
        <Suspense fallback={fallback}><Outlet /></Suspense>
      </main>
    </div>
  )
}
