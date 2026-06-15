// Landing publique « Chapote » — port fidèle du design claude.ai/design
// (Chapote Landing.dc.html, hero « Split »). Charte : navy #1C3F5C primaire,
// mint #2F9E79 (local/RGPD), corail #E86A5F (humain), violet #8C6DFF (IA) ;
// typo Clash Display / Plus Jakarta Sans / Inter / JetBrains Mono.
// Sections : header sticky (blur), hero + widget animé, 4 piliers, comparatif,
// installation (snippet copiable), logos, témoignages, CTA final, footer.
// Auto-contenu : polices + keyframes/reveal/responsive injectés au montage
// (portée landing uniquement, nettoyés au démontage). Pas de switcher de hero,
// pas de cartes tarifs (le design renvoie « Tarifs » vers l'installation).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'

// ---- Polices + styles scoped (.chapote) injectés au montage ----------------
const FONT_LINKS = [
  ['preconnect', 'https://fonts.googleapis.com', ''],
  ['preconnect', 'https://fonts.gstatic.com', 'anonymous'],
  ['stylesheet', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap', ''],
  ['stylesheet', 'https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap', ''],
] as const

const CHAPOTE_CSS = `
.chapote *{box-sizing:border-box;}
.chapote ::selection{background:rgba(47,158,121,.22);}
.chapote :focus-visible{outline:3px solid #1C3F5C;outline-offset:2px;}
@keyframes ch-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes ch-flashok{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes ch-in{0%{opacity:0;transform:translateY(9px) scale(.985)}100%{opacity:1;transform:none}}
@keyframes ch-pulse{0%{box-shadow:0 0 0 0 rgba(47,158,121,.55)}70%{box-shadow:0 0 0 7px rgba(47,158,121,0)}100%{box-shadow:0 0 0 0 rgba(47,158,121,0)}}
.ch-reveal{opacity:0;transform:translateY(28px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);}
.ch-reveal.is-in{opacity:1;transform:none;}
.ch-navlink{text-decoration:none;color:#1E2A32;font-size:15px;font-weight:500;transition:color .2s;}
.ch-navlink:hover{color:#2F9E79;}
.ch-cta-primary{transition:transform .2s,box-shadow .2s;}
.ch-cta-primary:hover{transform:scale(1.02);box-shadow:0 16px 32px -10px rgba(28,63,92,.7);}
.ch-cta-secondary{transition:transform .2s,border-color .2s;}
.ch-cta-secondary:hover{transform:scale(1.02);border-color:#2F9E79;}
.ch-pilier{transition:transform .25s,box-shadow .25s;}
.ch-pilier:hover{transform:translateY(-4px);box-shadow:0 24px 46px -22px rgba(28,63,92,.3);}
.ch-cmp-row{transition:background .2s;}
.ch-cmp-row:hover{background:rgba(47,158,121,.045);}
.ch-logo{transition:opacity .2s,color .2s;}
.ch-logo:hover{opacity:1 !important;color:#1C3F5C !important;}
.ch-copy:hover{background:#268968 !important;}
.ch-flink{text-decoration:none;color:rgba(255,255,255,.72);font-size:14px;transition:color .2s;}
.ch-flink:hover{color:#fff;}
.ch-cta-dark:hover{transform:scale(1.02);box-shadow:0 18px 36px -12px rgba(0,0,0,.5);}
.ch-cta-coral:hover{transform:scale(1.02);background:#df5b50 !important;}
.ch-menu-btn{display:none;}
@media (max-width:920px){
  .ch-nav-links{display:none !important;}
  .ch-hero-split{grid-template-columns:1fr !important;gap:38px !important;text-align:center;}
  .ch-hero-split .ch-hero-cta,.ch-hero-split .ch-hero-trust{justify-content:center;}
  .ch-piliers-grid{grid-template-columns:1fr 1fr !important;}
  .ch-footer-grid{grid-template-columns:1fr 1fr !important;gap:36px !important;}
  .ch-menu-btn{display:flex !important;}
}
@media (max-width:600px){
  .ch-piliers-grid{grid-template-columns:1fr !important;}
  .ch-testi-grid{grid-template-columns:1fr !important;}
  .ch-hero-h1{font-size:38px !important;}
  .ch-section-h2{font-size:30px !important;}
}
@media (prefers-reduced-motion: reduce){.ch-reveal{opacity:1;transform:none;transition:none;}.chapote *{animation:none !important;}}
`

function useChapoteAssets() {
  useEffect(() => {
    const nodes: HTMLElement[] = []
    FONT_LINKS.forEach(([rel, href, cors]) => {
      const l = document.createElement('link')
      l.rel = rel
      l.href = href
      if (cors) l.crossOrigin = cors
      document.head.appendChild(l)
      nodes.push(l)
    })
    const style = document.createElement('style')
    style.textContent = CHAPOTE_CSS
    document.head.appendChild(style)
    nodes.push(style)
    return () => { nodes.forEach(n => n.remove()) }
  }, [])
}

// Apparition au scroll (IntersectionObserver) pour les blocs .ch-reveal
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } })
    }, { threshold: 0.12 })
    const t = setTimeout(() => { document.querySelectorAll('.ch-reveal').forEach(el => io.observe(el)) }, 90)
    return () => { clearTimeout(t); io.disconnect() }
  }, [])
}

