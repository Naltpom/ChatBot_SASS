// Section installation : la balise <script> réelle, copiable. Elle se « tape »
// au fil du scroll, puis le widget apparaît sur un faux site à droite.
// Le snippet affiché doit refléter le widget réel : attribut `data-bot-key`
// (clé publique pk_…) et src `{API_URL}/widget.js`. Voir data.tsx (SNIPPET,
// SNIPPET_TOKENS) et GET /api/bots/{id}/embed côté backend.
import { useRef, useState } from 'react'
import { CLASH, MONO, SNIPPET, SNIPPET_TOKENS, HatIcon, Kicker, sectionH2, lead } from './data'
import { clamp, revealDelay, useScrollProgress } from './assets'
import { usePluginDownload } from '../../hooks/usePluginDownload'

const SNIPPET_LEN = SNIPPET.length

// Squelette gris du faux site client (barres de texte + emplacement image).
const SKELETON: [number, number, number, string][] = [
  [14, 30, 0, '#E9ECF0'], [34, 72, 40, '#E9ECF0'], [34, 54, 10, '#E9ECF0'], [12, 64, 24, '#F0F2F5'], [12, 58, 8, '#F0F2F5'],
]

export function Install() {
  const [copied, setCopied] = useState(false)
  const dl = usePluginDownload()
  const ref = useRef<HTMLElement>(null)
  const p = useScrollProgress(ref, 'enter')
  const ip = clamp((p - 0.25) / 0.45)
  const done = ip >= 1

  // Jetons visibles à cette progression (le dernier est tronqué).
  let left = Math.floor(ip * SNIPPET_LEN)
  const tokens: [string, string][] = []
  for (const [t, c] of SNIPPET_TOKENS) {
    if (left <= 0) break
    tokens.push([t.slice(0, left), c])
    left -= t.length
  }

  const copyCode = () => {
    try { navigator.clipboard?.writeText(SNIPPET) } catch { /* clipboard indispo */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section id="install" ref={ref} className="ch-pad" style={{ background: '#F0F2F5', padding: '130px 32px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: '56px 72px', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div className="ch-reveal"><Kicker color="#2F9E79">INSTALLATION</Kicker></div>
          <h2 className="ch-reveal" style={{ ...sectionH2, ...revealDelay(80) }}>Collez une ligne.<br />C’est en ligne.</h2>
          <p className="ch-reveal" style={{ ...lead, ...revealDelay(160) }}>
            Une balise avant la fin de votre page, et votre bot répond. Sur WordPress,{' '}
            <a href={dl.url} download={dl.filename} style={{ color: '#1C7A5C', fontWeight: 600, textDecoration: 'none', borderBottom: '1px solid currentColor' }}>le plugin Chapote Bot Manager{dl.version ? ` (v${dl.version})` : ''}</a>{' '}
            s’en charge pour vous.
          </p>
          <div style={{ marginTop: 34, background: '#1E2A32', borderRadius: 18, overflow: 'hidden', boxShadow: '0 34px 64px -30px rgba(28,63,92,.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              <span style={{ fontSize: 12, color: '#A8C0D0', fontFamily: MONO }}>index.html</span>
              <button onClick={copyCode} className="ch-copy" style={{ marginLeft: 'auto', background: '#2F9E79', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {copied ? <span style={{ display: 'inline-block', animation: 'ch-flashok .5s ease' }}>Copié ✓</span> : 'Copier'}
              </button>
            </div>
            {/* Le texte complet reste lisible par les lecteurs d'écran ; l'effet
                de frappe est réservé à l'affichage. */}
            <code style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{SNIPPET}</code>
            <div aria-hidden="true" style={{ padding: 22, fontFamily: MONO, fontSize: 14, lineHeight: 1.7, color: '#E2E8F0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 72 }}>
              {tokens.map(([t, c], i) => <span key={i} style={{ color: c }}>{t}</span>)}
              <span style={{ display: 'inline-block', width: 8, height: '1.1em', background: '#2F9E79', verticalAlign: -3, marginLeft: 1, animation: 'ch-blink 1s steps(1) infinite' }} />
            </div>
          </div>
          <div className="ch-reveal" style={{ ...revealDelay(120), marginTop: 28, fontFamily: CLASH, fontWeight: 500, fontSize: 22, lineHeight: 1.45, color: '#6B7B8D' }}>WordPress, Shopify, Webflow, Wix, PrestaShop <span style={{ color: '#1E2A32' }}>et tout site HTML.</span></div>
        </div>

        <div aria-hidden="true" className="ch-reveal" style={{ ...revealDelay(100), background: '#fff', borderRadius: 16, border: '1px solid #D8DEE6', overflow: 'hidden', boxShadow: '0 40px 80px -50px rgba(28,63,92,.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid #E2E8F0', background: '#F4F6F8' }}>
            {['#E86A5F', '#E0A82E', '#2F9E79'].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
            <span style={{ marginLeft: 12, fontFamily: MONO, fontSize: 12, color: '#6B7B8D' }}>votre-site.fr</span>
          </div>
          <div style={{ position: 'relative', height: 440, padding: 28 }}>
            {SKELETON.map(([h, w, mt, bg], i) => <div key={i} style={{ height: h, width: `${w}%`, background: bg, borderRadius: h > 20 ? 6 : 4, marginTop: mt }} />)}
            <div style={{ height: 120, width: '46%', background: 'repeating-linear-gradient(135deg,rgba(0,0,0,.04) 0 10px,transparent 10px 20px)', border: '1px solid #E9ECF0', borderRadius: 10, marginTop: 28 }} />
            <div style={{ position: 'absolute', right: 24, bottom: 96, width: 'min(270px,calc(100% - 48px))', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 18, boxShadow: '0 24px 50px -20px rgba(20,32,42,.4)', overflow: 'hidden', opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(16px) scale(.85)', transformOrigin: 'bottom right', transition: 'opacity .5s ease .25s,transform .7s cubic-bezier(.2,1.3,.4,1) .25s' }}>
              <div style={{ background: '#1C3F5C', color: '#fff', padding: '11px 14px', fontWeight: 700, fontSize: 13.5 }}>Assistant votre-site.fr</div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: '#fff', border: '1px solid #E8ECF0', borderRadius: '14px 14px 14px 4px', padding: '8px 11px', fontSize: 12.5, lineHeight: 1.45, alignSelf: 'flex-start' }}>Bonjour ! Comment puis-je vous aider ?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['Horaires', 'Tarifs', 'Contact'].map(c => <span key={c} style={{ border: '1px solid #2F9E79', borderRadius: 999, padding: '5px 10px', fontSize: 11.5, color: '#1C3F5C' }}>{c}</span>)}
                </div>
              </div>
            </div>
            <div style={{ position: 'absolute', right: 24, bottom: 24, width: 56, height: 56, borderRadius: 18, background: '#1C3F5C', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 30px -10px rgba(28,63,92,.7)', transform: ip > 0.98 ? 'scale(1)' : 'scale(0)', transition: 'transform .6s cubic-bezier(.2,1.5,.4,1)' }}><HatIcon size={28} stroke="#fff" /></div>
          </div>
        </div>
      </div>
    </section>
  )
}
