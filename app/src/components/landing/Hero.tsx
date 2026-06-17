// Hero « Split » : promesse + CTA à gauche, widget animé flottant à droite.
import { Link } from 'react-router-dom'
import { CLASH, JAKARTA, Check, btnPrimary, btnSecondary } from './data'
import { ChapoteWidget } from './ChapoteWidget'

export function Hero({ ctaTo }: { ctaTo: string }) {
  return (
    <div style={{ position: 'relative', background: 'radial-gradient(circle at 12% 16%, rgba(47,158,121,.07) 0%, transparent 46%), radial-gradient(circle at 88% 26%, rgba(140,109,255,.06) 0%, transparent 44%)', overflow: 'hidden' }}>
      <section className="ch-hero-split" style={{ maxWidth: 1280, margin: '0 auto', padding: '74px 32px 70px', display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 56, alignItems: 'center' }}>
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, background: 'rgba(47,158,121,.1)', border: '1px solid rgba(47,158,121,.26)', color: '#1C7A5C', fontSize: 13, fontWeight: 600 }}>🇫🇷 Hébergement français · RGPD par défaut</span>
          <h1 className="ch-hero-h1" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 56, lineHeight: 1.07, letterSpacing: '-.02em', color: '#1E2A32', margin: '22px 0 0' }}>Le chatbot <span style={{ color: '#2F9E79' }}>hybride français</span></h1>
          <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 20, lineHeight: 1.5, color: '#6B7B8D', margin: '20px 0 0', maxWidth: 520 }}>Arbre guidé illimité + IA + relais humain — en une seule balise. 100% gratuit, RGPD par défaut.</p>
          <div className="ch-hero-cta" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 32 }}>
            <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>Ajouter gratuitement la balise →</Link>
            <a href="#demo" className="ch-cta-secondary" style={btnSecondary}><svg width="15" height="15" viewBox="0 0 24 24" fill="#1C3F5C"><path d="M7 5v14l12-7z" /></svg>Voir la démo interactive</a>
          </div>
          <div className="ch-hero-trust" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 22 }}>
            {['Sans carte bancaire', 'Installation en 2 min', '100% gratuit'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: '#6B7B8D' }}><Check />{t}</span>
            ))}
          </div>
        </div>
        <div id="demo" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: '-12% -8%', background: 'radial-gradient(circle at 50% 42%, rgba(47,158,121,.14), transparent 62%)' }} />
          <div style={{ position: 'relative', animation: 'ch-floaty 7s ease-in-out infinite' }}>
            <ChapoteWidget />
            <div style={{ position: 'absolute', top: -16, left: -30, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '8px 12px', boxShadow: '0 14px 30px -14px rgba(28,63,92,.3)', fontSize: 12.5, fontWeight: 600, color: '#1C3F5C' }}>🔒 RGPD natif</div>
            <div style={{ position: 'absolute', bottom: 64, right: -38, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '8px 12px', boxShadow: '0 14px 30px -14px rgba(28,63,92,.3)', fontSize: 12.5, fontWeight: 600, color: '#2F9E79' }}>✨ 100% gratuit</div>
          </div>
        </div>
      </section>
    </div>
  )
}
