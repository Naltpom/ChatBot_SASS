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
import { FONT_STACKS, clampInt, leadFieldsOf, safeHex, TEXT_SCALE, nowHHMM } from './widget-preview/shared'
import type { Msg, LeadSim, PreviewStyle } from './widget-preview/shared'

// Sérialisation LOGIQUE du tree pour la dépendance du reset : on OMET node.pos
// (position d'éditeur, purement visuelle). Sans ça, déplacer un nœud dans
// l'éditeur de workflow re-déclencherait le reset de la conversation simulée.
function treeLogicSig(tree: Tree): string {
  const t = tree && typeof tree === 'object' ? tree : {}
  const nodes = t.nodes || {}
  const logical: Record<string, Omit<TreeNode, 'pos'>> = {}
  for (const id of Object.keys(nodes)) {
    // On retire node.pos ET option.bend (purement visuels/éditeur) : les déplacer
    // ou plier une flèche ne doit PAS réinitialiser la conversation simulée.
    const { pos: _pos, options, ...rest } = nodes[id]
    logical[id] = options
      ? { ...rest, options: options.map(({ bend: _b, ...o }) => o) }
      : rest
  }
  return JSON.stringify({ start: t.start, nodes: logical })
}

// Dictionnaire UI miroir de I18N (widget/widget.js) pour les clés réellement
// rendues par l'aperçu. Les valeurs FR sont les chaînes historiques À L'OCTET
// (contrat e2e en défaut fr), les EN celles de widget.js — toute divergence
// avec widget.js est un bug de parité.
const PREVIEW_I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    online_tree: 'En ligne · Menu guidé',
    online_ai: 'En ligne · Mode IA',
    online: 'En ligne',
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
    online: 'Online',
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
  // Côté d'affichage de la DÉMO seulement (override de design.position), pour
  // pousser l'aperçu hors des contrôles pendant l'édition. N'affecte PAS la
  // position réelle du widget (qui reste design.position).
  positionOverride?: 'left' | 'right'
}

const AI_PREVIEW_REPLIES = [
  "Bonne question ! (réponse IA simulée pour l'aperçu — le vrai widget interroge votre modèle configuré)",
  "Bien sûr ! Dans le widget en production, cette réponse viendrait de l'IA avec le contexte de la page visitée.",
  "Voici un exemple de réponse IA. Les réponses arbre, elles, sont gratuites et illimitées.",
]

