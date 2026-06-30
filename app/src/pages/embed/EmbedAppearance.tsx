// Éditeur d'APPARENCE embarqué (/embed/appearance) ouvert par le plugin WordPress.
// Panneau de réglages partagé (<AppearancePanel>) + aperçu = le VRAI widget.js
// chargé en iframe (/widget-frame, mode flottant, preview_token), pour tester
// l'apparence en « mode prod » exact (zéro divergence d'un composant React).
//
// Aperçu LIVE sans recharger à chaque frappe :
//  - cosmétique (couleurs, position, taille, police, thème…) -> postMessage
//    'chapote-apply-design' : le widget remplace sa feuille de style à chaud ;
//  - structurel (icône, message d'accueil, lanceur…) -> rechargement de l'iframe
//    APRÈS l'autosave (le widget bootstrape alors le design sauvé).
// Le widget n'accepte le re-skin QUE de notre origine + nonce (reflétés et
// validés par /widget-frame). Le pont admin<->éditeur (postToParent) reste pour
// 'ready'/'saved'/'error' vers le plugin.
//
// Auth Bearer embed_token (useEmbedSession), sans cookie ni AuthContext.
// Contrat API : GET /api/embed/bot, PATCH /api/embed/bot/appearance {design_json},
// POST /api/embed/preview-token -> {preview_token, public_key}.
//
// ⚠ « Nom du bot » : édité en LOCAL uniquement (non persisté ici).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppearancePanel from '../../components/AppearancePanel'
import EmbedLayout, { EmbedSaveBar, SaveErrorBanner } from './EmbedLayout'
import { useEmbedSession } from '../../hooks/useEmbedSession'
import { useEmbedSave } from '../../hooks/useEmbedSave'
import { postToParent } from '../../lib/embedBridge'
import { stableStringify } from '../../utils/stableStringify'
import { errMsg } from '../../utils/errors'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { API_URL } from '../../api'
import type { BotMode, DesignJson, Tree } from '../../types/bot'

interface EmbedBot {
  id: number
  name: string
  mode: BotMode
  tree_json: Tree
  design_json: DesignJson
  public_key: string
}

// Clés du design NON exprimées en CSS (le re-skin à chaud ne les couvre pas) :
// un changement de l'une d'elles déclenche un rechargement de l'iframe après save.
const STRUCTURAL_KEYS = [
  'icon', 'avatarImage', 'welcomeMessage', 'launcherText', 'greeting', 'greetingText',
  'headerAvatar', 'headerStatus', 'statusLabel', 'poweredBy',
]

// Origine de l'API (= origine de l'iframe widget) pour cibler/valider postMessage.
const API_ORIGIN = (() => {
  try { return new URL(API_URL, 'http://localhost').origin } catch { return '' }
})()

