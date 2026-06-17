// Section installation : la balise <script> réelle, copiable.
// §5.1 D13 — le snippet affiché doit refléter le widget réel : attribut
// `data-bot-key` (clé publique pk_…) et src `{API_URL}/widget.js`. Voir
// data.tsx (SNIPPET) et GET /api/bots/{id}/embed côté backend.
import { useState } from 'react'
import { MONO, SNIPPET, WIDGET_SRC, EXAMPLE_BOT_KEY, eyebrow, sectionH2 } from './data'

// Snippet colorisé (repris du design). Doit rester cohérent avec SNIPPET :
// même src, même attribut data-bot-key, même defer.
function Snippet({ big }: { big?: boolean }) {
  return (
    <span style={{ fontSize: big ? 14 : 13 }}>
      <span style={{ color: '#6B7B8D' }}>&lt;</span><span style={{ color: '#8C6DFF' }}>script</span> <span style={{ color: '#7FE3BE' }}>src</span><span style={{ color: '#6B7B8D' }}>=</span><span style={{ color: '#A8D8C5' }}>"{WIDGET_SRC}"</span> <span style={{ color: '#7FE3BE' }}>data-bot-key</span><span style={{ color: '#6B7B8D' }}>=</span><span style={{ color: '#A8D8C5' }}>"{EXAMPLE_BOT_KEY}"</span> <span style={{ color: '#7FE3BE' }}>defer</span><span style={{ color: '#6B7B8D' }}>&gt;&lt;/</span><span style={{ color: '#8C6DFF' }}>script</span><span style={{ color: '#6B7B8D' }}>&gt;</span>
    </span>
  )
}

export function Install() {
  const [copied, setCopied] = useState(false)
  const copyCode = () => {
    try { navigator.clipboard?.writeText(SNIPPET) } catch { /* clipboard indispo */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <section id="install" style={{ background: '#F9F9FB', padding: '88px 0' }}>
      <div className="ch-pad" style={{ maxWidth: 920, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
        <span style={eyebrow('#2F9E79')}>INSTALLATION</span>
        <h2 className="ch-section-h2" style={sectionH2}>Une balise. Une minute. C'est tout.</h2>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px auto 0', maxWidth: 560 }}>Copiez-collez cette balise dans votre page — aucun autre réglage.</p>
        <div className="ch-reveal" style={{ marginTop: 36, textAlign: 'left', background: '#1E2A32', borderRadius: 20, overflow: 'hidden', boxShadow: '0 34px 64px -28px rgba(28,63,92,.55)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
            {['#E86A5F', '#E0A82E', '#2F9E79'].map(c => <span key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />)}
            <span style={{ marginLeft: 8, fontSize: 12, color: '#7FA0B5', fontFamily: MONO }}>index.html</span>
            <button onClick={copyCode} className="ch-copy" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2F9E79', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .2s' }}>
              {copied
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, animation: 'ch-flashok .5s ease' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Copié</span>
                : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2.5" stroke="#fff" strokeWidth="1.8" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="#fff" strokeWidth="1.8" /></svg>Copier</>}
            </button>
          </div>
          <div style={{ padding: '22px 22px', fontFamily: MONO, fontSize: 14, lineHeight: 1.7, color: '#E2E8F0', overflowX: 'auto', whiteSpace: 'nowrap' }}><Snippet big /></div>
        </div>
        <p style={{ fontSize: 13.5, color: '#9AA7B4', marginTop: 16 }}>Compatible WordPress, Shopify, Webflow et tout site HTML.</p>
      </div>
    </section>
  )
}
