// Footer : marque + colonnes de liens (types explicites, §8) + mentions.
import { Link } from 'react-router-dom'
import { CLASH, FOOTER_COLUMNS, HatIcon } from './data'

export function Footer() {
  return (
    <footer style={{ background: '#1C3F5C', color: '#fff', padding: '62px 0 28px' }}>
      <div className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
        <div className="ch-footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.13)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={19} /></span>
              <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 21, color: '#fff' }}>Chapote</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#A8C0D0', margin: '16px 0 0', maxWidth: 280 }}>Le chatbot hybride français. Arbre guidé, IA, relais humain — en une balise, gratuitement.</p>
          </div>
          {FOOTER_COLUMNS.map(col => (
            <div key={col.title}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, color: '#fff' }}>{col.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {col.links.map((link, i) =>
                  // §8 a11y : ancres réelles (#features…) en <a> ; routes internes
                  // (/cgu…) en <Link> react-router ; placeholders « # » en <button>
                  // (focusables, pas de saut en haut de page).
                  link.href.startsWith('/')
                    ? <Link key={link.label + i} className="ch-flink" to={link.href}>{link.label}</Link>
                    : link.href === '#'
                      ? <button key={link.label + i} type="button" className="ch-flink" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>{link.label}</button>
                      : <a key={link.label + i} className="ch-flink" href={link.href}>{link.label}</a>,
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,.12)', margin: '40px 0 22px' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#A8C0D0' }}>🇫🇷 Hébergement français · Données locales · Conforme RGPD</span>
          <span style={{ fontSize: 13, color: '#7FA0B5' }}>© {new Date().getFullYear()} Chapote. Tous droits réservés.</span>
        </div>
      </div>
    </footer>
  )
}