// ---- Icônes (SVG inline, tracés repris du design) --------------------------
const HatIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const Check = ({ stroke = '#2F9E79', w = 2.2, size = 16 }: { stroke?: string; w?: number; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10.5" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// ---- Widget Chapote animé (port de ChapoteWidget.dc.html) ------------------
type WItem = { kind: string; side?: string; ai?: boolean; text?: string; items?: string[]; name?: string; role?: string; initials?: string }
const WIDGET_PHASES: WItem[][] = [
  [
    { kind: 'msg', side: 'bot', text: "Bonjour 👋 Je suis l'assistant Chapote. Comment vous aider ?" },
    { kind: 'chips', items: ['Suivre ma commande', "Modifier l'abonnement", 'Autre question'] },
    { kind: 'msg', side: 'user', text: 'Suivre ma commande' },
    { kind: 'msg', side: 'bot', text: 'Parfait — quel est votre numéro de commande ? 📦' },
  ],
  [
    { kind: 'msg', side: 'user', text: "C'est compatible avec mon forfait Pro ?" },
    { kind: 'msg', side: 'bot', ai: true, text: 'Oui ✨ Le forfait Pro inclut le suivi en temps réel et le multi-agent.' },
    { kind: 'note', text: 'Réponse IA · plafonnée & modérée' },
  ],
  [
    { kind: 'msg', side: 'bot', text: 'Je vous mets en relation avec un conseiller humain.' },
    { kind: 'handoff', name: 'Camille', role: 'Conseillère Chapote', initials: 'CA' },
    { kind: 'msg', side: 'user', text: 'Merci, parfait !' },
  ],
]

function ChapoteWidget() {
  const [phase, setPhase] = useState(0)
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    const t = setInterval(() => { setPhase(p => (p + 1) % 3); setSeq(s => s + 1) }, 5000)
    return () => clearInterval(t)
  }, [])

  const pill = (on: boolean, c: string): React.CSSProperties => ({
    padding: '7px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 6, background: '#fff',
    border: `1px solid ${on ? c : '#E6EAEF'}`, color: on ? c : '#9AA7B4',
    boxShadow: on ? `0 2px 8px -2px ${c}66` : 'none', transition: 'all .3s',
  })
  const items = WIDGET_PHASES[phase]

  return (
    <div style={{ width: 340, fontFamily: "'Inter',system-ui,sans-serif", background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 24, boxShadow: '0 26px 64px -20px rgba(28,63,92,.32)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', background: '#1C3F5C', color: '#fff' }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><HatIcon size={21} /></span>
        <div style={{ flex: 1, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Assistant Chapote</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#A8C0D0', marginTop: 1 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2F9E79', animation: 'ch-pulse 2.4s infinite' }} />En ligne
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#7FA0B5', letterSpacing: '.04em' }}>🇫🇷</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '11px 14px', background: '#F9F9FB', borderBottom: '1px solid #EEF1F4' }}>
        <span style={pill(phase === 0, '#2F9E79')}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />Arbre</span>
        <span style={pill(phase === 1, '#8C6DFF')}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />IA</span>
        <span style={pill(phase === 2, '#E86A5F')}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />Humain</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 250, background: '#FBFCFD' }}>
        {items.map((m, i) => {
          const key = `${seq}-${i}`
          if (m.kind === 'msg' && m.side === 'user')
            return <div key={key} style={{ display: 'flex', justifyContent: 'flex-end', animation: 'ch-in .42s ease both' }}><div style={{ maxWidth: '78%', background: '#1C3F5C', color: '#fff', padding: '9px 13px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, lineHeight: 1.45 }}>{m.text}</div></div>
          if (m.kind === 'msg' && m.side === 'bot' && !m.ai)
            return <div key={key} style={{ display: 'flex', justifyContent: 'flex-start', animation: 'ch-in .42s ease both' }}><div style={{ maxWidth: '82%', background: '#fff', border: '1px solid #E8ECF0', color: '#1E2A32', padding: '9px 13px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.45, boxShadow: '0 2px 6px rgba(28,63,92,.05)' }}>{m.text}</div></div>
          if (m.kind === 'msg' && m.side === 'bot' && m.ai)
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'flex-start', animation: 'ch-in .42s ease both' }}>
                <div style={{ maxWidth: '84%', background: 'rgba(140,109,255,.08)', border: '1px solid rgba(140,109,255,.3)', color: '#1E2A32', padding: '10px 13px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: '#8C6DFF' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#8C6DFF"><path d="M12 2l1.9 5.6L19.5 9l-4.2 3.7 1.3 5.8L12 15.6 7.4 18.5l1.3-5.8L4.5 9l5.6-1.4z" /></svg>GÉNÉRATION IA
                  </div>{m.text}
                </div>
              </div>
            )
          if (m.kind === 'chips')
            return <div key={key} style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'flex-start', animation: 'ch-in .42s ease both' }}>{m.items!.map(c => <span key={c} style={{ border: '1px solid #2F9E79', color: '#1C3F5C', background: 'rgba(47,158,121,.06)', padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>{c}</span>)}</div>
          if (m.kind === 'note')
            return <div key={key} style={{ textAlign: 'center', fontSize: 11, color: '#9AA7B4', animation: 'ch-in .42s ease both' }}>{m.text}</div>
          if (m.kind === 'handoff')
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(232,106,95,.07)', border: '1px solid rgba(232,106,95,.32)', borderRadius: 14, padding: '10px 12px', animation: 'ch-in .42s ease both' }}>
                <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#E86A5F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{m.initials}</span>
                <span style={{ lineHeight: 1.25 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: '#1E2A32' }}>{m.name}</span><span style={{ display: 'block', fontSize: 11.5, color: '#6B7B8D' }}>{m.role}</span></span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#2F9E79', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2F9E79' }} />Connecté</span>
              </div>
            )
          return null
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderTop: '1px solid #EEF1F4', background: '#fff' }}>
        <div style={{ flex: 1, height: 38, borderRadius: 12, background: '#F0F2F5', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#9AA7B4', fontSize: 13 }}>Écrivez votre message…</div>
        <button aria-label="Envoyer" style={{ width: 38, height: 38, border: 'none', borderRadius: 12, background: '#1C3F5C', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  )
}

// ---- Données comparatif ----------------------------------------------------
const SNIPPET = '<script src="https://chapote.com/widget.js" data-bot-id="votre-id"></script>'

const PILIERS = [
  { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', t: 'Coût maîtrisé', d: 'IA plafonnée par design. Vous fixez le budget — jamais de facture surprise.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14.5 9.4a3.2 3.2 0 100 5.2M8 11h4.5M8 13.2h3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> },
  { bg: 'rgba(47,158,121,.12)', co: '#2F9E79', t: 'RGPD par défaut', d: 'Hébergement français, données locales. Conforme sans la moindre configuration.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 2.6v5.2c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V5.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { bg: 'rgba(140,109,255,.12)', co: '#8C6DFF', t: 'Installation 1 minute', d: 'Une seule balise <script> à coller. Aucun autre réglage requis.', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M9 7l-4.5 5L9 17M15 7l4.5 5L15 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { bg: 'rgba(232,106,95,.12)', co: '#E86A5F', t: 'Relais humain', d: "Bascule fluide vers un conseiller quand l'humain fait la différence.", icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H9l-4 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="11" r="2.2" stroke="currentColor" strokeWidth="1.8" /></svg> },
]

type Cell = { kind: 'ok' | 'warn' | 'no'; label: string; strong?: boolean }
const CmpOk = ({ strong }: { strong?: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill={strong ? 'rgba(47,158,121,.2)' : 'rgba(47,158,121,.14)'} /><path d="M7.5 12.4l3 3 6-6.6" stroke="#2F9E79" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
const CmpWarn = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="rgba(224,168,46,.16)" /><path d="M12 7v6" stroke="#C98A12" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.4" r="1.3" fill="#C98A12" /></svg>
const CmpNo = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="rgba(107,123,141,.14)" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#8A98A6" strokeWidth="2.2" strokeLinecap="round" /></svg>

const CMP_ROWS: { label: string; badge?: string; chapote: Cell; ia: Cell; classic: Cell }[] = [
  { label: 'Coût maîtrisé', chapote: { kind: 'ok', label: 'Budget plafonné' }, ia: { kind: 'warn', label: "Coût à l'usage" }, classic: { kind: 'no', label: 'Masse salariale' } },
  { label: 'RGPD & hébergement FR', chapote: { kind: 'ok', label: 'Français, natif' }, ia: { kind: 'no', label: 'Souvent hors UE' }, classic: { kind: 'warn', label: "Selon l'outil" } },
  { label: 'Installation', chapote: { kind: 'ok', label: '1 balise, 1 min' }, ia: { kind: 'warn', label: 'Config requise' }, classic: { kind: 'no', label: 'Projet long' } },
  { label: 'Relais humain', chapote: { kind: 'ok', label: 'Bascule fluide' }, ia: { kind: 'no', label: 'Aucun' }, classic: { kind: 'ok', label: 'Oui, mais lent' } },
  { label: 'Arbre guidé', badge: 'ILLIMITÉ', chapote: { kind: 'ok', label: 'Sans surcoût', strong: true }, ia: { kind: 'no', label: "Limité à l'IA" }, classic: { kind: 'no', label: 'Manuel' } },
]

const TESTIS = [
  { stars: 5, q: '« On a divisé par 3 notre volume de tickets de niveau 1 — sans jamais dépasser notre budget IA. »', av: 'LM', bg: '#1C3F5C', name: 'Léa Mercier', role: 'Head of Support · Velobird' },
  { stars: 5, q: '« L\'installation a pris deux minutes. Le relais humain reste fluide — nos clients ne voient pas la couture. »', av: 'KB', bg: '#2F9E79', name: 'Karim Benali', role: 'CTO · Maison Lou' },
  { stars: 5, q: '« Enfin un chatbot où je maîtrise le coût ET le RGPD. L\'hébergement français a débloqué notre service juridique. »', av: 'SD', bg: '#E86A5F', name: 'Sophie Dubois', role: 'COO · Nordia' },
]

const LOGOS = ['Velobird', 'Maison Lou', 'Nordia', 'Fika&Co', 'Atelier 9']
const NAV = [['#features', 'Fonctionnalités'], ['#why', 'Pourquoi Chapote'], ['#install', 'Tarifs'], ['#testi', 'Blog']]

const CLASH = "'Clash Display',sans-serif"
const JAKARTA = "'Plus Jakarta Sans',sans-serif"
const MONO = "'JetBrains Mono',monospace"
const eyebrow = (color: string): React.CSSProperties => ({ fontSize: 13, fontWeight: 700, letterSpacing: '.12em', color })

// Snippet colorisé (repris du design)
function Snippet({ big }: { big?: boolean }) {
  return (
    <span style={{ fontSize: big ? 14 : 13 }}>
      <span style={{ color: '#6B7B8D' }}>&lt;</span><span style={{ color: '#8C6DFF' }}>script</span> <span style={{ color: '#7FE3BE' }}>src</span><span style={{ color: '#6B7B8D' }}>=</span><span style={{ color: '#A8D8C5' }}>"https://chapote.com/widget.js"</span> <span style={{ color: '#7FE3BE' }}>data-bot-id</span><span style={{ color: '#6B7B8D' }}>=</span><span style={{ color: '#A8D8C5' }}>"votre-id"</span><span style={{ color: '#6B7B8D' }}>&gt;&lt;/</span><span style={{ color: '#8C6DFF' }}>script</span><span style={{ color: '#6B7B8D' }}>&gt;</span>
    </span>
  )
}

export default function Landing() {
  const { user } = useAuth()
  useChapoteAssets()
  useReveal()
  const [copied, setCopied] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const ctaTo = user ? '/app' : '/register'

  const copyCode = () => {
    try { navigator.clipboard?.writeText(SNIPPET) } catch { /* clipboard indispo */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const btnPrimary: React.CSSProperties = { background: '#1C3F5C', color: '#fff', border: 'none', borderRadius: 14, padding: '15px 26px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', boxShadow: '0 12px 26px -10px rgba(28,63,92,.6)' }
  const btnSecondary: React.CSSProperties = { background: '#fff', color: '#1C3F5C', border: '1px solid #D8DEE6', borderRadius: 14, padding: '15px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 9 }

  return (
    <div className="chapote" style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', color: '#1E2A32', WebkitFontSmoothing: 'antialiased' }}>

      {/* ---- Header sticky ---- */}
      <header style={{ position: 'sticky', top: 0, zIndex: 60, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', background: 'rgba(249,249,251,.82)', borderBottom: '1px solid rgba(226,232,240,.7)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <span style={{ width: 36, height: 36, borderRadius: 11, background: '#1C3F5C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={20} /></span>
            <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 22, color: '#1E2A32', letterSpacing: '-.01em' }}>Chapote</span>
          </a>
          <nav className="ch-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
            {NAV.map(([href, label]) => <a key={label} className="ch-navlink" href={href}>{label}</a>)}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!user && <Link className="ch-navlink" to="/login" style={{ whiteSpace: 'nowrap' }}>Se connecter</Link>}
            <Link to={ctaTo} className="ch-cta-primary" style={{ background: '#1C3F5C', color: '#fff', borderRadius: 12, padding: '11px 18px', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', textDecoration: 'none', boxShadow: '0 6px 16px -8px rgba(28,63,92,.6)' }}>
              {user ? "Ouvrir l'application" : 'Installer la balise'}
            </Link>
            <button className="ch-menu-btn" aria-label="Menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(o => !o)} style={{ width: 42, height: 42, border: '1px solid #E2E8F0', borderRadius: 11, background: '#fff', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E2A32" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div style={{ borderTop: '1px solid #E2E8F0', background: '#fff', padding: '14px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {NAV.map(([href, label]) => <a key={label} href={href} onClick={() => setMobileOpen(false)} style={{ textDecoration: 'none', color: '#1E2A32', fontWeight: 500 }}>{label}</a>)}
          </div>
        )}
      </header>

      {/* ---- Hero (Split) ---- */}
      <div style={{ position: 'relative', background: 'radial-gradient(circle at 12% 16%, rgba(47,158,121,.07) 0%, transparent 46%), radial-gradient(circle at 88% 26%, rgba(140,109,255,.06) 0%, transparent 44%)', overflow: 'hidden' }}>
        <section className="ch-hero-split" style={{ maxWidth: 1280, margin: '0 auto', padding: '74px 32px 70px', display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 56, alignItems: 'center' }}>
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, background: 'rgba(47,158,121,.1)', border: '1px solid rgba(47,158,121,.26)', color: '#1C7A5C', fontSize: 13, fontWeight: 600 }}>🇫🇷 Hébergement français · RGPD par défaut</span>
            <h1 className="ch-hero-h1" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 56, lineHeight: 1.07, letterSpacing: '-.02em', color: '#1E2A32', margin: '22px 0 0' }}>Le chatbot <span style={{ color: '#2F9E79' }}>hybride français</span></h1>
            <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 20, lineHeight: 1.5, color: '#6B7B8D', margin: '20px 0 0', maxWidth: 520 }}>Arbre guidé illimité + IA plafonnée + relais humain — en une seule balise. RGPD par défaut.</p>
            <div className="ch-hero-cta" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 32 }}>
              <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>Ajouter gratuitement la balise →</Link>
              <a href="#demo" className="ch-cta-secondary" style={btnSecondary}><svg width="15" height="15" viewBox="0 0 24 24" fill="#1C3F5C"><path d="M7 5v14l12-7z" /></svg>Voir la démo interactive</a>
            </div>
            <div className="ch-hero-trust" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 22 }}>
              {['Sans carte bancaire', 'Installation en 2 min', 'Résiliable à tout moment'].map(t => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: '#6B7B8D' }}><Check />{t}</span>
              ))}
            </div>
          </div>
          <div id="demo" style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: '-12% -8%', background: 'radial-gradient(circle at 50% 42%, rgba(47,158,121,.14), transparent 62%)' }} />
            <div style={{ position: 'relative', animation: 'ch-floaty 7s ease-in-out infinite' }}>
              <ChapoteWidget />
              <div style={{ position: 'absolute', top: -16, left: -30, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '8px 12px', boxShadow: '0 14px 30px -14px rgba(28,63,92,.3)', fontSize: 12.5, fontWeight: 600, color: '#1C3F5C' }}>🔒 RGPD natif</div>
              <div style={{ position: 'absolute', bottom: 64, right: -38, display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '8px 12px', boxShadow: '0 14px 30px -14px rgba(28,63,92,.3)', fontSize: 12.5, fontWeight: 600, color: '#8C6DFF' }}>✨ IA plafonnée</div>
            </div>
          </div>
        </section>
      </div>

      {/* ---- 4 piliers ---- */}
      <section id="features" style={{ background: '#F9F9FB', padding: '88px 0' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 50px' }}>
            <span style={eyebrow('#2F9E79')}>POURQUOI CHAPOTE</span>
            <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>L'hybride frugal, sans compromis</h2>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px 0 0' }}>Quatre promesses tenues par design — pas par option payante.</p>
          </div>
          <div className="ch-piliers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 24 }}>
            {PILIERS.map(p => (
              <div key={p.t} className="ch-reveal ch-pilier" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, padding: '28px 24px', boxShadow: '0 6px 20px -12px rgba(28,63,92,.18)' }}>
                <span style={{ width: 50, height: 50, borderRadius: 14, background: p.bg, color: p.co, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.icon}</span>
                <h3 style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 19, color: '#1E2A32', margin: '18px 0 0' }}>{p.t}</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6B7B8D', margin: '8px 0 0' }}>{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Comparatif ---- */}
      <section id="why" style={{ background: '#F0F2F5', padding: '88px 0' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px' }}>
          <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
            <span style={eyebrow('#2F9E79')}>COMPARATIF</span>
            <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>Ni Intercom, ni Chatbase.</h2>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: '#6B7B8D', margin: '14px 0 0' }}>L'hybride qui prend le meilleur de chaque modèle, sans en payer les défauts.</p>
          </div>
          <div className="ch-reveal" style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 24, overflow: 'hidden', boxShadow: '0 16px 44px -24px rgba(28,63,92,.24)' }}>
            {/* en-têtes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
              <div style={{ padding: '22px 24px' }} />
              <div style={{ padding: '20px 14px', textAlign: 'center', background: 'rgba(47,158,121,.07)', borderBottom: '3px solid #2F9E79' }}>
                <div style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 19, color: '#1C3F5C' }}>Chapote</div>
                <div style={{ fontSize: 11.5, color: '#1C7A5C', marginTop: 2, fontWeight: 600 }}>L'hybride frugal</div>
              </div>
              <div style={{ padding: '20px 14px', textAlign: 'center', borderBottom: '1px solid #EEF1F4' }}><div style={{ fontWeight: 600, fontSize: 15, color: '#6B7B8D' }}>Chatbot 100% IA</div></div>
              <div style={{ padding: '20px 14px', textAlign: 'center', borderBottom: '1px solid #EEF1F4' }}><div style={{ fontWeight: 600, fontSize: 15, color: '#6B7B8D' }}>Support classique</div></div>
            </div>
            {/* lignes */}
            {CMP_ROWS.map((row, idx) => {
              const lastRow = idx === CMP_ROWS.length - 1
              const cell = (c: Cell, chapoteCol: boolean) => (
                <div style={{ padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center', background: chapoteCol ? (lastRow ? 'rgba(47,158,121,.1)' : 'rgba(47,158,121,.05)') : undefined }}>
                  {c.kind === 'ok' ? <CmpOk strong={c.strong} /> : c.kind === 'warn' ? <CmpWarn /> : <CmpNo />}
                  <span style={{ fontSize: 11.5, color: c.strong ? '#1C7A5C' : c.kind === 'ok' && chapoteCol ? '#6B7B8D' : '#9AA7B4', fontWeight: c.strong ? 600 : 400 }}>{c.label}</span>
                </div>
              )
              return (
                <div key={row.label} className={lastRow ? undefined : 'ch-cmp-row'} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', borderTop: '1px solid #EEF1F4', background: lastRow ? 'rgba(47,158,121,.07)' : undefined }}>
                  <div style={{ padding: '18px 24px', fontWeight: lastRow ? 700 : 600, fontSize: 15, color: '#1E2A32', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {row.label}
                    {row.badge && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, background: '#2F9E79', color: '#fff', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>{row.badge}</span>}
                  </div>
                  {cell(row.chapote, true)}
                  {cell(row.ia, false)}
                  {cell(row.classic, false)}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ---- Installation ---- */}
      <section id="install" style={{ background: '#F9F9FB', padding: '88px 0' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
          <span style={eyebrow('#2F9E79')}>INSTALLATION</span>
          <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>Une balise. Une minute. C'est tout.</h2>
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

      {/* ---- Logos ---- */}
      <section style={{ background: '#F0F2F5', padding: '54px 0' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.08em', color: '#9AA7B4', textTransform: 'uppercase' }}>Déjà adopté par des équipes qui comptent chaque euro</div>
          <div style={{ marginTop: 30, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 46 }}>
            {LOGOS.map(l => <span key={l} className="ch-logo" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 23, color: '#6B7B8D', opacity: .55 }}>{l}</span>)}
          </div>
        </div>
      </section>

      {/* ---- Témoignages ---- */}
      <section id="testi" style={{ background: '#F9F9FB', padding: '88px 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
          <div className="ch-reveal" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 46px' }}>
            <span style={eyebrow('#8C6DFF')}>TÉMOIGNAGES</span>
            <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 40, lineHeight: 1.15, letterSpacing: '-.02em', color: '#1E2A32', margin: '12px 0 0' }}>Moins de tickets, plus de marge.</h2>
          </div>
          <div className="ch-testi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
            {TESTIS.map(t => (
              <div key={t.name} className="ch-reveal" style={{ background: '#fff', border: '1px solid #E2E8F0', borderLeft: '4px solid #8C6DFF', borderRadius: 18, padding: '26px 24px', boxShadow: '0 8px 26px -16px rgba(28,63,92,.2)' }}>
                <div style={{ display: 'flex', gap: 3, color: '#E0A82E' }}>{'★★★★★'.slice(0, t.stars)}</div>
                <p style={{ fontSize: 15.5, lineHeight: 1.6, color: '#1E2A32', margin: '14px 0 0' }}>{t.q}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
                  <span style={{ width: 42, height: 42, borderRadius: '50%', background: t.bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>{t.av}</span>
                  <span style={{ lineHeight: 1.3 }}><span style={{ display: 'block', fontWeight: 600, fontSize: 14.5, color: '#1E2A32' }}>{t.name}</span><span style={{ display: 'block', fontSize: 13, color: '#6B7B8D' }}>{t.role}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CTA final ---- */}
      <section style={{ background: 'linear-gradient(135deg,#1C3F5C 0%,#15344b 100%)', padding: '90px 0', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-30%', left: '8%', width: 340, height: 340, background: 'radial-gradient(circle,rgba(47,158,121,.22),transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-40%', right: '6%', width: 380, height: 380, background: 'radial-gradient(circle,rgba(140,109,255,.2),transparent 65%)' }} />
        <div className="ch-reveal" style={{ maxWidth: 760, margin: '0 auto', padding: '0 32px', textAlign: 'center', position: 'relative' }}>
          <h2 className="ch-section-h2" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 42, lineHeight: 1.12, letterSpacing: '-.02em', color: '#fff', margin: 0 }}>Prêt à maîtriser vos coûts de support ?</h2>
          <p style={{ fontFamily: JAKARTA, fontWeight: 500, fontSize: 18, lineHeight: 1.5, color: '#A8C0D0', margin: '16px auto 0', maxWidth: 520 }}>Installez la balise en une minute. Gardez l'humain là où il compte.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 30, justifyContent: 'center' }}>
            <Link to={ctaTo} className="ch-cta-dark" style={{ background: '#fff', color: '#1C3F5C', border: 'none', borderRadius: 14, padding: '15px 26px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', boxShadow: '0 14px 30px -12px rgba(0,0,0,.4)', transition: 'transform .2s,box-shadow .2s' }}>Installer la balise →</Link>
            <a href="#demo" className="ch-cta-coral" style={{ background: '#E86A5F', color: '#fff', border: 'none', borderRadius: 14, padding: '15px 24px', fontWeight: 600, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 9, transition: 'transform .2s,background .2s' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16v10H9l-4 3.5z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>Parler à un conseiller</a>
          </div>
          <p style={{ fontSize: 13, color: '#7FA0B5', marginTop: 20 }}>Sans engagement · Hébergement français · Conforme RGPD</p>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer style={{ background: '#1C3F5C', color: '#fff', padding: '62px 0 28px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <div className="ch-footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', gap: 28 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.13)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={19} /></span>
                <span style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 21, color: '#fff' }}>Chapote</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#A8C0D0', margin: '16px 0 0', maxWidth: 280 }}>Le chatbot hybride français. Arbre guidé, IA plafonnée, relais humain — en une balise.</p>
            </div>
            {[
              ['Produit', [['#features', 'Fonctionnalités'], ['#why', 'Comparatif'], ['#install', 'Tarifs'], ['#demo', 'Démo']]],
              ['Ressources', [['#', 'Documentation'], ['#', 'Blog'], ['#', 'Guides'], ['#', 'Statut']]],
              ['RGPD & Légal', [['#', 'Confidentialité'], ['#', 'Hébergement FR'], ['#', 'CGU'], ['#', 'DPA']]],
              ['Réseaux', [['#', 'LinkedIn'], ['#', 'X / Twitter'], ['#', 'GitHub']]],
            ].map(([title, links]) => (
              <div key={title as string}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, color: '#fff' }}>{title as string}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {(links as string[][]).map(([href, label], i) => <a key={label + i} className="ch-flink" href={href}>{label}</a>)}
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
    </div>
  )
}
