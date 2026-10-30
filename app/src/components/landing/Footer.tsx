// Footer : marque + colonnes de liens + mentions.
import { Link, useLocation } from 'react-router-dom'
import { CLASH, FOOTER_COLUMNS } from './data'

export function Footer() {
  // Hors landing (ex. /demo), les ancres « #tarifs » sont préfixées par « / »
  // pour pointer vers la section de l'accueil (cf. Header — même logique).
  const onLanding = useLocation().pathname === '/'
  return (
    <footer style={{ background: '#14202A', color: '#A8C0D0', padding: '56px 0 28px' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-footer-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '40px 64px' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 24, color: '#fff' }}>Chapote</div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#A8C0D0', margin: '12px 0 0', maxWidth: 280 }}>Le chatbot hybride français. Arbre guidé, IA, relais humain, en une balise.</p>
          </div>
          {FOOTER_COLUMNS.map(col => (
            <div key={col.title}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: '#fff' }}>{col.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map((link, i) =>
                  // a11y : routes internes (/cgu…) en <Link> ; placeholders « # »
                  // en <button> (focusables, pas de saut en haut). Ancres « #x » :
                  // sur la landing → <a> (saut natif même page) ; hors landing →
                  // <Link to="/#x"> (nav SPA vers l'accueil + ScrollToHash App.tsx).
                  // mailto:/externes → <a> brut (pas de routage SPA).
                  link.href.startsWith('mailto:') || link.href.startsWith('http')
                    ? <a key={link.label + i} className="ch-flink" href={link.href}>{link.label}</a>
                    : link.href.startsWith('/')
                    ? <Link key={link.label + i} className="ch-flink" to={link.href}>{link.label}</Link>
                    : link.href === '#'
                      ? <button key={link.label + i} type="button" className="ch-flink" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>{link.label}</button>
                      : onLanding
                        ? <a key={link.label + i} className="ch-flink" href={link.href}>{link.label}</a>
                        : <Link key={link.label + i} className="ch-flink" to={`/${link.href}`}>{link.label}</Link>,
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span>Hébergement français · Données locales · Conforme RGPD</span>
          <span>© {new Date().getFullYear()} Chapote</span>
        </div>
      </div>
    </footer>
  )
}
