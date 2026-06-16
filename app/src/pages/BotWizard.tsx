// Wizard de création — expérience conversationnelle Chapote (BotCreate.dc.html).
// 5 étapes : CHAT (le bot interroge l'utilisateur) → PRESET (récap des
// capacités, tout inclus/gratuit) → APPARENCE (contrôles + widget live fixe) →
// ARBRE (composant PARTAGÉ TreeFlow) → DONE (bot créé).
//
// SOURCE UNIQUE de l'arbre : à l'entrée de l'étape ARBRE, les réponses du chat
// produisent UN vrai tree_json (rawBranches → buildTree) stocké dans `treeJson`,
// puis édité via <TreeFlow> — le MÊME composant que l'onglet « Arbre » de
// l'éditeur, donc rendu strictement identique. La création finale envoie CE
// tree_json édité (plus de double source brouillon/arbre).
//
// Câblage réel : à l'étape ARBRE, « Créer mon chatbot » crée vraiment le bot
// via l'API existante (POST /api/orgs/{id}/bots puis PATCH /api/bots/{id}),
// avec ce tree_json et un design_json valide. Le mode "tree" (aucune IA voulue)
// masque l'option IA dans TreeFlow (allowAI=false).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { MODEL_OPTIONS } from '../botConstants'
import TreeFlow from '../components/TreeFlow'

// ---------------------------------------------------------------------------
// Palette Chapote (alignée styles.css / charte)
const NAVY = '#1C3F5C'
const MINT = '#2F9E79'
const CORAL = '#E86A5F'
const INK = '#1E2A32'
const MUT = '#6B7B8D'
const FAINT = '#9AA7B4'
const BORDER = '#E8ECF0'

// ---------------------------------------------------------------------------
// Questions du chat (portées de BotCreate.dc.html, Q())
type QType = 'single' | 'multi'
interface Question { key: string; type: QType; q: string; opts: [string, string][] }
const QUESTIONS: Question[] = [
  {
    key: 'sector', type: 'single',
    q: "Bonjour 👋 Je vais construire votre assistant sur-mesure. Quel est votre domaine d'activité ?",
    opts: [['ecom', 'E-commerce'], ['saas', 'SaaS / Logiciel'], ['service', 'Service / Conseil'], ['other', 'Autre']],
  },
  {
    key: 'goals', type: 'multi',
    q: 'Que doit-il faire en priorité ? Choisissez tout ce qui compte.',
    opts: [['faq', 'Répondre aux questions fréquentes'], ['orders', 'Suivre les commandes'], ['leads', 'Capturer des contacts'], ['rdv', 'Prendre des rendez-vous']],
  },
  {
    key: 'fallback', type: 'single',
    q: "Quand l'arbre guidé ne suffit pas, que préférez-vous ?",
    opts: [['ia', "Laisser l'IA répondre"], ['human', 'Passer à un conseiller'], ['both', 'Les deux : IA puis humain']],
  },
]
function optLabel(key: string, v: string): string {
  const q = QUESTIONS.find(x => x.key === key)
  const o = q && q.opts.find(p => p[0] === v)
  return o ? o[1] : v
}

// ---------------------------------------------------------------------------
// Brouillon d'arbre éditable (modèle interne du wizard, façon BotCreate.dc.html)
interface SubBranch { answer: string; type: string; title: string }
interface Branch { answer: string; type: string; title: string; subs: SubBranch[] }

// Construit l'ébauche d'arbre à partir des réponses du chat.
function rawBranches(answers: Record<string, string>, goals: string[]): Branch[] {
  const ai = answers.fallback === 'ia' || answers.fallback === 'both'
  const human = answers.fallback === 'human' || answers.fallback === 'both'
  const out: Branch[] = []
  if (goals.includes('orders')) out.push({
    answer: 'Suivre ma commande', type: 'q', title: 'Avez-vous votre n° ?',
    subs: [
      { answer: 'Oui', type: 'act', title: 'Vérifier la commande' },
      { answer: 'Non', type: ai ? 'ia' : 'hum', title: ai ? "L'IA recherche" : 'Un conseiller' },
    ],
  })
  if (goals.includes('faq')) out.push({ answer: 'Une question', type: ai ? 'ia' : 'q', title: ai ? 'Réponse IA' : 'FAQ guidée', subs: [] })
  if (goals.includes('rdv')) out.push({ answer: 'Prendre RDV', type: 'act', title: 'Ouvrir le calendrier', subs: [] })
  if (goals.includes('leads')) out.push({ answer: 'Être recontacté', type: 'act', title: 'Capturer le contact', subs: [] })
  out.push({
    answer: 'Autre / parler', type: human ? 'hum' : (ai ? 'ia' : 'q'),
    title: human ? 'Relais conseiller' : (ai ? 'IA plafonnée' : 'Reformuler'), subs: [],
  })
  if (out.length < 2) out.unshift({ answer: 'Bonjour', type: 'q', title: 'Comment aider ?', subs: [] })
  return out
}

