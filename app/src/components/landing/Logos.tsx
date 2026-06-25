// Bandeau de réassurance : plateformes d'intégration (« s'intègre partout »).
import { CLASH, LOGOS } from './data'

export function Logos() {
  return (
    <section style={{ background: '#F0F2F5', padding: '54px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.08em', color: '#9AA7B4', textTransform: 'uppercase' }}>S'intègre partout, en une balise</div>
        <div style={{ marginTop: 30, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 46 }}>
          {LOGOS.map(l => <span key={l} className="ch-logo" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 23, color: '#6B7B8D', opacity: .62 }}>{l}</span>)}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#9AA7B4' }}>+ tout site HTML</span>
        </div>
      </div>
    </section>
  )
}
