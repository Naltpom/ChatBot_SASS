// treeGraph — SOURCE DE VÉRITÉ pure des transformations de l'arbre de
// conversation pour l'éditeur de workflow (style n8n/Make). AUCUN React, AUCUN
// import @xyflow. Tout est testable/portable.
//
// Différence clé avec l'ancien TreeFlow : React Flow rend un VRAI GRAPHE. Un
// nœud = une seule box ; aretes multiples entrantes ; cycles natifs. On a donc
// SUPPRIMÉ toute la machinerie possession/claimed/'link'/back-edge : un « retour
// au menu » (option next===start) est simplement une arête vers le nœud start,
// et le type « Lien » disparaît (c'est le geste « tirer une arête vers un nœud
// existant »).
//
// CONTRAT validate_tree (api/src/services/tree_engine.py) — l'éditeur émet
// TOUJOURS un Tree valide : chaque nœud a un message NON VIDE ; le nœud start a
// >=1 option ; chaque option.next pointe vers un id existant ou '__ai__'.
//
// MODÈLE inchangé (on AJOUTE seulement node.pos) :
//   Tree = { start?, nodes?: Record<id, TreeNode> }
//   TreeNode = { message?, options?, type?, url?, fields?, pos? }
//   NodeOption = { label, next }   // next==='__ai__' = bascule IA (pas un nœud)

import dagre from '@dagrejs/dagre'
import type { Tree, TreeNode } from '../../types/bot'

// ----- Type d'un NOEUD dérivé de node.type (l'IA n'est PAS un type de nœud :
// c'est une CIBLE d'arête, materialisée par un nœud sentinelle '__ai__'). -----
export type NodeKind = 'q' | 'hum' | 'act' | 'ai-sentinel'

// Couleurs (bord-gauche carte + pastille + badge) et libellés — repris de
// TreeFlow.tsx (q=#2F9E79 Question, ia=#8C6DFF IA, hum=#E86A5F Conseiller,
// act=#2563EB Action).
export const KIND_COLOR: Record<NodeKind, string> = {
  q: '#2F9E79',
  hum: '#E86A5F',
  act: '#2563EB',
  'ai-sentinel': '#8C6DFF',
}
export const KIND_LABEL: Record<NodeKind, string> = {
  q: 'Question',
  hum: 'Conseiller',
  act: 'Action',
  'ai-sentinel': 'IA',
}

// Identifiant sentinelle de l'IA (cible d'arête, pas un vrai nœud du tree).
export const AI_ID = '__ai__'

// Légende affichée dans la barre d'outils (mêmes 4 couleurs que l'actuel).
export const LEGEND: { color: string; label: string }[] = [
  { color: KIND_COLOR.q, label: KIND_LABEL.q },
  { color: KIND_COLOR['ai-sentinel'], label: KIND_LABEL['ai-sentinel'] },
  { color: KIND_COLOR.hum, label: KIND_LABEL.hum },
  { color: KIND_COLOR.act, label: KIND_LABEL.act },
]

// ----- id unique stable (PORTÉ de TreeFlow.tsx l.48-53) -----
let _seq = 1
export function newNodeId(nodes: Record<string, unknown>): string {
  let id: string
  do { id = 'n' + Date.now().toString(36).slice(-4) + _seq++ } while (nodes[id])
  return id
}

// ----- Normalisation défensive -----
function asTree(raw: unknown): Tree {
  return raw && typeof raw === 'object' ? (raw as Tree) : {}
}
function clone(t: unknown): Tree {
  return JSON.parse(JSON.stringify(asTree(t)))
}
function startId(t: Tree): string {
  return t.start || 'root'
}

// Kind d'un nœud du tree (hors sentinelle).
function kindOfNode(node: TreeNode | undefined): NodeKind {
  if (!node) return 'q'
  if (node.type === 'handoff') return 'hum'
  if (node.type === 'appointment' || node.type === 'lead') return 'act'
  return 'q'
}

