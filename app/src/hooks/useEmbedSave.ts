// Échafaudage d'enregistrement COMMUN aux éditeurs embarqués (pages/embed/*) :
// dirty-tracking par signature, garde anti double-soumission, raccourci
// Ctrl/Cmd+S, avertissement beforeunload, et écoute du `request-save` du parent
// (pont postMessage). La persistance réelle (PUT/PATCH + émission 'saved') et les
// messages spécifiques (ex. highlight-module) restent à la charge de chaque page.
import { useCallback, useEffect, useRef, useState } from 'react'
import { postToParent, parseAdminMessage } from '../lib/embedBridge'
import type { AdminMessage } from '../lib/embedBridge'
import { errMsg } from '../utils/errors'

interface UseEmbedSaveParams {
  // Session prête : on n'écoute les messages du parent qu'à partir de là.
  ready: boolean
  // Origine + nonce du parent (validation stricte du pont postMessage).
  parentOrigin: string
  nonce: string
  // Identité du bot pour les messages émis (présent une fois le bot chargé).
  botId?: number
  // Signature mémoïsée de l'état éditable courant vs. dernière version enregistrée
  // ('' tant que rien n'est chargé) -> dirty.
  signature: string
  savedSignature: string
  // Vrai quand l'état est chargé et donc enregistrable (garde `!!tree`/`!!bot`).
  canSave: boolean
  // Persistance réelle : appel API + setSavedSig + émission 'saved'. Lève en cas
  // d'échec (le hook attrape, affiche la bannière et émet 'error').
  doSave: () => Promise<void>
  // Messages admin non gérés par le hook (ex. highlight-module) ; `request-save`
  // est déjà traité ici.
  onAdminMessage?: (msg: AdminMessage) => void
}

export interface EmbedSave {
  dirty: boolean
  saving: boolean
  saveErr: string | null
  // Exposé pour les pages qui alimentent aussi la bannière hors flux de save
  // (ex. repli de génération de l'éditeur d'arbre).
  setSaveErr: (v: string | null) => void
  // Référence STABLE : déclenche toujours la dernière version de l'enregistrement.
  save: () => void
}

export function useEmbedSave({
  ready, parentOrigin, nonce, botId,
  signature, savedSignature, canSave, doSave, onAdminMessage,
}: UseEmbedSaveParams): EmbedSave {
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // Modifié = l'état courant diffère de la dernière version enregistrée (rien
  // n'est enregistrable tant que savedSignature est vide = non chargé).
  const dirty = canSave && savedSignature !== '' && signature !== savedSignature

  // Enregistrement idempotent (garde anti double-soumission). Le succès et
  // l'émission 'saved' sont délégués à doSave ; l'échec -> bannière + 'error'.
  const savingRef = useRef(false)
  const save = useCallback(async () => {
    if (savingRef.current || !canSave) return
    savingRef.current = true
    setSaving(true); setSaveErr(null)
    try {
      await doSave()
    } catch (err) {
      const message = errMsg(err, "L'enregistrement a échoué.")
      setSaveErr(message)
      postToParent({ type: 'error', message, botId }, parentOrigin, nonce)
    } finally {
      setSaving(false); savingRef.current = false
    }
  }, [canSave, doSave, botId, parentOrigin, nonce])
  // Réfs stables vers les dernières versions, pour les écouteurs globaux (clavier
  // / postMessage) sans les ré-abonner à chaque édition.
  const saveFnRef = useRef(save); saveFnRef.current = save
  const onMsgRef = useRef(onAdminMessage); onMsgRef.current = onAdminMessage

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

  // -- Messages du parent (validés origin+nonce+source) : request-save géré ici,
  // le reste (ex. highlight-module) transmis à onAdminMessage.
  useEffect(() => {
    if (!ready) return
    const onMsg = (ev: MessageEvent) => {
      const msg = parseAdminMessage(ev, parentOrigin, nonce)
      if (!msg) return
      if (msg.type === 'request-save') saveFnRef.current()
      onMsgRef.current?.(msg)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [ready, parentOrigin, nonce])

  // -- Avertissement de fermeture si des changements ne sont pas enregistrés.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Référence stable exposée : appelle toujours la dernière version interne.
  const stableSave = useCallback(() => { saveFnRef.current() }, [])

  return { dirty, saving, saveErr, setSaveErr, save: stableSave }
}
