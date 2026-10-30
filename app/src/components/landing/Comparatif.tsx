// Section comparatif : tableau sans icônes, Chapote vs chatbot 100 % IA vs
// support classique. Défile horizontalement sous 620px de large.
import { CLASH, CMP_ROWS, Kicker, CORAL, sectionH2, lead } from './data'
import { revealDelay } from './assets'

const COLS = '1.3fr 1fr 1fr 1fr'

export function Comparatif() {
  return (
    <section id="comparatif" className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '130px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: '48px 72px', alignItems: 'start' }}>
      <div style={{ maxWidth: 420 }}>
        <div className="ch-reveal"><Kicker color={CORAL}>COMPARATIF</Kicker></div>
        <h2 className="ch-reveal" style={{ ...sectionH2, ...revealDelay(80) }}>Ni Intercom,<br />ni Chatbase.</h2>
        <p className="ch-reveal" style={{ ...lead, ...revealDelay(160) }}>Le meilleur de chaque modèle, sans en payer les défauts.</p>
      </div>
      <div className="ch-reveal ch-cmp-table" role="table" aria-label="Comparatif Chapote, chatbot 100 % IA et support classique" style={{ ...revealDelay(120), overflowX: 'auto', minWidth: 0, WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: 620 }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '0 0 16px', borderBottom: '2px solid #1E2A32', fontSize: 14, fontWeight: 700 }}>
            <span role="columnheader" />
            <span role="columnheader" style={{ fontFamily: CLASH, fontSize: 20, color: '#1C3F5C' }}>Chapote</span>
            <span role="columnheader" style={{ color: '#6B7B8D' }}>Chatbot 100 % IA</span>
            <span role="columnheader" style={{ color: '#6B7B8D' }}>Support classique</span>
          </div>
          {CMP_ROWS.map(row => (
            <div key={row.l} role="row" className="ch-cmp-row" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '20px 0', borderBottom: '1px solid #E2E8F0', alignItems: 'baseline' }}>
              <span role="rowheader" style={{ fontWeight: 600, fontSize: 15.5 }}>{row.l}</span>
              <span role="cell" style={{ fontWeight: 700, fontSize: 15, color: '#1C7A5C', display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F9E79', flexShrink: 0, transform: 'translateY(-1px)' }} />{row.a}</span>
              <span role="cell" style={{ fontSize: 15, color: '#6B7B8D' }}>{row.b}</span>
              <span role="cell" style={{ fontSize: 15, color: '#6B7B8D' }}>{row.c}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
