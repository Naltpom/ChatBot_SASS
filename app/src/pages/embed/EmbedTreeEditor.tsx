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
import { useCallback, useEffect, useRef, useState } from 'react'
import TreeFlow from '../../components/TreeFlow'
import ProcessingScreen from '../../components/ProcessingScreen'
import EmbedLayout, { StatusPill } from './EmbedLayout'
import { useEmbedSession } from '../../hooks/useEmbedSession'
import { postToParent, parseAdminMessage } from '../../lib/embedBridge'
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

// Sérialisation STABLE (clés triées) pour comparer arbre courant vs enregistré
// indépendamment de l'ordre des clés (le serveur peut le renvoyer différemment).
function stableStr(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce((a, k) => {
        a[k] = (val as Record<string, unknown>)[k]; return a
      }, {} as Record<string, unknown>)
      : val)
}

const NAVY = '#1C3F5C'
const MINT = '#2F9E79'

export default function EmbedTreeEditor() {
  const { ready, error: sessionError, embApi, parentOrigin, nonce, jobId } = useEmbedSession()
  const mobile = useIsMobile(760)

  const [bot, setBot] = useState<EmbedBot | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  // Signature de l'arbre enregistré ('' tant que non chargé) -> dirty-tracking.
  const [savedSig, setSavedSig] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<ModuleKey | null>(null)
  // Écran d'attente piloté par le job de génération (si #job présent au montage).
  const [gen, setGen] = useState<{ stage: string; pct: number } | null>(
    jobId ? { stage: 'Préparation…', pct: 4 } : null,
  )

  const dirty = !!tree && savedSig !== '' && stableStr(tree) !== savedSig

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
        if (!jobId) { setTree(b.tree_json); setSavedSig(stableStr(b.tree_json)) }
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
      setTree(bot.tree_json); setSavedSig(stableStr(bot.tree_json)); setGen(null)
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
          setTree(t); setSavedSig(stableStr(t)); setGen(null)
        } else {
          fallback(s.error || "La génération n'a pas abouti — voici l'arbre actuel, à personnaliser.")
        }
      } catch {
        if (alive) fallback()
      }
    }
    poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [ready, jobId, bot, embApi])

  // -- Émet 'dirty' au parent à chaque bascule propre/modifié.
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (dirty === dirtyRef.current) return
    dirtyRef.current = dirty
    postToParent({ type: 'dirty', dirty, botId: bot?.id }, parentOrigin, nonce)
  }, [dirty, bot, parentOrigin, nonce])

  // -- Avertissement de fermeture si des changements ne sont pas enregistrés.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // -- Enregistrement : PUT /api/embed/bot/tree. Garde anti double-soumission.
  const savingRef = useRef(false)
  const save = useCallback(async () => {
    if (savingRef.current || !tree) return
    savingRef.current = true
    setSaving(true); setSaveErr(null)
    try {
      const resp = await embApi<{ tree_json: Tree; updated_at: string }>(
        '/api/embed/bot/tree', { method: 'PUT', body: { tree_json: tree } },
      )
      const t = resp.tree_json ?? tree
      setSavedSig(stableStr(t))
      postToParent({ type: 'saved', botId: bot?.id, tree_json: t, savedAt: resp.updated_at }, parentOrigin, nonce)
    } catch (err) {
      const message = errMsg(err, "L'enregistrement a échoué.")
      setSaveErr(message)
      postToParent({ type: 'error', message, botId: bot?.id }, parentOrigin, nonce)
    } finally {
      setSaving(false); savingRef.current = false
    }
  }, [tree, bot, embApi, parentOrigin, nonce])
  // Référence stable vers la dernière version de `save` pour les écouteurs
  // globaux (clavier / postMessage) sans les ré-abonner à chaque édition.
  const saveFnRef = useRef(save); saveFnRef.current = save

  // -- Ctrl/Cmd+S -> enregistrer (empêche la boîte « Enregistrer la page »).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveFnRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // -- Messages du parent (validés origin+nonce+source) : request-save / highlight.
  useEffect(() => {
    if (!ready) return
    const onMsg = (ev: MessageEvent) => {
      const msg = parseAdminMessage(ev, parentOrigin, nonce)
      if (!msg) return
      if (msg.type === 'request-save') saveFnRef.current()
      else if (msg.type === 'highlight-module') setHighlight(msg.module ?? null)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ready, parentOrigin, nonce])

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
      right={
        <>
          {saving
            ? <StatusPill tone="busy">Enregistrement…</StatusPill>
            : dirty
              ? <StatusPill tone="dirty">● Modifié</StatusPill>
              : <StatusPill tone="saved">✓ Enregistré</StatusPill>}
          <button type="button" onClick={save} disabled={saving || !dirty}
                  style={{
                    background: dirty && !saving ? MINT : '#C7D0D9', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
                    fontFamily: 'inherit', cursor: dirty && !saving ? 'pointer' : 'default',
                  }}>
            Enregistrer
          </button>
        </>
      }
    >
      {saveErr && (
        <div style={{ marginBottom: 14, fontSize: 13, color: '#9A2820', background: '#FEF2F1', border: '1px solid #F8D7D3', borderRadius: 10, padding: '10px 13px' }}>
          {saveErr}
        </div>
      )}
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
