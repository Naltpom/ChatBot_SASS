// Shell sidebar — porté du prototype Chapote (sidebar 222px, logo, org
// switcher, nav). Deux modes déduits du pathname :
// /app/* = espace client (OrgSwitcher), /admin/* = back-office staff.
import { ReactNode, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight, BarChart3, Bot, Building2, Check, ChevronDown, CircleUser,
  CreditCard, Inbox, Layers, LayoutDashboard, LogOut, Menu, ShieldCheck, Users,
} from 'lucide-react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Org, useAuth } from './AuthContext'
import { canSeeBilling } from './utils/permissions'
import { orgColor, orgInitials } from './ui'

function OrgSwitcher({ orgs, current, onSwitch }: { orgs: Org[]; current: Org | null; onSwitch: (o: Org) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Aucune équipe (compte solo) : encart « Perso » non cliquable. La création
  // de bot perso ne dépend pas d'une équipe active.
  if (orgs.length === 0) {
    return (
      <div className="orgsw">
        <div className="orgsw-btn" style={{ cursor: 'default' }}>
          <span className="org-avatar" style={{ background: 'var(--acc-soft)', color: 'var(--mint)' }}>P</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="orgsw-name">Espace perso</span>
            <span className="orgsw-sub">Aucune équipe</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} className="orgsw">
      <button className="orgsw-btn" onClick={() => setOpen(o => !o)}>
        <span className="org-avatar" style={{ background: orgColor(current?.name || '') }}>{orgInitials(current?.name || '?')}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="orgsw-name">{current?.name || 'Choisir une équipe'}</span>
          <span className="orgsw-sub">Équipe active</span>
        </span>
        <ChevronDown size={12} style={{ color: 'var(--faint)', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="orgsw-menu">
          <div className="orgsw-menu-title">Vos équipes</div>
          {orgs.map(o => (
            <button key={o.id} className={`orgsw-item ${o.id === current?.id ? 'current' : ''}`}
                    onClick={() => { onSwitch(o); setOpen(false) }}>
              <span className="org-avatar" style={{ background: orgColor(o.name) }}>{orgInitials(o.name)}</span>
              <span className="nm">{o.name}</span>
              {o.id === current?.id && <Check size={12} className="ck" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, activeOrg, setActiveOrg, logout } = useAuth()
  // Drawer mobile (off-canvas) — desktop n'utilise jamais cet état.
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const path = location.pathname
  const inAdmin = path.startsWith('/admin')
  // Le wizard de création (/app/bots/new) a son propre en-tête plein écran
  // (logo + étapes + « Quitter ») : on masque le chrome du tableau de bord
  // (sidebar + topbar mobile) et on le rend pleine largeur, sans padding.
  const chromeless = path === '/app/bots/new'

  // Fermeture auto du drawer à chaque changement de route.
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  if (chromeless) {
    return (
      <div className="shell">
        <main className="main" style={{ padding: 0 }}>{children}</main>
      </div>
    )
  }

  return (
    <div className="shell">
      {/* Barre haute mobile (≤860px) — logo + hamburger. Cachée en desktop (CSS). */}
      <div className="topbar-mobile">
        <Link to="/app" className="topbar-mobile-logo">
          <span className="sidebar-logo-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">Chapote</span>
        </Link>
        <button className="topbar-burger" aria-label="Menu" onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
        </button>
      </div>

      {/* Backdrop du drawer — visible seulement quand ouvert (mobile). */}
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <Link to="/app" className="sidebar-logo">
          <span className="sidebar-logo-mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <div className="brand-name">Chapote</div>
            {inAdmin && <div className="brand-sub">Opérateur</div>}
          </div>
        </Link>

        {!inAdmin && user && (
          <OrgSwitcher orgs={user.organizations} current={activeOrg}
                       onSwitch={o => { setActiveOrg(o); navigate('/app') }} />
        )}

        <nav className="col" style={{ gap: 4 }}>
          {!inAdmin && (
            <>
              {/* Toujours visibles (solo ou en équipe) : ses chatbots (perso +
                  équipes via GET /api/bots), l'analytics et l'inbox. */}
              <button className={`nav-item ${path === '/app' || path.startsWith('/app/bots') ? 'active' : ''}`}
                      onClick={() => navigate('/app')}>
                <span className="nav-ico"><Bot size={16} /></span>Mes chatbots
              </button>
              <button className={`nav-item ${path.startsWith('/app/analytics') ? 'active' : ''}`}
                      onClick={() => navigate('/app/analytics')}>
                <span className="nav-ico"><BarChart3 size={16} /></span>Analytics
              </button>
              <button className={`nav-item ${path.startsWith('/app/inbox') ? 'active' : ''}`}
                      onClick={() => navigate('/app/inbox')}>
                <span className="nav-ico"><Inbox size={16} /></span>Inbox
              </button>
              {/* Facturation : visible uniquement pour un payeur (owner d'org ou
                  compte perso) ; masquée pour un admin non-owner (canSeeBilling).
                  Défense en profondeur : le backend rejette (403) les non-owners. */}
              {canSeeBilling(user) && (
                <button className={`nav-item ${path.startsWith('/app/billing') ? 'active' : ''}`}
                        onClick={() => navigate('/app/billing')}>
                  <span className="nav-ico"><CreditCard size={16} /></span>Facturation
                </button>
              )}
              {/* Lien team-scoped : visible seulement avec une équipe active. */}
              {activeOrg && (
                <button className={`nav-item ${path.startsWith('/app/team') ? 'active' : ''}`}
                        onClick={() => navigate('/app/team')}>
                  <span className="nav-ico"><Users size={16} /></span>Équipe
                </button>
              )}
              <div className="nav-divider" />
              <button className={`nav-item ${path.startsWith('/app/orgs') ? 'active' : ''}`}
                      onClick={() => navigate('/app/orgs')}>
                <span className="nav-ico"><Layers size={16} /></span>Mes équipes
              </button>
              <button className={`nav-item ${path.startsWith('/app/profile') ? 'active' : ''}`}
                      onClick={() => navigate('/app/profile')}>
                <span className="nav-ico"><CircleUser size={16} /></span>Profil
              </button>
              {user?.is_superadmin && (
                <>
                  <div className="nav-divider" />
                  <button className="nav-item" onClick={() => navigate('/admin')}>
                    <span className="nav-ico"><ShieldCheck size={16} /></span>Back-office
                  </button>
                </>
              )}
            </>
          )}
          {inAdmin && (
            <>
              <button className={`nav-item ${path === '/admin' ? 'active' : ''}`}
                      onClick={() => navigate('/admin')}>
                <span className="nav-ico"><LayoutDashboard size={16} /></span>Dashboard
              </button>
              <button className={`nav-item ${path.startsWith('/admin/clients') ? 'active' : ''}`}
                      onClick={() => navigate('/admin/clients')}>
                <span className="nav-ico"><Building2 size={16} /></span>Clients
              </button>
              <button className={`nav-item ${path.startsWith('/admin/users') ? 'active' : ''}`}
                      onClick={() => navigate('/admin/users')}>
                <span className="nav-ico"><Users size={16} /></span>Utilisateurs
              </button>
              <div className="nav-divider" />
              <button className="nav-item" onClick={() => navigate('/app')}>
                <span className="nav-ico"><ArrowLeftRight size={16} /></span>Espace client
              </button>
            </>
          )}
        </nav>

        <div style={{ flex: 1 }} />

        <div className="sidebar-user">
          <button className="sidebar-user-main" onClick={() => navigate('/app/profile')} title="Mon profil">
            <span className="sidebar-user-avatar" aria-hidden="true">{orgInitials(user?.name || '?')}</span>
            <span className="sidebar-user-id">
              <span className="nm">
                {user?.name}
                {user?.is_superadmin && <ShieldCheck size={12} style={{ color: 'var(--mint)', flexShrink: 0 }} />}
              </span>
              <span className="org">{activeOrg?.name || (inAdmin ? 'Back-office' : 'Espace perso')}</span>
            </span>
          </button>
          <button className="sidebar-user-logout" onClick={logout} title="Déconnexion" aria-label="Déconnexion">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  )
}