// ============================================================================
// toGraph — projette le tree en nœuds/arêtes pour le rendu graphe.
// ============================================================================
export interface GNode {
  id: string
  kind: NodeKind
  message: string
  type?: TreeNode['type']
  url?: string
  fields?: string[]
  hasPos: boolean
  isStart: boolean
}
export interface GEdge {
  id: string          // `${parentId}::${optIdx}`
  source: string
  target: string      // id existant ou '__ai__'
  label: string
  optIdx: number
  back: boolean       // arête de RETOUR/boucle (cible déjà atteinte) — rendue en
                      // pointillé et EXCLUE du layout dagre (anti-spaghetti)
  bend?: { x: number; y: number }  // point de pliage manuel (option.bend), si présent
}

// Classe les VRAIES « back-edges » par DFS depuis `start` : une arête est de
// retour/boucle UNIQUEMENT si sa cible est un ANCÊTRE du nœud source sur le
// chemin DFS courant (ex. « ↩ Retour au menu » next:'root', ou une boucle
// A->…->A). On les rend en pointillé et on les EXCLUT du ranking dagre (sinon
// les dizaines de retours vers la racine tirent tout vers elle = spaghetti).
// IMPORTANT : une arête vers un nœud PARTAGÉ atteint ailleurs (cross-edge, ex.
// l'accueil ET une branche pointent vers le même nœud « contact ») N'EST PAS un
// retour — elle reste PLEINE et participe au layout (multi-parents = DAG, OK).
export function backEdgeIds(tree: Tree): Set<string> {
  const t = asTree(tree)
  const nodes = t.nodes || {}
  const back = new Set<string>()
  const onPath = new Set<string>()  // ancêtres : nœuds sur le chemin DFS courant
  const done = new Set<string>()    // nœuds déjà entièrement explorés
  function visit(id: string) {
    onPath.add(id)
    const opts = nodes[id]?.options || []
    opts.forEach((o, idx) => {
      if (o.next === AI_ID) return                  // l'IA n'est jamais une back-edge
      if (!nodes[o.next]) return                    // cible inexistante : ignorée
      if (onPath.has(o.next)) { back.add(`${id}::${idx}`); return }  // ANCÊTRE -> vrai retour/boucle
      if (!done.has(o.next)) visit(o.next)          // 1re visite -> on descend
      // sinon : cross-edge vers un nœud partagé déjà exploré ailleurs -> PLEINE
    })
    onPath.delete(id)
    done.add(id)
  }
  visit(startId(t))
  return back
}

// Libellé spécial du nœud start (DOIT contenir le texte exact "Message d'accueil").
export const START_LABEL = "Message d'accueil"

export function toGraph(tree: Tree): { nodes: GNode[]; edges: GEdge[] } {
  const t = asTree(tree)
  const nodes = t.nodes || {}
  const start = startId(t)
  const gnodes: GNode[] = []
  const edges: GEdge[] = []
  let usesAI = false
  const back = backEdgeIds(t)

  // S'assure que le nœud start figure même si nodes[start] manque.
  const ids = new Set<string>(Object.keys(nodes))
  ids.add(start)

  for (const id of ids) {
    const node = nodes[id] || { message: '', options: [] }
    gnodes.push({
      id,
      kind: kindOfNode(node),
      message: node.message || '',
      type: node.type,
      url: node.url,
      fields: node.fields,
      hasPos: !!node.pos,
      isStart: id === start,
    })
    const opts = node.options || []
    opts.forEach((o, idx) => {
      if (o.next === AI_ID) usesAI = true
      const eid = `${id}::${idx}`
      edges.push({
        id: eid,
        source: id,
        target: o.next,
        label: o.label,
        optIdx: idx,
        back: back.has(eid),
        bend: o.bend,
      })
    })
  }

  // Synthétise UN SEUL nœud sentinelle '__ai__' si au moins une option le cible.
  if (usesAI) {
    gnodes.push({
      id: AI_ID,
      kind: 'ai-sentinel',
      message: "L'IA répond aux questions ouvertes",
      hasPos: false,
      isStart: false,
    })
  }

  return { nodes: gnodes, edges }
}

// ============================================================================
// layout — positions dagre pour TOUS les nœuds (root + nodes + sentinelle).
// ============================================================================
const NODE_W = 200
const NODE_H = 90

