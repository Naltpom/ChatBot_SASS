// CTA final (bandeau navy) : un grand chapeau se dessine au trait pendant que la
// section entre dans l'écran. Bouton secondaire « parler à un conseiller ».
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { CLASH } from './data'
import { clamp, revealDelay, useScrollProgress } from './assets'

export function CtaFinal({ ctaTo }: { ctaTo: string }) {
  const ref = useRef<HTMLElement>(null)
  const hp = clamp(useScrollProgress(ref, 'enter') * 1.3)
  return (
    <section ref={ref} className="ch-pad" style={{ background: '#1C3F5C', color: '#fff', padding: '140px 32px', overflow: 'hidden', position: 'relative' }}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ position: 'absolute', right: '-6%', top: '50%', width: 'min(640px,70vw)', height: 'auto', transform: `translateY(-50%) rotate(${-8 + hp * 8}deg)`, opacity: 0.9, pointerEvents: 'none' }}>
        <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" style={{ stroke: '#2F9E79', strokeWidth: 0.9, strokeLinecap: 'round', strokeDasharray: 20, strokeDashoffset: 20 * (1 - hp) }} />
        <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" style={{ stroke: '#2F9E79', strokeWidth: 0.9, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: 24, strokeDashoffset: 24 * (1 - hp) }} />
      </svg>
      <div style={{ maxWidth: 1280, margin: '0 auto', position: 'relative' }}>
        <h2 className="ch-reveal" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 'clamp(48px,7.4vw,112px)', lineHeight: 0.95, letterSpacing: '-.035em', margin: 0, maxWidth: 900 }}>Vos conseillers ont mieux à faire.</h2>
        <p className="ch-reveal" style={{ ...revealDelay(100), fontSize: 19, lineHeight: 1.6, color: '#C3D3DF', margin: '28px 0 0', maxWidth: 480 }}>Installez la balise en une minute. Gardez l’humain là où il compte.</p>
        <div className="ch-reveal" style={{ ...revealDelay(180), display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 36 }}>
          <Link to={ctaTo} className="ch-cta-lift" style={{ background: '#fff', color: '#1C3F5C', borderRadius: 12, padding: '16px 26px', fontWeight: 600, fontSize: 16, textDecoration: 'none' }}>Installer la balise →</Link>
          <a href="mailto:hello@chapote.fr" className="ch-cta-lift" style={{ background: '#E86A5F', color: '#14202A', borderRadius: 12, padding: '16px 24px', fontWeight: 600, fontSize: 16, textDecoration: 'none' }}>Parler à un conseiller</a>
        </div>
        <div style={{ marginTop: 28, fontSize: 13.5, color: '#A8C0D0' }}>Dès 9 € / mois · Sans engagement · Hébergé en France</div>
      </div>
    </section>
  )
}
