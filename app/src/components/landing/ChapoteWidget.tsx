// Widget Chapote animé (port de ChapoteWidget.dc.html) — extrait de Landing.tsx.
// Boucle de 3 phases (arbre / IA / humain) toutes les 5 s, purement décoratif.
import { useEffect, useState } from 'react'
import { HatIcon } from './data'

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
    { kind: 'note', text: 'Réponse IA · modérée' },
  ],
  [
    { kind: 'msg', side: 'bot', text: 'Je vous mets en relation avec un conseiller humain.' },
    { kind: 'handoff', name: 'Camille', role: 'Conseillère Chapote', initials: 'CA' },
    { kind: 'msg', side: 'user', text: 'Merci, parfait !' },
  ],
]

export function ChapoteWidget() {
  const [phase, setPhase] = useState(0)
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    const t = setInterval(() => { setPhase(p => (p + 1) % WIDGET_PHASES.length); setSeq(s => s + 1) }, 5000)
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
    <div className="ch-hero-widget" style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 24, boxShadow: '0 26px 64px -20px rgba(28,63,92,.32)', overflow: 'hidden' }}>
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
            return <div key={key} style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'flex-start', animation: 'ch-in .42s ease both' }}>{(m.items ?? []).map(c => <span key={c} style={{ border: '1px solid #2F9E79', color: '#1C3F5C', background: 'rgba(47,158,121,.06)', padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>{c}</span>)}</div>
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