export function layout(tree: Tree, direction: 'TB' | 'LR' = 'TB'): Record<string, { x: number; y: number }> {
  const { nodes, edges } = toGraph(tree)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep: 80, ranksep: 130, edgesep: 40, marginx: 30, marginy: 30 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of edges) {
    // EXCLUT les back-edges (retours/boucles) du ranking : elles tireraient tout
    // vers la racine et casseraient la hiérarchie (spaghetti). Elles restent
    // rendues (en pointillé), juste pas prises en compte pour le placement.
    if (e.back) continue
    // dagre exige que source et target existent comme nœuds.
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const out: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const dn = g.node(n.id) as { x: number; y: number } | undefined
    // dagre renvoie le CENTRE ; React Flow place par le coin haut-gauche.
    out[n.id] = dn ? { x: dn.x - NODE_W / 2, y: dn.y - NODE_H / 2 } : { x: 0, y: 0 }
  }
  return out
}

// resolvePositions : node.pos (override manuel persiste) SINON position dagre.
export function resolvePositions(
  tree: Tree,
  layoutDir: 'TB' | 'LR' = 'TB',
): Record<string, { x: number; y: number }> {
  const t = asTree(tree)
  const nodes = t.nodes || {}
  const auto = layout(t, layoutDir)
  const out: Record<string, { x: number; y: number }> = {}
  for (const id of Object.keys(auto)) {
    // pos manuel persisté : node.pos pour un vrai nœud, t.aiPos pour la sentinelle IA.
    const manual = id === AI_ID ? t.aiPos : nodes[id]?.pos
    out[id] = manual ? { x: manual.x, y: manual.y } : auto[id]
  }
  return out
}

// ============================================================================
// gc / ensureQ — PORTÉS de TreeFlow.tsx (l.204-211 / l.219-227).
// ============================================================================

// Retire un nœud devenu inaccessible (ni racine, ni référencé ailleurs), récursivement.
export function gc(tree: Tree, id: string): void {
  if (id === AI_ID || !tree.nodes || id === tree.start || !tree.nodes[id]) return
  const referenced = Object.values(tree.nodes).some(n => (n.options || []).some(o => o.next === id))
  if (referenced) return
  const children = (tree.nodes[id].options || []).map(o => o.next)
  delete tree.nodes[id]
  children.forEach(c => gc(tree, c))
}

// Garantit que `parentId` est un nœud « q » porteur d'options (neutralise un
// éventuel type appointment/lead/handoff). PRÉSERVE node.pos.
export function ensureQ(nd: Record<string, TreeNode>, parentId: string): TreeNode | null {
  const parent = nd[parentId]
  if (!parent) return null
  delete parent.type
  delete parent.url
  delete parent.fields
  if (!parent.options) parent.options = []
  return parent
}

// ============================================================================
// MUTATIONS — toutes immuables (clonent), renvoient un Tree VALIDE.
// ============================================================================

// Garantit start + nodes[start] sur un clone (évite un tree dégénéré).
function ensureBase(t: Tree): Tree {
  if (!t.nodes) t.nodes = {}
  if (!t.start) t.start = 'root'
  if (!t.nodes[t.start]) t.nodes[t.start] = { message: 'Bonjour ! Comment puis-je vous aider ?', options: [] }
  if (!t.nodes[t.start].options) t.nodes[t.start].options = []
  return t
}

// « Supprimer » le nœud sentinelle IA = retirer TOUTES les options qui ciblent
// '__ai__' (la sentinelle n'est pas un vrai nœud : elle existe tant qu'une option
// pointe vers l'IA). Les vrais nœuds ne sont pas touchés.
export function removeAiSentinel(tree: Tree): Tree {
  const t = clone(tree)
  for (const id of Object.keys(t.nodes || {})) {
    const node = t.nodes![id]
    if (node.options) node.options = node.options.filter(o => o.next !== AI_ID)
  }
  return t
}

