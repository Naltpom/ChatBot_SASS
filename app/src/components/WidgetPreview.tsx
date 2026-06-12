// Aperçu live du widget — réplique React du widget embarquable (widget.jsx du
// design). Navigue dans le VRAI tree_json du bot, en local ; les réponses IA
// sont simulées (l'aperçu n'appelle jamais l'API IA).
import { ReactNode, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Sparkles } from 'lucide-react'
import { BubbleIcon, brandBg } from '../ui'

interface Msg { from: 'bot' | 'user'; text: string; ai?: boolean }

// Formulaire de contact simulé (nœud d'arbre type 'lead') — mêmes clés que
// widget.js : fields filtrés sur le référentiel, email forcé en tête.
interface LeadSim { fields: string[]; after: { label: string; next: string }[] }

const LEAD_LABELS: Record<string, string> = { email: 'Email', name: 'Nom', phone: 'Téléphone', message: 'Message' }

function leadFieldsOf(fields?: string[]): string[] {
  const f = (fields || ['email', 'message']).filter(x => LEAD_LABELS[x])
  if (!f.includes('email')) f.unshift('email')
  return f
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

interface Props {
  design: Record<string, any>
  mode: string             // tree | ai | hybrid
  tree: Record<string, any>
  botName: string
  degraded?: boolean
  defaultOpen?: boolean    // false : bulle fermée au départ (démo landing)
}

const AI_PREVIEW_REPLIES = [
  "Bonne question ! (réponse IA simulée pour l'aperçu — le vrai widget interroge votre modèle configuré)",
  "Bien sûr ! Dans le widget en production, cette réponse viendrait de l'IA avec le contexte de la page visitée.",
  "Voici un exemple de réponse IA. Les réponses arbre, elles, sont gratuites et illimitées.",
]

// Polices SANS chargement externe — mêmes stacks que widget.js (FONTS)
const FONT_STACKS: Record<string, string> = {
  system: "'Public Sans',-apple-system,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
}

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = parseInt(v, 10)
  return isNaN(n) ? fallback : Math.min(max, Math.max(min, n))
}