// ---------------------------------------------------------------------------
// Mapping brouillon -> tree_json réel ({ start, nodes: { id: { message,
// options:[{label,next}], type?, url?, fields? } } }, "__ai__" = bascule IA).
// allowAI=false (mode tree pur) -> les destinations IA deviennent un message.
function slug(s: string, fallback: string): string {
  const v = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  return v || fallback
}

function buildTree(branches: Branch[], welcome: string, allowAI: boolean): Record<string, any> {
  const nodes: Record<string, any> = {}
  const used = new Set<string>(['root'])
  const uniq = (base: string): string => {
    let id = base, n = 2
    while (used.has(id)) { id = `${base}_${n++}` }
    used.add(id)
    return id
  }

  // Crée le nœud cible d'une branche/sous-branche selon son type.
  function makeNode(b: { answer: string; type: string; title: string }, parentBackTo: string): string {
    const id = uniq(slug(b.answer, 'node'))
    const back = { label: '↩ Retour au menu', next: parentBackTo }
    if (b.type === 'ia') {
      if (allowAI) {
        // Branche IA : option qui bascule directement sur l'IA depuis l'accueil.
        // (géré au niveau de l'option racine, pas en nœud — voir plus bas)
        nodes[id] = { message: b.title || 'Posez votre question, je vous réponds.', options: [back] }
      } else {
        nodes[id] = { message: b.title || 'Reformulez votre demande et nous vous aidons.', options: [back] }
      }
    } else if (b.type === 'hum') {
      nodes[id] = { message: b.title || 'Je vous mets en relation avec un conseiller.', type: 'handoff', options: [back] }
    } else if (b.type === 'act') {
      const t = (b.title || '').toLowerCase()
      if (t.includes('calend') || t.includes('rendez') || t.includes('rdv')) {
        // Prise de RDV -> nœud appointment (URL Calendly à compléter par le client)
        nodes[id] = {
          message: b.title || 'Choisissez un créneau dans notre agenda.',
          type: 'appointment', url: 'https://calendly.com/votre-compte/rendez-vous',
          options: [back],
        }
      } else {
        // Autres actions (capture contact, vérif commande…) -> formulaire lead
        nodes[id] = {
          message: b.title || 'Laissez-nous vos coordonnées, nous revenons vers vous.',
          type: 'lead', fields: ['email', 'name', 'message'],
          options: [back],
        }
      }
    } else {
      // Question : nœud message simple.
      nodes[id] = { message: b.title || b.answer, options: [back] }
    }
    return id
  }

  const rootOptions: { label: string; next: string }[] = []
  for (const b of branches) {
    const label = (b.answer || 'Choix').slice(0, 60)
    if (b.type === 'ia' && allowAI) {
      // Bascule IA directe depuis l'accueil.
      rootOptions.push({ label, next: '__ai__' })
      continue
    }
    const targetId = makeNode(b, 'root')
    rootOptions.push({ label, next: targetId })
    // Sous-branches -> options du nœud cible.
    if (b.subs.length && nodes[targetId] && !nodes[targetId].type) {
      const subOpts: { label: string; next: string }[] = []
      for (const s of b.subs) {
        if (s.type === 'ia' && allowAI) {
          subOpts.push({ label: (s.answer || 'Choix').slice(0, 60), next: '__ai__' })
          continue
        }
        const sid = makeNode(s, targetId)
        subOpts.push({ label: (s.answer || 'Choix').slice(0, 60), next: sid })
      }
      nodes[targetId].options = [...subOpts, { label: '↩ Retour au menu', next: 'root' }]
    }
  }

  if (!rootOptions.length) rootOptions.push({ label: 'Nos services', next: '__ai__' })
  nodes.root = {
    message: welcome || 'Bonjour ! Comment puis-je vous aider ?',
    options: allowAI ? rootOptions : rootOptions.filter(o => o.next !== '__ai__'),
  }
  return { start: 'root', nodes }
}

// ---------------------------------------------------------------------------
// Apparence : état interne -> design_json valide (clés du backend).
const RADIUS_MAP: Record<string, number> = { sm: 10, md: 16, lg: 24 }
const ICON_MAP: Record<string, string> = { chat: 'chat', bot: 'chat', spark: 'spark', head: 'help' }
const ICON_GLYPH: Record<string, string> = { chat: '💬', bot: '🤖', spark: '✨', head: '🎧' }

interface Look {
  color: string; color2: string | null; gradient: boolean; radius: string; fontSize: string
  icon: string; logoUrl: string; dark: boolean; typing: boolean; big: boolean; position: string; welcome: string
}
const DEFAULT_LOOK: Look = {
  color: NAVY, color2: MINT, gradient: false, radius: 'md', fontSize: 'md', icon: 'chat',
  logoUrl: '', dark: false, typing: true, big: false, position: 'br',
  welcome: 'Bonjour 👋 Comment puis-je vous aider ?',
}

