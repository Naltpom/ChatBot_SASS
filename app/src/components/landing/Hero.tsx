// Hero « Aiguillage » : promesse + CTA à gauche ; à droite, un tableau animé où
// une question de visiteur passe par 01 Arbre → 02 IA → 03 Humain. La colonne
// qui répond s'élargit et se colore. Boucle sur les 3 scénarios de data.tsx.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CLASH, EASE, MONO, ROUTES, SCENARIOS, btnPrimary, btnUnderline } from './data'
import type { Scenario } from './data'
import { clamp, useMounted } from './assets'

// Chronologie d'un scénario (ms) : frappe de la question, puis 1 s par guichet
// testé, réponse affichée 3,6 s, fondu de 420 ms avant le scénario suivant.
const TYPE_DELAY = 450
const PER_CHAR = 34
const SCAN_DELAY = 400
const PER_LANE = 1000
const HOLD = 3600
const FADE = 420
const scanStart = (s: Scenario) => TYPE_DELAY + s.q.length * PER_CHAR + SCAN_DELAY
const doneAt = (s: Scenario) => scanStart(s) + (s.route + 1) * PER_LANE - 250
const duration = (s: Scenario) => doneAt(s) + HOLD + FADE
const TOTAL = SCENARIOS.reduce((a, s) => a + duration(s), 0)

type Loop = { sc: number; typed: number; scan: number; done: boolean; swap: boolean }
const START: Loop = { sc: 0, typed: 0, scan: -1, done: false, swap: false }

// État de la boucle à l'instant `elapsed` (ms depuis le début).
function loopAt(elapsed: number): Loop {
  let e = elapsed % TOTAL
  let sc = 0
  while (e >= duration(SCENARIOS[sc])) { e -= duration(SCENARIOS[sc]); sc++ }
  const s = SCENARIOS[sc]
  const typed = clamp(Math.floor((e - TYPE_DELAY) / PER_CHAR) + 1, 0, s.q.length)
  const scan = e < scanStart(s) ? -1 : Math.min(s.route, Math.floor((e - scanStart(s)) / PER_LANE))
  const done = e >= doneAt(s)
  return { sc, typed, scan, done, swap: e >= doneAt(s) + HOLD }
}

function useHeroLoop() {
  const [st, setSt] = useState<Loop>(START)
  const t0 = useRef(0)
  useEffect(() => {
    t0.current = Date.now()
    const tick = setInterval(() => {
      const next = loopAt(Date.now() - t0.current)
      setSt(prev => (prev.sc === next.sc && prev.typed === next.typed && prev.scan === next.scan && prev.done === next.done && prev.swap === next.swap ? prev : next))
    }, 40)
    return () => clearInterval(tick)
  }, [])
  return st
}

// Ligne du titre qui monte depuis sous sa ligne de base.
function TitleLine({ children, delay, on, color, pb = '.06em' }: { children: React.ReactNode; delay: number; on: boolean; color?: string; pb?: string }) {
  return (
    <span style={{ display: 'block', overflow: 'hidden', paddingBottom: pb }}>
      <span style={{ display: 'block', color, transform: on ? 'translateY(0)' : 'translateY(105%)', transition: `transform 1s ${EASE} ${delay}s` }}>{children}</span>
    </span>
  )
}

