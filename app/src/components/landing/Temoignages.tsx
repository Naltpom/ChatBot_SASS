// Section « L'impact » : pas de témoignages inventés — on
// décrit ce que la mécanique produit par design (3 cartes à icône).
import { JAKARTA, IMPACTS, eyebrow, sectionH2 } from './data'

export function Temoignages() {
  return (
    <section id="testi" style={{ background: '#F9F9FB', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
          <span style={eyebrow('#8C6DFF')}>L'IMPACT</span>
          <h2 className="ch-section-h2" style={sectionH2}>Conçu pour réduire vos tickets.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px auto 0', maxWidth: 560 }}>
            Pas encore de témoignages clients — on préfère ne pas en inventer. Voici ce que la mécanique fait, par design.
          </p>
        </div>
        <div className="ch-testi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
          {IMPACTS.map(i => (
            <div key={i.t} className="ch-reveal" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 18, padding: '28px 26px', boxShadow: '0 8px 26px -16px rgba(28,63,92,.2)' }}>
              <span style={{ display: 'inline-flex', width: 46, height: 46, borderRadius: 13, background: i.bg, color: i.co, alignItems: 'center', justifyContent: 'center' }}>{i.icon}</span>
              <h3 style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 18, color: '#1E2A32', margin: '18px 0 0' }}>{i.t}</h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#6B7B8D', margin: '9px 0 0' }}>{i.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
