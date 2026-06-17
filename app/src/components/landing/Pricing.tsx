// Section tarifs : l'app est 100% gratuite, sans limite (pas de cartes plans).
import { Link } from 'react-router-dom'
import { CLASH, btnPrimary, eyebrow } from './data'

export function Pricing({ ctaTo }: { ctaTo: string }) {
  return (
    <section id="pricing" style={{ background: '#F0F2F5', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 760, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
        <div className="ch-reveal">
          <span style={eyebrow('#2F9E79')}>TARIFS</span>
          <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>100% gratuit, sans limite.</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px auto 0', maxWidth: 560 }}>Arbre guidé illimité, IA, relais humain : toutes les fonctionnalités sont incluses, sans carte bancaire.</p>
          <div style={{ marginTop: 30 }}>
            <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>Commencer gratuitement →</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
