// « Ce que ça coûte vraiment » : texte + compteurs à gauche, courbe d'un mois
// type à droite. La courbe se dévoile au scroll (un cache blanc se retire de
// gauche à droite) et les compteurs suivent. Chiffres = EXEMPLE illustratif.
import { useRef } from 'react'
import { CLASH, MONO, Kicker, VIOLET, VIOLET_DARK, sectionH2, lead } from './data'
import { clamp, revealDelay, useScrollProgress } from './assets'

const fr = (n: number) => Math.round(n).toLocaleString('fr-FR')

export function Couts() {
  const ref = useRef<HTMLElement>(null)
  const p = useScrollProgress(ref, 'enter')
  const cp = clamp((p - 0.15) / 0.65)
  // L'IA atteint son plafond à ~63 % du mois (point x=380 sur 600 de la courbe).
  const iaFrac = clamp(cp / 0.63)

  return (
    <section id="couts" ref={ref} className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '130px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '56px 72px', alignItems: 'center' }}>
      <div>
        <div className="ch-reveal"><Kicker color={VIOLET}>CE QUE ÇA COÛTE VRAIMENT</Kicker></div>
        <h2 className="ch-reveal" style={{ ...sectionH2, ...revealDelay(80) }}>L’arbre ne coûte rien.<br /><span style={{ color: VIOLET }}>L’IA a un plafond.</span></h2>
        <p className="ch-reveal" style={{ ...lead, ...revealDelay(160) }}>Les réponses de l’arbre sont illimitées et incluses. L’IA fonctionne par paliers de 1 000, 3 000 ou 10 000 réponses par mois. Un plafond quotidien par bot protège votre budget : au-delà, le widget continue en arbre seul. Pas de facture qui dérape.</p>
        <div className="ch-reveal" style={{ ...revealDelay(240), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 40, maxWidth: 520 }}>
          <div style={{ borderTop: '3px solid #2F9E79', paddingTop: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 12, color: '#6B7B8D' }}>Réponses arbre</div>
            <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 44, letterSpacing: '-.02em', marginTop: 4 }}>{fr(cp * 18400)}</div>
            <div style={{ fontSize: 13.5, color: '#1C7A5C', fontWeight: 600 }}>0 € de plus</div>
          </div>
          <div style={{ borderTop: `3px solid ${VIOLET}`, paddingTop: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 12, color: '#6B7B8D' }}>Réponses IA</div>
            <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 44, letterSpacing: '-.02em', marginTop: 4 }}>{fr(iaFrac * 3000)}</div>
            <div style={{ fontSize: 13.5, color: VIOLET_DARK, fontWeight: 600 }}>sur 3 000, pas une de plus</div>
          </div>
        </div>
      </div>
      <div className="ch-reveal" style={{ ...revealDelay(120), background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, padding: '28px 28px 22px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontFamily: MONO, fontSize: 12, color: '#6B7B8D' }}><span>Exemple de mois · palier IA Growth</span><span>jour {Math.max(1, Math.round(cp * 30))}</span></div>
        <div style={{ position: 'relative', marginTop: 22 }}>
          <svg viewBox="0 0 600 320" role="img" aria-label="Sur un mois type, les réponses de l’arbre montent sans limite ; les réponses IA plafonnent à 3 000, puis le widget repasse en arbre." style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
            <line x1="0" y1="300" x2="600" y2="300" style={{ stroke: '#E2E8F0', strokeWidth: 1.5 }} />
            <line x1="0" y1="120" x2="600" y2="120" style={{ stroke: '#E86A5F', strokeWidth: 1.5, strokeDasharray: '6 6' }} />
            <text x="0" y="108" style={{ fontFamily: MONO, fontSize: 13, fill: '#C24E44' }}>plafond IA · 3 000</text>
            <path d="M0 300 C 160 285, 380 170, 600 18" style={{ fill: 'none', stroke: '#2F9E79', strokeWidth: 4, strokeLinecap: 'round' }} />
            <path d="M0 300 C 120 272, 260 150, 380 120 L 600 120" style={{ fill: 'none', stroke: VIOLET, strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
            <circle cx="380" cy="120" r="7" style={{ fill: VIOLET }} />
            <text x="392" y="150" style={{ fontFamily: MONO, fontSize: 13, fill: '#4A5A68' }}>→ le widget repasse en arbre</text>
            <text x="596" y="44" style={{ fontFamily: MONO, fontSize: 13, fill: '#1C7A5C', textAnchor: 'end' }}>arbre · illimité</text>
          </svg>
          <div aria-hidden="true" style={{ position: 'absolute', top: -30, bottom: -4, right: -10, width: `${(1 - cp) * 100}%`, background: '#fff' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: '#6B7B8D' }}><span>1er</span><span>15</span><span>30</span></div>
      </div>
    </section>
  )
}