function buildDesign(look: Look): Record<string, any> {
  return {
    primaryColor: look.color,
    secondaryColor: look.gradient ? (look.color2 || MINT) : null,
    position: look.position === 'bl' ? 'left' : 'right',
    size: look.big ? 'lg' : 'md',
    borderRadius: RADIUS_MAP[look.radius] ?? 16,
    icon: look.logoUrl ? 'image' : (ICON_MAP[look.icon] || 'chat'),
    avatarImage: look.logoUrl || '',
    bordered: false,
    welcomeMessage: look.welcome.trim(),
    placeholder: 'Écrivez votre message…',
    loadingAnimation: 'dots',
    poweredBy: true,
    darkMode: look.dark,
    headerStyle: 'solid',
    bubbleStyle: 'rounded',
    density: 'cozy',
    font: 'system',
    locale: 'fr',
  }
}

// ---------------------------------------------------------------------------
// Icône logo Chapote (en-tête widget + bulles bot)
function ChapoteMark({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
type Step = 'chat' | 'preset' | 'appearance' | 'tree' | 'done'
const STEP_ORDER: Step[] = ['chat', 'preset', 'appearance', 'tree']
const STEP_CAPTION: Record<Step, string> = {
  chat: 'Discussion', preset: 'Proposition', appearance: 'Apparence', tree: 'Arbre', done: 'Terminé',
}

const RANDOM_SWATCHES = ['#1C3F5C', '#2F9E79', '#8C6DFF', '#E86A5F', '#0F766E', '#7C3AED', '#0EA5E9', '#D946A6']
const PRIMARY_SWATCHES = ['#1C3F5C', '#2F9E79', '#8C6DFF', '#E86A5F', '#0F766E', '#7C3AED']
const SECONDARY_SWATCHES = ['#1C3F5C', '#2F9E79', '#8C6DFF', '#E86A5F', '#0F766E', '#7C3AED']

// ---------------------------------------------------------------------------
// Hook responsive (media queries impossibles en style inline) : matchMedia
// + écoute du resize. SSR-safe (window absent -> false au 1er rendu).
function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches : false)
  const [match, setMatch] = useState<boolean>(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const on = () => setMatch(mql.matches)
    on()
    // addEventListener moderne ; addListener en repli (Safari ancien).
    if (mql.addEventListener) mql.addEventListener('change', on)
    else mql.addListener(on)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', on)
      else mql.removeListener(on)
    }
  }, [query])
  return match
}

