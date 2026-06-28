// Construction d'arbre du wizard — LOGIQUE PURE (entrée → sortie, sans état React).
// Extrait tel quel de pages/BotWizard.tsx (comportement strictement identique) :
//   - rawBranches : réponses du chat → ébauche d'arbre (modèle interne Branch).
//   - buildTree (+ makeNode/slug) : ébauche → tree_json réel ({ start, nodes }).
// allowAI=false (mode tree pur) → les destinations IA deviennent un message.
// Aucune dépendance à la palette/au design : 100% testable isolément.
import type { Tree, TreeNode } from '../types/bot'

// ---------------------------------------------------------------------------
// Brouillon d'arbre éditable (modèle interne du wizard, façon BotCreate.dc.html)
export interface SubBranch { answer: string; type: string; title: string }
export interface Branch { answer: string; type: string; title: string; subs: SubBranch[] }

// Construit l'ébauche d'arbre à partir des réponses du chat.
export function rawBranches(answers: Record<string, string>, goals: string[]): Branch[] {
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

export function buildTree(branches: Branch[], welcome: string, allowAI: boolean): Tree {
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
