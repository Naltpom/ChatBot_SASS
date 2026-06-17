// Section témoignages clients.
import { TESTIS, eyebrow, sectionH2 } from './data'

export function Temoignages() {
  return (
    <section id="testi" style={{ background: '#F9F9FB', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
          <span style={eyebrow('#8C6DFF')}>TÉMOIGNAGES</span>
          <h2 className="ch-section-h2" style={sectionH2}>Moins de tickets, plus de marge.</h2>
        </div>
        <div className="ch-testi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
          {TESTIS.map(t => (
            <div key={t.name} className="ch-reveal" style={{ background: '#fff', border: '1px solid #E2E8F0', borderLeft: '4px solid #8C6DFF', borderRadius: 18, padding: '26px 24px', boxShadow: '0 8px 26px -16px rgba(28,63,92,.2)' }}>
              <div style={{ display: 'flex', gap: 3, color: '#E0A82E' }}>{'★★★★★'.slice(0, t.stars)}</div>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: '#1E2A32', margin: '14px 0 0' }}>{t.q}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
                <span style={{ width: 42, height: 42, borderRadius: '50%', background: t.bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>{t.av}</span>
                <span style={{ lineHeight: 1.3 }}><span style={{ display: 'block', fontWeight: 600, fontSize: 14.5, color: '#1E2A32' }}>{t.name}</span><span style={{ display: 'block', fontSize: 13, color: '#6B7B8D' }}>{t.role}</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
