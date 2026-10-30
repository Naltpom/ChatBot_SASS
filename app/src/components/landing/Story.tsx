// « Comment ça répond » : section haute (340vh) à contenu sticky. Le scroll fait
// avancer une conversation dans le widget (arbre → IA → humain) et change le
// texte à gauche, avec un rail de progression à trois segments.
import { useRef } from 'react'
import { CLASH, EASE, MONO, STEPS, STORY, CORAL, HatIcon, Kicker, SendIcon } from './data'
import type { StoryMsg } from './data'
import { clamp, useScrollProgress } from './assets'

const BUBBLE: Record<'bot' | 'ai' | 'human', [string, string]> = {
  bot: ['#fff', '#E8ECF0'],
  ai: ['rgba(140,109,255,.08)', 'rgba(140,109,255,.35)'],
  human: ['rgba(232,106,95,.08)', 'rgba(232,106,95,.35)'],
}
const MODE_LABEL = ['l’arbre', 'l’IA', 'un humain']

function Message({ m }: { m: StoryMsg }) {
  switch (m.type) {
    case 'user':
      return <div style={{ alignSelf: 'flex-end', maxWidth: '78%', background: '#1C3F5C', color: '#fff', padding: '9px 13px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, lineHeight: 1.45 }}>{m.text}</div>
    case 'chips':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {m.items.map(ch => <span key={ch} style={{ border: '1px solid #2F9E79', color: '#1C3F5C', background: 'rgba(47,158,121,.06)', padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500 }}>{ch}</span>)}
        </div>
      )
    case 'handoff':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(232,106,95,.08)', border: '1px solid rgba(232,106,95,.35)', borderRadius: 14, padding: '10px 12px' }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: CORAL, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>CA</span>
          <span style={{ lineHeight: 1.25 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>Camille</span><span style={{ display: 'block', fontSize: 11.5, color: '#6B7B8D' }}>Conseillère, service client</span></span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#1C7A5C' }}>a rejoint</span>
        </div>
      )
    default: {
      const [bg, bd] = BUBBLE[m.type]
      return (
        <div style={{ alignSelf: 'flex-start', maxWidth: '84%', background: bg, border: `1px solid ${bd}`, color: '#1E2A32', padding: '9px 13px', borderRadius: '16px 16px 16px 4px', fontSize: 13.5, lineHeight: 1.45 }}>
          {m.tag && <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: m.tc ?? '#6B7B8D', marginBottom: 4 }}>{m.tag}</div>}
          {m.text}
        </div>
      )
    }
  }
}

export function Story() {
  const ref = useRef<HTMLElement>(null)
  const sp = useScrollProgress(ref, 'pin')
  const step = sp < 0.34 ? 0 : sp < 0.67 ? 1 : 2
  const cur = STEPS[step]

  return (
    <section id="story" ref={ref} style={{ height: '340vh', position: 'relative', background: '#14202A', color: '#fff' }}>
      <div className="ch-pad ch-story-grid" style={{ position: 'sticky', top: 0, height: '100vh', maxWidth: 1280, margin: '0 auto', padding: '76px 32px 20px', display: 'grid', gap: '16px 64px', alignItems: 'center', alignContent: 'center', overflow: 'hidden' }}>
        <div>
          <Kicker color={cur.c} dark>COMMENT ÇA RÉPOND</Kicker>
          <div className="ch-story-num" aria-hidden="true" style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 'min(14vw,20vh,200px)', lineHeight: 0.85, letterSpacing: '-.05em', color: cur.c, marginTop: 16, transition: 'color .5s' }}>{cur.n}</div>
          <div className="ch-story-steps" style={{ position: 'relative', marginTop: 18 }}>
            {STEPS.map((x, i) => (
              <div key={x.n} aria-hidden={i !== step} style={{ position: 'absolute', inset: 0, opacity: i === step ? 1 : 0, transform: i === step ? 'none' : i < step ? 'translateY(-40px)' : 'translateY(40px)', transition: `opacity .5s,transform .7s ${EASE}` }}>
                <div style={{ fontFamily: MONO, fontSize: 13, color: x.c }}>{x.k}</div>
                <h3 style={{ fontFamily: CLASH, fontWeight: 600, fontSize: 'clamp(32px,3.6vw,48px)', lineHeight: 1.05, letterSpacing: '-.02em', margin: '8px 0 0' }}>{x.h}</h3>
                <p style={{ fontSize: 17.5, lineHeight: 1.6, color: '#B8C8D4', margin: '16px 0 0', maxWidth: 500, textWrap: 'pretty' } as React.CSSProperties}>{x.d}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, maxWidth: 500 }}>
            {STEPS.map((x, i) => (
              <div key={x.n} style={{ flex: 1 }}>
                <div style={{ height: 3, background: '#2A3A46', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${clamp((sp - i / 3) * 3) * 100}%`, background: x.c }} /></div>
                <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 8, color: i === step ? '#fff' : '#6B7B8D', transition: 'color .3s' }}>{x.k}</div>
              </div>
            ))}
          </div>
        </div>

        <div aria-hidden="true" style={{ justifySelf: 'center', width: 'min(400px,100%)', background: '#fff', borderRadius: 24, overflow: 'hidden', boxShadow: '0 40px 90px -30px rgba(0,0,0,.6)', color: '#1E2A32' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', background: '#1C3F5C', color: '#fff' }}>
            <span style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(255,255,255,.13)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HatIcon size={20} stroke="#fff" /></span>
            <div style={{ flex: 1, lineHeight: 1.25 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Assistant Chapote</div>
              <div style={{ fontSize: 12, color: '#A8C0D0' }}>Répond via : <span style={{ color: '#fff', fontWeight: 600 }}>{MODE_LABEL[step]}</span></div>
            </div>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: cur.c, transition: 'background .5s' }} />
          </div>
          <div className="ch-story-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: '#FBFCFD', overflow: 'hidden' }}>
            {STORY.map((m, i) => {
              const vis = sp >= m.t
              return (
                <div key={i} style={{ maxHeight: vis ? 200 : 0, opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(16px)', marginTop: vis ? 10 : 0, overflow: 'hidden', flexShrink: 0, transition: `max-height .5s ease,opacity .4s,transform .5s ${EASE},margin .5s`, display: 'flex', flexDirection: 'column' }}>
                  <Message m={m} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid #EEF1F4' }}>
            <div style={{ flex: 1, height: 38, borderRadius: 12, background: '#F0F2F5', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#6B7B8D', fontSize: 13 }}>Écrivez votre message…</div>
            <span style={{ width: 38, height: 38, borderRadius: 12, background: '#1C3F5C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SendIcon size={17} /></span>
          </div>
        </div>
      </div>
    </section>
  )
}