// Colle une COPIE de `content` (message/type/url/fields) comme enfant de parentId
// (Ctrl+V). Nouveau nœud = nouvel id, options vides, branché par une option
// {label:'Réponse'} sur parentId. ensureQ sur le parent.
export function pasteNodeAsChild(
  tree: Tree,
  parentId: string,
  content: { message?: string; type?: TreeNode['type']; url?: string; fields?: string[] },
  position?: { x: number; y: number },
): { tree: Tree; newNodeId: string } {
  const t = ensureBase(clone(tree))
  const nd = t.nodes!
  if (!nd[parentId] || parentId === AI_ID) return { tree: clone(tree), newNodeId: '' }
  ensureQ(nd, parentId)
  const nid = newNodeId(nd)
  const node: TreeNode = { message: content.message || 'Copie', options: [] }
  if (position) node.pos = { x: position.x, y: position.y }
  if (content.type) node.type = content.type
  if (content.url) node.url = content.url
  if (content.fields) node.fields = content.fields
  nd[nid] = node
  nd[parentId].options!.push({ label: 'Réponse', next: nid })
  return { tree: t, newNodeId: nid }
}

// Drag depuis une poignée vers le VIDE : crée un nœud {message:'Destination',
// options:[]} à `position` (pos persiste tout de suite) + une option
// {label:'Réponse', next:newId} sur sourceId. ensureQ sur sourceId.
export function addChildNode(
  tree: Tree,
  sourceId: string,
  position: { x: number; y: number },
): { tree: Tree; newNodeId: string } {
  const t = ensureBase(clone(tree))
  const nd = t.nodes!
  if (!nd[sourceId] || sourceId === AI_ID) return { tree: clone(tree), newNodeId: '' }
  ensureQ(nd, sourceId)
  const nid = newNodeId(nd)
  nd[nid] = { message: 'Destination', options: [], pos: { x: position.x, y: position.y } }
  nd[sourceId].options!.push({ label: 'Réponse', next: nid })
  return { tree: t, newNodeId: nid }
}

// Drag d'une poignée vers un nœud EXISTANT : ajoute une option {label:'Réponse',
// next:targetId} sur sourceId. ensureQ sourceId. (= l'ancien type « Lien ».)
export function connectExisting(tree: Tree, sourceId: string, targetId: string): Tree {
  const t = ensureBase(clone(tree))
  const nd = t.nodes!
  if (!nd[sourceId] || sourceId === AI_ID) return clone(tree)
  // Pas d'auto-boucle A->A (geste accidentel) : on refuse.
  if (sourceId === targetId) return clone(tree)
  // Cible valide = nœud existant OU sentinelle IA.
  if (targetId !== AI_ID && !nd[targetId]) return clone(tree)
  ensureQ(nd, sourceId)
  nd[sourceId].options!.push({ label: 'Réponse', next: targetId })
  return t
}

// Change le TYPE d'un nœud EN PLACE (mode GRAPHE : un nœud partagé l'est assumé,
// pas de fork). PORTÉ d'applyType (TreeFlow.tsx l.146-201). Ne touche JAMAIS la
// sentinelle ni le start. PRÉSERVE message + options + pos.
export function setNodeType(tree: Tree, nodeId: string, kind: 'q' | 'hum' | 'act'): Tree {
  const t = clone(tree)
  if (!t.nodes || nodeId === AI_ID || nodeId === t.start) return t
  const node = t.nodes[nodeId]
  if (!node) return t
  if (kind === 'hum') {
    node.type = 'handoff'
    delete node.url
    delete node.fields
  } else if (kind === 'act') {
    if (node.type !== 'appointment' && node.type !== 'lead') {
      node.type = 'lead'
      if (!Array.isArray(node.fields)) node.fields = ['email', 'message']
      delete node.url
    }
  } else {
    delete node.type
    delete node.url
    delete node.fields
  }
  return t
}

export function setNodeMessage(tree: Tree, nodeId: string, msg: string): Tree {
  const t = clone(tree)
  const node = t.nodes?.[nodeId]
  if (node) node.message = msg
  return t
}

export function setNodeUrl(tree: Tree, nodeId: string, url: string): Tree {
  const t = clone(tree)
  const node = t.nodes?.[nodeId]
  if (node) node.url = url
  return t
}

