// « Pourquoi Chapote » : développe la promesse du hero (moins cher qu'un
// chatbot 100 % IA, plus malin qu'une FAQ, plus rapide qu'un ticket), une ligne
// par promesse, chacune terminée par un « avant » barré et un « avec Chapote ».
import { CLASH, MONO, WHY } from './data'
import { revealDelay } from './assets'

export function Pourquoi() {
  return (
    <section id="pourquoi" className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '40px 32px 120px' }}>
      <div style={{ borderTop: '2px solid #1E2A32' }}>
        {WHY.map(w => (
          <div key={w.n} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: '24px 72px', padding: '56px 0', borderBottom: '1px solid #D8DEE6' }}>
            <div className="ch-reveal">
              <div style={{ fontFamily: MONO, fontSize: 12.5, color: w.c }}>{w.n} — {w.vs}</div>
              <h2 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 'clamp(34px,4vw,54px)', lineHeight: 1, letterSpacing: '-.03em', margin: '14px 0 0' }}>{w.h}</h2>
            </div>
            <div className="ch-reveal" style={revealDelay(100)}>
              <p style={{ fontSize: 18, lineHeight: 1.6, color: '#4A5A68', margin: 0, textWrap: 'pretty' } as React.CSSProperties}>{w.d}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '10px 20px', marginTop: 28, fontFamily: MONO, fontSize: 13.5, lineHeight: 1.5 }}>
                <span style={{ color: '#6B7B8D' }}>{w.before[0]}</span><span style={{ color: '#6B7B8D', textDecoration: 'line-through' }}>{w.before[1]}</span>
                <span style={{ color: '#1C7A5C', fontWeight: 600 }}>Chapote</span><span style={{ color: '#1E2A32' }}>{w.after}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
