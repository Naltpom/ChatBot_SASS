// Wizard de création — expérience conversationnelle Chapote (BotCreate.dc.html).
// 7 étapes : CHAT (le bot interroge l'utilisateur, Q&R enrichie + perso +
// branchement conditionnel) → PRESET (récap des capacités, tout inclus/gratuit)
// → APPARENCE (contrôles + palette réelle + widget live fixe) → SOURCES (URLs +
// PDF du client, validés en direct) → PROCESSING (écran d'attente animé qui
// appelle l'IA de génération d'arbre) → ARBRE (composant PARTAGÉ TreeFlow) →
// DONE (bot créé).
//
// SOURCE de l'arbre : à l'étape SOURCES, soit l'utilisateur passe (on construit
// l'ébauche locale rawBranches → buildTree), soit il fournit des pages/PDF et
// l'étape PROCESSING démarre un job (POST /api/tree/jobs) puis suit sa
// progression en SSE (GET /api/tree/jobs/{id}/stream) jusqu'au tree_json généré
// par l'IA. Dans TOUS les cas le résultat atterrit dans
// `treeJson`, édité via <TreeFlow> — le MÊME composant que l'onglet « Arbre » de
// l'éditeur, donc rendu strictement identique. La création finale envoie CE
// tree_json édité. Toute erreur de génération retombe sur l'ébauche locale :
// l'utilisateur n'est jamais bloqué.
//
// Câblage réel : à l'étape ARBRE, « Créer mon chatbot » crée vraiment le bot
// via l'API existante (POST /api/orgs/{id}/bots puis PATCH /api/bots/{id}),
// avec ce tree_json et un design_json valide. Le mode "tree" (aucune IA voulue)
// masque l'option IA dans TreeFlow (allowAI=false).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, postForm, streamSSE } from '../api'
import { useAuth } from '../AuthContext'
import { MODEL_OPTIONS, WIDGET_BRAND_COLORS, GRADIENT_SECOND_COLORS } from '../botConstants'
import { useIsMobile } from '../hooks/useMediaQuery'
import TreeFlow from '../components/TreeFlow'
import WidgetPreview from '../components/WidgetPreview'
import HatIcon from '../components/HatIcon'
import BotConfigurator from '../components/billing/BotConfigurator'
import PriceCart, { formatCents } from '../components/billing/PriceCart'
import { errMsg } from '../utils/errors'
import { InfoBox, Seg } from '../ui'
import { FALLBACK_CATALOG, computeCart, deriveConfigFromChat } from '../utils/billing'
import type { DesignJson, Tree, TreeNode } from '../types/bot'
import type { BillingCatalog, BotConfig } from '../types/billing'

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
// Questions du chat — Q&R enrichie (portée de BotCreate.dc.html, Q()) :
// personnalisation (nom d'entreprise + ton de voix) et UN branchement
// conditionnel (la question de suivi n'apparaît que si 'orders' est coché).
//   - 'single' : un choix parmi des chips.
//   - 'multi'  : plusieurs choix (objectifs), avec un bouton « Continuer ».
//   - 'text'   : saisie libre (input stylé + envoi), rendue en bulle utilisateur.
// `when(answers, goals)` (optionnel) : prédicat de branchement — si présent et
// faux, la question est SAUTÉE (ni posée, ni rendue dans l'historique).
type QType = 'single' | 'multi' | 'text'
interface Question {
  key: string
  type: QType
  q: string
  opts: [string, string][]            // vide pour 'text'
  placeholder?: string                // 'text' uniquement
  when?: (answers: Record<string, string>, goals: string[]) => boolean
}
const QUESTIONS: Question[] = [
  {
    key: 'company', type: 'text', opts: [],
    q: "Bonjour 👋 Je vais construire votre assistant sur-mesure. Pour commencer, comment s'appelle votre entreprise ?",
    placeholder: 'Ex. Maison Léna',
  },
  {
    key: 'sector', type: 'single', opts:
      [['ecom', 'E-commerce'], ['local', 'Commerce local'], ['saas', 'SaaS / Logiciel'], ['service', 'Service / Conseil'], ['other', 'Autre']],
    q: "Parfait. Quel est votre domaine d'activité ?",
  },
  {
    key: 'goals', type: 'multi', opts:
      [['faq', 'Répondre aux questions fréquentes'], ['orders', 'Suivre les commandes'], ['leads', 'Capturer des contacts'], ['rdv', 'Prendre des rendez-vous'], ['horaires', 'Donner horaires & infos pratiques']],
    q: 'Que doit-il faire en priorité ? Choisissez tout ce qui compte.',
  },
  {
    // Branchement conditionnel : suivi de commande proposé UNIQUEMENT si
    // l'objectif « Suivre les commandes » a été coché.
    key: 'order_channel', type: 'single', opts:
      [['site', 'Sur mon site (numéro de commande)'], ['transporteur', 'Via le transporteur'], ['email', "Par e-mail à l'équipe"]],
    q: 'Comment vos clients suivent-ils leur commande aujourd\'hui ?',
    when: (_a, goals) => goals.includes('orders'),
  },
  {
    key: 'tone', type: 'single', opts:
      [['tu', 'Tutoiement chaleureux'], ['vous', 'Vouvoiement professionnel'], ['neutre', 'Neutre']],
    q: 'Quel ton de voix doit-il adopter ?',
  },
  {
    key: 'fallback', type: 'single', opts:
      [['ia', "Laisser l'IA répondre"], ['human', 'Passer à un conseiller'], ['both', 'Les deux : IA puis humain']],
    q: "Quand l'arbre guidé ne suffit pas, que préférez-vous ?",
  },
]
function optLabel(key: string, v: string): string {
  const q = QUESTIONS.find(x => x.key === key)
  const o = q && q.opts.find(p => p[0] === v)
  return o ? o[1] : v
}

// Liste des questions RÉELLEMENT actives selon les réponses (branchement when()).
function activeQuestions(answers: Record<string, string>, goals: string[]): Question[] {
  return QUESTIONS.filter(q => !q.when || q.when(answers, goals))
}