export function setNodeFields(tree: Tree, nodeId: string, fields: string[]): Tree {
  const t = clone(tree)
  const node = t.nodes?.[nodeId]
  // email reste obligatoire pour un formulaire lead.
  if (node) node.fields = fields.includes('email') ? fields : ['email', ...fields]
  return t
}

export function setOptionLabel(tree: Tree, parentId: string, optIdx: number, label: string): Tree {
  const t = clone(tree)
  const o = t.nodes?.[parentId]?.options?.[optIdx]
  if (o) o.label = label
  return t
}

// Repointe une option vers une cible (id existant ou '__ai__' si allowAI). GC
// l'ancienne cible si orpheline.
export function setOptionTarget(tree: Tree, parentId: string, optIdx: number, target: string): Tree {
  const t = clone(tree)
  const o = t.nodes?.[parentId]?.options?.[optIdx]
  if (!o) return t
  if (target !== AI_ID && !t.nodes?.[target]) return t
  const old = o.next
  o.next = target
  if (old !== target) gc(t, old)
  return t
}

// Pose (pos) ou efface (null) le point de pliage d'une option = courbure manuelle
// de la flèche. Clé ADDITIVE option.bend, ignorée backend/widget (comme node.pos).
export function setOptionBend(
  tree: Tree, parentId: string, optIdx: number, pos: { x: number; y: number } | null,
): Tree {
  const t = clone(tree)
  const o = t.nodes?.[parentId]?.options?.[optIdx]
  if (!o) return t
  if (pos) o.bend = { x: pos.x, y: pos.y }
  else delete o.bend
  return t
}

// Efface TOUS les points de pliage (option.bend). Utilisé lors d'un re-layout
// (Réorganiser / changement de direction) : les bend sont en coords ABSOLUES et
// deviennent incohérents quand les nœuds bougent.
export function clearAllBends(tree: Tree): Tree {
  const t = clone(tree)
  for (const id of Object.keys(t.nodes || {})) {
    for (const o of t.nodes![id].options || []) delete o.bend
  }
  return t
}

// Écrit le pos manuel (override). Pour la sentinelle IA -> t.aiPos (elle n'a pas
// d'entrée dans nodes) ; pour un vrai nœud -> node.pos.
export function setNodePos(tree: Tree, nodeId: string, pos: { x: number; y: number }): Tree {
  const t = clone(tree)
  if (nodeId === AI_ID) { t.aiPos = { x: pos.x, y: pos.y }; return t }
  const node = t.nodes?.[nodeId]
  if (node) node.pos = { x: pos.x, y: pos.y }
  return t
}

// Supprime une option (PORTÉ removeOption + gc, TreeFlow.tsx l.204-211,282-289).
export function deleteOption(tree: Tree, parentId: string, optIdx: number): Tree {
  const t = clone(tree)
  const opts = t.nodes?.[parentId]?.options
  if (!opts) return t
  const [removed] = opts.splice(optIdx, 1)
  if (removed) gc(t, removed.next)
  return t
}

// Supprime un nœud. INTERDIT si nodeId===start. Retire le nœud, retire TOUTES
// les options pointant vers lui, puis gc des orphelins. Garde-fou : si après
// suppression le start n'a plus d'option, NE PAS appliquer (renvoyer inchangé).
export function deleteNode(tree: Tree, nodeId: string): Tree {
  const orig = clone(tree)
  if (!orig.nodes || nodeId === AI_ID || nodeId === orig.start || !orig.nodes[nodeId]) return orig
  const t = clone(tree)
  const nd = t.nodes!
  const start = t.start!
  // Retire toutes les options qui pointaient vers nodeId.
  for (const id of Object.keys(nd)) {
    const opts = nd[id].options
    if (opts) nd[id].options = opts.filter(o => o.next !== nodeId)
  }
  // Récupère les enfants avant suppression pour gc.
  const children = (nd[nodeId].options || []).map(o => o.next)
  delete nd[nodeId]
  children.forEach(c => gc(t, c))
  // Garde-fou : ne pas vider la racine de ses options.
  if (!(nd[start]?.options?.length)) return orig
  return t
}