export default function BotWizard() {
  const { user, activeOrg } = useAuth()
  const navigate = useNavigate()
  // Équipes où l'utilisateur est admin = destinations possibles d'un bot
  // d'équipe (POST /api/orgs/{id}/bots est réservé aux admins).
  const adminOrgs = (user?.organizations || []).filter(o => o.role === 'admin')
  // Destination du bot : 'perso' (POST /api/bots) ou un id d'équipe
  // (POST /api/orgs/{id}/bots). Pré-sélectionne l'équipe active si elle fait
  // partie des équipes admin, sinon « Perso ».
  const [dest, setDest] = useState<'perso' | number>(
    activeOrg && adminOrgs.some(o => o.id === activeOrg.id) ? activeOrg.id : 'perso',
  )
  // Responsive : empilement du contenu en dessous de ~760px (mobile ~360-430px).
  const mobile = useMediaQuery('(max-width: 760px)')

  const [step, setStep] = useState<Step>('chat')
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [goals, setGoals] = useState<string[]>([])
  const [look, setLook] = useState<Look>({ ...DEFAULT_LOOK })
  const [collapsed, setCollapsed] = useState(false)
  // Arbre RÉEL (tree_json) édité via le composant partagé TreeFlow. Construit à
  // l'entrée de l'étape ARBRE depuis les réponses du chat (buildTree). null tant
  // qu'on n'a pas atteint cette étape.
  const [treeJson, setTreeJson] = useState<Record<string, any> | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createdBotId, setCreatedBotId] = useState<number | null>(null)

  // L'IA est câblée si l'utilisateur l'a choisie (tout est gratuit, pas de budget).
  const wantsAI = answers.fallback === 'ia' || answers.fallback === 'both'
  const wantsHuman = answers.fallback === 'human' || answers.fallback === 'both'
  const allowAI = wantsAI
  // Mode réel du bot : hybride si IA voulue, sinon arbre.
  const botMode = wantsAI ? 'hybrid' : 'tree'

  // -------------------------------------------------------------------------
  // Logique du chat
  function answerSingle(key: string, v: string) {
    const a = { ...answers, [key]: v }
    const next = qi + 1
    setAnswers(a)
    if (next >= QUESTIONS.length) setStep('preset')
    else setQi(next)
  }
  function toggleGoal(v: string) {
    setGoals(g => g.includes(v) ? g.filter(x => x !== v) : [...g, v])
  }
  function nextMulti() {
    const next = qi + 1
    if (next >= QUESTIONS.length) setStep('preset')
    else setQi(next)
  }

  // -------------------------------------------------------------------------
  // Capacités activées (récap PRESET — données frontend pures, charte du design).
  // Tout est gratuit : aucune notion de prix/quota.
  const caps = useMemo(() => {
    const list: { icon: string; label: string; desc: string; tint: string }[] = [
      { icon: '🌿', label: 'Arbre guidé illimité', desc: 'Branches & options sans limite', tint: 'rgba(47,158,121,.12)' },
    ]
    if (allowAI) list.push({ icon: '✨', label: 'IA conversationnelle', desc: 'Répond aux questions ouvertes', tint: 'rgba(140,109,255,.12)' })
    if (wantsHuman) list.push({ icon: '💬', label: 'Relais humain', desc: 'Bascule vers un conseiller', tint: 'rgba(232,106,95,.12)' })
    if (goals.includes('leads')) list.push({ icon: '📥', label: 'Capture de contacts', desc: 'Collecte les leads qualifiés', tint: 'rgba(37,99,235,.12)' })
    if (goals.includes('rdv')) list.push({ icon: '📅', label: 'Prise de rendez-vous', desc: 'Intégration calendrier', tint: 'rgba(224,168,46,.14)' })
    return list
  }, [allowAI, wantsHuman, goals])
  const draftBranchCount = useMemo(() => rawBranches(answers, goals).length, [answers, goals])

  // -------------------------------------------------------------------------
  // Entrée dans l'étape ARBRE : on matérialise le tree_json réel à partir des
  // réponses du chat (UNE seule fois), puis TreeFlow l'édite en place.
  function goToTree() {
    if (!treeJson) {
      setTreeJson(buildTree(rawBranches(answers, goals), look.welcome, allowAI))
    }
    setStep('tree')
  }

  // -------------------------------------------------------------------------
  // Apparence
  function patchLook(p: Partial<Look>) { setLook(prev => ({ ...prev, ...p })) }
  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => patchLook({ logoUrl: String(r.result), icon: 'chat' })
    r.readAsDataURL(f)
  }
  function surpriseMe() {
    const p = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
    patchLook({
      color: p(RANDOM_SWATCHES), color2: p(RANDOM_SWATCHES), gradient: Math.random() < 0.5,
      radius: p(['sm', 'md', 'lg']), fontSize: p(['sm', 'md', 'lg']), icon: p(['chat', 'bot', 'spark', 'head']),
      dark: Math.random() < 0.4, typing: Math.random() < 0.75,
    })
  }

  // -------------------------------------------------------------------------
  // Création réelle du bot (étape ARBRE -> DONE)
  async function createBot() {
    setError('')
    setBusy(true)
    try {
      // Source UNIQUE : l'arbre édité dans TreeFlow. Repli sur une construction
      // fraîche si l'étape ARBRE n'a jamais été ouverte (parcours direct improbable).
      const tree = treeJson ?? buildTree(rawBranches(answers, goals), look.welcome, allowAI)
      const design = buildDesign(look)
      const name = sectorName(answers.sector)

      // 1) création du bot (name + mode) — perso (POST /api/bots) ou équipe
      // (POST /api/orgs/{id}/bots) selon la destination choisie.
      const createPath = dest === 'perso' ? '/api/bots' : `/api/orgs/${dest}/bots`
      const bot = await api(createPath, {
        method: 'POST', body: { name, mode: botMode },
      })

      // 2) configuration (design, arbre, modèle IA, captcha)
      const model = MODEL_OPTIONS[1] // Claude Sonnet par défaut
      const body: Record<string, any> = {
        design_json: design,
        tree_json: tree,
        captcha_provider: 'turnstile',
      }
      if (botMode !== 'tree') {
        body.ai_provider = model.provider
        body.ai_model = model.model
        body.api_key_mode = 'managed'
      }
      await api(`/api/bots/${bot.id}`, { method: 'PATCH', body })

      setCreatedBotId(bot.id)
      setStep('done')
    } catch (err: any) {
      setError(err?.message || 'La création a échoué.')
    } finally {
      setBusy(false)
    }
  }

  const si = STEP_ORDER.indexOf(step)
  const cur = qi < QUESTIONS.length ? QUESTIONS[qi] : null
  const poolGoals = cur && cur.type === 'multi' ? cur.opts.filter(o => !goals.includes(o[0])) : []

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', minHeight: '100%', color: INK }}>
      {/* ---- En-tête avec pastilles d'étape ---- */}
      <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(249,249,251,.92)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: mobile ? '11px 16px' : '13px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: mobile ? 10 : 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChapoteMark size={18} />
            </span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Nouveau chatbot</span>
            <span style={{ fontSize: 13, color: FAINT, marginLeft: 6 }}>· {STEP_CAPTION[step]}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {STEP_ORDER.map((s, i) => (
              <span key={s} style={{
                width: 8, height: 8, borderRadius: '50%', transition: 'background .3s',
                background: i < si ? MINT : (i === si ? NAVY : '#D8DEE6'),
              }} />
            ))}
            <button onClick={() => navigate('/app')} style={{ marginLeft: 12, color: FAINT, background: 'none', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Quitter</button>
          </div>
        </div>
      </header>

      {error && (
        <div style={{ maxWidth: 680, margin: '16px auto 0', padding: mobile ? '0 16px' : '0 28px' }}>
          <div style={{ background: 'rgba(232,106,95,.08)', border: `1px solid rgba(232,106,95,.32)`, color: CORAL, borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 600 }}>{error}</div>
        </div>
      )}

      {/* ============================ ÉTAPE 1 : CHAT ============================ */}
      {step === 'chat' && (
        <div style={{ maxWidth: 680, margin: '0 auto', padding: mobile ? '24px 16px 44px' : '40px 28px 60px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Historique + question courante dans UN SEUL tableau : les clés
                (q-${i}) vivent dans le MÊME espace de noms React (une map et un
                élément frère seraient namespacés différemment → remount). Quand on
                répond, la question courante (dernier item) devient un item
                d'historique au MÊME index/clé → React conserve son nœud DOM et ne
                rejoue PAS l'animation d'entrée. Seules la réponse (nouveau nœud) et
                la question suivante s'animent. */}
            {[
              ...QUESTIONS.slice(0, qi).map((q, i) => {
                const lbl = q.type === 'multi'
                  ? (goals.map(v => optLabel('goals', v)).join(', ') || '—')
                  : optLabel(q.key, answers[q.key])
                return (
                  <div key={`q-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <BotBubble text={q.q} />
                    <UserBubble text={lbl} />
                  </div>
                )
              }),
              ...(cur ? [(
                <div key={`q-${qi}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <BotBubble text={cur.q} />
                  {cur.type === 'single' && (
                    <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 2 }}>
                      {cur.opts.map(o => (
                        <ChatChip key={o[0]} fullWidth={mobile} onClick={() => answerSingle(cur.key, o[0])}>{o[1]}</ChatChip>
                      ))}
                    </div>
                  )}
                  {cur.type === 'multi' && (
                    <div style={{ marginTop: 2 }}>
                      {goals.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginBottom: 10 }}>
                          {goals.map(v => (
                            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: MINT, color: '#fff', borderRadius: 999, padding: '8px 12px', fontSize: 13.5, fontWeight: 600 }}>
                              {optLabel('goals', v)}
                              <button onClick={() => toggleGoal(v)} style={{ width: 17, height: 17, border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.25)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end' }}>
                        {poolGoals.map(o => (
                          <ChatChip key={o[0]} fullWidth={mobile} onClick={() => toggleGoal(o[0])}>+ {o[1]}</ChatChip>
                        ))}
                      </div>
                      {goals.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                          <button onClick={nextMulti} style={{ ...primaryBtn, ...(mobile ? { width: '100%' } : null) }}>Continuer →</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )] : []),
            ]}
          </div>
        </div>
      )}

      {/* ============================ ÉTAPE 2 : PRESET ============================ */}
      {step === 'preset' && (
        <div style={{ maxWidth: 680, margin: '0 auto', padding: mobile ? '24px 16px 44px' : '40px 28px 60px', animation: 'cin .35s ease' }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <span style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(47,158,121,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>✨</span>
            <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 30, margin: '16px 0 0', letterSpacing: '-.02em' }}>Voici l'assistant de vos rêves</h1>
            <p style={{ fontSize: 15, color: MUT, margin: '8px 0 0' }}>Construit d'après vos réponses — toutes les capacités sont incluses.</p>
          </div>
          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 20, overflow: 'hidden', boxShadow: '0 18px 50px -28px rgba(28,63,92,.3)' }}>
            {caps.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: i < caps.length - 1 ? '1px solid #F4F6F8' : 'none' }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>{c.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{c.label}</div>
                  <div style={{ fontSize: 13, color: FAINT }}>{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 20px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 13 }}>
            <span style={{ fontSize: 20 }}>🌿</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Une ébauche d'arbre est prête</div>
              <div style={{ fontSize: 13, color: FAINT }}>{draftBranchCount} branches générées — vous les personnaliserez à l'étape suivante.</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 24 }}>
            <button onClick={() => { setStep('chat'); setQi(0) }} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>← Modifier mes réponses</button>
            <button onClick={() => setStep('appearance')} style={{ ...primaryBtnLg, flex: 1, ...(mobile ? { width: '100%' } : null) }}>Personnaliser l'apparence →</button>
          </div>
        </div>
      )}

      {/* ============================ ÉTAPE 3 : APPARENCE ============================ */}
      {step === 'appearance' && (
        <>
          <div style={{ maxWidth: 1000, margin: '0 auto', padding: mobile ? '22px 16px 200px' : '34px 28px 90px', animation: 'cin .35s ease' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: '-.02em' }}>L'apparence de votre widget</h1>
                <p style={{ fontSize: 15, color: MUT, margin: '8px 0 0' }}>Réglez tout — le widget en bas de page se met à jour en direct. Fermez-le, agrandissez-le, testez le mode sombre.</p>
              </div>
              <button onClick={surpriseMe} style={{ background: '#fff', color: '#7C5CE6', border: '1px solid rgba(140,109,255,.4)', borderRadius: 12, padding: '11px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>🎲 Surprends-moi</button>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 18, padding: mobile ? 16 : 24, marginTop: 20, maxWidth: 640 }}>
              <Label>Couleur principale</Label>
              <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
                {PRIMARY_SWATCHES.map(c => (
                  <Swatch key={c} c={c} on={look.color === c} onClick={() => patchLook({ color: c })} size={34} />
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: '16px 18px', marginTop: 20 }}>
                <SegBlock label="Style de fond" value={look.gradient ? 'grad' : 'solid'} opts={[['solid', 'Uni'], ['grad', 'Dégradé']]} onPick={v => patchLook({ gradient: v === 'grad' })} />
                <div>
                  <Label>Couleur secondaire</Label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SECONDARY_SWATCHES.map(c => (
                      <Swatch key={c} c={c} on={look.color2 === c} onClick={() => patchLook({ color2: c })} size={26} />
                    ))}
                  </div>
                </div>
                <SegBlock label="Arrondi" value={look.radius} opts={[['sm', 'Léger'], ['md', 'Moyen'], ['lg', 'Rond']]} onPick={v => patchLook({ radius: v })} />
                <SegBlock label="Taille du texte" value={look.fontSize} opts={[['sm', 'Petit'], ['md', 'Normal'], ['lg', 'Grand']]} onPick={v => patchLook({ fontSize: v })} />
                <SegBlock label="Thème" value={look.dark ? 'dark' : 'light'} opts={[['light', 'Clair'], ['dark', 'Sombre']]} onPick={v => patchLook({ dark: v === 'dark' })} />
                <SegBlock label="Animation d'attente" value={look.typing ? 'on' : 'off'} opts={[['off', 'Sans'], ['on', 'Animée']]} onPick={v => patchLook({ typing: v === 'on' })} />
                <SegBlock label="Taille du chat" value={look.big ? 'b' : 'n'} opts={[['n', 'Standard'], ['b', 'Grand']]} onPick={v => patchLook({ big: v === 'b' })} />
                <SegBlock label="Position" value={look.position} opts={[['bl', 'Bas gauche'], ['br', 'Bas droite']]} onPick={v => patchLook({ position: v })} />
              </div>

              <Label style={{ marginTop: 20 }}>Icône de la bulle</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {(['chat', 'bot', 'spark', 'head'] as const).map(k => (
                  <button key={k} onClick={() => patchLook({ icon: k, logoUrl: '' })} style={{
                    width: 42, height: 42, borderRadius: 12, border: 'none', background: '#F4F6F8', fontSize: 20, cursor: 'pointer',
                    boxShadow: look.icon === k && !look.logoUrl ? `0 0 0 2px #fff,0 0 0 3px ${NAVY}` : 'inset 0 0 0 1px #E2E8F0', transition: 'box-shadow .2s',
                  }}>{ICON_GLYPH[k]}</button>
                ))}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 42, padding: '0 14px', border: `1px ${look.logoUrl ? 'solid' : 'dashed'} ${look.logoUrl ? MINT : '#CBD5DF'}`, borderRadius: 12, fontSize: 13, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
                  🖼️ {look.logoUrl ? 'Image importée' : 'Importer'}
                  <input type="file" accept="image/*" onChange={onLogo} style={{ display: 'none' }} />
                </label>
              </div>

              <Label style={{ marginTop: 20 }}>Message d'accueil</Label>
              <input type="text" value={look.welcome} onChange={e => patchLook({ welcome: e.target.value })}
                     style={{ width: '100%', height: 44, border: '1px solid #D8DEE6', borderRadius: 12, padding: '0 14px', fontSize: 14.5 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 24, maxWidth: 640 }}>
              <button onClick={() => setStep('preset')} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>← Retour</button>
              <button onClick={goToTree} style={{ ...primaryBtnLg, flex: 1, ...(mobile ? { width: '100%' } : null) }}>Continuer vers l'arbre →</button>
            </div>
          </div>

          {/* widget LIVE fixé en bas de page (réduit + repliable en mobile) */}
          <LiveWidget look={look} mobile={mobile} collapsed={collapsed} onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)} />
        </>
      )}

      {/* ============================ ÉTAPE 4 : ARBRE ============================ */}
      {step === 'tree' && (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: mobile ? '22px 16px 56px' : '34px 28px 70px', animation: 'cin .35s ease' }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: '-.02em' }}>Votre arbre de conversation</h1>
            <p style={{ fontSize: 15, color: MUT, margin: '8px 0 0', maxWidth: 560 }}>Chaque réponse route vers une autre question, l'IA, un conseiller ou une action. Personnalisez tout ci-dessous — c'est exactement l'arbre que vous retrouverez dans l'éditeur.</p>
          </div>

          {/* Arbre partagé : MÊME composant que l'onglet « Arbre » de l'éditeur.
              treeJson est la source unique envoyée à la création. */}
          <TreeFlow
            tree={treeJson ?? buildTree(rawBranches(answers, goals), look.welcome, allowAI)}
            onChange={setTreeJson}
            allowAI={allowAI}
          />

          {/* Destination du bot : perso (par défaut) ou une équipe où je suis
              admin. Masqué si l'utilisateur n'a aucune équipe admin (perso seul). */}
          {adminOrgs.length > 0 && (
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 20px', marginTop: 22 }}>
              <Label>Où créer ce chatbot ?</Label>
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <button onClick={() => setDest('perso')} style={destChip(dest === 'perso')}>Perso</button>
                {adminOrgs.map(o => (
                  <button key={o.id} onClick={() => setDest(o.id)} style={destChip(dest === o.id)}>{o.name}</button>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: FAINT, marginTop: 10, lineHeight: 1.5 }}>
                {dest === 'perso'
                  ? 'Bot personnel : vous en êtes le seul propriétaire. Vous pourrez le transférer à une équipe plus tard.'
                  : 'Bot d\'équipe : partagé avec les membres de l\'équipe selon leurs permissions.'}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 24 }}>
            <button onClick={() => setStep('appearance')} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }} disabled={busy}>← Retour</button>
            <button onClick={createBot} disabled={busy} style={{ ...primaryBtnLg, flex: 1, background: MINT, opacity: busy ? 0.7 : 1, ...(mobile ? { width: '100%' } : null) }}>
              {busy ? 'Création…' : 'Créer mon chatbot ✓'}
            </button>
          </div>
        </div>
      )}

      {/* ============================ ÉTAPE 5 : DONE ============================ */}
      {step === 'done' && (
        <div style={{ maxWidth: 520, margin: '0 auto', padding: mobile ? '56px 16px' : '80px 28px', textAlign: 'center', animation: 'cin .35s ease' }}>
          <span style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(47,158,121,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10.5" stroke={MINT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 30, margin: '22px 0 0', letterSpacing: '-.02em' }}>Votre chatbot est créé 🎉</h1>
          <p style={{ fontSize: 15, color: MUT, margin: '12px auto 0', maxWidth: 400, lineHeight: 1.55 }}>
            Il est prêt. Ouvrez l'éditeur pour affiner chaque onglet et récupérer votre balise d'intégration.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 30 }}>
            <button onClick={() => navigate(`/app/bots/${createdBotId}`)} style={{ ...primaryBtnLg, padding: 15, fontSize: 15.5 }}>Ouvrir l'éditeur →</button>
            <button onClick={() => navigate('/app')} style={{ background: 'transparent', color: MUT, border: 'none', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>Aller au tableau de bord</button>
          </div>
        </div>
      )}

      <style>{`@keyframes cin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}`}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nom du bot dérivé du secteur choisi.
function sectorName(sector?: string): string {
  switch (sector) {
    case 'ecom': return 'Assistant boutique'
    case 'saas': return 'Assistant produit'
    case 'service': return 'Assistant conseil'
    default: return 'Mon assistant'
  }
}

// ---------------------------------------------------------------------------
// Sous-composants présentationnels
const primaryBtn: React.CSSProperties = { background: NAVY, color: '#fff', border: 'none', borderRadius: 12, padding: '11px 22px', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }
const primaryBtnLg: React.CSSProperties = { background: NAVY, color: '#fff', border: 'none', borderRadius: 13, padding: '14px 20px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { background: '#fff', color: NAVY, border: '1px solid #D8DEE6', borderRadius: 13, padding: '14px 20px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }

function BotBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', animation: 'cin .35s ease' }}>
      <span style={{ width: 34, height: 34, borderRadius: '50%', background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <ChapoteMark size={18} />
      </span>
      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '4px 16px 16px 16px', padding: '12px 16px', fontSize: 15, lineHeight: 1.5, maxWidth: '85%', boxShadow: '0 3px 10px -6px rgba(28,63,92,.2)' }}>{text}</div>
    </div>
  )
}
function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', animation: 'cin .35s ease' }}>
      <div style={{ background: NAVY, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '11px 16px', fontSize: 14.5, fontWeight: 500, maxWidth: '80%' }}>{text}</div>
    </div>
  )
}
function ChatChip({ children, onClick, fullWidth }: { children: React.ReactNode; onClick: () => void; fullWidth?: boolean }) {
  return (
    <button onClick={onClick} style={{ border: '1px solid #D8DEE6', background: '#fff', color: NAVY, borderRadius: 999, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all .15s', width: fullWidth ? '100%' : undefined, textAlign: fullWidth ? 'center' : undefined }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = MINT; e.currentTarget.style.background = 'rgba(47,158,121,.06)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#D8DEE6'; e.currentTarget.style.background = '#fff' }}>
      {children}
    </button>
  )
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, margin: '0 0 10px', ...style }}>{children}</label>
}
// Pilule de choix de destination (perso / équipe) — même look que ChatChip.
function destChip(on: boolean): React.CSSProperties {
  return {
    border: `1.5px solid ${on ? MINT : '#D8DEE6'}`, background: on ? 'rgba(47,158,121,.08)' : '#fff',
    color: on ? '#1C7A5C' : NAVY, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  }
}
function Swatch({ c, on, onClick, size }: { c: string; on: boolean; onClick: () => void; size: number }) {
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
      boxShadow: on ? `0 0 0 2px #fff,0 0 0 ${size > 30 ? 4 : 3}px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,.08)', transition: 'box-shadow .2s',
    }} />
  )
}
function SegBlock({ label, value, opts, onPick }: { label: string; value: string; opts: [string, string][]; onPick: (v: string) => void }) {
  return (
    <div>
      <Label style={{ marginBottom: 8 }}>{label}</Label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {opts.map(([v, l]) => {
          const on = value === v
          return (
            <button key={v} onClick={() => onPick(v)} style={{
              padding: '8px 13px', borderRadius: 9, border: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: on ? NAVY : '#fff', color: on ? '#fff' : MUT, transition: 'all .15s',
            }}>{l}</button>
          )
        })}
      </div>
    </div>
  )
}
// ---------------------------------------------------------------------------
// Widget live (aperçu fixe bas de page de l'étape Apparence) — porté de
// BotCreate.dc.html (liveWidget) + ChapoteWidget.dc.html.
function LiveWidget({ look, mobile, collapsed, onCollapse, onExpand }: {
  look: Look; mobile?: boolean; collapsed: boolean; onCollapse: () => void; onExpand: () => void
}) {
  const radMap: Record<string, number> = { sm: 10, md: 18, lg: 26 }
  const cardRadMap: Record<string, number> = { sm: 8, md: 12, lg: 16 }
  const fontMap: Record<string, number> = { sm: 12.5, md: 13.5, lg: 15 }
  const headerBg = look.gradient ? `linear-gradient(135deg,${look.color} 0%,${look.color2 || MINT} 100%)` : look.color
  const dark = look.dark
  // En mobile : largeur bornée au viewport (jamais plein écran) et offsets réduits.
  const baseW = look.big ? 384 : 320
  const w = mobile ? `min(${baseW}px, calc(100vw - 24px))` : baseW
  const edge = mobile ? 12 : 24
  const side = look.position === 'br' ? 'right' : 'left'
  const tint = `rgba(${parseInt(look.color.slice(1, 3), 16)},${parseInt(look.color.slice(3, 5), 16)},${parseInt(look.color.slice(5, 7), 16)},0.10)`
  const cardBg = dark ? '#26333E' : '#fff'
  const cardText = dark ? '#E6EDF3' : INK
  const cardBorder = dark ? '#3A4A57' : BORDER
  const panelBg = dark ? '#1B2630' : '#FBFCFD'
  const shellBg = dark ? '#16212B' : '#fff'
  const shellBorder = dark ? '#2B3845' : BORDER
  const inputBg = dark ? '#0F1A22' : '#F0F2F5'
  const font = fontMap[look.fontSize]
  const chipFont = font - 1
  const isLogo = !!look.logoUrl

  return (
    <div style={{ position: 'fixed', bottom: edge, [side]: edge, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, animation: 'cin .4s ease' } as React.CSSProperties}>
      {!collapsed && (
        <div style={{ width: w, background: shellBg, border: `1px solid ${shellBorder}`, borderRadius: radMap[look.radius], overflow: 'hidden', boxShadow: '0 26px 60px -20px rgba(28,63,92,.45)' }}>
          <div style={{ background: headerBg, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {isLogo
                ? <span style={{ width: 36, height: 36, backgroundImage: `url(${look.logoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: 8 }} />
                : <span style={{ fontSize: 18 }}>{ICON_GLYPH[look.icon] || '💬'}</span>}
            </span>
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Assistant</div>
              <div style={{ fontSize: 11, opacity: .85, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7FE3BE' }} />En ligne
              </div>
            </div>
            <button onClick={onCollapse} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', opacity: .85, fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <div style={{ padding: 15, background: panelBg, minHeight: mobile ? 96 : 132 }}>
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, color: cardText, borderRadius: cardRadMap[look.radius], padding: '10px 13px', fontSize: font, lineHeight: 1.45, maxWidth: '88%' }}>{look.welcome}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
              {['Suivre ma commande', 'Une question'].map(c => (
                <span key={c} style={{ border: `1px solid ${look.color}`, color: look.color, background: tint, padding: '6px 11px', borderRadius: 999, fontSize: chipFont, fontWeight: 500 }}>{c}</span>
              ))}
            </div>
            {look.typing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, padding: '9px 13px', background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 12, width: 'fit-content' }}>
                {[0, .2, .4].map(d => (
                  <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: look.color, animation: `blink 1.2s infinite ${d}s` }} />
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderTop: `1px solid ${shellBorder}`, background: shellBg }}>
            <div style={{ flex: 1, height: 34, borderRadius: 10, background: inputBg, display: 'flex', alignItems: 'center', padding: '0 12px', color: FAINT, fontSize: 12.5 }}>Écrivez…</div>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: headerBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </div>
        </div>
      )}
      {collapsed && (
        <button onClick={onExpand} style={{ width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer', background: headerBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, boxShadow: '0 16px 36px -12px rgba(28,63,92,.5)' }}>
          {isLogo
            ? <span style={{ width: 30, height: 30, backgroundImage: `url(${look.logoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: 8 }} />
            : <span>{ICON_GLYPH[look.icon] || '💬'}</span>}
        </button>
      )}
    </div>
  )
}
