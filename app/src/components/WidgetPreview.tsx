// Aperçu live du widget — réplique React du widget embarquable (widget.jsx du
// design). Navigue dans le VRAI tree_json du bot, en local ; les réponses IA
// sont simulées (l'aperçu n'appelle jamais l'API IA).
// Parité widget.js : locale (PREVIEW_I18N miroir de I18N), CSAT simulé sous les
// bulles bot, flux LIVE léger sur les nœuds handoff. Les TRIGGERS ne sont pas
// simulés ici (panneau toujours ouvert dans l'aperçu : une bulle surgissante
// serait intrusive) — le hint de la Card « Déclencheurs proactifs » le dit, et
// on n'affiche pas non plus de badge « N déclencheurs actifs » (même raison :
// l'aperçu reste épuré, l'info vit dans l'éditeur).
import { ReactNode, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import { BubbleIcon, brandBg } from '../ui'

interface Msg {
  from: 'bot' | 'user'
  text: string
  ai?: boolean
  sys?: boolean      // bulle système du flux LIVE (attente conseiller) : italique, sans CSAT
  advisor?: boolean  // réponse « Conseiller » simulée : étiquette, sans CSAT (parité : jamais sur human)
}

// Formulaire de contact simulé (nœud d'arbre type 'lead') — mêmes clés que
// widget.js : fields filtrés sur le référentiel, email forcé en tête.
interface LeadSim { fields: string[]; after: { label: string; next: string }[] }

const LEAD_FIELD_KEYS = ['email', 'name', 'phone', 'message']

function leadFieldsOf(fields?: string[]): string[] {
  const f = (fields || ['email', 'message']).filter(x => LEAD_FIELD_KEYS.includes(x))
  if (!f.includes('email')) f.unshift('email')
  return f
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Dictionnaire UI miroir de I18N (widget/widget.js) pour les clés réellement
// rendues par l'aperçu. Les valeurs FR sont les chaînes historiques À L'OCTET
// (contrat e2e en défaut fr), les EN celles de widget.js — toute divergence
// avec widget.js est un bug de parité.
const PREVIEW_I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    online_tree: 'En ligne · Menu guidé',
    online_ai: 'En ligne · Mode IA',
    advisor_online: 'Conseiller en ligne',
    advisor_wait: "En attente d'un conseiller…",
    close: 'Fermer',
    send: 'Envoyer',
    open_chat: 'Ouvrir le chat',
    degraded_banner: ' Assistant IA momentanément indisponible — le menu guidé reste actif.',
    placeholder: 'Écrivez votre message…',
    placeholder_advisor: 'Écrivez au conseiller…',
    placeholder_pick: 'Choisissez une option ci-dessus',
    powered_by: 'Propulsé par',
    tag_ai: ' IA',
    tag_advisor: ' Conseiller',
    appointment: 'Prendre rendez-vous',
    appointment_title: 'Prise de rendez-vous',
    open_new_tab: 'Ouvrir dans un nouvel onglet',
    back_to_menu: '↩ Revenir au menu',
    back_to_menu_user: 'Revenir au menu',
    lead_email: 'Email',
    lead_name: 'Nom',
    lead_phone: 'Téléphone',
    lead_message: 'Message',
    lead_invalid_email: "Merci d'indiquer un email valide.",
    lead_sent: 'Merci ! Votre demande a bien été transmise.',
    ai_unavailable: 'Les réponses IA sont indisponibles pour le moment. Utilisez le menu ou le formulaire de contact.',
    ai_intro: "Je vous écoute ! Posez votre question librement, je réponds grâce à l'IA.",
    rate_up: 'Réponse utile',
    rate_down: 'Réponse peu utile',
  },
  en: {
    online_tree: 'Online · Guided menu',
    online_ai: 'Online · AI mode',
    advisor_online: 'Advisor online',
    advisor_wait: 'Waiting for an advisor…',
    close: 'Close',
    send: 'Send',
    open_chat: 'Open chat',
    degraded_banner: ' AI assistant temporarily unavailable — the guided menu is still active.',
    placeholder: 'Type your message…',
    placeholder_advisor: 'Write to the advisor…',
    placeholder_pick: 'Pick an option above',
    powered_by: 'Powered by',
    tag_ai: ' AI',
    tag_advisor: ' Advisor',
    appointment: 'Book an appointment',
    appointment_title: 'Appointment booking',
    open_new_tab: 'Open in a new tab',
    back_to_menu: '↩ Back to menu',
    back_to_menu_user: 'Back to menu',
    lead_email: 'Email',
    lead_name: 'Name',
    lead_phone: 'Phone',
    lead_message: 'Message',
    lead_invalid_email: 'Please enter a valid email address.',
    lead_sent: 'Thank you! Your request has been sent.',
    ai_unavailable: 'AI answers are unavailable right now. Please use the menu or the contact form.',
    ai_intro: "I'm listening! Ask your question freely, I answer with AI.",
    rate_up: 'Helpful',
    rate_down: 'Not helpful',
  },
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
  // Locale — même règle de résolution que widget.js : 'en' explicite, 'auto'
  // suit navigator.language, tout le reste = fr (rendu historique).
  const lang: 'fr' | 'en' = d.locale === 'en' ? 'en'
    : d.locale === 'auto' ? ((navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr')
    : 'fr'
  const t = (k: string) => PREVIEW_I18N[lang][k] || PREVIEW_I18N.fr[k] || ''
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
  // CSAT simulé : sélection locale par INDEX de message, aucun appel réseau
  const [ratings, setRatings] = useState<Record<number, 1 | -1>>({})
  // LIVE léger (nœud handoff) : badge LIVE + saisie active + UNE réponse
  // « Conseiller » factice — pas de poll, pas de file (parité visuelle seule)
  const [live, setLive] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Timers en attente (botSay, sendAI, flux handoff simulé) : tous annulables.
  // Un reset structurel ou un retour au menu ne doit jamais laisser une bulle
  // retardée (ex. réponse « Conseiller » à +2,4 s) atterrir dans le mauvais
  // contexte après que live est repassé à false ou que msgs a été vidé.
  const pendingTimers = useRef<number[]>([])
  function schedule(fn: () => void, delay: number) {
    const h = window.setTimeout(() => {
      pendingTimers.current = pendingTimers.current.filter(x => x !== h)
      fn()
    }, delay)
    pendingTimers.current.push(h)
  }
  function clearPendingTimers() {
    pendingTimers.current.forEach(h => clearTimeout(h))
    pendingTimers.current = []
  }

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
    setRatings({})
    setLive(false)
    if (isIA) {
      setMsgs([{ from: 'bot', text: d.welcomeMessage || t('ai_intro') }])
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
    // Cleanup : annule les bulles différées avant chaque re-reset ET au
    // démontage (sinon une réponse « Conseiller » différée resurgirait dans
    // l'aperçu fraîchement réinitialisé)
    return clearPendingTimers
  }, [mode, degraded, lang, JSON.stringify(tree)])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, typing, options])

  function botSay(text: string, opts: { label: string; next: string }[] | null, delay = 650, ai = false,
                  extras?: { appt?: string | null; lead?: LeadSim | null }) {
    setTyping(true)
    setOptions([])
    setAppt(null)
    setLead(null)
    schedule(() => {
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
        botSay(t('ai_unavailable'), root.options || [], 500)
        return
      }
      setAiMode(true)
      botSay(t('ai_intro'), null, 550)
      return
    }
    const node = nodeOf(opt.next)
    // Parité widget.js (renderResponse) : mêmes clés type / url / fields
    if (node.type === 'handoff') {
      // LIVE simulé : intro du nœud, bulle système d'attente, puis UNE réponse
      // « Conseiller » factice ~1,6 s plus tard. Aucune autre logique.
      setLive(true)
      botSay(node.message, null, 700)
      schedule(() => {
        setMsgs(m => [...m, { from: 'bot', text: t('advisor_wait'), sys: true }])
      }, 760)
      schedule(() => {
        setMsgs(m => [...m, {
          from: 'bot', advisor: true,
          text: lang === 'en' ? '(Preview) A human advisor would reply here.' : '(Aperçu) Un conseiller humain vous répondrait ici.',
        }])
      }, 760 + 1600)
      return
    }
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
    botSay(t('lead_sent') + (lang === 'en' ? ' (preview — nothing is sent)' : " (simulation — rien n'est envoyé)"), after, 500)
  }

  function sendAI() {
    const txt = input.trim()
    if (!txt || typing) return
    setInput('')
    setMsgs(m => [...m, { from: 'user', text: txt }])
    // Mode LIVE simulé : le message part « au conseiller », pas de réponse IA
    if (live) return
    setTyping(true)
    schedule(() => {
      setTyping(false)
      setMsgs(m => [...m, { from: 'bot', text: AI_PREVIEW_REPLIES[aiIdx % AI_PREVIEW_REPLIES.length], ai: true }])
      setAiIdx(i => i + 1)
    }, 1200)
  }

  function backToTree() {
    // Annule les bulles différées du flux handoff simulé (jusqu'à +2,4 s) :
    // elles ne doivent pas atterrir au milieu du menu arbre redessiné
    clearPendingTimers()
    setLive(false)
    setAiMode(false)
    setMsgs(m => [...m, { from: 'user', text: t('back_to_menu_user') }])
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

  const inputDisabled = live ? false : (!aiMode || degraded)
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
                {live ? t('advisor_online') : t(aiMode ? 'online_ai' : 'online_tree')}
              </div>
            </div>
            {/* Badge .kc-mode : jamais localisé (parité widget.js) */}
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: .6, padding: '3px 8px', borderRadius: 99, textTransform: 'uppercase',
              ...(soft
                ? { border: `1.5px solid ${brand}`, color: brand, background: 'transparent' }
                : { background: 'rgba(255,255,255,.2)' }),
            }}>
              {live ? 'LIVE' : aiMode ? 'IA' : 'TREE'}
            </span>
            <button onClick={() => setOpen(false)} aria-label={t('close')} style={{ background: 'none', border: 'none', color: headText, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4, opacity: .85 }}>×</button>
          </div>

          {degraded && (
            <div style={{ background: '#fdf3e0', borderBottom: '1px solid #ecd6a8', color: '#8a5a0a', fontSize: 11.5, padding: '7px 13px', display: 'flex', gap: 7, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />{t('degraded_banner')}
            </div>
          )}

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? 10 : '14px 13px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 9, background: msgsBg }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.from === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: compact ? '7px 10px' : '9px 12px', fontSize: compact ? 12.5 : 13.5, lineHeight: 1.5,
                  borderRadius: square ? 8 : (m.from === 'user' ? `${r14}px ${r14}px 4px ${r14}px` : `4px ${r14}px ${r14}px ${r14}px`),
                  background: m.from === 'user' ? brand : botBg,
                  color: m.from === 'user' ? '#fff' : (m.sys ? mutedText : botText),
                  fontStyle: m.sys ? 'italic' : undefined,
                  border: m.from === 'user' ? 'none' : `1px solid ${botBorder}`,
                  boxShadow: m.from === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,.04)',
                }}>
                  {m.ai && (
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: .5, color: brand, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Sparkles size={10} /> {t('tag_ai').trim()}
                    </div>
                  )}
                  {m.advisor && (
                    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: .5, color: brand, marginBottom: 3 }}>
                      {t('tag_advisor').trim()}
                    </div>
                  )}
                  {m.text}
                </div>
                {/* CSAT simulé — HORS de la bulle (parité .kc-rate hors .kc-msg),
                    jamais sur les bulles système/Conseiller (parité : le widget
                    ne propose le vote que sur les réponses ai|tree) */}
                {m.from === 'bot' && !m.sys && !m.advisor && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, paddingLeft: 4 }}>
                    <button onClick={() => setRatings(r => ({ ...r, [i]: 1 }))}
                            title={t('rate_up')} aria-label={t('rate_up')}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, lineHeight: 0,
                                     color: ratings[i] === 1 ? 'var(--go)' : 'var(--faint)' }}>
                      <ThumbsUp size={12} />
                    </button>
                    <button onClick={() => setRatings(r => ({ ...r, [i]: -1 }))}
                            title={t('rate_down')} aria-label={t('rate_down')}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, lineHeight: 0,
                                     color: ratings[i] === -1 ? 'var(--danger)' : 'var(--faint)' }}>
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                )}
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
                  }}>{t('appointment')}</button>
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
                    <label style={{ fontSize: 11, fontWeight: 700, color: mutedText }}>{t('lead_' + f)}</label>
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
                {leadErr && <div style={{ fontSize: 11.5, color: '#c0392b' }}>{t('lead_invalid_email')}</div>}
                <button onClick={submitLead} style={{
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 9, borderRadius: 99,
                  border: 'none', cursor: 'pointer', background: brand, color: '#fff', marginTop: 4,
                }}>{t('send')}</button>
              </div>
            )}
            {(live || (aiMode && mode !== 'ai')) && !typing && (
              <button onClick={backToTree} style={{
                alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600, padding: '5px 10px',
                borderRadius: 99, border: '1px solid #d8dedc', background: '#fff', color: '#5f7873', cursor: 'pointer',
              }}>{t('back_to_menu')}</button>
            )}
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${lineBorder}`, padding: 10, display: 'flex', gap: 8, background: panelBg }}>
            <input
              value={input} disabled={inputDisabled}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAI()}
              placeholder={live ? t('placeholder_advisor') : inputDisabled ? t('placeholder_pick') : (d.placeholder || t('placeholder'))}
              style={{
                flex: 1, fontFamily: 'inherit', fontSize: 13.5, padding: '10px 13px', borderRadius: 99,
                border: `1px solid ${inputBorder}`, outline: 'none',
                background: inputDisabled ? (dark ? '#0c1311' : '#f4f6f5') : inputBg,
                color: botText, minWidth: 0, boxShadow: 'none',
              }} />
            <button onClick={sendAI} disabled={inputDisabled || !input.trim()} aria-label={t('send')} style={{
              width: 40, height: 40, borderRadius: 99, border: 'none', cursor: inputDisabled ? 'default' : 'pointer',
              background: inputDisabled || !input.trim() ? '#e3e8e6' : brand, color: '#fff',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.6 21.8 12 3.4 3.4l.01 6.6L15 12 3.41 14z" /></svg>
            </button>
          </div>

          {d.poweredBy !== false && (
            <div style={{ textAlign: 'center', fontSize: 10, color: dark ? '#6b7a76' : '#9aa7a3', padding: '0 0 7px', background: panelBg }}>
              {t('powered_by')} <span style={{ fontWeight: 700, color: '#0d9488' }}>Kertios Chat</span>
            </div>
          )}

          {/* Overlay rendez-vous simulé : pas de vraie iframe Calendly dans le
              dashboard — le widget réel embarque le calendrier (hôtes whitelistés) */}
          {overlay && (
            <div style={{ position: 'absolute', inset: 0, background: panelBg, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
              <div style={{ background: bg, color: '#fff', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{t('appointment_title')}</span>
                <button onClick={() => setOverlay(null)} aria-label={t('close')} style={{
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
                }}>{t('open_new_tab')}</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulle — launcherText non vide et fermée : pilule [icône + libellé] ;
          ouverte : redevient un rond avec la croix (comportement widget.js) */}
      <button onClick={() => setOpen(o => !o)} aria-label={t('open_chat')} style={{
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
