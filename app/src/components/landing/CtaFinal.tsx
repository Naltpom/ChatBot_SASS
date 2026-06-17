// CTA final (bandeau navy) + bouton secondaire « parler à un conseiller ».
import { Link } from 'react-router-dom'
import { CLASH, JAKARTA } from './data'

export function CtaFinal({ ctaTo }: { ctaTo: string }) {
  return (
    <section style={{ background: 'linear-gradient(135deg,#1C3F5C 0%,#15344b 100%)', padding: '90px 0', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-30%', left: '8%', width: 340, height: 340, background: 'radial-gradient(circle,rgba(47,158,121,.22),transparent 65%)' }} />
      <div style={{ position: 'absolute', bottom: '-40%', right: '6%', width: 380, height: 380, background: 'radial-gradient(circle,rgba(140,109,255,.2),transparent 65%)' }} />
      <div className="ch-reveal ch-pad" style={{ maxWidth: 760, margin: '0 auto', padding: '0 32px', textAlign: 'center', position: 'relative' }}>
        <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 42, lineHeight: 1.12, letterSpacing: '-.02em', color: '#fff', margin: 0 }}>Prêt à alléger votre support ?</h2>
        <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 18, lineHeight: 1.5, color: '#A8C0D0', margin: '16px auto 0', maxWidth: 520 }}>Installez la balise en une minute, gratuitement. Gardez l'humain là où il compte.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 30, justifyContent: 'center' }}>
          <Link to={ctaTo} className="ch-cta-dark" style={{ background: '#fff', color: '#1C3F5C', border: 'none', borderRadius: 14, padding: '15px 26px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', boxShadow: '0 14px 30px -12px rgba(0,0,0,.4)', transition: 'transform .2s,box-shadow .2s' }}>Installer la balise →</Link>
          <a href="#demo" className="ch-cta-coral" style={{ background: '#E86A5F', color: '#fff', border: 'none', borderRadius: 14, padding: '15px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 9, transition: 'transform .2s,background .2s' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H9l-4 3.5z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>Parler à un conseiller</a>
        </div>
        <p style={{ fontSize: 13, color: '#7FA0B5', marginTop: 20 }}>Sans engagement · Hébergement français · Conforme RGPD</p>
      </div>
    </section>
  )
}