export default function WidgetPreview({ design, mode, tree, botName, degraded = false, defaultOpen = true }: Props) {
  const d = design || {}
  const brand = d.primaryColor || '#0d9488'
  const bg = brandBg(d)
  const R = typeof d.borderRadius === 'number' ? d.borderRadius : 16
  const bubblePx = d.size === 'sm' ? 48 : d.size === 'lg' ? 68 : 58
  const anim = d.loadingAnimation || 'dots'
  // Personnalisation étendue — mêmes défauts/whitelists que widget.js (css(d))
  const font = FONT_STACKS[d.font] || FONT_STACKS.system
  const ox = clampInt(d.offsetX, 0, 120, 18)
  const oy = clampInt(d.offsetY, 0, 120, 18)
  const side = d.position === 'left' ? { left: ox } : { right: ox }
  const dark = d.darkMode === true
  const soft = d.headerStyle === 'soft'
  const square = d.bubbleStyle === 'square'
  const compact = d.density === 'compact'
  const launcherText = (typeof d.launcherText === 'string' ? d.launcherText : '').slice(0, 40).trim()
  // Surfaces : palette sombre si darkMode, littéraux historiques sinon
  const panelBg = dark ? '#101816' : '#fff'
  const msgsBg = dark ? '#0c1311' : '#fafbfb'
  const botBg = dark ? '#1b2624' : '#fff'
  const botBorder = dark ? '#233330' : '#e6eae8'
  const botText = dark ? '#e8efed' : '#1d2b27'
  const lineBorder = dark ? '#233330' : '#e9edec'
  const inputBg = dark ? '#18221f' : '#fff'
  const inputBorder = dark ? '#233330' : '#dde3e1'
  const mutedText = dark ? '#9fb0ab' : '#5f7873'
  const headText = soft ? (dark ? '#e8efed' : '#1d2b27') : '#fff'

  const [open, setOpen] = useState(defaultOpen)
  const [aiMode, setAiMode] = useState(mode === 'ai')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [options, setOptions] = useState<{ label: string; next: string }[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [aiIdx, setAiIdx] = useState(0)
  // Nœuds typés : bouton RDV en tête des options, overlay simulé, formulaire lead
  const [appt, setAppt] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<string | null>(null)
  const [lead, setLead] = useState<LeadSim | null>(null)
  const [leadVals, setLeadVals] = useState<Record<string, string>>({})
  const [leadErr, setLeadErr] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const nodes = tree?.nodes || {}
  const start = tree?.start || 'root'

  function nodeOf(id: string) {
    return nodes[id] || nodes[start] || { message: 'Bonjour !', options: [] }
  }

  // reset à chaque changement structurel
  useEffect(() => {
    const isIA = mode === 'ai' && !degraded
    setAiMode(isIA)
    setAppt(null)
    setLead(null)
    setOverlay(null)
    setLeadVals({})
    setLeadErr(false)
    if (isIA) {
      setMsgs([{ from: 'bot', text: d.welcomeMessage || 'Je vous écoute ! Posez votre question librement, je réponds grâce à l\'IA.' }])
      setOptions([])
    } else {
      const root = nodeOf(start)
      setMsgs([{ from: 'bot', text: root.message }])
      if (root.type === 'lead') {
        setOptions([])
        setLead({ fields: leadFieldsOf(root.fields), after: root.options || [] })
      } else {
        setOptions(root.options || [])
        if (root.type === 'appointment' && /^https:\/\//.test(root.url || '')) setAppt(root.url)
      }
    }
    setTyping(false)
  }, [mode, degraded, JSON.stringify(tree)])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, typing, options])

  function botSay(text: string, opts: { label: string; next: string }[] | null, delay = 650, ai = false,
                  extras?: { appt?: string | null; lead?: LeadSim | null }) {
    setTyping(true)
    setOptions([])
    setAppt(null)
    setLead(null)
    setTimeout(() => {
      setTyping(false)
      setMsgs(m => [...m, { from: 'bot', text, ai }])
      if (opts) setOptions(opts)
      setAppt(extras?.appt || null)
      if (extras?.lead) {
        setLead(extras.lead)
        setLeadVals({})
        setLeadErr(false)
      }
    }, delay)
  }

  function pick(opt: { label: string; next: string }) {
    setMsgs(m => [...m, { from: 'user', text: opt.label.replace(/^[^\p{L}\p{N}↩]*\s*/u, '') }])
    if (opt.next === '__ai__') {
      if (degraded || mode === 'tree') {
        const root = nodeOf(start)
        botSay('Les réponses IA sont indisponibles pour le moment. Utilisez le menu ou le formulaire de contact.', root.options || [], 500)
        return
      }
      setAiMode(true)
      botSay("Je vous écoute ! Posez votre question librement, je réponds grâce à l'IA.", null, 550)
      return
    }
    const node = nodeOf(opt.next)
    // Parité widget.js (renderResponse) : mêmes clés type / url / fields
    if (node.type === 'lead') {
      botSay(node.message, null, 700, false,
             { lead: { fields: leadFieldsOf(node.fields), after: node.options || [] } })
      return
    }
    if (node.type === 'appointment' && /^https:\/\//.test(node.url || '')) {
      botSay(node.message, node.options || [], 700, false, { appt: node.url })
      return
    }
    botSay(node.message, node.options || [], 700)
  }

  function submitLead() {
    if (!lead) return
    const email = (leadVals.email || '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setLeadErr(true)
      return
    }
    setLeadErr(false)
    const after = lead.after
    setLead(null)
    botSay("Merci ! Votre demande a bien été transmise. (simulation — rien n'est envoyé)", after, 500)
  }

  function sendAI() {
    const t = input.trim()
    if (!t || typing) return
    setInput('')
    setMsgs(m => [...m, { from: 'user', text: t }])
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setMsgs(m => [...m, { from: 'bot', text: AI_PREVIEW_REPLIES[aiIdx % AI_PREVIEW_REPLIES.length], ai: true }])
      setAiIdx(i => i + 1)
    }, 1200)
  }

  function backToTree() {
    setAiMode(false)
    setMsgs(m => [...m, { from: 'user', text: 'Revenir au menu' }])
    const root = nodeOf(start)
    if (root.type === 'lead') {
      botSay(root.message, null, 450, false,
             { lead: { fields: leadFieldsOf(root.fields), after: root.options || [] } })
      return
    }
    if (root.type === 'appointment' && /^https:\/\//.test(root.url || '')) {
      botSay(root.message, root.options || [], 450, false, { appt: root.url })
      return
    }
    botSay(root.message, root.options || [], 450)
  }

  const inputDisabled = !aiMode || degraded
  const r14 = Math.min(R, 14)

  return (
    <div style={{ fontFamily: font }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: bubblePx + oy + 12, ...side, width: 338, maxWidth: 'calc(100% - 36px)',
          height: compact ? 420 : 460, maxHeight: `calc(100% - ${bubblePx + oy + 34}px)`,
          background: panelBg, borderRadius: R, boxShadow: '0 18px 60px rgba(10,30,25,.22), 0 2px 8px rgba(10,30,25,.08)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 40,
          border: dark ? '1px solid #233330' : '1px solid rgba(0,0,0,.06)',
        }}>
          {/* Header — solid : couleur de marque ; soft : surface claire (ou sombre) */}
          <div style={{
            background: soft ? panelBg : bg, color: headText, padding: '13px 15px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: soft ? `1px solid ${lineBorder}` : 'none',
          }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: soft ? bg : 'rgba(255,255,255,.18)', color: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 34 : 19} avatarImg={d.avatarImage} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2 }}>{d.title || botName}</div>
              <div style={{ fontSize: 11, opacity: .85, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 9, background: '#7CF5C8', display: 'inline-block' }} />
                En ligne · {aiMode ? 'Mode IA' : 'Menu guidé'}
              </div>
            </div>
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: .6, padding: '3px 8px', borderRadius: 99, textTransform: 'uppercase',
              ...(soft
                ? { border: `1.5px solid ${brand}`, color: brand, background: 'transparent' }
                : { background: 'rgba(255,255,255,.2)' }),
            }}>
              {aiMode ? 'IA' : 'TREE'}
            </span>
            <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ background: 'none', border: 'none', color: headText, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4, opacity: .85 }}>×</button>
          </div>

          {degraded && (
            <div style={{ background: '#fdf3e0', borderBottom: '1px solid #ecd6a8', color: '#8a5a0a', fontSize: 11.5, padding: '7px 13px', display: 'flex', gap: 7, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> Assistant IA momentanément indisponible — le menu guidé reste actif.
            </div>
          )}

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? 10 : '14px 13px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 9, background: msgsBg }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: compact ? '7px 10px' : '9px 12px', fontSize: compact ? 12.5 : 13.5, lineHeight: 1.5,
                  borderRadius: square ? 8 : (m.from === 'user' ? `${r14}px ${r14}px 4px ${r14}px` : `4px ${r14}px ${r14}px ${r14}px`),
                  background: m.from === 'user' ? brand : botBg,
                  color: m.from === 'user' ? '#fff' : botText,
                  border: m.from === 'user' ? 'none' : `1px solid ${botBorder}`,
                  boxShadow: m.from === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,.04)',
                }}>
                  {m.ai && (
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: .5, color: brand, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Sparkles size={10} /> IA
                    </div>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div style={{ display: 'flex' }}>
                <div style={{ padding: '10px 14px', borderRadius: '4px 14px 14px 14px', background: botBg, border: `1px solid ${botBorder}`, display: 'flex', gap: 4, alignItems: 'center' }}>
                  {anim === 'pulse' ? (
                    <span style={{ width: 10, height: 10, borderRadius: 9, background: brand, display: 'inline-block', animation: 'kcPulse 1s infinite ease-in-out' }} />
                  ) : [0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 6, height: 6, borderRadius: 9,
                      background: anim === 'wave' ? brand : '#b9c4c0', display: 'inline-block',
                      animation: anim === 'wave' ? `kcWave 1s ${i * .14}s infinite ease-in-out` : `kcBlink 1.2s ${i * .18}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            {!typing && (options.length > 0 || appt) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 2 }}>
                {appt && (
                  <button onClick={() => setOverlay(appt)} style={{
                    fontSize: compact ? 11.5 : 12.5, fontWeight: 600, padding: compact ? '6px 10px' : '8px 12px', whiteSpace: 'nowrap',
                    borderRadius: square ? 10 : 99, border: `1.5px solid ${brand}`, background: '#fff', color: brand, cursor: 'pointer',
                  }}>Prendre rendez-vous</button>
                )}
                {options.map((o, i) => (
                  <button key={i} onClick={() => pick(o)} style={{
                    fontSize: compact ? 11.5 : 12.5, fontWeight: 600, padding: compact ? '6px 10px' : '8px 12px', whiteSpace: 'nowrap',
                    borderRadius: square ? 10 : 99, border: `1.5px solid ${brand}`, background: '#fff', color: brand, cursor: 'pointer',
                  }}>{o.label}</button>
                ))}
              </div>
            )}
            {!typing && lead && (
              <div style={{
                background: botBg, border: `1px solid ${botBorder}`, borderRadius: square ? 10 : r14, padding: 12,
                display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '86%',
                boxShadow: '0 1px 2px rgba(0,0,0,.04)',
              }}>
                {lead.fields.map(f => (
                  <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: mutedText }}>{LEAD_LABELS[f]}</label>
                    {f === 'message' ? (
                      <textarea rows={3} value={leadVals[f] || ''}
                                onChange={e => setLeadVals(v => ({ ...v, [f]: e.target.value }))}
                                style={{
                                  fontFamily: 'inherit', fontSize: 13, padding: '8px 11px', borderRadius: 10,
                                  border: `1px solid ${inputBorder}`, outline: 'none', background: inputBg, color: botText, resize: 'vertical',
                                }} />
                    ) : (
                      <input type={f === 'email' ? 'email' : 'text'} required={f === 'email'}
                             value={leadVals[f] || ''}
                             onChange={e => setLeadVals(v => ({ ...v, [f]: e.target.value }))}
                             style={{
                               fontFamily: 'inherit', fontSize: 13, padding: '8px 11px', borderRadius: 10,
                               border: `1px solid ${inputBorder}`, outline: 'none', background: inputBg, color: botText,
                             }} />
                    )}
                  </div>
                ))}
                {leadErr && <div style={{ fontSize: 11.5, color: '#c0392b' }}>Merci d'indiquer un email valide.</div>}
                <button onClick={submitLead} style={{
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 9, borderRadius: 99,
                  border: 'none', cursor: 'pointer', background: brand, color: '#fff', marginTop: 4,
                }}>Envoyer</button>
              </div>
            )}
            {aiMode && !typing && mode !== 'ai' && (
              <button onClick={backToTree} style={{
                alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600, padding: '5px 10px',
                borderRadius: 99, border: '1px solid #d8dedc', background: '#fff', color: '#5f7873', cursor: 'pointer',
              }}>↩ Revenir au menu</button>
            )}
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${lineBorder}`, padding: 10, display: 'flex', gap: 8, background: panelBg }}>
            <input
              value={input} disabled={inputDisabled}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAI()}
              placeholder={inputDisabled ? 'Choisissez une option ci-dessus' : (d.placeholder || 'Écrivez votre message…')}
              style={{
                flex: 1, fontFamily: 'inherit', fontSize: 13.5, padding: '10px 13px', borderRadius: 99,
                border: `1px solid ${inputBorder}`, outline: 'none',
                background: inputDisabled ? (dark ? '#0c1311' : '#f4f6f5') : inputBg,
                color: botText, minWidth: 0, boxShadow: 'none',
              }} />
            <button onClick={sendAI} disabled={inputDisabled || !input.trim()} aria-label="Envoyer" style={{
              width: 40, height: 40, borderRadius: 99, border: 'none', cursor: inputDisabled ? 'default' : 'pointer',
              background: inputDisabled || !input.trim() ? '#e3e8e6' : brand, color: '#fff',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.6 21.8 12 3.4 3.4l.01 6.6L15 12 3.41 14z" /></svg>
            </button>
          </div>

          {d.poweredBy !== false && (
            <div style={{ textAlign: 'center', fontSize: 10, color: dark ? '#6b7a76' : '#9aa7a3', padding: '0 0 7px', background: panelBg }}>
              Propulsé par <span style={{ fontWeight: 700, color: '#0d9488' }}>Kertios Chat</span>
            </div>
          )}

          {/* Overlay rendez-vous simulé : pas de vraie iframe Calendly dans le
              dashboard — le widget réel embarque le calendrier (hôtes whitelistés) */}
          {overlay && (
            <div style={{ position: 'absolute', inset: 0, background: panelBg, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
              <div style={{ background: bg, color: '#fff', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Prendre rendez-vous</span>
                <button onClick={() => setOverlay(null)} aria-label="Fermer" style={{
                  background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
                  fontSize: 18, lineHeight: 1, padding: 4, opacity: .85,
                }}>×</button>
              </div>
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 10, padding: 20, textAlign: 'center',
              }}>
                <CalendarDays size={22} style={{ color: '#93a8a2' }} />
                <div style={{ fontSize: 12.5, color: mutedText, lineHeight: 1.55, maxWidth: 250 }}>
                  Aperçu : le calendrier ({hostnameOf(overlay)}) s'affiche ici dans le widget réel.
                </div>
                <a href={overlay} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 12.5, fontWeight: 700, color: brand, textDecoration: 'underline',
                }}>Ouvrir dans un nouvel onglet</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulle — launcherText non vide et fermée : pilule [icône + libellé] ;
          ouverte : redevient un rond avec la croix (comportement widget.js) */}
      <button onClick={() => setOpen(o => !o)} aria-label="Ouvrir le chat" style={{
        position: 'absolute', bottom: oy, ...side, height: bubblePx, borderRadius: launcherText && !open ? 99 : '50%',
        width: launcherText && !open ? 'auto' : bubblePx,
        border: d.bordered ? '3px solid rgba(255,255,255,.95)' : 'none', cursor: 'pointer',
        background: bg, color: '#fff', boxShadow: '0 8px 26px rgba(10,30,25,.3)',
        zIndex: 41, transform: open ? 'scale(.92)' : 'scale(1)', transition: 'transform .18s ease',
        ...(launcherText && !open
          ? { padding: '0 16px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }
          : { padding: 0, display: 'grid', placeItems: 'center' }),
      }}>
        {open
          ? <svg width={bubblePx * .38} height={bubblePx * .38} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          : (
            <>
              <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? bubblePx * .58 : bubblePx * .44} avatarImg={d.avatarImage} />
              {launcherText && <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{launcherText}</span>}
            </>
          )}
      </button>
    </div>
  )
}

// Cadre « faux site client » autour de l'aperçu (pages-bot.jsx)
export function PreviewFrame({ site, siteName, brandColor, children, height = 560 }: {
  site: string; siteName?: string; brandColor: string; children: ReactNode; height?: number
}) {
  return (
    <div>
      <div className="browser-bar">
        {['#f87171', '#fbbf24', '#34d399'].map(c => <span key={c} className="b-dot" style={{ background: c }} />)}
        <span className="b-url">{site}</span>
      </div>
      <div className="preview-stage" style={{ height }}>
        <div style={{ padding: '26px 30px', opacity: .85 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#283733' }}>{siteName || site}</div>
            <div style={{ display: 'flex', gap: 14 }}>
              {['Services', 'Tarifs', 'À propos', 'Contact'].map(n => (
                <span key={n} style={{ fontSize: 11.5, color: '#7d8c87' }}>{n}</span>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 36, maxWidth: 380 }}>
            <div style={{ height: 22, width: '78%', borderRadius: 6, background: '#e8eeec' }} />
            <div style={{ height: 22, width: '55%', borderRadius: 6, background: '#e8eeec', marginTop: 8 }} />
            <div style={{ height: 11, width: '92%', borderRadius: 5, background: '#f0f4f3', marginTop: 18 }} />
            <div style={{ height: 11, width: '85%', borderRadius: 5, background: '#f0f4f3', marginTop: 7 }} />
            <div style={{ height: 11, width: '62%', borderRadius: 5, background: '#f0f4f3', marginTop: 7 }} />
            <div style={{ height: 34, width: 130, borderRadius: 9, background: brandColor, opacity: .9, marginTop: 22 }} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 34 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ flex: 1, height: 110, borderRadius: 12, background: '#f4f7f6', border: '1px solid #e8eeec' }} />
            ))}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
