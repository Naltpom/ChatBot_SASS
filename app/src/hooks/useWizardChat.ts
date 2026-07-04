// Machine d'états du CHAT de configuration du wizard (pages/BotWizard.tsx) :
// questions, branchement conditionnel (when()), transitions, correction (goBack),
// liste active dérivée.
// La PAGE compose ce hook + le rendu ; la transition de fin (message d'accueil +
// passage à l'étape 'preset') est déléguée au parent via onComplete.
import { useState } from 'react'

// ---------------------------------------------------------------------------
// Machine d'étapes du wizard. 'processing' est un écran TRANSITOIRE (génération
// IA) : il n'a PAS sa propre pastille (les dots restent calés sur SOURCES).
export type Step = 'chat' | 'preset' | 'plan' | 'appearance' | 'sources' | 'processing' | 'tree' | 'done'
// Pastilles d'en-tête : 6 étapes « visibles » (processing/done exclus). L'étape
// 'plan' (configurateur + panier) s'intercale entre preset et apparence (spec §5.3).
export const STEP_DOTS: Step[] = ['chat', 'preset', 'plan', 'appearance', 'sources', 'tree']
export const STEP_CAPTION: Record<Step, string> = {
  chat: 'Discussion', preset: 'Proposition', plan: 'Abonnement', appearance: 'Apparence',
  sources: 'Vos contenus', processing: 'Génération', tree: 'Arbre', done: 'Terminé',
}
// Index « visible » d'une étape pour l'avancement des pastilles : processing se
// situe entre sources et tree, done est tout au bout.
export function dotIndex(step: Step): number {
  if (step === 'processing') return STEP_DOTS.indexOf('sources')
  if (step === 'done') return STEP_DOTS.length
  return STEP_DOTS.indexOf(step)
}

// ---------------------------------------------------------------------------
// Questions du chat : personnalisation (nom d'entreprise + ton de voix) et UN
// branchement conditionnel (la question de suivi n'apparaît que si 'orders' est coché).
//   - 'single' : un choix parmi des chips.
//   - 'multi'  : plusieurs choix (objectifs), avec un bouton « Continuer ».
//   - 'text'   : saisie libre (input stylé + envoi), rendue en bulle utilisateur.
// `when(answers, goals)` (optionnel) : prédicat de branchement — si présent et
// faux, la question est SAUTÉE (ni posée, ni rendue dans l'historique).
export type QType = 'single' | 'multi' | 'text'
export interface Question {
  key: string
  type: QType
  q: string
  opts: [string, string][]            // vide pour 'text'
  placeholder?: string                // 'text' uniquement
  when?: (answers: Record<string, string>, goals: string[]) => boolean
}
export const QUESTIONS: Question[] = [
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
export function optLabel(key: string, v: string): string {
  const q = QUESTIONS.find(x => x.key === key)
  const o = q && q.opts.find(p => p[0] === v)
  return o ? o[1] : v
}

// Liste des questions RÉELLEMENT actives selon les réponses (branchement when()).
export function activeQuestions(answers: Record<string, string>, goals: string[]): Question[] {
  return QUESTIONS.filter(q => !q.when || q.when(answers, goals))
}

// Message d'accueil personnalisé dérivé du nom d'entreprise + du ton de voix.
export function deriveWelcome(company: string, tone: string): string {
  const c = (company || '').trim()
  const chez = c ? ` chez ${c}` : ''
  if (tone === 'vous') return `Bonjour 👋 Bienvenue${chez}, comment puis-je vous aider ?`
  if (tone === 'tu') return `Salut 👋 Bienvenue${chez} ! Comment je peux t'aider ?`
  return `Bonjour 👋 Bienvenue${chez}. Comment vous aider ?`
}

// ---------------------------------------------------------------------------
// État du chat (qi/answers/goals/textDraft) + transitions. À la fin du chat, on
// appelle onComplete(welcome) : le parent personnalise le message d'accueil et
// passe à l'étape 'preset' (logique d'apparence/d'étape laissée à la page).
export interface ChatInit { qi?: number; answers?: Record<string, string>; goals?: string[] }

export function useWizardChat(init: ChatInit, onComplete: (welcome: string) => void) {
  const [qi, setQi] = useState(init.qi ?? 0)
  const [answers, setAnswers] = useState<Record<string, string>>(init.answers ?? {})
  const [goals, setGoals] = useState<string[]>(init.goals ?? [])
  const [textDraft, setTextDraft] = useState('')   // saisie en cours d'une question 'text'

  // Liste des questions actives (branchement when()) + question courante. La
  // liste est recalculée à chaque rendu : l'historique et la question courante
  // s'indexent dedans.
  const qList = activeQuestions(answers, goals)
  const cur = qi < qList.length ? qList[qi] : null
  const poolGoals = cur && cur.type === 'multi' ? cur.opts.filter(o => !goals.includes(o[0])) : []

  // Le branchement conditionnel (when()) modifie la liste des questions actives
  // EN FONCTION des réponses : on recalcule donc la liste à partir des réponses
  // MISES À JOUR avant de décider de l'étape suivante.
  function advance(a: Record<string, string>, g: string[]) {
    const list = activeQuestions(a, g)
    const next = qi + 1
    if (next >= list.length) {
      // Fin du chat : on personnalise le message d'accueil (entreprise + ton).
      onComplete(deriveWelcome(a.company, a.tone))
    } else {
      setQi(next)
    }
  }
  function answerSingle(key: string, v: string) {
    const a = { ...answers, [key]: v }
    setAnswers(a)
    advance(a, goals)
  }
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
  function reset() {
    setQi(0); setAnswers({}); setGoals([]); setTextDraft('')
  }

  return {
    qi, setQi, answers, setAnswers, goals, setGoals, textDraft, setTextDraft,
    qList, cur, poolGoals,
    answerSingle, answerText, toggleGoal, nextMulti, goBack, reset,
  }
}
