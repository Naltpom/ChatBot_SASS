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
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppearancePanel from '../../components/AppearancePanel'
import WidgetPreview from '../../components/WidgetPreview'
import EmbedLayout, { EmbedSaveBar, SaveErrorBanner } from './EmbedLayout'
import { useEmbedSession } from '../../hooks/useEmbedSession'
import { useEmbedSave } from '../../hooks/useEmbedSave'
import { postToParent } from '../../lib/embedBridge'
import { stableStringify } from '../../utils/stableStringify'
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

export default function EmbedAppearance() {
  const { ready, error: sessionError, embApi, parentOrigin, nonce } = useEmbedSession()
  const mobile = useIsMobile(900)

  const [bot, setBot] = useState<EmbedBot | null>(null)
  const [design, setDesign] = useState<DesignJson>({})
  // Nom édité localement (aperçu seulement — non persisté, cf. en-tête de fichier).
  const [botName, setBotName] = useState('')
  const [savedSig, setSavedSig] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Signature mémoïsée de design_json (clés triées) -> dirty-tracking.
  const designSig = useMemo(() => stableStringify(design), [design])

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
        setSavedSig(stableStringify(b.design_json || {}))
        postToParent({ type: 'ready', botId: b.id }, parentOrigin, nonce)
      })
      .catch(err => { if (alive) setLoadErr(errMsg(err, 'Impossible de charger le chatbot.')) })
    return () => { alive = false }
  }, [ready, embApi, parentOrigin, nonce])

  // -- Fusion d'un changement partiel d'apparence dans l'état contrôlé.
  const onChange = useCallback((partial: Partial<DesignJson>) => {
    setDesign(prev => ({ ...prev, ...partial }))
  }, [])

  // -- Persistance de l'apparence : PATCH /api/embed/bot/appearance (+ 'saved').
  const doSave = useCallback(async () => {
    if (!bot) return
    const resp = await embApi<{ design_json: DesignJson }>(
      '/api/embed/bot/appearance', { method: 'PATCH', body: { design_json: design } },
    )
    const d = resp.design_json ?? design
    setSavedSig(stableStringify(d))
    postToParent({ type: 'saved', botId: bot.id, savedAt: new Date().toISOString() }, parentOrigin, nonce)
  }, [bot, design, embApi, parentOrigin, nonce])

  // Échafaudage d'enregistrement commun (dirty, Ctrl-S, beforeunload, request-save).
  const { dirty, saving, saveErr, save } = useEmbedSave({
    ready, parentOrigin, nonce, botId: bot?.id,
    signature: designSig, savedSignature: savedSig, canSave: !!bot, doSave,
  })

  // -- Autosave débouncé : 700 ms après le dernier changement (designSig le réarme).
  useEffect(() => {
    if (!dirty) return
    const h = setTimeout(save, 700)
    return () => clearTimeout(h)
  }, [dirty, designSig, save])

  const error = sessionError || loadErr
  if (error) return <EmbedLayout error={error} />
  if (!bot) return <EmbedLayout loading loadingLabel="Chargement du chatbot…" />

  return (
    <EmbedLayout
      title={botName || bot.name}
      right={<EmbedSaveBar saving={saving} dirty={dirty} onSave={save} />}
    >
      <SaveErrorBanner message={saveErr} />
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
