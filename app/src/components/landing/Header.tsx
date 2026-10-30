// Header sticky (blur) + nav desktop + menu burger mobile.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { User } from '../../AuthContext'
import { CLASH, HatIcon, NAV } from './data'

export function Header({ user, ctaTo }: { user: User | null; ctaTo: string }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // 3 cas de liens de nav :
  //  • « /… » (ex. /demo) → vraie route en <Link>.
  //  • ancre « #x » SUR la landing → <a href="#x"> (saut natif, même page).
  //  • ancre « #x » HORS landing (ex. /demo) → <Link to="/#x"> : navigation SPA
  //    vers l'accueil (sans reload, donc pas de restauration de scroll qui
  //    parasite), puis ScrollToHash (App.tsx) scrolle jusqu'à la section.
  const onLanding = useLocation().pathname === '/'
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 60, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(249,249,251,.92)', borderBottom: '1px solid #E2E8F0' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: '#1C3F5C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={20} /></span>
          <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 22, color: '#1E2A32', letterSpacing: '-.01em' }}>Chapote</span>
        </Link>
        <nav className="ch-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 26, marginLeft: 'auto' }}>
          {NAV.map(({ href, label }) => href.startsWith('/')
            ? <Link key={label} className="ch-navlink" to={href}>{label}</Link>
            : onLanding
              ? <a key={label} className="ch-navlink" href={href}>{label}</a>
              : <Link key={label} className="ch-navlink" to={`/${href}`}>{label}</Link>)}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 'auto' }}>
          {/* Actions « bureau » : « Se connecter » masqué sous 720px, le CTA sous
              440px (le menu burger les reprend tous les deux). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {!user && <Link className="ch-navlink ch-login" to="/login" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>Se connecter</Link>}
            <Link to={ctaTo} className="ch-cta-flat ch-header-cta" style={{ background: '#1C3F5C', color: '#fff', borderRadius: 11, padding: '11px 18px', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', textDecoration: 'none', transition: 'background .2s' }}>
              {user ? "Ouvrir l'application" : 'Installer la balise'}
            </Link>
          </div>
          <button className="ch-menu-btn" aria-label="Menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(o => !o)} style={{ width: 42, height: 42, border: '1px solid #E2E8F0', borderRadius: 11, background: '#fff', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E2A32" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div style={{ borderTop: '1px solid #E2E8F0', background: '#fff', padding: '14px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {NAV.map(({ href, label }) => href.startsWith('/')
            ? <Link key={label} to={href} onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 500 }}>{label}</Link>
            : onLanding
              ? <a key={label} href={href} onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 500 }}>{label}</a>
              : <Link key={label} to={`/${href}`} onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 500 }}>{label}</Link>)}
          {/* Connexion + CTA repliés dans le menu (masqués dans la barre en mobile). */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!user && <Link to="/login" onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 600 }}>Se connecter</Link>}
            <Link to={ctaTo} onClick={() => setMobileOpen(false)} className="ch-cta-flat" style={{ background: '#1C3F5C', color: '#fff', borderRadius: 12, padding: '12px 18px', fontWeight: 600, fontSize: 15, textDecoration: 'none', textAlign: 'center' }}>
              {user ? "Ouvrir l'application" : 'Installer la balise'}
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
