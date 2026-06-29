// Éditeur d'arbre EMBARQUÉ (/embed/tree-editor) ouvert par le plugin WordPress.
// Réutilise l'éditeur de workflow partagé (<TreeFlow>, wrapper lazy() — JAMAIS
// TreeFlowCanvas directement, pour garder le chunk @xyflow séparé du prérendu).
//
// Auth : Bearer embed_token uniquement (useEmbedSession), AUCUN cookie dashboard,
// AUCUN AuthContext. Le bot_id est porté par le jeton (le serveur le résout).
//
// Contrat API : GET /api/embed/bot, PUT /api/embed/bot/tree {tree_json},
// GET /api/embed/generate-status?job_id=. Pont postMessage (origin+nonce+source
// validés des deux côtés) : émet ready/dirty/saved/error, écoute request-save/
// highlight-module.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TreeFlow from '../../components/TreeFlow'
import ProcessingScreen from '../../components/ProcessingScreen'
import EmbedLayout, { EmbedSaveBar, SaveErrorBanner } from './EmbedLayout'
import { useEmbedSession } from '../../hooks/useEmbedSession'
import { useEmbedSave } from '../../hooks/useEmbedSave'
import { postToParent } from '../../lib/embedBridge'
import { stableStringify } from '../../utils/stableStringify'
import { errMsg } from '../../utils/errors'
import { useIsMobile } from '../../hooks/useMediaQuery'
import type { BotMode, DesignJson, Tree } from '../../types/bot'
import type { ModuleKey } from '../../types/billing'

// Forme renvoyée par GET /api/embed/bot (contrat gelé).
interface EmbedBot {
  id: number
  name: string
  mode: BotMode
  tree_json: Tree
  design_json: DesignJson
  public_key: string
}

// Statut de génération (GET /api/embed/generate-status).
interface GenStatus {
  status: 'running' | 'done' | 'error'
  stage?: string
  pct?: number
  tree_json?: Tree
  error?: string
}

const NAVY = '#1C3F5C'

export default function EmbedTreeEditor() {
  const { ready, error: sessionError, embApi, parentOrigin, nonce, jobId } = useEmbedSession()
  const mobile = useIsMobile(760)

  const [bot, setBot] = useState<EmbedBot | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  // Signature de l'arbre enregistré ('' tant que non chargé) -> dirty-tracking.
  const [savedSig, setSavedSig] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<ModuleKey | null>(null)
  // Écran d'attente piloté par le job de génération (si #job présent au montage).
  const [gen, setGen] = useState<{ stage: string; pct: number } | null>(
    jobId ? { stage: 'Préparation…', pct: 4 } : null,
  )

  // Signature mémoïsée de l'arbre courant (clés triées) -> dirty-tracking.
  const treeSig = useMemo(() => stableStringify(tree), [tree])

  // -- Persistance de l'arbre : PUT /api/embed/bot/tree (+ émission 'saved').
  const doSave = useCallback(async () => {
    if (!tree) return
    const resp = await embApi<{ tree_json: Tree; updated_at: string }>(
      '/api/embed/bot/tree', { method: 'PUT', body: { tree_json: tree } },
    )
    const t = resp.tree_json ?? tree
    setSavedSig(stableStringify(t))
    postToParent({ type: 'saved', botId: bot?.id, tree_json: t, savedAt: resp.updated_at }, parentOrigin, nonce)
  }, [tree, bot, embApi, parentOrigin, nonce])

  // Échafaudage d'enregistrement commun (dirty, Ctrl-S, beforeunload, request-save).
  // highlight-module reste spécifique à cette page (transmis via onAdminMessage).
  const { dirty, saving, saveErr, setSaveErr, save } = useEmbedSave({
    ready, parentOrigin, nonce, botId: bot?.id,
    signature: treeSig, savedSignature: savedSig, canSave: !!tree, doSave,
    onAdminMessage: msg => { if (msg.type === 'highlight-module') setHighlight(msg.module ?? null) },
  })

  // -- Chargement du bot (nom/mode/arbre). Émet 'ready' au parent une fois chargé.
  useEffect(() => {
    if (!ready) return
    let alive = true
    embApi<EmbedBot>('/api/embed/bot')
      .then(b => {
        if (!alive) return
        setBot(b)
        // Sans job en cours, l'arbre vient directement du bot ; avec job, il
        // arrivera par le polling (on laisse l'écran d'attente).
        if (!jobId) { setTree(b.tree_json); setSavedSig(stableStringify(b.tree_json)) }
        postToParent({ type: 'ready', botId: b.id }, parentOrigin, nonce)
      })
      .catch(err => { if (alive) setLoadErr(errMsg(err, 'Impossible de charger le chatbot.')) })
    return () => { alive = false }
  }, [ready, jobId, embApi, parentOrigin, nonce])

  // -- Polling du job de génération (si #job). Tout échec -> arbre actuel du bot
  // (jamais bloqué). Nettoyage au démontage (anti-StrictMode / fuite de timer).
  useEffect(() => {
    if (!ready || !jobId || !bot) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const fallback = (note?: string) => {
      setTree(bot.tree_json); setSavedSig(stableStringify(bot.tree_json)); setGen(null)
      if (note) setSaveErr(note)
    }
    async function poll() {
      try {
        const s = await embApi<GenStatus>(`/api/embed/generate-status?job_id=${encodeURIComponent(jobId!)}`)
        if (!alive) return
        if (s.status === 'running') {
          setGen({ stage: s.stage || 'Génération…', pct: s.pct ?? 0 })
          timer = setTimeout(poll, 1200)
        } else if (s.status === 'done') {
          const t = s.tree_json ?? bot!.tree_json
          setTree(t); setSavedSig(stableStringify(t)); setGen(null)
        } else {
          fallback(s.error || "La génération n'a pas abouti — voici l'arbre actuel, à personnaliser.")
        }
      } catch {
        if (alive) fallback()
      }
    }
    poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [ready, jobId, bot, embApi, setSaveErr])

  // -- Émet 'dirty' au parent à chaque bascule propre/modifié (spécifique à
  // l'éditeur d'arbre : l'apparence, qui autosave, ne notifie pas le dirty).
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (dirty === dirtyRef.current) return
    dirtyRef.current = dirty
    postToParent({ type: 'dirty', dirty, botId: bot?.id }, parentOrigin, nonce)
  }, [dirty, bot, parentOrigin, nonce])

  // ----- Rendu ---------------------------------------------------------------
  const error = sessionError || loadErr
  if (error) return <EmbedLayout error={error} />
  if (!bot) return <EmbedLayout loading loadingLabel="Chargement du chatbot…" />
  if (gen) {
    return (
      <EmbedLayout title={bot.name}>
        <ProcessingScreen mobile={mobile} stage={gen.stage} pct={gen.pct} />
      </EmbedLayout>
    )
  }

  return (
    <EmbedLayout
      title={bot.name}
      right={<EmbedSaveBar saving={saving} dirty={dirty} onSave={save} />}
    >
      <SaveErrorBanner message={saveErr} />
      <TreeFlow
        tree={tree ?? bot.tree_json}
        onChange={setTree}
        allowAI={bot.mode !== 'tree'}
        highlightModule={highlight}
      />
      <div style={{ marginTop: 14, fontSize: 12, color: NAVY, opacity: 0.55 }}>
        Astuce : Ctrl/Cmd + S pour enregistrer.
      </div>
    </EmbedLayout>
  )
}
