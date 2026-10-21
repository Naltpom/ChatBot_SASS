// Section « 4 piliers » : promesses produit (gratuit, RGPD, install, humain),
// suivies des modules complémentaires de l'Espace client (MODULES).
import { Link } from 'react-router-dom'
import { JAKARTA, MODULES, PILIERS, eyebrow, sectionH2 } from './data'

export function Piliers() {
  return (
    <section id="features" style={{ background: '#F9F9FB', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 50px' }}>
          <span style={eyebrow('#2F9E79')}>POURQUOI CHAPOTE</span>
          <h2 className="ch-section-h2" style={sectionH2}>L'hybride frugal, sans compromis</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px 0 0' }}>Quatre promesses tenues par design — toutes gratuites.</p>
        </div>
        <div className="ch-piliers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 24 }}>
          {PILIERS.map(p => (
            <div key={p.t} className="ch-reveal ch-pilier" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, padding: '28px 24px', boxShadow: '0 6px 20px -12px rgba(28,63,92,.18)' }}>
              <span style={{ width: 50, height: 50, borderRadius: 14, background: p.bg, color: p.co, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.icon}</span>
              <h3 style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 19, color: '#1E2A32', margin: '18px 0 0' }}>{p.t}</h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6B7B8D', margin: '8px 0 0' }}>{p.d}</p>
            </div>
          ))}
        </div>
        {MODULES.map(m => (
          <div key={m.t} className="ch-reveal" style={{ marginTop: 24, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, padding: '22px 24px', display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 6px 20px -12px rgba(28,63,92,.18)' }}>
            <span style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(28,63,92,.08)', color: '#1C3F5C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M10.5 9.5v5l4-2.5z" fill="currentColor" /></svg>
            </span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h3 style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 17, color: '#1E2A32', margin: 0 }}>
                {m.t} <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#2F9E79', marginLeft: 6 }}>MODULE</span>
              </h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6B7B8D', margin: '6px 0 0' }}>{m.d}</p>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 13.5 }}>
              {m.links.map(l => <Link key={l.href} to={l.href} style={{ color: '#1C3F5C' }}>{l.label}</Link>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
