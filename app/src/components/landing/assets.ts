// Polices, keyframes/responsive scoped (.chapote) et apparition au scroll —
// extraits de Landing.tsx (R4). Portée landing uniquement : tout est injecté
// au montage et nettoyé au démontage.
import { useEffect } from 'react'

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
.ch-cmp-scroll{-webkit-overflow-scrolling:touch;}
.ch-cmp-table{min-width:0;}
/* Widget animé du hero : largeur naturelle 340px mais autorisé à rétrécir
   pour ne jamais forcer la largeur du hero sous l'écran (mobile étroit). */
.ch-hero-widget{width:100%;max-width:340px;}
@media (max-width:920px){
  .ch-nav-links{display:none !important;}
  .ch-desktop-actions{display:none !important;}
  .ch-hero-split{grid-template-columns:1fr !important;gap:38px !important;text-align:center;}
  .ch-hero-split .ch-hero-cta,.ch-hero-split .ch-hero-trust{justify-content:center;}
  .ch-piliers-grid{grid-template-columns:1fr 1fr !important;}
  .ch-footer-grid{grid-template-columns:1fr 1fr !important;gap:36px !important;}
  .ch-menu-btn{display:flex !important;}
}
/* Comparatif : sous 720px le tableau 4 colonnes défile horizontalement
   (au lieu d'écraser les colonnes), avec une largeur minimale lisible. */
@media (max-width:720px){
  .ch-cmp-table{min-width:560px;}
}
@media (max-width:600px){
  .ch-piliers-grid{grid-template-columns:1fr !important;}
  .ch-testi-grid{grid-template-columns:1fr !important;}
  .ch-hero-h1{font-size:38px !important;}
  .ch-section-h2{font-size:30px !important;}
  .ch-footer-grid{grid-template-columns:1fr 1fr !important;gap:28px !important;}
  /* Padding latéral réduit : 32px -> 18px sur tous les conteneurs centrés
     de la landing (inline padding écrasé par !important, vertical préservé). */
  .chapote .ch-pad{padding-left:18px !important;padding-right:18px !important;}
  .ch-hero-split{padding-left:18px !important;padding-right:18px !important;padding-top:54px !important;}
  .ch-hero-cta .ch-cta-primary,.ch-hero-cta .ch-cta-secondary{flex:1 1 100%;justify-content:center;}
}
@media (max-width:440px){
  .ch-footer-grid{grid-template-columns:1fr !important;gap:24px !important;}
  .ch-hero-h1{font-size:32px !important;}
  .ch-section-h2{font-size:25px !important;}
  .ch-piliers-grid{gap:16px !important;}
}
@media (prefers-reduced-motion: reduce){.ch-reveal{opacity:1;transform:none;transition:none;}.chapote *{animation:none !important;}}
`

// Polices + styles scoped (.chapote) injectés au montage, nettoyés au démontage.
export function useChapoteAssets() {
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

// Apparition au scroll (IntersectionObserver) pour les blocs .ch-reveal.
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } })
    }, { threshold: 0.12 })
    const t = setTimeout(() => { document.querySelectorAll('.ch-reveal').forEach(el => io.observe(el)) }, 90)
    return () => { clearTimeout(t); io.disconnect() }
  }, [])
}
