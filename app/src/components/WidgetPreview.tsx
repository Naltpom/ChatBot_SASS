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
import type { DesignJson, Tree, TreeNode } from '../types/bot'
import { BubbleIcon, brandBg } from '../ui'
import PreviewBubble from './widget-preview/PreviewBubble'
import PreviewTyping from './widget-preview/PreviewTyping'
import PreviewLeadForm from './widget-preview/PreviewLeadForm'
import PreviewAppointmentOverlay from './widget-preview/PreviewAppointmentOverlay'
import PreviewLauncher from './widget-preview/PreviewLauncher'
import { FONT_STACKS, clampInt, leadFieldsOf } from './widget-preview/shared'
import type { Msg, LeadSim, PreviewStyle } from './widget-preview/shared'

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
  design: DesignJson
  mode: string             // tree | ai | hybrid
  tree: Tree
  botName: string
  defaultOpen?: boolean    // false : bulle fermée au départ (démo landing)
}

const AI_PREVIEW_REPLIES = [
  "Bonne question ! (réponse IA simulée pour l'aperçu — le vrai widget interroge votre modèle configuré)",
  "Bien sûr ! Dans le widget en production, cette réponse viendrait de l'IA avec le contexte de la page visitée.",
  "Voici un exemple de réponse IA. Les réponses arbre, elles, sont gratuites et illimitées.",
]

export default function WidgetPreview({ design, mode, tree, botName, defaultOpen = true }: Props) {
  const d = design || {}
  const brand = d.primaryColor || '#0d9488'
  const bg = brandBg(d)
  const R = typeof d.borderRadius === 'number' ? d.borderRadius : 16
  const bubblePx = d.size === 'sm' ? 48 : d.size === 'lg' ? 68 : 58
  const anim = d.loadingAnimation || 'dots'
  // Personnalisation étendue — mêmes défauts/whitelists que widget.js (css(d))
  const font = FONT_STACKS[d.font || 'system'] || FONT_STACKS.system
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

  function nodeOf(id: string): TreeNode {
    return nodes[id] || nodes[start] || { message: 'Bonjour !', options: [] }
  }
  // message d'un nœud, jamais undefined (parité widget.js : '' rend une bulle vide).
  const msgOf = (n: TreeNode): string => n.message || ''

  // reset à chaque changement structurel
  useEffect(() => {
    const isIA = mode === 'ai'
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
      setMsgs([{ from: 'bot', text: msgOf(root) }])
      if (root.type === 'lead') {
        setOptions([])
        setLead({ fields: leadFieldsOf(root.fields), after: root.options || [] })
      } else {
        setOptions(root.options || [])
        if (root.type === 'appointment' && /^https:\/\//.test(root.url || '')) setAppt(root.url || null)
      }
    }
    setTyping(false)
    // Cleanup : annule les bulles différées avant chaque re-reset ET au
    // démontage (sinon une réponse « Conseiller » différée resurgirait dans
    // l'aperçu fraîchement réinitialisé)
    return clearPendingTimers
    // d.welcomeMessage : utilisé par la branche IA (1er message). Sans cette dép,
    // l'aperçu ne se rafraîchissait pas à l'édition du message d'accueil.
  }, [mode, lang, JSON.stringify(tree), d.welcomeMessage])

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
      if (mode === 'tree') {
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
      botSay(msgOf(node), null, 700)
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
      botSay(msgOf(node), null, 700, false,
             { lead: { fields: leadFieldsOf(node.fields), after: node.options || [] } })
      return
    }
    if (node.type === 'appointment' && /^https:\/\//.test(node.url || '')) {
      botSay(msgOf(node), node.options || [], 700, false, { appt: node.url })
      return
    }
    botSay(msgOf(node), node.options || [], 700)
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
      botSay(msgOf(root), null, 450, false,
             { lead: { fields: leadFieldsOf(root.fields), after: root.options || [] } })
      return
    }
    if (root.type === 'appointment' && /^https:\/\//.test(root.url || '')) {
      botSay(msgOf(root), root.options || [], 450, false, { appt: root.url })
      return
    }
    botSay(msgOf(root), root.options || [], 450)
  }

  const inputDisabled = live ? false : !aiMode
  const r14 = Math.min(R, 14)

  // Tokens visuels résolus une fois, passés aux sous-composants présentationnels.
  const st: PreviewStyle = {
    brand, bg, r14, compact, square, dark,
    botBg, botBorder, botText, inputBg, inputBorder, mutedText, panelBg, anim,
  }

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

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? 10 : '14px 13px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 9, background: msgsBg }}>
            {msgs.map((m, i) => (
              <PreviewBubble key={i} m={m} i={i} st={st} t={t}
                             rating={ratings[i]}
                             onRate={(idx, v) => setRatings(r => ({ ...r, [idx]: v }))} />
            ))}
            {typing && <PreviewTyping st={st} />}
            {!typing && (options.length > 0 || appt) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 2 }}>
                {appt && (
                  <button onClick={() => setOverlay(appt)} style={{
                    fontSize: compact ? 11.5 : 12.5, fontWeight: 600, padding: compact ? '6px 10px' : '8px 12px', whiteSpace: 'nowrap',
                    borderRadius: square ? 10 : 99, border: `1.5px solid ${brand}`, background: '#fff', color: brand, cursor: 'pointer',
                  }}>{t('appointment')}</button>
                )}
                {options.map((o, i) => (
                  // Clé = identité de l'option (cible + libellé) plutôt que l'index,
                  // suffixée par i pour rester unique si deux options coïncident.
                  <button key={`${o.next}|${o.label}|${i}`} onClick={() => pick(o)} style={{
                    fontSize: compact ? 11.5 : 12.5, fontWeight: 600, padding: compact ? '6px 10px' : '8px 12px', whiteSpace: 'nowrap',
                    borderRadius: square ? 10 : 99, border: `1.5px solid ${brand}`, background: '#fff', color: brand, cursor: 'pointer',
                  }}>{o.label}</button>
                ))}
              </div>
            )}
            {!typing && lead && (
              <PreviewLeadForm lead={lead} vals={leadVals} err={leadErr} st={st} t={t}
                               onChange={(f, val) => setLeadVals(v => ({ ...v, [f]: val }))}
                               onSubmit={submitLead} />
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
              {t('powered_by')} <span style={{ fontWeight: 700, color: '#0d9488' }}>Chapote</span>
            </div>
          )}

          {overlay && (
            <PreviewAppointmentOverlay url={overlay} st={st} t={t} onClose={() => setOverlay(null)} />
          )}
        </div>
      )}

      <PreviewLauncher d={d} bg={bg} bubblePx={bubblePx} oy={oy} side={side}
                       launcherText={launcherText} open={open} t={t}
                       onToggle={() => setOpen(o => !o)} />
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
