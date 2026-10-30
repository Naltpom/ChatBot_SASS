// « Ce qu'est Chapote » : le positionnement en une phrase (les chatbots à source
// unique en gris, ce que fait Chapote en noir), puis un bandeau qui barre les
// trois approches à source unique face à la case Chapote.
import { CLASH, MONO, SINGLE_SOURCE, Kicker } from './data'
import { revealDelay } from './assets'

export function Chapote() {
  return (
    <section id="chapote" className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '56px 32px 80px' }}>
      <div className="ch-reveal"><Kicker color="#1C3F5C">CE QU’EST CHAPOTE</Kicker></div>
      <p className="ch-reveal" style={{ ...revealDelay(80), fontFamily: CLASH, fontWeight: 500, fontSize: 'clamp(26px,3.2vw,42px)', lineHeight: 1.2, letterSpacing: '-.015em', color: '#1E2A32', margin: '24px 0 0', maxWidth: 1080, textWrap: 'pretty' } as React.CSSProperties}>
        <span style={{ color: '#6B7B8D' }}>La plupart des chatbots n’ont qu’une corde à leur arc : un arbre de décision, une IA, ou des conseillers.</span>{' '}
        Chapote réunit les trois. Chaque question va vers ce qui y répond le plus vite et au meilleur coût, à partir de votre site et de vos documents.{' '}
        <span style={{ color: '#2F9E79' }}>Et votre équipe souffle enfin.</span>
      </p>
      <div className="ch-reveal ch-single" style={{ ...revealDelay(160), display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', marginTop: 56, borderTop: '1px solid #D8DEE6' }}>
        {SINGLE_SOURCE.map((x, i) => (
          <div key={x.k} style={{ padding: i === 0 ? '22px 24px 22px 0' : '22px 24px' }}>
            <div style={{ fontFamily: MONO, fontSize: 12.5, color: '#6B7B8D', textDecoration: 'line-through' }}>{x.k}</div>
            <p style={{ fontSize: 15, lineHeight: 1.55, color: '#4A5A68', margin: '10px 0 0' }}>{x.d}</p>
          </div>
        ))}
        <div style={{ padding: '22px 24px', background: '#1C3F5C', color: '#fff', borderRight: 'none' }}>
          <div style={{ fontFamily: MONO, fontSize: 12.5, color: '#7FE3BE', fontWeight: 600 }}>Chapote</div>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: '#fff', margin: '10px 0 0', fontWeight: 600 }}>Les trois, chacun là où il est le meilleur.</p>
        </div>
      </div>
    </section>
  )
}
