// Header sticky (blur) + nav desktop + menu burger mobile.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from '../../AuthContext'
import { CLASH, HatIcon, NAV } from './data'

export function Header({ user, ctaTo }: { user: User | null; ctaTo: string }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 60, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: 'rgba(249,249,251,.82)', borderBottom: '1px solid rgba(226,232,240,.7)' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, background: '#1C3F5C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={20} /></span>
          <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 22, color: '#1E2A32', letterSpacing: '-.01em' }}>Chapote</span>
        </Link>
        <nav className="ch-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          {NAV.map(({ href, label }) => <a key={label} className="ch-navlink" href={href}>{label}</a>)}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!user && <Link className="ch-navlink" to="/login" style={{ whiteSpace: 'nowrap' }}>Se connecter</Link>}
          <Link to={ctaTo} className="ch-cta-primary" style={{ background: '#1C3F5C', color: '#fff', borderRadius: 12, padding: '11px 18px', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', textDecoration: 'none', boxShadow: '0 6px 16px -8px rgba(28,63,92,.6)' }}>
            {user ? "Ouvrir l'application" : 'Installer la balise'}
          </Link>
          <button className="ch-menu-btn" aria-label="Menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(o => !o)} style={{ width: 42, height: 42, border: '1px solid #E2E8F0', borderRadius: 11, background: '#fff', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E2A32" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div style={{ borderTop: '1px solid #E2E8F0', background: '#fff', padding: '14px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {NAV.map(({ href, label }) => <a key={label} href={href} onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 500 }}>{label}</a>)}
        </div>
      )}
    </header>
  )
}