// Message d'accueil personnalisé dérivé du nom d'entreprise + du ton de voix.
function deriveWelcome(company: string, tone: string): string {
  const c = (company || '').trim()
  const chez = c ? ` chez ${c}` : ''
  if (tone === 'vous') return `Bonjour 👋 Bienvenue${chez}, comment puis-je vous aider ?`
  if (tone === 'tu') return `Salut 👋 Bienvenue${chez} ! Comment je peux t'aider ?`
  return `Bonjour 👋 Bienvenue${chez}. Comment vous aider ?`
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
  if (goals.includes('horaires')) out.push({ answer: 'Horaires & infos', type: 'q', title: 'Nos horaires et coordonnées', subs: [] })
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

function buildTree(branches: Branch[], welcome: string, allowAI: boolean): Tree {
  const nodes: Record<string, TreeNode> = {}
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
// Valeurs typées sur l'icône design_json (DesignJson['icon']) pour que
// buildDesign() reste assignable à DesignJson sans cast.
const ICON_MAP: Record<string, NonNullable<DesignJson['icon']>> = { chat: 'chat', bot: 'chat', spark: 'spark', head: 'help' }
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

function buildDesign(look: Look): DesignJson {
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
// Machine d'étapes. 'processing' est un écran TRANSITOIRE (génération IA) : il
// n'a PAS sa propre pastille (les dots restent calés sur SOURCES) pour ne pas
// alourdir l'en-tête — voir headerDot()/STEP_DOTS.
type Step = 'chat' | 'preset' | 'plan' | 'appearance' | 'sources' | 'processing' | 'tree' | 'done'
// Pastilles d'en-tête : 6 étapes « visibles » (processing/done exclus). L'étape
// 'plan' (configurateur + panier) s'intercale entre preset et apparence (spec §5.3).
const STEP_DOTS: Step[] = ['chat', 'preset', 'plan', 'appearance', 'sources', 'tree']
const STEP_CAPTION: Record<Step, string> = {
  chat: 'Discussion', preset: 'Proposition', plan: 'Abonnement', appearance: 'Apparence',
  sources: 'Vos contenus', processing: 'Génération', tree: 'Arbre', done: 'Terminé',
}
// Index « visible » d'une étape pour l'avancement des pastilles : processing se
// situe entre sources et tree, done est tout au bout.
function dotIndex(step: Step): number {
  if (step === 'processing') return STEP_DOTS.indexOf('sources')
  if (step === 'done') return STEP_DOTS.length
  return STEP_DOTS.indexOf(step)
}

const RANDOM_SWATCHES = ['#1C3F5C', '#2F9E79', '#8C6DFF', '#E86A5F', '#0F766E', '#7C3AED', '#0EA5E9', '#D946A6']

// Composition de bot par défaut (étape 'plan'). Arbre seul : aucun module payant,
// AUCUN plan IA pré-sélectionné (ai_tier_id=null — l'IA gratuite à vie 'ai_free'
// est supprimée, point 7 ; l'utilisateur choisit un plan IA s'il veut l'IA). La
// dérivation du chat (deriveConfigFromChat) ou le configurateur fait ensuite
// évoluer cette config.
const DEFAULT_BOT_CONFIG: BotConfig = { modules: [], ai_tier_id: null, ai_byok: false }

// Sources : types de page proposés + libellé d'en-tête FR utilisé côté backend.
type SourceType = 'site' | 'contact' | 'aide' | 'qr' | 'autre'
const SOURCE_TYPE_OPTS: [SourceType, string][] = [
  ['site', 'Site'], ['contact', 'Contact'], ['aide', 'Aide'], ['qr', 'Q&R'], ['autre', 'Autre'],
]
interface SourceRow { url: string; type: SourceType; status: 'idle' | 'checking' | 'ok' | 'err'; reason: string | null }
const newRow = (): SourceRow => ({ url: '', type: 'site', status: 'idle', reason: null })
const MAX_SOURCES = 5
const MAX_PDFS = 2
// Note douce affichée à l'étape arbre quand on retombe sur l'ébauche par défaut.
const GEN_FALLBACK = "Nous n'avons pas pu générer depuis vos pages, voici un modèle de départ."

// Brouillon localStorage : reprend la config du wizard après un rafraîchissement,
// une coupure de courant ou de réseau. Les PDF (objets File) ne sont pas
// sérialisables -> à re-déposer. Effacé à la création du bot (étape 'done').
const DRAFT_KEY = 'cbsaas_wizard_draft_v1'
function loadDraft(): any | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    return d && d.v === 1 && d.step !== 'done' ? d : null
  } catch { return null }
}

const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 Mo (parité MAX_PDF_BYTES backend)

// reason backend -> indication FR pour l'utilisateur.
const REASON_FR: Record<string, string> = {
  not_https: 'https:// requis',
  redirect: "cette URL redirige, indiquez l'URL finale",
  http_error: 'page introuvable',
  unreachable: 'site injoignable',
}
function reasonFr(r: string | null): string {
  return (r && REASON_FR[r]) || 'URL non valide'
}
function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

// ---------------------------------------------------------------------------
export default function BotWizard() {
  const { user, activeOrg } = useAuth()
  const navigate = useNavigate()
  // Équipes où l'utilisateur est admin = destinations possibles d'un bot
  // d'équipe (POST /api/orgs/{id}/bots est réservé aux admins).
  const adminOrgs = (user?.organizations || []).filter(o => o.role === 'admin')
  // Brouillon restauré (coupure/refresh) : lu UNE fois au montage, sert à
  // initialiser les états ci-dessous. draftRestored pilote la bannière.
  const draft0 = useRef(loadDraft()).current
  const [draftRestored, setDraftRestored] = useState(!!draft0)
  // Destination du bot : 'perso' (POST /api/bots) ou un id d'équipe
  // (POST /api/orgs/{id}/bots). Pré-sélectionne l'équipe active si elle fait
  // partie des équipes admin, sinon « Perso ».
  const [dest, setDest] = useState<'perso' | number>(
    draft0?.dest !== undefined ? draft0.dest
      : (activeOrg && adminOrgs.some(o => o.id === activeOrg.id) ? activeOrg.id : 'perso'),
  )
  // Responsive : empilement du contenu en dessous de ~760px (mobile ~360-430px).
  // Breakpoint 760 conservé À L'IDENTIQUE (paramètre explicite, défaut du hook = 860).
  const mobile = useIsMobile(760)

  // États initialisés depuis le brouillon si présent ('processing' -> 'sources'
  // car la tâche de génération ne survit pas à un rechargement).
  const [step, setStep] = useState<Step>(draft0 ? (draft0.step === 'processing' ? 'sources' : draft0.step) : 'chat')
  const [qi, setQi] = useState(draft0?.qi ?? 0)
  const [answers, setAnswers] = useState<Record<string, string>>(draft0?.answers ?? {})
  const [goals, setGoals] = useState<string[]>(draft0?.goals ?? [])
  const [textDraft, setTextDraft] = useState('')   // saisie en cours d'une question 'text'
  const [look, setLook] = useState<Look>(draft0?.look ?? { ...DEFAULT_LOOK })
  const [collapsed, setCollapsed] = useState(false)
  // Sources (étape SOURCES) : lignes d'URL + PDF importés.
  const [rows, setRows] = useState<SourceRow[]>(draft0?.rows ?? [newRow()])
  const [pdfs, setPdfs] = useState<File[]>([])
  const [genNote, setGenNote] = useState('')   // note douce si repli sur ébauche
  // Progression réelle de la génération (flux SSE) affichée par ProcessingScreen.
  const [genStage, setGenStage] = useState<{ label: string; pct: number }>({ label: 'Préparation…', pct: 3 })
  const genAbort = useRef<AbortController | null>(null)
  // Arbre RÉEL (tree_json) édité via le composant partagé TreeFlow. Construit à
  // l'entrée de l'étape ARBRE depuis les réponses du chat (buildTree). null tant
  // qu'on n'a pas atteint cette étape.
  const [treeJson, setTreeJson] = useState<Tree | null>(draft0?.treeJson ?? null)

  // Étape 'plan' : catalogue (GET /api/billing/catalog, repli sur le miroir
  // FALLBACK_CATALOG si indisponible) + composition choisie (botConfig). Le
  // configurateur fait confiance au backend pour le montant final (Stripe).
  const [catalog, setCatalog] = useState<BillingCatalog>(FALLBACK_CATALOG)
  const [botConfig, setBotConfig] = useState<BotConfig>(draft0?.botConfig ?? { ...DEFAULT_BOT_CONFIG })
  // Intention de souscription (point 3) : le bot démarre TOUJOURS en essai 7 j.
  // false (défaut) => on reflète l'essai (activate-free). true => l'utilisateur veut
  // souscrire tout de suite (checkout Stripe, lève l'essai). Restauré du brouillon.
  const [subscribeNow, setSubscribeNow] = useState<boolean>(draft0?.subscribeNow ?? false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createdBotId, setCreatedBotId] = useState<number | null>(null)

  // L'IA est câblée si l'utilisateur l'a choisie (tout est gratuit, pas de budget).
  const wantsAI = answers.fallback === 'ia' || answers.fallback === 'both'
  const wantsHuman = answers.fallback === 'human' || answers.fallback === 'both'
  const allowAI = wantsAI
  // Mode réel du bot : hybride si IA voulue, sinon arbre.
  const botMode = wantsAI ? 'hybrid' : 'tree'

  // --- Facturation (étape 'plan') ------------------------------------------
  // Le billing est-il actif côté serveur (clés Stripe posées) ? Si non, on reste
  // 100% gratuit : l'étape 'plan' est sautée et createBot crée un bot gratuit.
  const billingActive = !!user?.is_billing_enabled
  // Suis-je le PAYEUR de la destination choisie ? Perso => oui (moi-même).
  // Équipe => uniquement si je suis OWNER de l'org (owned_org_ids). Un admin
  // non-owner voit les modules payants en lecture seule (c'est l'owner qui paie).
  const ownedOrgIds = user?.owned_org_ids ?? []
  const isOwnerDest = dest === 'perso' || ownedOrgIds.includes(dest as number)
  // Panier live recomposé localement (computeCart est PUR). Total en centimes.
  const cart = useMemo(() => computeCart(catalog, botConfig), [catalog, botConfig])
  const totalCents = cart.total_cents

  // -------------------------------------------------------------------------
  // Logique du chat. Le branchement conditionnel (when()) modifie la liste des
  // questions actives EN FONCTION des réponses : on recalcule donc la liste à
  // partir des réponses MISES À JOUR avant de décider de l'étape suivante.
  function advance(a: Record<string, string>, g: string[]) {
    const list = activeQuestions(a, g)
    const next = qi + 1
    if (next >= list.length) {
      // Fin du chat : on personnalise le message d'accueil (entreprise + ton).
      patchLook({ welcome: deriveWelcome(a.company, a.tone) })
      setStep('preset')
    } else {
      setQi(next)
    }
  }
  function answerSingle(key: string, v: string) {
    const a = { ...answers, [key]: v }
    setAnswers(a)
    advance(a, goals)
  }
  // Question 'text' validée -> enregistre la réponse + (si entreprise) amorce le
  // nom du bot et le message d'accueil, puis avance.
  function answerText(key: string, raw: string) {
    const v = raw.trim()
    if (!v) return
    const a = { ...answers, [key]: v }
    setAnswers(a)
    setTextDraft('')
    advance(a, goals)
  }
  function toggleGoal(v: string) {
    setGoals(g => g.includes(v) ? g.filter(x => x !== v) : [...g, v])
  }
  function nextMulti() {
    advance(answers, goals)
  }
  // Revient à la question précédente (si on s'est trompé). On efface la réponse
  // de cette question pour la re-poser ; pour une 'multi' (objectifs) on garde
  // la sélection (l'UI multi permet déjà de la corriger).
  function goBack() {
    if (qi === 0) return
    const prev = qList[qi - 1]
    if (prev.type !== 'multi') {
      setAnswers(a => { const c = { ...a }; delete c[prev.key]; return c })
      setTextDraft(prev.type === 'text' ? (answers[prev.key] || '') : '')
    }
    setQi(qi - 1)
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
  // design_json dérivé de l'apparence : mémorisé pour stabiliser l'identité du
  // prop passé à <WidgetPreview> (sinon l'aperçu live se re-rend à chaque render)
  // et éviter de reconstruire l'objet en double (aperçu + création).
  const design = useMemo(() => buildDesign(look), [look])

  // -------------------------------------------------------------------------
  // Construit l'ébauche LOCALE d'arbre (repli systématique : passage de l'étape
  // sources, erreur de génération, parcours direct).
  function presetTree(): Tree {
    return buildTree(rawBranches(answers, goals), look.welcome, allowAI)
  }

  // -------------------------------------------------------------------------
  // SOURCES : lignes d'URL + PDF.
  // URLs « ok » = celles que la validation a confirmées en HTTP 200.
  const okRows = rows.filter(r => r.url.trim() && r.status === 'ok')
  const canGenerate = okRows.length > 0 || pdfs.length > 0

  function patchRow(i: number, p: Partial<SourceRow>) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  }
  function addRow() { setRows(rs => (rs.length >= MAX_SOURCES ? rs : [...rs, newRow()])) }
  function removeRow(i: number) { setRows(rs => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i))) }

  // Validation d'une URL non vide via POST /api/tree/validate-url (toujours 200,
  // { ok, status, reason }). Déclenchée au blur ET en debounce (cf. URLRow).
  async function validateRow(i: number, url: string) {
    const u = url.trim()
    if (!u) { patchRow(i, { status: 'idle', reason: null }); return }
    patchRow(i, { status: 'checking', reason: null })
    try {
      const res = await api<{ ok: boolean; status: number | null; reason: string | null }>(
        '/api/tree/validate-url', { method: 'POST', body: { url: u } },
      )
      patchRow(i, res.ok ? { status: 'ok', reason: null } : { status: 'err', reason: res.reason })
    } catch {
      // Erreur réseau/serveur côté validation : on signale « injoignable ».
      patchRow(i, { status: 'err', reason: 'unreachable' })
    }
  }

  function onPdfPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    e.target.value = '' // permet de re-sélectionner le même fichier après retrait
    setPdfs(prev => {
      const out = [...prev]
      for (const f of picked) {
        if (out.length >= MAX_PDFS) break
        if (f.size > MAX_PDF_BYTES) { setGenNote(`« ${f.name} » dépasse 10 Mo et a été ignoré.`); continue }
        out.push(f)
      }
      return out
    })
  }
  function removePdf(i: number) { setPdfs(ps => ps.filter((_, j) => j !== i)) }

  // Construit le contexte FR court (<=500 c.) prepended au texte des sources.
  function buildContext(): string {
    const parts: string[] = []
    if (answers.company) parts.push(`Entreprise : ${answers.company}.`)
    if (answers.sector) parts.push(`Secteur : ${sectorLabel(answers.sector)}.`)
    if (goals.length) parts.push(`Objectifs : ${goals.map(g => optLabel('goals', g)).join(', ')}.`)
    if (answers.tone) parts.push(`Ton : ${optLabel('tone', answers.tone)}.`)
    return parts.join(' ').slice(0, 500)
  }

  // Passe l'étape sources : ébauche locale -> arbre.
  function skipSources() {
    setTreeJson(presetTree())
    setStep('tree')
  }

  // Génération RÉELLE avec progression SSE. Déclenchée par le clic « Générer »
  // (un gestionnaire d'événement, donc PAS rejoué par le double-montage
  // StrictMode — contrairement à un effet). Étapes : POST /jobs (démarre la
  // tâche de fond) -> streamSSE (progression temps réel) -> dès le tree prêt on
  // passe AUTOMATIQUEMENT à l'étape arbre. Tout échec/skip -> ébauche par défaut.
  async function startGeneration() {
    setGenNote('')
    setGenStage({ label: 'Préparation…', pct: 4 })
    setStep('processing')
    if (!canGenerate) {  // garde-fou : aucune source exploitable
      setGenNote(GEN_FALLBACK); setTreeJson(presetTree()); setStep('tree'); return
    }
    const form = new FormData()
    form.append('sources', JSON.stringify(okRows.map(r => ({ url: r.url.trim(), type: r.type }))))
    form.append('context', buildContext())
    pdfs.forEach(f => form.append('files', f))

    const ctrl = new AbortController()
    genAbort.current = ctrl
    const safety = setTimeout(() => ctrl.abort(), 150_000)  // jamais bloqué > 2,5 min
    let resolved = false
    try {
      const { job_id } = await postForm<{ job_id: string }>('/api/tree/jobs', form)
      await streamSSE(`/api/tree/jobs/${job_id}/stream`, ev => {
        if (ev.type === 'progress') setGenStage({ label: ev.stage || '…', pct: ev.pct ?? 0 })
        else if (ev.type === 'done') { resolved = true; setGenStage({ label: 'Terminé', pct: 100 }); setTreeJson(ev.tree_json) }
        else if (ev.type === 'error') { resolved = true; setGenNote(GEN_FALLBACK); setTreeJson(presetTree()) }
      }, ctrl.signal)
      // Flux fermé sans verdict (réseau coupé, abort) -> ébauche.
      if (!resolved) { setGenNote(GEN_FALLBACK); setTreeJson(presetTree()) }
    } catch {
      setGenNote(GEN_FALLBACK); setTreeJson(presetTree())
    } finally {
      clearTimeout(safety)
      genAbort.current = null
      setStep('tree')  // on enchaîne TOUJOURS sur l'arbre
    }
  }

  // Coupe un flux SSE en cours si on quitte le wizard pendant la génération.
  useEffect(() => () => { genAbort.current?.abort() }, [])

  // Catalogue de facturation : chargé une fois si le billing est actif. Repli
  // silencieux sur FALLBACK_CATALOG (déjà en état initial) en cas d'échec.
  useEffect(() => {
    if (!billingActive) return
    let alive = true
    api<BillingCatalog>('/api/billing/catalog')
      .then(c => { if (alive) setCatalog(c) })
      .catch(() => { /* repli FALLBACK_CATALOG */ })
    return () => { alive = false }
  }, [billingActive])

  // Garde-fou : un brouillon restauré sur l'étape 'plan' alors que le billing
  // a été désactivé entre-temps ne doit pas bloquer sur un écran vide.
  useEffect(() => {
    if (step === 'plan' && !billingActive) setStep('appearance')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, billingActive])

  // DÉRIVATION de l'abonnement depuis le chat : l'étape 'plan' arrive PRÉ-REMPLIE
  // (preset + modules cochés), ajustable. La règle vit dans deriveConfigFromChat
  // (utils/billing, PURE) : objectifs/repli -> modules recommandés (inbox si
  // conseiller, rag si FAQ, actions si rdv/commande/leads, ai+palier si IA voulue,
  // sinon arbre seul). On ne re-dérive QUE tant qu'on n'a pas dépassé l'étape
  // 'plan' (en amont du choix), et JAMAIS par-dessus une config restaurée d'un
  // brouillon (l'utilisateur a déjà ajusté) ni après que l'utilisateur a ouvert
  // le configurateur (planTouched). Cela évite d'écraser un choix manuel.
  const planTouched = useRef(false)
  const beforePlan = step === 'chat' || step === 'preset'
  useEffect(() => {
    if (draft0?.botConfig) return        // config restaurée : ne pas écraser
    if (planTouched.current) return      // l'utilisateur a ajusté : ne pas écraser
    if (!beforePlan) return              // déjà au-delà du choix d'abonnement
    setBotConfig(deriveConfigFromChat(catalog, { goals, wantsAi: wantsAI, wantsHuman }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, wantsAI, wantsHuman, catalog, beforePlan])

  // Le configurateur a remonté un changement : on marque la config comme « touchée »
  // pour figer la dérivation automatique (le choix manuel prime).
  function onConfigChange(next: BotConfig) {
    planTouched.current = true
    setBotConfig(next)
  }

  // Sauvegarde du brouillon à chaque changement (reprise après coupure). On ne
  // persiste pas l'étape transitoire 'processing' (re-jouée), et on efface tout
  // à la création du bot ('done'). Les PDF (File) ne sont pas sérialisables.
  useEffect(() => {
    // Wizard vierge ou bot créé : aucun brouillon à conserver.
    const pristine = step === 'chat' && qi === 0 && Object.keys(answers).length === 0 && goals.length === 0 && !treeJson
    if (step === 'done' || pristine) { try { localStorage.removeItem(DRAFT_KEY) } catch { /* quota/private */ } return }
    // Debounce 500 ms : une rafale de frappes (chat/URL/apparence) ne déclenche
    // qu'une seule sérialisation+écriture (le JSON.stringify de tout l'état, arbre
    // inclus, est lui-même différé hors du chemin de frappe).
    const h = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          v: 1, step: step === 'processing' ? 'sources' : step,
          qi, answers, goals, look, rows, treeJson, dest, botConfig, subscribeNow, savedAt: Date.now(),
        }))
      } catch { /* quota dépassé / mode privé : on ignore */ }
    }, 500)
    return () => clearTimeout(h)
  }, [step, qi, answers, goals, look, rows, treeJson, dest, botConfig, subscribeNow])

  // « Recommencer à zéro » : efface le brouillon et remet le wizard au départ.
  function discardDraft() {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    setDraftRestored(false)
    setStep('chat'); setQi(0); setAnswers({}); setGoals([]); setTextDraft('')
    setLook({ ...DEFAULT_LOOK }); setRows([newRow()]); setPdfs([]); setTreeJson(null); setGenNote('')
    setBotConfig({ ...DEFAULT_BOT_CONFIG })
    setSubscribeNow(false)
    planTouched.current = false   // ré-active la dérivation depuis le chat
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
      const tree = treeJson ?? presetTree()
      const name = botName(answers.company, answers.sector)

      // 1) création du bot (name + mode) — perso (POST /api/bots) ou équipe
      // (POST /api/orgs/{id}/bots) selon la destination choisie.
      const createPath = dest === 'perso' ? '/api/bots' : `/api/orgs/${dest}/bots`
      const bot = await api(createPath, {
        method: 'POST', body: { name, mode: botMode },
      })

      // 2) configuration (design, arbre, modèle IA, captcha). Le mode de clé IA
      // suit le choix du configurateur : BYOK (clé du client) ou géré (managed).
      const model = MODEL_OPTIONS[1] // Claude Sonnet par défaut
      const body: Record<string, any> = {
        design_json: design,
        tree_json: tree,
        captcha_provider: 'turnstile',
      }
      if (botMode !== 'tree') {
        body.ai_provider = model.provider
        body.ai_model = model.model
        body.api_key_mode = botConfig.ai_byok ? 'byok' : 'managed'
      }
      await api(`/api/bots/${bot.id}`, { method: 'PATCH', body })

      // 3) facturation : le bot démarre TOUJOURS en essai 7 j (plus de chemin
      // « gratuit à vie », point 1). Si le billing est actif et que je suis le
      // payeur de la destination, deux chemins selon l'intention :
      //   - subscribeNow=false (défaut) : on REFLÈTE l'essai sur la config choisie
      //     via /billing/activate-free (status='trialing', modules + quota du plan,
      //     trial_end posé à la création) — sans carte ;
      //   - subscribeNow=true : l'utilisateur souscrit tout de suite => /billing/checkout
      //     (lève l'essai). checkout_url null / free=true (rien à payer in fine,
      //     ou catalogue non seedé) => pas de redirection, on termine en 'done'.
      // Invariant billing-OFF (D0) : si billing OFF, AUCUN appel /api/billing/*
      // (billingActive=false) — le bot reste sur son essai par défaut, pas de crash.
      if (billingActive && isOwnerDest) {
        if (subscribeNow) {
          const { checkout_url, free } = await api<{ checkout_url: string | null; free?: boolean }>(
            '/api/billing/checkout', {
              method: 'POST',
              body: { bot_id: bot.id, config: botConfig, grouping: user?.billing_grouping ?? 'total' },
            },
          )
          if (checkout_url && !free) {
            // Redirection vers le Checkout hébergé. Retour Stripe (?checkout=success)
            // sur /app/billing. On ne navigue JAMAIS vers un url null/undefined.
            window.location.href = checkout_url
            return
          }
          // Rien à payer (free / url absente) : état déjà projeté côté serveur.
        } else {
          // Reflète l'essai 7 j sur la config (débloque le plan configuré pendant
          // l'essai, IA plafonnée à 50 réponses jusqu'à la souscription).
          await api('/api/billing/activate-free', {
            method: 'POST',
            body: { bot_id: bot.id, config: botConfig },
          })
        }
      }

      setCreatedBotId(bot.id)
      setStep('done')
    } catch (err: unknown) {
      setError(errMsg(err, 'La création a échoué.'))
    } finally {
      setBusy(false)
    }
  }

  // Liste des questions actives (branchement when()) recalculée à chaque rendu :
  // l'historique et la question courante s'indexent dedans (cf. render CHAT).
  const qList = activeQuestions(answers, goals)
  const si = dotIndex(step)
  const cur = qi < qList.length ? qList[qi] : null
  const poolGoals = cur && cur.type === 'multi' ? cur.opts.filter(o => !goals.includes(o[0])) : []

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: '#F9F9FB', minHeight: '100%', color: INK }}>
      {/* ---- En-tête avec pastilles d'étape ---- */}
      <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(249,249,251,.92)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: mobile ? '11px 16px' : '13px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: mobile ? 10 : 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HatIcon size={18} color="#fff" />
            </span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Nouveau chatbot</span>
            <span style={{ fontSize: 13, color: FAINT, marginLeft: 6 }}>· {STEP_CAPTION[step]}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {STEP_DOTS.map((s, i) => (
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

      {/* Reprise après coupure/rafraîchissement : POPUP modale (plus visible
          qu'un bandeau) proposant de reprendre le brouillon ou de repartir. */}
      {draftRestored && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(28,63,92,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'cin .2s ease' }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: mobile ? '24px 20px' : '30px 28px', maxWidth: 440, width: '100%', boxShadow: '0 30px 80px -20px rgba(28,63,92,.5)', textAlign: 'center' }}>
            <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(47,158,121,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>↩</span>
            <h2 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 22, margin: '16px 0 0', letterSpacing: '-.02em' }}>Reprendre votre configuration ?</h2>
            <p style={{ fontSize: 14.5, color: MUT, margin: '10px 0 0', lineHeight: 1.55 }}>
              Nous avons retrouvé un chatbot en cours de création{answers.company ? <> pour <strong>{answers.company}</strong></> : null} (étape «&nbsp;{STEP_CAPTION[step]}&nbsp;»). Voulez-vous continuer là où vous en étiez ?
            </p>
            <div style={{ display: 'flex', flexDirection: mobile ? 'column-reverse' : 'row', gap: 11, marginTop: 24 }}>
              <button onClick={discardDraft} style={{ ...ghostBtn, flex: 1 }}>Recommencer à zéro</button>
              <button onClick={() => setDraftRestored(false)} style={{ ...primaryBtnLg, flex: 1, background: MINT }}>Reprendre</button>
            </div>
          </div>
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
              // Historique : on parcourt la liste ACTIVE (qList) — ainsi une
              // question sautée par when() n'apparaît jamais dans l'historique.
              ...qList.slice(0, qi).map((q, i) => {
                const lbl = q.type === 'multi'
                  ? (goals.map(v => optLabel('goals', v)).join(', ') || '—')
                  : q.type === 'text'
                    ? (answers[q.key] || '—')
                    : optLabel(q.key, answers[q.key])
                return (
                  <div key={`q-${q.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <BotBubble text={q.q} />
                    <UserBubble text={lbl} />
                  </div>
                )
              }),
              ...(cur ? [(
                <div key={`q-${cur.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <BotBubble text={cur.q} />
                  {cur.type === 'single' && (
                    <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 2 }}>
                      {cur.opts.map(o => (
                        <ChatChip key={o[0]} fullWidth={mobile} onClick={() => answerSingle(cur.key, o[0])}>{o[1]}</ChatChip>
                      ))}
                    </div>
                  )}
                  {/* Question 'text' : saisie libre stylée + envoi (Entrée ou bouton). */}
                  {cur.type === 'text' && (
                    <form onSubmit={e => { e.preventDefault(); answerText(cur.key, textDraft) }}
                          style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 2, flexDirection: mobile ? 'column' : 'row' }}>
                      <input
                        autoFocus value={textDraft} placeholder={cur.placeholder || 'Votre réponse…'}
                        onChange={e => setTextDraft(e.target.value)}
                        style={{ flex: mobile ? undefined : 1, maxWidth: mobile ? '100%' : 360, height: 44, border: '1px solid #D8DEE6', borderRadius: 12, padding: '0 14px', fontSize: 14.5, fontFamily: 'inherit' }} />
                      <button type="submit" disabled={!textDraft.trim()}
                              style={{ ...primaryBtn, opacity: textDraft.trim() ? 1 : 0.5, cursor: textDraft.trim() ? 'pointer' : 'not-allowed', ...(mobile ? { width: '100%' } : null) }}>
                        Valider →
                      </button>
                    </form>
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
            {/* Revenir à la question précédente (correction d'une réponse). */}
            {cur && qi > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 2 }}>
                <button onClick={goBack} style={{ background: 'none', border: 'none', color: FAINT, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>← Question précédente</button>
              </div>
            )}
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
              // Clé = libellé de la capacité (identité stable) : la liste s'agrandit/
              // se réduit selon les objectifs cochés, l'index glisserait d'une ligne.
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: i < caps.length - 1 ? '1px solid #F4F6F8' : 'none' }}>
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
            {/* Billing actif => étape 'plan' (configurateur + panier). Sinon on
                saute directement à l'apparence (app 100% gratuite, invariant D0). */}
            <button onClick={() => setStep(billingActive ? 'plan' : 'appearance')} style={{ ...primaryBtnLg, flex: 1, ...(mobile ? { width: '100%' } : null) }}>
              {billingActive ? 'Choisir mon abonnement →' : "Personnaliser l'apparence →"}
            </button>
          </div>
        </div>
      )}

      {/* ===================== ÉTAPE 2bis : PLAN / ABONNEMENT ===================== */}
      {/* Configurateur modulaire + panier live. Rendu uniquement si le billing est
          actif (sinon on saute cette étape). Org non-owner => modules payants en
          lecture seule + InfoBox (c'est l'owner de l'équipe qui paie). */}
      {step === 'plan' && (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: mobile ? '24px 16px 44px' : '40px 28px 60px', animation: 'cin .35s ease' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(47,158,121,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🧩</span>
            <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 28, margin: '14px 0 0', letterSpacing: '-.02em' }}>Composez votre abonnement</h1>
            <p style={{ fontSize: 15, color: MUT, margin: '10px auto 0', maxWidth: 540, lineHeight: 1.55 }}>
              {/* Description RÉELLE du socle (catalogue), pas une répétition du titre. */}
              {catalog.base_description || 'Le socle inclut l\'arbre, l\'apparence, les déclencheurs et les analytics.'}{' '}
              Choisissez votre plan IA et les modules à valeur — le panier se met à jour en direct.
            </p>
          </div>

          {/* Essai 7 j sans carte — l'abonnement composé démarre en essai, l'IA est
              plafonnée pendant cette période (levée à la souscription). */}
          <div style={{ marginBottom: 18 }}>
            <InfoBox tone="info" title="Essai 7 jours, sans carte">
              Votre chatbot démarre par un essai gratuit de 7 jours, sans carte bancaire. Pendant l'essai,
              l'IA managée est plafonnée à 50 réponses ; ce plafond est levé dès la souscription.
            </InfoBox>
          </div>

          {!isOwnerDest && (
            <div style={{ marginBottom: 18 }}>
              <InfoBox tone="warn" title="Facturation gérée par le propriétaire de l'équipe">
                Vous n'êtes pas le propriétaire de cette équipe : les modules payants sont en lecture seule.
                Le bot sera créé sur le socle gratuit ; le propriétaire pourra ensuite souscrire les modules.
              </InfoBox>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }}>
            <BotConfigurator catalog={catalog} config={botConfig} onChange={onConfigChange} readOnly={!isOwnerDest} />
            <PriceCart catalog={catalog} config={botConfig} />
          </div>

          {/* Intention de souscription. L'essai 7 j est le défaut ; l'owner peut
              choisir de souscrire tout de suite (Checkout à la création). Affiché
              seulement à l'owner ET si la compo est facturable (sinon checkout =
              no-op : seul l'essai a du sens). */}
          {isOwnerDest && totalCents > 0 && (
            <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, padding: '16px 20px', marginTop: 18 }}>
              <Label>Comment démarrer ?</Label>
              <Seg
                options={[
                  { value: 'trial', label: 'Essai 7 jours gratuit' },
                  { value: 'now', label: 'Souscrire maintenant' },
                ]}
                value={subscribeNow ? 'now' : 'trial'}
                onChange={v => setSubscribeNow(v === 'now')}
              />
              <div style={{ fontSize: 12.5, color: FAINT, marginTop: 10, lineHeight: 1.5 }}>
                {subscribeNow
                  ? `Vous serez redirigé vers le paiement sécurisé à la création (${formatCents(totalCents, catalog.currency)} /mois).`
                  : 'Aucune carte demandée. Vous pourrez souscrire à tout moment depuis l\'espace facturation.'}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 24 }}>
            <button onClick={() => setStep('preset')} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>← Retour</button>
            <button onClick={() => setStep('appearance')} style={{ ...primaryBtnLg, flex: 1, ...(mobile ? { width: '100%' } : null) }}>
              Personnaliser l'apparence →
            </button>
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
              {/* Palette principale : swatches de marque (WIDGET_BRAND_COLORS) +
                  pioche personnalisée native (mirroir de ColorDots). */}
              <Label>Couleur principale</Label>
              <ColorPalette colors={WIDGET_BRAND_COLORS} value={look.color} onPick={c => patchLook({ color: c })} size={34} />

              <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: '16px 18px', marginTop: 20 }}>
                <SegBlock label="Style de fond" value={look.gradient ? 'grad' : 'solid'} opts={[['solid', 'Uni'], ['grad', 'Dégradé']]} onPick={v => patchLook({ gradient: v === 'grad' })} />
                {/* Couleur secondaire : utilisée seulement si dégradé activé. */}
                <div style={{ opacity: look.gradient ? 1 : 0.5 }}>
                  <Label>Couleur secondaire</Label>
                  <ColorPalette colors={GRADIENT_SECOND_COLORS} value={look.color2 || ''} onPick={c => patchLook({ color2: c })} size={28} />
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
              <button onClick={() => setStep(billingActive ? 'plan' : 'preset')} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>← Retour</button>
              <button onClick={() => setStep('sources')} style={{ ...primaryBtnLg, flex: 1, ...(mobile ? { width: '100%' } : null) }}>Continuer →</button>
            </div>
          </div>

          {/* widget LIVE fixé en bas de page (réduit + repliable en mobile) */}
          <LiveWidget look={look} mobile={mobile} collapsed={collapsed} onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)} />
        </>
      )}

      {/* ============================ ÉTAPE 4 : SOURCES ============================ */}
      {step === 'sources' && (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: mobile ? '24px 16px 48px' : '40px 28px 64px', animation: 'cin .35s ease' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(140,109,255,.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🪄</span>
            <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 28, margin: '14px 0 0', letterSpacing: '-.02em' }}>Construisons l'arbre depuis vos contenus</h1>
            <p style={{ fontSize: 15, color: MUT, margin: '10px auto 0', maxWidth: 520, lineHeight: 1.55 }}>
              Indiquez vos vraies pages (site, contact, aide, Q&R) ou importez des PDF : notre IA lit tout et propose un arbre de conversation prêt à l'emploi. Étape facultative — vous pouvez la passer.
            </p>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 18, padding: mobile ? 16 : 24 }}>
            <Label>Pages à analyser (jusqu'à {MAX_SOURCES})</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map((r, i) => (
                <URLRow
                  key={i} row={r} mobile={mobile} canRemove={rows.length > 1}
                  onUrl={u => patchRow(i, { url: u, status: 'idle', reason: null })}
                  onType={ty => patchRow(i, { type: ty })}
                  onValidate={() => validateRow(i, r.url)}
                  onRemove={() => removeRow(i)}
                />
              ))}
            </div>
            {rows.length < MAX_SOURCES && (
              <button onClick={addRow} style={{ marginTop: 12, background: '#fff', color: NAVY, border: '1px dashed #CBD5DF', borderRadius: 10, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                + Ajouter une page
              </button>
            )}

            <Label style={{ marginTop: 24 }}>Documents PDF (jusqu'à {MAX_PDFS}, 10 Mo max)</Label>
            {pdfs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {pdfs.map((f, i) => (
                  <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${BORDER}`, borderRadius: 11, padding: '9px 12px' }}>
                    <span style={{ fontSize: 18 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                      <div style={{ fontSize: 12, color: FAINT }}>{fmtSize(f.size)}</div>
                    </div>
                    <button onClick={() => removePdf(i)} style={{ width: 30, height: 30, border: 'none', borderRadius: 8, background: '#F4F6F8', color: FAINT, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {pdfs.length < MAX_PDFS && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 15px', border: '1px dashed #CBD5DF', borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
                📎 Importer un PDF
                <input type="file" accept="application/pdf,.pdf" multiple onChange={onPdfPick} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          {genNote && (
            <div style={{ marginTop: 14, fontSize: 13, color: MUT, background: 'rgba(232,168,46,.1)', border: '1px solid rgba(232,168,46,.3)', borderRadius: 12, padding: '10px 14px' }}>{genNote}</div>
          )}

          <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12, marginTop: 24 }}>
            <button onClick={() => setStep('appearance')} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>← Retour</button>
            <button onClick={skipSources} style={{ ...ghostBtn, ...(mobile ? { width: '100%' } : null) }}>Passer cette étape</button>
            <button onClick={startGeneration} disabled={!canGenerate}
                    style={{ ...primaryBtnLg, flex: 1, background: MINT, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? 'pointer' : 'not-allowed', ...(mobile ? { width: '100%' } : null) }}>
              Générer mon arbre →
            </button>
          </div>
        </div>
      )}

      {/* ============================ ÉTAPE 5 : PROCESSING ============================ */}
      {/* Écran piloté par la progression SSE (genStage) — la logique réseau vit
          dans startGeneration (clic « Générer »), pas dans un effet (anti
          StrictMode). On enchaîne tout seul vers l'arbre dès la fin. */}
      {step === 'processing' && (
        <ProcessingScreen mobile={mobile} stage={genStage.label} pct={genStage.pct} />
      )}

      {/* ============================ ÉTAPE 6 : ARBRE ============================ */}
      {step === 'tree' && (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: mobile ? '22px 16px 56px' : '34px 28px 70px', animation: 'cin .35s ease' }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: '-.02em' }}>Votre arbre de conversation</h1>
            <p style={{ fontSize: 15, color: MUT, margin: '8px 0 0', maxWidth: 560 }}>Chaque réponse route vers une autre question, l'IA, un conseiller ou une action. Personnalisez tout ci-dessous — c'est exactement l'arbre que vous retrouverez dans l'éditeur.</p>
          </div>

          {/* Note douce si la génération a échoué et qu'on a basculé sur le modèle. */}
          {genNote && (
            <div style={{ marginBottom: 16, fontSize: 13.5, color: MUT, background: 'rgba(232,168,46,.1)', border: '1px solid rgba(232,168,46,.3)', borderRadius: 12, padding: '11px 14px' }}>{genNote}</div>
          )}

          {/* Le vrai widget configuré est posé DIRECTEMENT sur cette page (bloc
              fixe en bas à droite, comme sur le site du client) — voir plus bas. */}
          <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(47,158,121,.07)', border: '1px solid rgba(47,158,121,.25)', borderRadius: 12, padding: '11px 14px' }}>
            <span style={{ fontSize: 18 }}>👉</span>
            <span style={{ fontSize: 13.5, color: '#1C7A5C', fontWeight: 600 }}>
              Votre chatbot est posé en bas à droite de cette page, comme sur votre site. Ouvrez-le pour tester le parcours — l'IA et le passage à un conseiller sont simulés.
            </span>
          </div>

          {/* Arbre partagé : MÊME composant que l'onglet « Arbre » de l'éditeur.
              treeJson est la source unique envoyée à la création. */}
          <TreeFlow
            tree={treeJson ?? presetTree()}
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

          {/* Widget RÉEL posé DIRECTEMENT sur la page. Calque plein écran fixe :
              le panneau du widget (hauteur en %) se cale ainsi sur la hauteur du
              viewport — un wrapper 0×0 le réduisait à 0 (« ne s'ouvrait pas »).
              pointer-events:none sur le calque -> il ne bloque AUCUN clic du
              wizard ; le wrap interne (auto) ré-active les clics sur le widget.
              Fermé par défaut ; apparence + arbre réels, IA/conseiller simulés. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <WidgetPreview design={design} mode={botMode}
                             tree={treeJson ?? presetTree()} botName={botName(answers.company, answers.sector)}
                             defaultOpen={false} />
            </div>
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

      <style>{`@keyframes cin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}`}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nom du bot. Priorité au nom d'entreprise saisi (« Assistant {entreprise} »),
// sinon repli sur un libellé dérivé du secteur.
function botName(company?: string, sector?: string): string {
  const c = (company || '').trim()
  if (c) return `Assistant ${c}`.slice(0, 60)
  switch (sector) {
    case 'ecom': return 'Assistant boutique'
    case 'local': return 'Assistant boutique'
    case 'saas': return 'Assistant produit'
    case 'service': return 'Assistant conseil'
    default: return 'Mon assistant'
  }
}
// Libellé lisible du secteur (pour le contexte FR envoyé à la génération).
function sectorLabel(sector?: string): string {
  return optLabel('sector', sector || '') || 'Autre'
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
        <HatIcon size={18} color="#fff" />
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
// Palette réelle : swatches preset + pioche personnalisée native (mirroir de
// ColorDots / AppearanceForm). Le <input type=color> reflète la valeur courante
// et permet n'importe quelle teinte hors-preset.
function ColorPalette({ colors, value, onPick, size }: { colors: string[]; value: string; onPick: (c: string) => void; size: number }) {
  const v = (value || '').toLowerCase()
  return (
    <div style={{ display: 'flex', gap: size > 30 ? 11 : 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {colors.map(c => (
        <Swatch key={c} c={c} on={v === c.toLowerCase()} onClick={() => onPick(c)} size={size} />
      ))}
      <input type="color" value={value || '#1C3F5C'} onChange={e => onPick(e.target.value)}
             title="Couleur personnalisée"
             style={{ width: size, height: size, padding: 0, border: '1px solid #D8DEE6', borderRadius: '50%', cursor: 'pointer', background: 'none' }} />
    </div>
  )
}
// Une ligne de l'étape SOURCES : input URL + select de type + statut de
// validation. La validation est déclenchée au blur ET en debounce (700 ms) après
// la dernière frappe, sur une URL non vide.
function URLRow({ row, mobile, canRemove, onUrl, onType, onValidate, onRemove }: {
  row: SourceRow; mobile?: boolean; canRemove: boolean
  onUrl: (u: string) => void; onType: (t: SourceType) => void; onValidate: () => void; onRemove: () => void
}) {
  const url = row.url
  // Debounce : revalide automatiquement 700 ms après la dernière frappe.
  useEffect(() => {
    if (!url.trim()) return
    const t = setTimeout(onValidate, 700)
    return () => clearTimeout(t)
    // onValidate capture l'URL courante via le parent ; on ne le met pas en dép.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: mobile ? 'wrap' : 'nowrap', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: mobile ? '100%' : 180, position: 'relative' }}>
        <input
          type="url" inputMode="url" value={row.url} placeholder="https://exemple.fr/aide"
          onChange={e => onUrl(e.target.value)} onBlur={onValidate}
          style={{
            width: '100%', height: 42, border: `1px solid ${row.status === 'err' ? 'rgba(232,106,95,.55)' : row.status === 'ok' ? 'rgba(47,158,121,.55)' : '#D8DEE6'}`,
            borderRadius: 11, padding: '0 38px 0 13px', fontSize: 14, fontFamily: 'inherit',
          }} />
        {/* Indicateur de statut dans l'input. */}
        <span style={{ position: 'absolute', right: 12, top: 0, height: 42, display: 'flex', alignItems: 'center', fontSize: 15 }}>
          {row.status === 'checking' && <span style={{ width: 14, height: 14, border: '2px solid #CBD5DF', borderTopColor: NAVY, borderRadius: '50%', display: 'inline-block', animation: 'spin .7s linear infinite' }} />}
          {row.status === 'ok' && <span style={{ color: MINT, fontWeight: 700 }}>✓</span>}
          {row.status === 'err' && <span style={{ color: CORAL, fontWeight: 700 }}>✗</span>}
        </span>
      </div>
      <select value={row.type} onChange={e => onType(e.target.value as SourceType)}
              style={{ height: 42, border: '1px solid #D8DEE6', borderRadius: 11, padding: '0 8px', fontSize: 13.5, fontWeight: 600, background: '#fff', color: NAVY, cursor: 'pointer' }}>
        {SOURCE_TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button onClick={onRemove} disabled={!canRemove}
              style={{ width: 38, height: 42, border: 'none', borderRadius: 10, background: '#F4F6F8', color: FAINT, fontSize: 14, cursor: canRemove ? 'pointer' : 'not-allowed', opacity: canRemove ? 1 : 0.4, flexShrink: 0 }}>✕</button>
      {row.status === 'err' && (
        <div style={{ width: '100%', fontSize: 12.5, color: CORAL, fontWeight: 600, marginTop: -2 }}>{reasonFr(row.reason)}</div>
      )}
    </div>
  )
}
// Écran de génération PRÉSENTIEL : reçoit la progression réelle (libellé + %)
// publiée par le flux SSE via startGeneration. Aucune logique réseau ici (donc
// pas de piège StrictMode) : c'est le parent qui pilote l'état et enchaîne sur
// l'arbre dès la fin.
function ProcessingScreen({ mobile, stage, pct }: { mobile?: boolean; stage: string; pct: number }) {
  const width = Math.max(4, Math.min(100, pct))
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: mobile ? '60px 16px' : '88px 28px', textAlign: 'center', animation: 'cin .35s ease' }}>
      {/* Robot inline (palette Chapote) — antennes + yeux qui clignotent. */}
      <div style={{ display: 'inline-flex', position: 'relative' }}>
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" style={{ animation: 'bob 2.4s ease-in-out infinite' }}>
          <line x1="60" y1="20" x2="60" y2="34" stroke={MINT} strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="16" r="5" fill={CORAL} style={{ animation: 'blink 1.4s infinite' }} />
          <rect x="26" y="34" width="68" height="56" rx="16" fill="#fff" stroke={NAVY} strokeWidth="3" />
          <rect x="34" y="42" width="52" height="40" rx="11" fill={NAVY} />
          <circle cx="50" cy="62" r="6" fill="#fff" style={{ animation: 'blink 1.8s infinite' }} />
          <circle cx="70" cy="62" r="6" fill="#fff" style={{ animation: 'blink 1.8s infinite .2s' }} />
          <rect x="22" y="52" width="6" height="20" rx="3" fill={MINT} />
          <rect x="92" y="52" width="6" height="20" rx="3" fill={MINT} />
          <rect x="44" y="94" width="32" height="10" rx="5" fill={MINT} />
        </svg>
      </div>
      <h1 style={{ fontFamily: "'Clash Display',sans-serif", fontWeight: 600, fontSize: 26, margin: '18px 0 0', letterSpacing: '-.02em' }}>Notre IA construit votre arbre</h1>
      <p style={{ fontSize: 16, color: MINT, fontWeight: 600, margin: '14px 0 0', minHeight: 24 }}>{stage}</p>
      {/* Barre de progression RÉELLE (pct renvoyé par le flux SSE). */}
      <div style={{ height: 6, background: '#E8ECF0', borderRadius: 3, overflow: 'hidden', maxWidth: 320, margin: '22px auto 0' }}>
        <div style={{ height: '100%', width: `${width}%`, background: MINT, borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
      <p style={{ fontSize: 13, color: FAINT, margin: '20px auto 0', maxWidth: 360, lineHeight: 1.5 }}>
        Nous lisons vos pages et documents pour proposer un arbre pertinent — quelques secondes.
      </p>
    </div>
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
