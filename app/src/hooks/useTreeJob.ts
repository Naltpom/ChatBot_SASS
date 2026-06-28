// Job de génération d'arbre du wizard + flux SSE (pages/BotWizard.tsx).
// Extrait tel quel (comportement strictement identique) : POST /api/tree/jobs
// (démarre la tâche de fond) -> streamSSE (progression temps réel) -> dès le
// tree prêt on passe à l'étape arbre. Tout échec/skip -> ébauche par défaut.
// Le hook possède l'état de progression (genStage), l'AbortController et son
// nettoyage au démontage (anti fuite de ressource) ; la page fournit les entrées
// (sources/contexte/fichiers) et les setters de résultat (note/arbre/étape).
import { useEffect, useRef, useState } from 'react'
import { postForm, streamSSE } from '../api'
import type { Tree } from '../types/bot'
import type { Step } from './useWizardChat'

// Note douce affichée quand on retombe sur l'ébauche par défaut.
const GEN_FALLBACK = "Nous n'avons pas pu générer depuis vos pages, voici un modèle de départ."

export interface GenStage { label: string; pct: number }

export interface GenerateArgs {
  canGenerate: boolean
  sources: { url: string; type: string }[]
  context: string
  files: File[]
  presetTree: () => Tree
  setGenNote: (s: string) => void
  setTreeJson: (t: Tree) => void
  setStep: (s: Step) => void
}

export function useTreeJob() {
  // Progression réelle de la génération (flux SSE) affichée par ProcessingScreen.
  const [genStage, setGenStage] = useState<GenStage>({ label: 'Préparation…', pct: 3 })
  const genAbort = useRef<AbortController | null>(null)

  // Coupe un flux SSE en cours si on quitte le wizard pendant la génération.
  useEffect(() => () => { genAbort.current?.abort() }, [])

  // Génération RÉELLE avec progression SSE. Déclenchée par le clic « Générer »
  // (un gestionnaire d'événement, donc PAS rejoué par le double-montage
  // StrictMode — contrairement à un effet). Étapes : POST /jobs (démarre la
  // tâche de fond) -> streamSSE (progression temps réel) -> dès le tree prêt on
  // passe AUTOMATIQUEMENT à l'étape arbre. Tout échec/skip -> ébauche par défaut.
  async function generate(args: GenerateArgs) {
    const { canGenerate, sources, context, files, presetTree, setGenNote, setTreeJson, setStep } = args
    setGenNote('')
    setGenStage({ label: 'Préparation…', pct: 4 })
    setStep('processing')
    if (!canGenerate) {  // garde-fou : aucune source exploitable
      setGenNote(GEN_FALLBACK); setTreeJson(presetTree()); setStep('tree'); return
    }
    const form = new FormData()
    form.append('sources', JSON.stringify(sources))
    form.append('context', context)
    files.forEach(f => form.append('files', f))

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

  return { genStage, generate }
}