export default function EmbedAppearance() {
  const { ready, error: sessionError, embApi, parentOrigin, nonce } = useEmbedSession()
  // Seuil bas : l'iframe d'apparence (hôte plugin) est étroite ; on garde le
  // côte-à-côte le plus longtemps possible et on n'empile qu'en dernier recours.
  const mobile = useIsMobile(640)

  const [bot, setBot] = useState<EmbedBot | null>(null)
  const [design, setDesign] = useState<DesignJson>({})
  const [botName, setBotName] = useState('')
  const [savedSig, setSavedSig] = useState('')
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Aperçu = vrai widget en iframe.
  const [previewToken, setPreviewToken] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [reloadKey, setReloadKey] = useState(0)   // bumpé -> recharge l'iframe (structurel)
  const [frameReady, setFrameReady] = useState(false) // le widget a armé son écouteur
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const lastFrameDesignRef = useRef<DesignJson>({}) // design que l'iframe reflète (sauvé)
  // Nonce de re-skin (≠ nonce admin) : le widget n'accepte nos messages qu'avec lui.
  const reskinNonceRef = useRef<string>('')
  if (!reskinNonceRef.current) {
    const a = new Uint8Array(16)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a)
    reskinNonceRef.current = Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
  }

  const designSig = useMemo(() => stableStringify(design), [design])

  // -- Chargement du bot (design + nom + arbre/mode). Émet 'ready' au plugin.
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
        lastFrameDesignRef.current = b.design_json || {}
        postToParent({ type: 'ready', botId: b.id }, parentOrigin, nonce)
      })
      .catch(err => { if (alive) setLoadErr(errMsg(err, 'Impossible de charger le chatbot.')) })
    return () => { alive = false }
  }, [ready, embApi, parentOrigin, nonce])

  // -- (Re)charge l'iframe d'aperçu : mint un preview_token frais (évite l'expiration
  // sur une longue session), réarme frameReady, bumpe reloadKey (force le reload).
  const loadFrame = useCallback(() => {
    embApi<{ preview_token: string; public_key: string }>(
      '/api/embed/preview-token', { method: 'POST' },
    ).then(d => {
      setFrameReady(false)
      setPreviewToken(d.preview_token)
      setPublicKey(d.public_key)
      setReloadKey(k => k + 1)
    }).catch(() => { /* aperçu indisponible : non bloquant pour l'édition */ })
  }, [embApi])

  // Premier montage de l'iframe une fois le bot chargé.
  useEffect(() => {
    if (ready && bot && !previewToken) loadFrame()
  }, [ready, bot, previewToken, loadFrame])

  // -- Le widget signale qu'il est prêt à recevoir le design (handshake).
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== API_ORIGIN) return
      const d = e.data
      if (d && d.source === 'chapote-widget' && d.type === 'reskin-ready'
          && d.nonce === reskinNonceRef.current) {
        setFrameReady(true)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // -- Re-skin à chaud : pousse le design courant au widget (débouncé). Cosmétique
  // appliqué instantanément côté widget ; déclenché aussi dès que frameReady passe.
  useEffect(() => {
    if (!frameReady) return
    const w = frameRef.current?.contentWindow
    if (!w) return
    const h = setTimeout(() => {
      w.postMessage(
        { type: 'chapote-apply-design', nonce: reskinNonceRef.current, design },
        API_ORIGIN,
      )
    }, 100)
    return () => clearTimeout(h)
  }, [designSig, frameReady, design])

  // -- Changement STRUCTUREL : après un autosave réussi (savedSig change), si une
  // clé non-CSS a bougé depuis le dernier rendu d'iframe, on recharge (le bootstrap
  // lira le design sauvé). Le cosmétique, lui, est déjà appliqué à chaud.
  useEffect(() => {
    if (!previewToken) return
    const prev = lastFrameDesignRef.current as Record<string, unknown>
    const cur = design as Record<string, unknown>
    const structuralChanged = STRUCTURAL_KEYS.some(
      k => stableStringify(prev[k]) !== stableStringify(cur[k]),
    )
    if (structuralChanged) {
      lastFrameDesignRef.current = design
      loadFrame()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSig])

  const onChange = useCallback((partial: Partial<DesignJson>) => {
    setDesign(prev => ({ ...prev, ...partial }))
  }, [])

  // -- Persistance : PATCH /api/embed/bot/appearance (+ 'saved' au plugin).
  const doSave = useCallback(async () => {
    if (!bot) return
    const resp = await embApi<{ design_json: DesignJson }>(
      '/api/embed/bot/appearance', { method: 'PATCH', body: { design_json: design } },
    )
    const d = resp.design_json ?? design
    setSavedSig(stableStringify(d))
    postToParent({ type: 'saved', botId: bot.id, savedAt: new Date().toISOString() }, parentOrigin, nonce)
  }, [bot, design, embApi, parentOrigin, nonce])

  const { dirty, saving, saveErr, save } = useEmbedSave({
    ready, parentOrigin, nonce, botId: bot?.id,
    signature: designSig, savedSignature: savedSig, canSave: !!bot, doSave,
  })

  // -- Autosave débouncé : 700 ms après le dernier changement.
  useEffect(() => {
    if (!dirty) return
    const h = setTimeout(save, 700)
    return () => clearTimeout(h)
  }, [dirty, designSig, save])

  // URL de l'iframe widget (mode flottant : key + preview_token + origine/nonce de
  // re-skin + reloadKey pour forcer le rechargement structurel).
  const frameSrc = useMemo(() => {
    if (!previewToken || !publicKey) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const qs = new URLSearchParams({
      key: publicKey,
      preview_token: previewToken,
      parent_origin: origin,
      design_nonce: reskinNonceRef.current,
      r: String(reloadKey),
    })
    return `${API_URL}/widget-frame?${qs.toString()}`
  }, [previewToken, publicKey, reloadKey])

  const error = sessionError || loadErr
  if (error) return <EmbedLayout error={error} />
  if (!bot) return <EmbedLayout loading loadingLabel="Chargement du chatbot…" />

  return (
    <EmbedLayout
      title={botName || bot.name}
      right={<EmbedSaveBar saving={saving} dirty={dirty} onSave={save} />}
    >
      <SaveErrorBanner message={saveErr} />
      {/* Mise en page 2 colonnes (empilée en mobile) : réglages à gauche, aperçu
          CONTENU à droite. On N'utilise PLUS d'overlay fixe — une iframe capte les
          clics sur toute sa surface (même transparente) et bloquerait le panneau.
          Le widget flotte en bas-droite DE son cadre (position:fixed = viewport de
          l'iframe). */}
      <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row',
                    gap: 16, alignItems: 'flex-start' }}>
        <div style={{ order: mobile ? 2 : 1, flex: '1 1 auto', minWidth: 0,
                      width: '100%', maxWidth: mobile ? '100%' : 680 }}>
          <AppearancePanel
            design={design}
            botName={botName}
            onChange={onChange}
            onNameChange={setBotName}
          />
        </div>
        {/* Aperçu = vrai widget en CADRE CONTENU (jamais un overlay : une iframe
            capte les clics partout). Collant (top) pour rester visible au scroll ;
            placé EN HAUT si la mise en page empile (sinon il file tout en bas). */}
        <div style={{
          order: mobile ? 1 : 2,
          flex: mobile ? '0 0 auto' : '0 0 340px',
          width: mobile ? '100%' : 340,
          position: 'sticky',
          top: 8,
          alignSelf: 'flex-start',
        }}>
          {frameSrc ? (
            <iframe
              key={reloadKey}
              ref={frameRef}
              src={frameSrc}
              title="Aperçu du widget"
              allow="clipboard-write"
              style={{
                width: '100%',
                height: mobile ? 320 : 452,
                border: '1px solid #e6e7e9',
                borderRadius: 12,
                background: '#f6f7f9',
                display: 'block',
              }}
            />
          ) : (
            <div style={{ height: mobile ? 320 : 452, border: '1px solid #e6e7e9',
                          borderRadius: 12, background: '#f6f7f9', display: 'grid',
                          placeItems: 'center', color: '#646970', fontSize: 13 }}>
              Préparation de l’aperçu…
            </div>
          )}
        </div>
      </div>
    </EmbedLayout>
  )
}