export function Hero({ ctaTo }: { ctaTo: string }) {
  const on = useMounted()
  const st = useHeroLoop()
  const s = SCENARIOS[st.sc]
  const route = ROUTES[s.route]
  const typing = st.typed < s.q.length
  const swapOp = st.swap ? 0 : 1
  const resultLine = st.done ? `→ Répondu via ${route.k} · ${s.tag}` : st.scan >= 0 ? ROUTES[st.scan].checking : typing ? 'Le visiteur écrit…' : ''

  return (
    <section className="ch-pad" style={{ maxWidth: 1280, margin: '0 auto', padding: '80px 32px 96px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,480px),1fr))', gap: 56, alignItems: 'center' }}>
      <div>
        <div style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: '.08em', color: '#6B7B8D', display: 'flex', gap: 14, alignItems: 'center' }}><span style={{ width: 32, height: 2, background: '#2F9E79', flexShrink: 0 }} />CHATBOT HYBRIDE · HÉBERGÉ EN FRANCE</div>
        <h1 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 'clamp(46px,6vw,84px)', lineHeight: 0.98, letterSpacing: '-.03em', margin: '26px 0 0', color: '#1E2A32' }}>
          <TitleLine on={on} delay={0.05}>Une question.</TitleLine>
          <TitleLine on={on} delay={0.17}>Trois façons</TitleLine>
          <TitleLine on={on} delay={0.29} color="#2F9E79" pb=".08em">d’y répondre.</TitleLine>
        </h1>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: '#4A5A68', margin: '28px 0 0', maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties}>Moins cher qu’un chatbot 100 % IA, plus malin qu’une FAQ, plus rapide qu’un ticket.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 28px', marginTop: 36 }}>
          <Link to={ctaTo} className="ch-cta-primary" style={btnPrimary}>Installer la balise →</Link>
          <a href="#story" className="ch-link-underline" style={btnUnderline}>Voir comment ça marche</a>
        </div>
        <div style={{ marginTop: 30, fontSize: 13.5, color: '#6B7B8D' }}>Dès 9 € / mois · Sans engagement · RGPD par défaut</div>
      </div>

      {/* Tableau d'aiguillage — purement illustratif (aria-hidden), la boucle
          défile en continu et n'apporte pas d'information au lecteur d'écran. */}
      <div aria-hidden="true" className="ch-hero-board" style={{ minWidth: 0, background: '#1E2A32', borderRadius: 24, padding: 22, color: '#fff', boxShadow: '0 50px 90px -50px rgba(28,63,92,.8)', opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(48px) scale(.97)', transition: `opacity .9s ease .35s,transform 1.1s ${EASE} .35s` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: MONO, fontSize: 12, color: '#A8C0D0', opacity: swapOp, transition: 'opacity .35s' }}><span>{s.site}</span><span>visiteur · à l’instant</span></div>
        <div style={{ marginTop: 14, background: '#fff', color: '#1E2A32', borderRadius: '16px 16px 16px 4px', padding: '15px 18px', fontSize: 18, fontWeight: 600, lineHeight: 1.35, minHeight: 24, opacity: swapOp, transition: 'opacity .35s' }}>
          {s.q.slice(0, st.typed)}
          <span style={{ display: 'inline-block', width: 2, height: '1.05em', background: '#2F9E79', verticalAlign: -3, marginLeft: 3, animation: 'ch-blink 1s steps(1) infinite' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, height: 280 }}>
          {ROUTES.map((r, i) => {
            const active = st.scan === i
            const passed = st.scan > i
            const isAns = active && i === s.route && st.done
            return (
              <div key={r.k} className="ch-lane" style={{ flex: `${isAns ? 2.6 : 1} 1 0`, minWidth: 0, position: 'relative', overflow: 'hidden', borderRadius: 16, background: isAns ? r.c : '#26343E', border: `1px solid ${active ? r.c : 'rgba(255,255,255,.08)'}`, opacity: passed ? 0.5 : 1, padding: 16, display: 'flex', flexDirection: 'column', transition: `flex-grow .8s ${EASE},background .5s,border-color .3s,opacity .4s` }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: 3, width: active || passed ? '100%' : '0%', background: r.c, transition: 'width .85s linear' }} />
                <div style={{ fontFamily: MONO, fontSize: 12, color: isAns ? '#14202A' : active ? r.c : passed ? '#8A98A6' : '#C3D3DF', transition: 'color .4s' }}>0{i + 1}</div>
                <div className="ch-lane-k" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 28, letterSpacing: '-.01em', color: isAns ? '#14202A' : active ? r.c : passed ? '#8A98A6' : '#C3D3DF', marginTop: 2, transition: 'color .4s' }}>{r.k}</div>
                <div style={{ position: 'absolute', left: 16, right: 16, top: 92, fontSize: 16, lineHeight: 1.45, fontWeight: 600, color: '#14202A', opacity: isAns ? 1 : 0, transform: isAns ? 'none' : 'translateY(14px)', transition: `opacity .5s ease .45s,transform .7s ${EASE} .45s` }}>{s.a}</div>
                <div style={{ marginTop: 'auto', fontSize: 13, lineHeight: 1.4, color: isAns ? '#14202A' : active ? '#fff' : '#A8C0D0', textDecoration: passed ? 'line-through' : 'none' }}>
                  {isAns ? s.tag : active ? r.checking : passed ? r.fail : r.idle}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 12, color: '#A8C0D0', minHeight: 16 }}>{resultLine}</div>
      </div>
    </section>
  )
}
