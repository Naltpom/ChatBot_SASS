// Polices, keyframes/responsive scoped (.chapote), apparition au scroll et
// mesure de progression de scroll des sections animées.
// Portée landing uniquement : tout est injecté au montage et nettoyé au démontage.
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

const FONT_LINKS = [
  ['preconnect', 'https://fonts.googleapis.com', ''],
  ['preconnect', 'https://fonts.gstatic.com', 'anonymous'],
  ['stylesheet', 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap', ''],
  ['stylesheet', 'https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap', ''],
] as const

const CHAPOTE_CSS = `
.chapote *{box-sizing:border-box;}
.chapote ::selection{background:#2F9E79;color:#fff;}
.chapote :focus-visible{outline:3px solid #1C3F5C;outline-offset:2px;}
@keyframes ch-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes ch-blink{50%{opacity:0}}
@keyframes ch-pulse{0%{box-shadow:0 0 0 0 rgba(47,158,121,.7)}70%{box-shadow:0 0 0 8px rgba(47,158,121,0)}100%{box-shadow:0 0 0 0 rgba(47,158,121,0)}}
@keyframes ch-flashok{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
/* Apparition au scroll : délai par bloc via la variable --rd (ms). */
.ch-reveal{opacity:0;transform:translateY(56px);transition:opacity .9s ease var(--rd,0ms),transform 1.1s cubic-bezier(.2,.8,.2,1) var(--rd,0ms);}
.ch-reveal.is-in{opacity:1;transform:none;}
.ch-navlink{text-decoration:none;color:#1E2A32;font-size:14.5px;font-weight:500;transition:color .2s;}
.ch-navlink:hover{color:#2F9E79;}
.ch-cta-primary{transition:background .2s,transform .2s;}
.ch-cta-primary:hover{background:#2F9E79 !important;color:#fff !important;transform:translateY(-2px);}
.ch-cta-flat:hover{background:#2F9E79 !important;color:#fff !important;}
.ch-cta-lift{transition:transform .2s;}
.ch-cta-lift:hover{transform:translateY(-2px);}
.ch-link-underline:hover{color:#2F9E79 !important;border-color:#2F9E79 !important;}
.ch-cmp-row{transition:background .2s;}
.ch-cmp-row:hover{background:#F0F2F5;}
.ch-copy{transition:background .2s;}
.ch-copy:hover{background:#1C7A5C !important;}
.ch-flink{text-decoration:none;color:#A8C0D0;font-size:14px;transition:color .2s;}
.ch-flink:hover{color:#fff;}
.ch-menu-btn{display:none;}
/* Bandes de la section « Ce qu'est Chapote » : séparateur vertical sauf la case Chapote. */
.ch-single > div{border-right:1px solid #D8DEE6;}
/* Comparatif : le tableau occupe 2 colonnes de la grille, sauf quand la grille
   n'en a plus qu'une (sinon « span 2 » crée une colonne fantôme qui déborde). */
.ch-cmp-table{grid-column:span 2;}
@media (max-width:820px){.ch-cmp-table{grid-column:1 / -1;}}
/* « Comment ça répond » : 2 colonnes en large, 1 colonne en étroit. */
.ch-story-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}
.ch-story-steps{height:220px;}
.ch-story-body{height:min(420px,46vh);}
@media (max-width:1040px){
  .ch-nav-links{display:none !important;}
  .ch-menu-btn{display:flex !important;}
}
@media (max-width:900px){
  .ch-story-grid{grid-template-columns:minmax(0,1fr);}
  .ch-story-num{display:none !important;}
  .ch-story-steps{height:170px;}
  .ch-story-body{height:min(300px,30vh);}
}
@media (max-width:720px){
  .ch-login{display:none !important;}
  .ch-footer-grid{gap:28px !important;}
}
@media (max-width:600px){
  /* Padding latéral réduit : 32px -> 18px sur tous les conteneurs centrés
     de la landing (inline padding écrasé par !important, vertical préservé). */
  .chapote .ch-pad{padding-left:18px !important;padding-right:18px !important;}
  .ch-hero-board{padding:16px !important;}
  .ch-lane{padding:12px !important;}
  .ch-lane-k{font-size:22px !important;}
  /* Étapes de « Comment ça répond » : texte resserré pour tenir au-dessus du rail. */
  .ch-story-steps{height:210px;}
  .ch-story-steps h3{font-size:28px !important;}
  .ch-story-steps p{font-size:15px !important;margin-top:10px !important;}
}
@media (max-width:440px){
  .ch-header-cta{display:none !important;}
}
@media (prefers-reduced-motion: reduce){
  .ch-reveal{opacity:1;transform:none;transition:none;}
  .chapote *{animation:none !important;}
}
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
// Le délai propre à chaque bloc se passe en style : { '--rd': '80ms' }.
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } })
    }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' })
    const t = setTimeout(() => { document.querySelectorAll('.ch-reveal').forEach(el => io.observe(el)) }, 90)
    return () => { clearTimeout(t); io.disconnect() }
  }, [])
}
// Délai d'apparition d'un bloc .ch-reveal (cf. useReveal).
export const revealDelay = (ms: number) => ({ '--rd': `${ms}ms` }) as React.CSSProperties

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))

// Progression de scroll d'une section, de 0 à 1, recalculée à chaque frame de scroll.
//  • 'pin'   : section haute à contenu sticky — 0 quand son haut touche le haut
//              de l'écran, 1 quand son bas touche le bas de l'écran.
//  • 'enter' : section qui entre par le bas — 0 quand son haut atteint le bas
//              de l'écran, 1 une fois bien installée dans la vue.
// Vaut 0 au prérendu (les effets ne tournent pas en SSR).
export function useScrollProgress(ref: RefObject<HTMLElement>, mode: 'pin' | 'enter') {
  const [p, setP] = useState(0)
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const vh = window.innerHeight
      const r = el.getBoundingClientRect()
      const next = mode === 'pin'
        ? clamp(-r.top / Math.max(1, r.height - vh))
        : clamp((vh - r.top) / (vh * 0.6 + r.height * 0.5))
      setP(prev => (Math.abs(prev - next) > 0.002 || (next !== prev && (next === 0 || next === 1)) ? next : prev))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ref, mode])
  return p
}

// Passe à true juste après le montage (déclenche les entrées du hero).
export function useMounted(delay = 80) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setOn(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return on
}
