// Shell sidebar — porté du prototype Kertios Chat (sidebar 222px, logo, org
// switcher, nav, bloc plan/crédits, MRR pour l'admin).
import { ReactNode, useEffect, useRef, useState } from 'react'
import { Bot, Building2, Check, ChevronDown, CreditCard, LogOut, ShieldCheck, Users } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Org, useAuth } from './AuthContext'
import { api } from './api'
import { Chip, Meter, orgColor, orgInitials } from './ui'
import { PLAN_LABELS } from './botConstants'

interface Usage {
  plan: string
  plan_price: number
  ai_messages_used: number
  ai_messages_quota: number
  bots_used: number
  bots_quota: number
}

function OrgSwitcher({ orgs, current, onSwitch }: { orgs: Org[]; current: Org | null; onSwitch: (o: Org) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (!current) return null

  return (
    <div ref={ref} className="orgsw">
      <button className="orgsw-btn" onClick={() => setOpen(o => !o)}>
        <span className="org-avatar" style={{ background: orgColor(current.name) }}>{orgInitials(current.name)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="orgsw-name">{current.name}</span>
          <span className="orgsw-sub">Plan {PLAN_LABELS[current.plan] || current.plan}</span>
        </span>
        <ChevronDown size={12} style={{ color: 'var(--faint)', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="orgsw-menu">
          <div className="orgsw-menu-title">Vos organisations</div>
          {orgs.map(o => (
            <button key={o.id} className={`orgsw-item ${o.id === current.id ? 'current' : ''}`}
                    onClick={() => { onSwitch(o); setOpen(false) }}>
              <span className="org-avatar" style={{ background: orgColor(o.name) }}>{orgInitials(o.name)}</span>
              <span className="nm">{o.name}</span>
              {o.id === current.id && <Check size={12} className="ck" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, activeOrg, setActiveOrg, logout, refreshUser } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // Org déjà resynchronisée après un 404 (anti-boucle : une fois par org)
  const resyncedOrgId = useRef<number | null>(null)

  const inAdmin = location.pathname.startsWith('/admin')

  useEffect(() => {
    if (!activeOrg || inAdmin) return
    api<Usage>(`/api/orgs/${activeOrg.id}/usage`)
      .then(setUsage)
      .catch((err: any) => {
        setUsage(null)
        // Membre retiré de l'org pendant sa session : l'usage renvoie 404 →
        // on recharge /me pour retirer l'org disparue et re-sélectionner.
        if (err?.status === 404 && resyncedOrgId.current !== activeOrg.id) {
          resyncedOrgId.current = activeOrg.id
          refreshUser().catch(() => {})
        }
      })
  }, [activeOrg, location.pathname])

  const creditsPct = usage ? Math.round((usage.ai_messages_used / Math.max(1, usage.ai_messages_quota)) * 100) : 0

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/app" className="sidebar-logo">
          <img src="/brand/icon.svg" alt="Kertios" />
          <div>
            <div className="brand-name">Kertios <span>Chat</span></div>
            <div className="brand-sub">{inAdmin ? 'Opérateur' : 'Chatbots hybrides'}</div>
          </div>
        </Link>

        {!inAdmin && user && user.organizations.length > 0 && (
          <OrgSwitcher orgs={user.organizations} current={activeOrg}
                       onSwitch={o => { setActiveOrg(o); navigate('/app') }} />
        )}

        <nav className="col" style={{ gap: 2 }}>
          {user && user.organizations.length > 0 && (
            <>
              <button className={`nav-item ${!inAdmin && !location.pathname.startsWith('/app/team') && !location.pathname.startsWith('/app/billing') ? 'active' : ''}`}
                      onClick={() => navigate('/app')}>
                <span className="nav-ico"><Bot size={16} /></span>Mes chatbots
              </button>
              <button className={`nav-item ${location.pathname.startsWith('/app/team') ? 'active' : ''}`}
                      onClick={() => navigate('/app/team')}>
                <span className="nav-ico"><Users size={16} /></span>Équipe
              </button>
              <button className={`nav-item ${location.pathname.startsWith('/app/billing') ? 'active' : ''}`}
                      onClick={() => navigate('/app/billing')}>
                <span className="nav-ico"><CreditCard size={16} /></span>Facturation
              </button>
            </>
          )}
          {user?.is_superadmin && (
            <button className={`nav-item ${inAdmin ? 'active' : ''}`} onClick={() => navigate('/admin')}>
              <span className="nav-ico"><Building2 size={16} /></span>Clients
            </button>
          )}
        </nav>

        <div style={{ flex: 1 }} />

        {!inAdmin && usage && (
          <div className="sidebar-block" role="button" tabIndex={0} title="Gérer la facturation"
               style={{ cursor: 'pointer' }}
               onClick={() => navigate('/app/billing')}
               onKeyDown={e => e.key === 'Enter' && navigate('/app/billing')}>
            <div className="sidebar-plan-row">
              <span className="lbl">Plan {PLAN_LABELS[usage.plan] || usage.plan}</span>
              <Chip tone="acc">{usage.plan_price} €/mois</Chip>
            </div>
            <div className="sidebar-usage">
              <Meter pct={creditsPct} tone={creditsPct > 95 ? 'danger' : creditsPct > 70 ? 'warn' : 'acc'} height={5} />
              <div className="sub">
                {usage.ai_messages_used.toLocaleString('fr-FR')} / {usage.ai_messages_quota.toLocaleString('fr-FR')} crédits IA
                · {usage.bots_used}/{usage.bots_quota} bots
              </div>
            </div>
          </div>
        )}

        <div className="sidebar-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 4px 0' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {user?.name}{user?.is_superadmin && <ShieldCheck size={13} style={{ color: 'var(--acc)' }} />}
          </span>
          <button className="btn btn-ghost small" onClick={logout} title="Déconnexion"><LogOut size={13} /></button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  )
}
