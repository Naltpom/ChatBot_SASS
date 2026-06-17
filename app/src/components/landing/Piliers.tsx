// Section « 4 piliers » : promesses produit (gratuit, RGPD, install, humain).
import { CLASH, JAKARTA, PILIERS, eyebrow } from './data'

export function Piliers() {
  return (
    <section id="features" style={{ background: '#F9F9FB', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 50px' }}>
          <span style={eyebrow('#2F9E79')}>POURQUOI CHAPOTE</span>
          <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>L'hybride frugal, sans compromis</h2>
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
      </div>
    </section>
  )
}
