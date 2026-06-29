// Éditeur d'APPARENCE embarqué (/embed/appearance) ouvert par le plugin WordPress.
// Panneau de réglages partagé (<AppearancePanel>) + aperçu live du widget
// (<WidgetPreview>, flottant). Auth Bearer embed_token (useEmbedSession), sans
// cookie ni AuthContext.
//
// Contrat API : GET /api/embed/bot, PATCH /api/embed/bot/appearance {design_json}.
// Autosave débouncé + bouton/Ctrl+S + request-save du parent ; émet ready/saved/
// error (pont postMessage validé origin+nonce+source).
//
// ⚠ « Nom du bot » : le champ du sous-onglet En-tête (AppearanceForm) est édité
// en LOCAL uniquement (aperçu) — il N'est PAS persisté ici : le contrat
// d'apparence ne porte que design_json ; le plugin gère le nom du bot ailleurs.
import { useCallback, useEffect, useRef, useState } from 'react'
import AppearancePanel from '../../components/AppearancePanel'
import WidgetPreview from '../../components/WidgetPreview'
import EmbedLayout, { StatusPill } from './EmbedLayout'
import { useEmbedSession } from '../../hooks/useEmbedSession'
import { postToParent, parseAdminMessage } from '../../lib/embedBridge'
import { errMsg } from '../../utils/errors'
import { useIsMobile } from '../../hooks/useMediaQuery'
import type { BotMode, DesignJson, Tree } from '../../types/bot'

interface EmbedBot {
  id: number
  name: string
  mode: BotMode
  tree_json: Tree
  design_json: DesignJson
  public_key: string
}

// Sérialisation STABLE (clés triées) pour le dirty-tracking de design_json.
function stableStr(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce((a, k) => {
        a[k] = (val as Record<string, unknown>)[k]; return a
      }, {} as Record<string, unknown>)
      : val)
}

const MINT = '#2F9E79'

export default function EmbedAppearance() {
  const { ready, error: sessionError, embApi, parentOrigin, nonce } = useEmbedSession()
  const mobile = useIsMobile(900)

  const [bot, setBot] = useState<EmbedBot | null>(null)
  const [design, setDesign] = useState<DesignJson>({})
  // Nom édité localement (aperçu seulement — non persisté, cf. en-tête de fichier).
  const [botName, setBotName] = useState('')
  const [savedSig, setSavedSig] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const designSig = stableStr(design)
  const dirty = !!bot && savedSig !== '' && designSig !== savedSig

  // -- Chargement du bot (design + nom + arbre/mode pour l'aperçu). Émet 'ready'.
  useEffect(() => {
    if (!ready) return
    let alive = true
    embApi<EmbedBot>('/api/embed/bot')
      .then(b => {
        if (!alive) return
        setBot(b)
        setDesign(b.design_json || {})
        setBotName(b.name)
        setSavedSig(stableStr(b.design_json || {}))
        postToParent({ type: 'ready', botId: b.id }, parentOrigin, nonce)
      })
      .catch(err => { if (alive) setLoadErr(errMsg(err, 'Impossible de charger le chatbot.')) })
    return () => { alive = false }
  }, [ready, embApi, parentOrigin, nonce])

  // -- Fusion d'un changement partiel d'apparence dans l'état contrôlé.
  const onChange = useCallback((partial: Partial<DesignJson>) => {
    setDesign(prev => ({ ...prev, ...partial }))
  }, [])

  // -- Enregistrement : PATCH /api/embed/bot/appearance. Anti double-soumission.
  const savingRef = useRef(false)
  const save = useCallback(async () => {
    if (savingRef.current || !bot) return
    savingRef.current = true
    setSaving(true); setSaveErr(null)
    try {
      const resp = await embApi<{ design_json: DesignJson }>(
        '/api/embed/bot/appearance', { method: 'PATCH', body: { design_json: design } },
      )
      const d = resp.design_json ?? design
      setSavedSig(stableStr(d))
      postToParent({ type: 'saved', botId: bot.id, savedAt: new Date().toISOString() }, parentOrigin, nonce)
    } catch (err) {
      const message = errMsg(err, "L'enregistrement a échoué.")
      setSaveErr(message)
      postToParent({ type: 'error', message, botId: bot.id }, parentOrigin, nonce)
    } finally {
      setSaving(false); savingRef.current = false
    }
  }, [bot, design, embApi, parentOrigin, nonce])
  const saveFnRef = useRef(save); saveFnRef.current = save

  // -- Autosave débouncé : 700 ms après le dernier changement (designSig le réarme).
  useEffect(() => {
    if (!dirty) return
    const h = setTimeout(() => saveFnRef.current(), 700)
    return () => clearTimeout(h)
  }, [dirty, designSig])

  // -- Ctrl/Cmd+S -> enregistrement immédiat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveFnRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // -- request-save du parent -> enregistrement immédiat (highlight-module ignoré ici).
  useEffect(() => {
    if (!ready) return
    const onMsg = (ev: MessageEvent) => {
      const msg = parseAdminMessage(ev, parentOrigin, nonce)
      if (msg?.type === 'request-save') saveFnRef.current()
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ready, parentOrigin, nonce])

  // -- Avertissement de fermeture si modifications non enregistrées (autosave en vol).
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const error = sessionError || loadErr
  if (error) return <EmbedLayout error={error} />
  if (!bot) return <EmbedLayout loading loadingLabel="Chargement du chatbot…" />

  return (
    <EmbedLayout
      title={botName || bot.name}
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
      {/* Panneau de réglages (gauche) ; l'aperçu widget flotte (position fixe) à
          droite et reflète design_json en direct. Marge basse pour ne pas le
          masquer par le widget flottant. */}
      <div style={{ maxWidth: 680, paddingBottom: mobile ? 380 : 120 }}>
        <AppearancePanel
          design={design}
          botName={botName}
          onChange={onChange}
          onNameChange={setBotName}
        />
      </div>
      <WidgetPreview
        design={design}
        mode={bot.mode}
        tree={bot.tree_json}
        botName={botName || bot.name}
        defaultOpen={!mobile}
        positionOverride="right"
      />
    </EmbedLayout>
  )
}