export default function WidgetPreview({ design, mode, tree, botName, defaultOpen = true, positionOverride }: Props) {
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
  // Côté du lanceur/panneau : override de démo prioritaire, sinon design.position.
  const pos = positionOverride || (d.position === 'left' ? 'left' : 'right')
  const side = pos === 'left' ? { left: ox } : { right: ox }
  const dark = d.darkMode === true
  // headerStyle : soft = surface claire ; solid (défaut) / gradient = `bg` (brandBg,
  // dégradé si secondaryColor, sinon couleur pleine). solid et gradient coïncident
  // car brandBg produit DÉJÀ le dégradé de marque (rendu actuel à l'octet).
  const soft = d.headerStyle === 'soft'
  const square = d.bubbleStyle === 'square'
  const compact = d.density === 'compact'
  const launcherText = (typeof d.launcherText === 'string' ? d.launcherText : '').slice(0, 40).trim()
  // --- Refonte Apparence (défauts = rendu actuel à l'octet) ---
  // windowWidth : largeur du panneau. Défaut = 338 (valeur HARDCODÉE actuelle du
  // widget) pour ne RIEN changer aux widgets existants ; clamp [300,560].
  const windowWidth = clampInt(d.windowWidth, 300, 560, 338)
  // windowHeight : null/absent = auto (selon densité, = hauteur historique) ; sinon borné.
  const windowHeight = clampInt(d.windowHeight, 360, 720, compact ? 420 : 460)
  const headerAvatar = d.headerAvatar !== false   // défaut true (affiché, comme actuellement)
  const headerStatus = d.headerStatus === true     // défaut false (pas de ligne de statut)
  const statusLabel = (typeof d.statusLabel === 'string' ? d.statusLabel : '').slice(0, 60).trim()
  const scale = TEXT_SCALE[d.textScale || 'md'] || 1
  const timestamps = d.timestamps === true
  const tail = d.bubbleTail !== false              // défaut true (ergot asymétrique actuel)
  // openAnimation : zoom (défaut, = ouverture actuelle) | fade | slide | pop | flip.
  const openAnim = d.openAnimation === 'fade' ? 'kcOpenFade .22s ease both'
    : d.openAnimation === 'slide' ? 'kcOpenSlide .26s ease both'
    : d.openAnimation === 'pop' ? 'kcOpenPop .3s ease both'
    : d.openAnimation === 'flip' ? 'kcOpenFlip .3s ease both'
    : 'kcOpenZoom .22s cubic-bezier(.2,.8,.3,1.1) both'
  // accentColor : null/invalide -> couleur de marque (rendu actuel). Sinon hex validé.
  const accent = safeHex(d.accentColor, brand)
  // chatBg : plain (défaut, fond solide actuel) | soft (léger dégradé teinté) | pattern (pointillés discrets).
  const chatBg = d.chatBg === 'soft' || d.chatBg === 'pattern' ? d.chatBg : 'plain'
  // shadow : intensité d'ombre [0,3], défaut 2 (= ombre actuelle).
  const shadowLvl = clampInt(d.shadow, 0, 3, 2)
  const optBtn = d.quickReplyStyle === 'button'
  const sendColored = d.sendStyle === 'colored'
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
  // En-tête : soft = surface claire/sombre ; sinon `bg` (brandBg) = dégradé si
  // secondaryColor définie, couleur pleine sinon. C'est le RENDU ACTUEL à l'octet
  // (le header solide utilisait déjà brandBg), donc le défaut reste inchangé.
  const headBg = soft ? panelBg : bg
  // Fond de la zone de conversation (chatBg). plain = fond solide actuel ;
  // soft = léger dégradé vertical teinté de marque ; pattern = pointillés discrets.
  // Doit respecter la palette sombre.
  const tint = dark ? 'rgba(255,255,255,.04)' : `${brand}0d`   // ~5% de marque
  const dotColor = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)'
  const msgsBgStyle: React.CSSProperties =
    chatBg === 'soft'
      ? { background: `linear-gradient(180deg, ${tint}, ${msgsBg})` }
      : chatBg === 'pattern'
        ? { background: msgsBg, backgroundImage: `radial-gradient(${dotColor} 1.3px, transparent 1.3px)`, backgroundSize: '14px 14px' }
        : { background: msgsBg }
  // Ombre de la fenêtre selon shadow [0,3] (2 = ombre actuelle, à l'octet).
  const PANEL_SHADOW = ['none',
    '0 8px 26px rgba(10,30,25,.12)',
    '0 18px 60px rgba(10,30,25,.22), 0 2px 8px rgba(10,30,25,.08)',
    '0 26px 80px rgba(10,30,25,.34), 0 4px 14px rgba(10,30,25,.14)'][shadowLvl]

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

  // Son à la réception (clé sound) — bip court synthétisé via WebAudio, sans
  // asset. No-op si désactivé, et toujours sous try/catch (politique d'autoplay,
  // contexte indisponible…) : ne doit JAMAIS bloquer le rendu de l'aperçu.
  const audioCtx = useRef<AudioContext | null>(null)
  function playPing() {
    if (d.sound !== true) return
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      const ctx = audioCtx.current || (audioCtx.current = new Ctx())
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.2)
    } catch { /* autoplay/contexte indisponible : on ignore (parité visuelle seule) */ }
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
  }, [mode, lang, treeLogicSig(tree), d.welcomeMessage])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, typing, options])

  // Suit le scroll pendant le révélé progressif d'une bulle (le texte grandit
  // sans changer la référence `msgs`, donc l'effet ci-dessus ne se redéclenche pas).
  function scrollDown() {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }

  function botSay(text: string, opts: { label: string; next: string }[] | null, delay = 650, ai = false,
                  extras?: { appt?: string | null; lead?: LeadSim | null }) {
    setTyping(true)
    setOptions([])
    setAppt(null)
    setLead(null)
    schedule(() => {
      setTyping(false)
      // animate : révélé progressif (parité typeInto de widget.js) — réponse bot
      // issue d'une interaction, par opposition au message d'accueil/reset.
      setMsgs(m => [...m, { from: 'bot', text, ai, animate: true }])
      playPing()
      if (opts) setOptions(opts)
      setAppt(extras?.appt || null)
      if (extras?.lead) {
        setLead(extras.lead)
        setLeadVals({})
        setLeadErr(false)
      }
    }, delay)
  }

  // Rendu d'un nœud arbre (lead / appointment-https / défaut) via botSay, au
  // délai voulu. Partagé par pick (delay 700) et backToTree (root, delay 450) ;
  // les cas __ai__ et handoff restent gérés à part (logique propre).
  function enterNode(node: TreeNode, delay: number) {
    // Parité widget.js (renderResponse) : mêmes clés type / url / fields
    if (node.type === 'lead') {
      botSay(msgOf(node), null, delay, false,
             { lead: { fields: leadFieldsOf(node.fields), after: node.options || [] } })
      return
    }
    if (node.type === 'appointment' && /^https:\/\//.test(node.url || '')) {
      botSay(msgOf(node), node.options || [], delay, false, { appt: node.url })
      return
    }
    botSay(msgOf(node), node.options || [], delay)
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
          from: 'bot', advisor: true, animate: true,
          text: lang === 'en' ? '(Preview) A human advisor would reply here.' : '(Aperçu) Un conseiller humain vous répondrait ici.',
        }])
        playPing()
      }, 760 + 1600)
      return
    }
    enterNode(node, 700)
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
      setMsgs(m => [...m, { from: 'bot', text: AI_PREVIEW_REPLIES[aiIdx % AI_PREVIEW_REPLIES.length], ai: true, animate: true }])
      playPing()
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
    enterNode(nodeOf(start), 450)
  }

  const inputDisabled = live ? false : !aiMode
  const r14 = Math.min(R, 14)

  // Tokens visuels résolus une fois, passés aux sous-composants présentationnels.
  const st: PreviewStyle = {
    brand, bg, r14, compact, square, dark,
    botBg, botBorder, botText, inputBg, inputBorder, mutedText, panelBg, anim,
    accent, scale, tail, optBtn, timestamps, ts: nowHHMM(),
  }

  // Style des boutons d'option / réponse rapide (parité .kc-opt) : couleur = accent
  // (accentColor ou marque). quickReplyStyle button -> rectangle ~10px, pleine
  // largeur, texte centré ; pill (défaut) -> chip arrondie 99 qui s'enroule.
  const optStyle: React.CSSProperties = {
    fontSize: compact ? 11.5 : 12.5, fontWeight: 600, padding: compact ? '6px 10px' : '8px 12px',
    whiteSpace: optBtn ? 'normal' : 'nowrap',
    borderRadius: optBtn ? 10 : (square ? 10 : 99),
    border: `1.5px solid ${accent}`, background: '#fff', color: accent, cursor: 'pointer',
    ...(optBtn ? { width: '100%', textAlign: 'center' as const } : {}),
  }

  return (
    <div style={{ fontFamily: font }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: bubblePx + oy + 12, ...side, width: windowWidth, maxWidth: 'calc(100% - 36px)',
          height: windowHeight, maxHeight: `calc(100% - ${bubblePx + oy + 34}px)`,
          background: panelBg, borderRadius: R, boxShadow: PANEL_SHADOW,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 40,
          border: dark ? '1px solid #233330' : '1px solid rgba(0,0,0,.06)',
          animation: openAnim, transformOrigin: 'bottom ' + (('left' in side) ? 'left' : 'right'),
        }}>
          {/* Header — solid/gradient : `bg` (brandBg, dégradé ou couleur pleine) ;
              soft : surface claire (ou sombre). headerAvatar masque l'icône si false. */}
          <div style={{
            background: headBg, color: headText, padding: '13px 15px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: soft ? `1px solid ${lineBorder}` : 'none',
          }}>
            {headerAvatar && (
              <div style={{ width: 34, height: 34, borderRadius: 10, background: soft ? bg : 'rgba(255,255,255,.18)', color: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 34 : 19} avatarImg={d.avatarImage} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2 }}>{d.title || botName}</div>
              {/* Sous-titre : headerStatus ON -> libellé de statut (statusLabel ou
                  « En ligne » localisé) ; OFF -> statut de mode historique (inchangé). */}
              <div style={{ fontSize: 11, opacity: .85, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 9, background: '#7CF5C8', display: 'inline-block' }} />
                {headerStatus
                  ? (live ? t('advisor_online') : (statusLabel || t('online')))
                  : (live ? t('advisor_online') : t(aiMode ? 'online_ai' : 'online_tree'))}
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

          {/* Messages — fond selon chatBg (plain | soft | pattern) */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? 10 : '14px 13px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 9, ...msgsBgStyle }}>
            {msgs.map((m, i) => (
              <PreviewBubble key={i} m={m} i={i} st={st} t={t}
                             rating={ratings[i]}
                             onRate={(idx, v) => setRatings(r => ({ ...r, [idx]: v }))}
                             onReveal={scrollDown} />
            ))}
            {typing && <PreviewTyping st={st} />}
            {!typing && (options.length > 0 || appt) && (
              // quickReplyStyle : pill (défaut) = chips arrondies qui s'enroulent ;
              // button = boutons rectangulaires empilés, pleine largeur.
              <div style={optBtn
                ? { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, alignItems: 'stretch' }
                : { display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 2 }}>
                {appt && (
                  <button onClick={() => setOverlay(appt)} style={optStyle}>{t('appointment')}</button>
                )}
                {options.map((o, i) => (
                  // Clé = identité de l'option (cible + libellé) plutôt que l'index,
                  // suffixée par i pour rester unique si deux options coïncident.
                  <button key={`${o.next}|${o.label}|${i}`} onClick={() => pick(o)} style={optStyle}>{o.label}</button>
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
              // accentColor : la bordure de focus passe sur l'accent (parité widget.js).
              onFocus={e => { e.currentTarget.style.borderColor = accent }}
              onBlur={e => { e.currentTarget.style.borderColor = inputBorder }}
              placeholder={live ? t('placeholder_advisor') : inputDisabled ? t('placeholder_pick') : (d.placeholder || t('placeholder'))}
              style={{
                flex: 1, fontFamily: 'inherit', fontSize: 13.5, padding: '10px 13px', borderRadius: 99,
                border: `1px solid ${inputBorder}`, outline: 'none',
                background: inputDisabled ? (dark ? '#0c1311' : '#f4f6f5') : inputBg,
                color: botText, minWidth: 0, boxShadow: 'none',
              }} />
            {/* sendStyle : icon (défaut) = bouton actuel (rempli marque à l'actif) ;
                colored = bouton rempli accent, glyphe blanc, toujours coloré. */}
            <button onClick={sendAI} disabled={inputDisabled || !input.trim()} aria-label={t('send')} style={{
              width: 40, height: 40, borderRadius: 99, border: 'none', cursor: inputDisabled ? 'default' : 'pointer',
              background: inputDisabled || !input.trim() ? (sendColored ? `${accent}55` : '#e3e8e6') : (sendColored ? accent : brand),
              color: '#fff',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              boxShadow: sendColored && !(inputDisabled || !input.trim()) ? `0 2px 8px ${accent}40` : 'none',
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
