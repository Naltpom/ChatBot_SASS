// Pages légales publiques de cm.chapote.fr (/privacy, /terms) : lisibles sans compte, connecté ou non.
// Le texte est dans src/legal/*.md (déclaré chez Google pour la connexion Google Drive).
import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import privacy from '../legal/privacy.md?raw'
import terms from '../legal/terms.md?raw'

const DOCS = {
  privacy: { md: privacy, title: 'Politique de confidentialité' },
  terms: { md: terms, title: 'Conditions d’utilisation' },
}

export default function Legal({ doc }: { doc: keyof typeof DOCS }) {
  const d = DOCS[doc]
  useEffect(() => { document.title = `${d.title} · Chapote CM`; window.scrollTo(0, 0) }, [d])
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header style={{ maxWidth: 760, margin: '0 auto', padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link to="/" className="row-nw" style={{ gap: 8, color: 'var(--text)', fontWeight: 700 }} aria-label="Chapote CM, accueil"><BrandMark size={28} />Chapote CM</Link>
      </header>
      <main className="legal" style={{ maxWidth: 760, margin: '0 auto', padding: '8px 16px 48px', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
        <ReactMarkdown components={{
          a: ({ href, children }) => href?.startsWith('/') ? <Link to={href}>{children}</Link>
            : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}>{d.md}</ReactMarkdown>
      </main>
      <footer style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 32px', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <Link to="/">Accueil</Link><Link to="/privacy">Confidentialité</Link><Link to="/terms">Conditions d’utilisation</Link>
      </footer>
    </div>
  )
}
