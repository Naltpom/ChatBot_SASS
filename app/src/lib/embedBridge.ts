// Pont postMessage entre l'éditeur embarqué (pages/embed/*, servi par cette app)
// et la fenêtre admin parente (back-office WordPress du plugin). Le plugin ouvre
// l'éditeur dans une iframe (window.parent) ou une popup (window.opener) ; ce
// module gère les DEUX cas.
//
// CONTRAT GELÉ (source de vérité partagée backend/plugin) :
//   éditeur → parent (postMessage vers `o` = adminOrigin) :
//     { source:'chapote-editor', nonce, type:'ready'|'dirty'|'saved'|'error',
//       botId?, tree_json?, savedAt?, dirty?, message? }
//   parent → éditeur (vers l'origine appBase) :
//     { source:'chapote-admin', nonce, type:'request-save'|'highlight-module', module? }
//
// SÉCURITÉ : validation STRICTE des DEUX côtés (origin + nonce + source). On ne
// poste JAMAIS un payload avec targetOrigin '*' (fuite du tree/jeton vers
// n'importe quelle frame) — l'envoi est refusé si parentOrigin est absent/'*'.
import type { Tree } from '../types/bot'
import type { ModuleKey } from '../types/billing'

// Marqueurs de provenance (anti-collision avec d'autres émetteurs postMessage).
export const EDITOR_SOURCE = 'chapote-editor' as const
export const ADMIN_SOURCE = 'chapote-admin' as const

// Types de messages éditeur → parent.
export type EditorMessageType = 'ready' | 'dirty' | 'saved' | 'error'
// Types de messages parent → éditeur.
export type AdminMessageType = 'request-save' | 'highlight-module'

// Charge utile éditeur → parent (hors source/nonce, ajoutés par postToParent).
export interface EditorPayload {
  type: EditorMessageType
  botId?: number
  tree_json?: Tree
  savedAt?: string
  dirty?: boolean
  message?: string
}

// Message complet reçu côté parent (forme documentaire, validée par le plugin).
export interface EditorMessage extends EditorPayload {
  source: typeof EDITOR_SOURCE
  nonce: string
}

// Message parent → éditeur, après validation par parseAdminMessage.
export interface AdminMessage {
  source: typeof ADMIN_SOURCE
  nonce: string
  type: AdminMessageType
  // Présent pour 'highlight-module' (null = effacer le surlignage).
  module?: ModuleKey | null
}

// Fenêtre cible = parent (iframe) ou opener (popup). null si l'éditeur est
// ouvert en pleine page (aucune fenêtre admin à notifier).
function adminWindow(): Window | null {
  if (typeof window === 'undefined') return null
  if (window.parent && window.parent !== window) return window.parent
  return window.opener || null
}

// Poste un message à la fenêtre admin. targetOrigin est TOUJOURS l'adminOrigin
// explicite — jamais '*'. Refuse l'envoi si parentOrigin est vide ou '*' (ne
// jamais diffuser un payload). No-op si aucune fenêtre admin (éditeur autonome).
export function postToParent(payload: EditorPayload, parentOrigin: string, nonce: string): void {
  const target = adminWindow()
  if (!target) return
  if (!parentOrigin || parentOrigin === '*') return
  const msg: EditorMessage = { source: EDITOR_SOURCE, nonce, ...payload }
  try {
    target.postMessage(msg, parentOrigin)
  } catch {
    // postMessage peut lever si la fenêtre cible a été fermée entre-temps.
  }
}

// Valide un message ENTRANT (depuis la fenêtre admin) : origin === adminOrigin,
// source === 'chapote-admin', nonce identique, type connu. Renvoie le message
// typé si tout concorde, sinon null (message ignoré silencieusement).
export function parseAdminMessage(
  ev: MessageEvent,
  parentOrigin: string,
  nonce: string,
): AdminMessage | null {
  if (!parentOrigin || ev.origin !== parentOrigin) return null
  const d = ev.data as Partial<AdminMessage> | null | undefined
  if (!d || typeof d !== 'object') return null
  if (d.source !== ADMIN_SOURCE) return null
  if (d.nonce !== nonce) return null
  if (d.type !== 'request-save' && d.type !== 'highlight-module') return null
  return d as AdminMessage
}
