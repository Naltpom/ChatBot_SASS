// TreeFlowCanvas — l'éditeur de workflow (type n8n/Make) basé sur React Flow.
// SEUL fichier qui importe @xyflow/react : il est chargé en lazy() depuis
// TreeFlow.tsx pour partir dans un chunk dynamique SÉPARÉ (jamais embarqué dans
// le pré-rendu bun de / et /showcase, qui touche au DOM au chargement).
//
// Source de vérité = prop `tree`. Toutes les transformations passent par
// treeGraph.ts (helper pur). L'état React Flow local sert UNIQUEMENT au confort
// d'édition (drag fluide) ; on re-synchronise depuis `tree` quand sa STRUCTURE
// change (génération IA, import, édition externe), avec un garde anti-boucle.

import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, Panel,
  BaseEdge, EdgeLabelRenderer, getBezierPath, MarkerType,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection,
  type OnConnect, type OnConnectEnd, type NodeTypes, type EdgeTypes, type OnNodesDelete,
  type OnEdgesDelete, type OnNodeDrag, type NodeMouseHandler, type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Tree, TreeNode } from '../../types/bot'
import { renderMarkdown } from '../widget-preview/markdown'
import {
  AI_ID, KIND_COLOR, KIND_LABEL, LEGEND, START_LABEL,
  toGraph, resolvePositions, pasteNodeAsChild,
  addChildNode, connectExisting, removeAiSentinel, setNodeType, setNodeMessage,
  setNodeUrl, setNodeFields, setOptionLabel, setOptionTarget, setOptionBend, setNodePos,
  deleteNode, deleteOption, layout, clearAllBends,
  type NodeKind, type GNode,
} from './treeGraph'

interface Props {
  tree: Tree
  onChange: (tree: Tree) => void
  allowAI?: boolean
}

// Données portées par un nœud React Flow.
interface RFNodeData extends Record<string, unknown> {
  kind: NodeKind
  message: string
  isStart: boolean
  dir: 'TB' | 'LR'   // oriente les poignées : TB -> haut/bas, LR -> gauche/droite
}
type RFNode = Node<RFNodeData, 'tree'>
type RFEdge = TreeRFEdge

// Signature STRUCTURELLE du tree (sans les pos) : déclenche une re-sync seulement
// si la structure logique change (start + nodes sans pos + options).
function structuralSig(tree: Tree): string {
  const t = tree && typeof tree === 'object' ? tree : {}
  const nodes = t.nodes || {}
  const out: Record<string, unknown> = { start: t.start || 'root' }
  const sorted: Record<string, unknown> = {}
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id]
    sorted[id] = {
      message: n.message || '',
      type: n.type,
      url: n.url,
      fields: n.fields,
      options: (n.options || []).map(o => ({ label: o.label, next: o.next })),
    }
  }
  out.nodes = sorted
  return JSON.stringify(out)
}

// TOPOLOGIE seule (structure + type de nœud + cibles d'arêtes), SANS texte ni pos
// ni url/fields : déclenche un RE-LAYOUT dagre uniquement sur ajout/lien/
// suppression/changement de type. url et fields sont du CONTENU d'inspecteur
// (jamais rendus sur le canvas) -> les inclure ferait re-layouter dagre à chaque
// frappe dans le champ URL / coche de champ lead. L'inspecteur les reflète seul
// (il re-rend sur changement de `tree`).
function topoSig(tree: Tree): string {
  const t = tree && typeof tree === 'object' ? tree : {}
  const nodes = t.nodes || {}
  const out: string[] = ['s:' + (t.start || 'root')]
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id]
    out.push(id + '|' + (n.type || '') + '>' + (n.options || []).map(o => o.next).join(','))
  }
  return out.join(';')
}
// CONTENU texte seul (messages + libellés) : patch léger des data SANS re-layout
// (taper un message/label ne relance plus dagre -> fluide).
function contentSig(tree: Tree): string {
  const t = tree && typeof tree === 'object' ? tree : {}
  const nodes = t.nodes || {}
  const out: string[] = []
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id]
    out.push(id + '=' + (n.message || '') + '#'
      + (n.options || []).map(o => o.label + (o.bend ? `@${o.bend.x},${o.bend.y}` : '')).join('|'))
  }
  return out.join(';')
}

// ---------- Nœud custom (carte aux couleurs du type) ----------
const TreeNodeCard = memo(function TreeNodeCard({ data, selected }: NodeProps<RFNode>) {
  const color = KIND_COLOR[data.kind]
  const isSentinel = data.kind === 'ai-sentinel'
  const isStart = data.isStart
  const badge = isStart ? 'Accueil' : KIND_LABEL[data.kind]
  // Poignées orientées selon la direction du layout : vertical (TB) = haut/bas,
  // horizontal (LR) = gauche/droite (sinon les flèches partent de travers).
  const horiz = data.dir === 'LR'
  const targetPos = horiz ? Position.Left : Position.Top
  const sourcePos = horiz ? Position.Right : Position.Bottom
  return (
    <div
      data-testid="tree-node"
      data-node-kind={data.kind}
      data-node-start={isStart ? '1' : '0'}
      style={{
        width: 200, minHeight: 70, boxSizing: 'border-box',
        background: isStart ? '#1C3F5C' : '#fff',
        color: isStart ? '#fff' : '#1C3F5C',
        border: '1px solid #E8ECF0',
        borderLeft: `4px solid ${color}`,
        borderRadius: 12, padding: '10px 13px',
        boxShadow: selected
          ? `0 0 0 2px ${color}, 0 8px 20px -10px rgba(28,63,92,.45)`
          : '0 6px 16px -12px rgba(28,63,92,.3)',
      }}
    >
      {/* Poignée d'entrée (cible) — pas sur le start (il n'a pas de parent). */}
      {!isStart && (
        <Handle type="target" position={targetPos} style={{ background: color, width: 13, height: 13, border: '2px solid #fff' }} />
      )}
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: isStart ? 'rgba(255,255,255,.85)' : color }}>
        {badge}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3, lineHeight: 1.35, wordBreak: 'break-word' }}>
        {isStart
          ? <span>🌿 {START_LABEL}</span>
          : isSentinel
            ? <span>🤖 {KIND_LABEL['ai-sentinel']}</span>
            : renderMarkdown((data.message || '').slice(0, 120))}
      </div>
      {/* Poignée de sortie (source) — pas sur la sentinelle IA (terminale).
          Plus grosse + anneau : c'est de LÀ qu'on tire une flèche (relier/créer). */}
      {!isSentinel && (
        <Handle type="source" position={sourcePos}
                style={{ background: color, width: 16, height: 16, border: '3px solid #fff', boxShadow: '0 1px 4px rgba(28,63,92,.35)' }} />
      )}
    </div>
  )
})

const nodeTypes: NodeTypes = { tree: TreeNodeCard }

// ---------- Arête custom (label HTML cliquable, ciblable en e2e) ----------
// On rend le libellé via EdgeLabelRenderer (HTML hors SVG) pour porter un
// data-testid stable et un clic qui sélectionne l'arête (les <text> SVG par
// défaut de React Flow ne sont pas ciblables de façon fiable en Playwright).
interface TreeEdgeData extends Record<string, unknown> {
  label: string
  back?: boolean      // arête de retour/boucle -> rendue estompée + pointillée
  bend?: { x: number; y: number }  // point de pliage déplaçable (persisté, additif)
  onSelect?: (id: string) => void
  onBend?: (id: string, pos: { x: number; y: number } | null) => void
}
type TreeRFEdge = Edge<TreeEdgeData, 'tree'>

const TreeEdge = memo(function TreeEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected,
}: EdgeProps<TreeRFEdge>) {
  const { screenToFlowPosition } = useReactFlow()
  const dragging = useRef(false)
  const [live, setLive] = useState<{ x: number; y: number } | null>(null)
  const bend = live ?? data?.bend ?? null
  const label = data?.label ?? ''
  const back = !!data?.back
  const stroke = selected ? '#1C3F5C' : back ? '#C2CCD6' : '#94A3B8'

  // Chemin + position du label/poignée. PLIÉ : `bend` est un point SUR la courbe
  // (son milieu) — la poignée reste donc sur la ligne quand on l'étire. Pour une
  // quadratique qui PASSE par `bend` à t=0.5, le point de contrôle vaut
  // C = 2·bend − (S+T)/2, et le milieu B(0.5) === bend. NON PLIÉ : bézier par
  // défaut de React Flow, poignée/label au milieu (rendu identique à l'origine).
  let path: string, lx: number, ly: number
  if (bend) {
    const cx = 2 * bend.x - (sourceX + targetX) / 2
    const cy = 2 * bend.y - (sourceY + targetY) / 2
    path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`
    lx = bend.x; ly = bend.y
  } else {
    const [p, mlx, mly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    path = p; lx = mlx; ly = mly
  }
  // Poignée toujours SUR la courbe (= son milieu). Affichée seulement si l'arête
  // est sélectionnée OU déjà pliée (sinon canvas épuré).
  const hx = lx
  const hy = ly
  const showHandle = selected || !!bend

  const onDown = (e: ReactPointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragging.current = true
    setLive(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }
  const onMove = (e: ReactPointerEvent) => {
    if (dragging.current) setLive(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }
  const onUp = (e: ReactPointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    data?.onBend?.(id, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    setLive(null)
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd}
                style={{ stroke, strokeWidth: selected ? 2.5 : 1.5, strokeDasharray: back ? '6 5' : undefined, opacity: back && !selected ? 0.75 : 1 }} />
      <EdgeLabelRenderer>
        {/* Point de pliage : glisser pour plier la flèche, double-clic pour la redresser. */}
        {showHandle && (
          <div
            className="nodrag nopan"
            title="Glisser pour plier la flèche · double-clic pour la redresser"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onDoubleClick={() => data?.onBend?.(id, null)}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${hx}px, ${hy}px)`,
              pointerEvents: 'all', zIndex: 5,
              width: 12, height: 12, borderRadius: '50%', cursor: 'grab',
              background: '#fff', border: `2px solid ${selected ? '#1C3F5C' : '#94A3B8'}`,
              boxShadow: '0 1px 3px rgba(28,63,92,.3)',
            }}
          />
        )}
        {label !== '' && (
          <div
            data-testid="tree-edge-label"
            data-edge-id={id}
            className="nodrag nopan"
            onClick={() => data?.onSelect?.(id)}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${lx}px, ${showHandle ? ly - 15 : ly}px)`,
              pointerEvents: 'all', zIndex: selected ? 6 : 1,
              fontSize: 11, fontWeight: 600, color: back ? '#94A3B8' : '#1C3F5C',
              background: 'rgba(255,255,255,.92)', borderRadius: 6, padding: '1px 5px',
              border: selected ? '1px solid #1C3F5C' : '1px solid transparent',
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {back ? '↩ ' + label.replace(/^[↩↪←]\s*/, '') : label}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
})

const edgeTypes: EdgeTypes = { tree: TreeEdge }

// ---------- Construit nodes/edges RF à partir du tree ----------
function buildNodes(tree: Tree, dir: 'TB' | 'LR', allowAI: boolean): RFNode[] {
  const { nodes } = toGraph(tree)
  const pos = resolvePositions(tree, dir)
  return nodes
    .filter(n => allowAI || n.kind !== 'ai-sentinel')
    .map((n: GNode): RFNode => ({
      id: n.id,
      type: 'tree',
      position: pos[n.id] || { x: 0, y: 0 },
      data: { kind: n.kind, message: n.message, isStart: n.isStart, dir },
      // Supprimable sauf le start. La sentinelle IA l'est aussi -> géré dans
      // onNodesDelete (retire les branches vers '__ai__').
      deletable: !n.isStart,
      // Tous draggables (sentinelle IA incluse : sa position est persistée dans
      // tree.aiPos, cf. setNodePos/resolvePositions).
      draggable: true,
    }))
}
function buildEdges(tree: Tree, allowAI: boolean, onSelect?: (id: string) => void): RFEdge[] {
  const { edges } = toGraph(tree)
  return edges
    .filter(e => allowAI || e.target !== AI_ID)
    .map((e): RFEdge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'tree',
      data: { label: e.label, back: e.back, bend: e.bend, onSelect },
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: e.back ? '#C2CCD6' : '#94A3B8' },
    }))
}

// ====================== Inner (a accès au contexte RF) ======================
function CanvasInner({ tree, onChange, allowAI = true }: Props) {
  const [dir, setDir] = useState<'TB' | 'LR'>('TB')
  // Init calculé UNE SEULE FOIS (ref), pas à chaque rendu : buildNodes/buildEdges
  // appellent dagre.layout, or useNodesState=useState n'utilise l'argument qu'au
  // montage. Passer l'appel direct relancerait dagre à chaque rendu (jank).
  const init = useRef<{ n: RFNode[]; e: RFEdge[] }>()
  if (!init.current) init.current = { n: buildNodes(tree, dir, allowAI), e: buildEdges(tree, allowAI) }
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(init.current.n)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(init.current.e)
  const [sel, setSel] = useState<{ kind: 'node'; id: string } | { kind: 'edge'; id: string } | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  // Historique undo/redo : piles de snapshots du tree. emit() empile l'état AVANT
  // l'édition (et vide la pile redo) ; undo/redo rejouent sans ré-empiler (appel
  // onChange direct). Remount A/B (key) -> historique remis à zéro, voulu.
  const undoStack = useRef<Tree[]>([])
  const redoStack = useRef<Tree[]>([])
  const clipboard = useRef<{ message?: string; type?: TreeNode['type']; url?: string; fields?: string[] } | null>(null)
  const emit = useCallback((next: Tree) => {
    undoStack.current.push(tree)
    if (undoStack.current.length > 100) undoStack.current.shift()
    redoStack.current = []
    onChange(next)
  }, [tree, onChange])
  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (prev === undefined) return
    redoStack.current.push(tree)
    setSel(null)
    onChange(prev)
  }, [tree, onChange])
  const redo = useCallback(() => {
    const nxt = redoStack.current.pop()
    if (nxt === undefined) return
    undoStack.current.push(tree)
    setSel(null)
    onChange(nxt)
  }, [tree, onChange])

  // Pliage d'une flèche : déplace (pos) ou efface (null) son point de pliage.
  const bendEdge = useCallback((id: string, pos: { x: number; y: number } | null) => {
    const m = /^(.*)::(\d+)$/.exec(id)
    if (m) emit(setOptionBend(tree, m[1], Number(m[2]), pos))
  }, [tree, emit])

  // Sélection d'une arête depuis le clic sur son label HTML (testable e2e).
  const selectEdge = useCallback((id: string) => setSel({ kind: 'edge', id }), [])
  // Injecte les callbacks (sélection + pliage) dans chaque arête juste avant le
  // rendu : garantit que MÊME les arêtes initiales sont cliquables/pliables.
  const rfEdges = useMemo<RFEdge[]>(
    () => edges.map(e => ({ ...e, data: { ...(e.data ?? { label: '' }), onSelect: selectEdge, onBend: bendEdge } })),
    [edges, selectEdge, bendEdge],
  )

  const { screenToFlowPosition, fitView } = useReactFlow()
  // Pour onConnectEnd : id de la poignée source du drag en cours.
  const connectSource = useRef<string | null>(null)

  // Recentre la vue à chaque bascule plein écran (le conteneur change de taille
  // -> sans refit le graphe reste décalé). On saute le 1er rendu (le prop
  // `fitView` de <ReactFlow> gère déjà le fit initial). Délai court : laisse le
  // DOM se redimensionner avant que React Flow ne mesure.
  const firstFit = useRef(true)
  useEffect(() => {
    if (firstFit.current) { firstFit.current = false; return }
    const id = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60)
    return () => clearTimeout(id)
  }, [full, fitView])

  // RE-SEED les nodes/edges quand la STRUCTURE du tree change (ajout, lien,
  // suppression, label, type…). `structuralSig` EXCLUT les pos : c'est lui
  // l'anti-boucle — un changement de pos SEUL (drag) ne change pas sig, donc
  // l'effet ne se déclenche pas et la position locale est préservée. Pas de
  // boucle possible : setNodes/setEdges ne touchent jamais au tree.
  // (1) TOPOLOGIE -> re-seed complet (re-layout dagre) : ajout/lien/suppression/type.
  // `pos` est exclu de topoSig -> un drag ne re-layout pas (position préservée).
  // Pas de boucle : setNodes/setEdges ne touchent jamais au tree.
  const topo = topoSig(tree)
  useEffect(() => {
    setNodes(buildNodes(tree, dir, allowAI))
    setEdges(buildEdges(tree, allowAI))
    setWarn(null)
    // dir exclu (géré par applyDirection qui re-positionne directement).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topo, allowAI])

  // (2) CONTENU texte -> patch LÉGER des data (message/label) SANS re-layout ni
  // dagre : taper dans l'inspecteur reste fluide et se reflète sur le canvas.
  const content = contentSig(tree)
  useEffect(() => {
    setNodes(ns => ns.map(n => {
      const msg = tree.nodes?.[n.id]?.message ?? n.data.message
      return n.data.message === msg ? n : { ...n, data: { ...n.data, message: msg } }
    }))
    const bendEq = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
      (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y)
    setEdges(es => es.map(e => {
      const m = /^(.*)::(\d+)$/.exec(e.id)
      if (!m) return e
      const opt = tree.nodes?.[m[1]]?.options?.[Number(m[2])]
      const label = opt?.label ?? ''
      const bend = opt?.bend
      if ((e.data?.label ?? '') === label && bendEq(e.data?.bend, bend)) return e
      return { ...e, data: { ...(e.data ?? { label: '' }), label, bend } }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Un nœud Conseiller (handoff) / Action (lead, appointment) est TERMINAL : lui
  // ajouter une réponse sortante appellerait ensureQ qui efface sa config
  // (url/fields) silencieusement. On refuse le geste et on prévient (return AVANT
  // tout emit -> pas de faux dirty, et l'effet topo ne tourne pas donc le warn
  // persiste).
  const terminalSourceBlocked = useCallback((sourceId: string | null | undefined): boolean => {
    const ty = sourceId ? tree.nodes?.[sourceId]?.type : undefined
    if (ty === 'handoff' || ty === 'lead' || ty === 'appointment') {
      setWarn("Un nœud Conseiller/Action est terminal : il ne peut pas avoir de réponse sortante. Repassez-le en « Question » d'abord.")
      return true
    }
    return false
  }, [tree])

  // ---------- Édition : connexion vers un nœud EXISTANT ----------
  const onConnect = useCallback<OnConnect>((c: Connection) => {
    if (!c.source || !c.target) return
    if (c.source === c.target) return                 // pas d'auto-boucle
    if (!allowAI && c.target === AI_ID) return
    if (terminalSourceBlocked(c.source)) return
    emit(connectExisting(tree, c.source, c.target))
  }, [tree, allowAI, emit, terminalSourceBlocked])

  // Mémorise la source au début du drag de poignée.
  const onConnectStart = useCallback((_e: unknown, params: { nodeId: string | null }) => {
    connectSource.current = params.nodeId
  }, [])

  // ---------- Drag de poignée vers le VIDE : crée un nœud ----------
  const onConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    const source = connectSource.current
    connectSource.current = null
    // Connexion déjà valide (vers un nœud) -> géré par onConnect.
    if (connectionState.isValid) return
    if (!source || source === AI_ID) return
    if (terminalSourceBlocked(source)) return
    const ev = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent)
    if (!ev) return                                   // touchcancel à liste vide -> pas de coordonnées
    const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    emit(addChildNode(tree, source, flowPos).tree)
  }, [tree, screenToFlowPosition, emit, terminalSourceBlocked])

  // ---------- Drag d'un nœud terminé -> persiste la position ----------
  // (sentinelle IA incluse : setNodePos écrit tree.aiPos.)
  const onNodeDragStop = useCallback<OnNodeDrag<RFNode>>((_e, node) => {
    emit(setNodePos(tree, node.id, { x: node.position.x, y: node.position.y }))
  }, [tree, emit])

  // ---------- Suppressions ----------
  const onNodesDelete = useCallback<OnNodesDelete<RFNode>>((deleted) => {
    let next = tree
    let refused = false
    for (const n of deleted) {
      if (n.id === (tree.start || 'root')) { refused = true; continue }
      if (n.id === AI_ID) {
        // « Supprimer l'IA » = retirer les branches vers '__ai__', sauf si ça vide la racine.
        const after = removeAiSentinel(next)
        const start = after.start || 'root'
        if (!(after.nodes?.[start]?.options?.length)) { refused = true; continue }
        next = after
        continue
      }
      const after = deleteNode(next, n.id)
      if (structuralSig(after) === structuralSig(next)) refused = true
      next = after
    }
    if (structuralSig(next) !== structuralSig(tree)) {
      // Au moins une suppression a abouti : on applique (pas de bandeau d'échec
      // contradictoire même si un nœud protégé du lot a été refusé).
      emit(next); setSel(null)
    } else {
      // Refus TOTAL (rien supprimé) -> on prévient (pas d'emit -> warn persiste).
      if (refused) setWarn("Le message d'accueil ne peut pas être supprimé, et la racine doit garder au moins une branche.")
      setNodes(buildNodes(tree, dir, allowAI)); setEdges(buildEdges(tree, allowAI))
    }
  }, [tree, dir, allowAI, emit, setNodes, setEdges])

  const onEdgesDelete = useCallback<OnEdgesDelete>((deleted) => {
    let next = tree
    // L'id d'arête est `${parentId}::${optIdx}` (cf. toGraph). Supprimer par
    // index DÉCROISSANT (groupé par parent) pour éviter le glissement d'indices
    // quand plusieurs arêtes d'un même parent partent dans le même batch.
    const targets = deleted
      .map(e => /^(.*)::(\d+)$/.exec(e.id))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => ({ parent: m[1], idx: Number(m[2]) }))
      .sort((a, b) => b.idx - a.idx)
    for (const t of targets) next = deleteOption(next, t.parent, t.idx)
    // Garde-fou racine : ne pas la vider de ses options.
    const start = next.start || 'root'
    if (!(next.nodes?.[start]?.options?.length)) {
      setWarn("La racine doit garder au moins une branche.")
      setNodes(buildNodes(tree, dir, allowAI)); setEdges(buildEdges(tree, allowAI))
      return
    }
    // Reset la sélection : les index d'options ont glissé (splice) -> sel devenu
    // périmé pointerait sur la mauvaise option dans l'inspecteur.
    setSel(null)
    emit(next)
  }, [tree, dir, allowAI, emit, setNodes, setEdges])

  // ---------- Sélection ----------
  const onNodeClick = useCallback<NodeMouseHandler<RFNode>>((_e, node) => {
    setSel({ kind: 'node', id: node.id })
  }, [])
  const onEdgeClick = useCallback<EdgeMouseHandler<RFEdge>>((_e, edge) => {
    setSel({ kind: 'edge', id: edge.id })
  }, [])
  const onPaneClick = useCallback(() => setSel(null), [])

  // « Supprimer » le nœud IA : retire toutes les branches qui mènent à l'IA.
  const removeAi = useCallback(() => {
    const next = removeAiSentinel(tree)
    const start = next.start || 'root'
    if (!(next.nodes?.[start]?.options?.length)) {
      setWarn("La racine doit garder au moins une branche : repointez la branche IA avant de retirer l'IA.")
      return
    }
    emit(next); setSel(null)
  }, [tree, emit])

  // Crée une réponse ENFANT depuis un nœud (geste explicite, sans drag) : placée
  // sous le nœud source, et sélectionnée pour édition immédiate.
  const addChildFrom = useCallback((sourceId: string) => {
    if (terminalSourceBlocked(sourceId)) return
    const src = nodes.find(n => n.id === sourceId)
    const base = src ? { x: src.position.x + 30, y: src.position.y + 170 } : { x: 0, y: 0 }
    const { tree: next, newNodeId: nid } = addChildNode(tree, sourceId, base)
    if (nid) { emit(next); setSel({ kind: 'node', id: nid }) }
  }, [nodes, tree, emit, terminalSourceBlocked])

  // Copier (Ctrl+C) le contenu du nœud sélectionné ; coller (Ctrl+V) une COPIE
  // comme enfant du nœud sélectionné (Question) ou, à défaut, de la racine.
  const copySelected = useCallback(() => {
    if (sel?.kind === 'node' && sel.id !== AI_ID) {
      const n = tree.nodes?.[sel.id]
      if (n) clipboard.current = { message: n.message, type: n.type, url: n.url, fields: n.fields }
    }
  }, [sel, tree])
  const paste = useCallback(() => {
    const c = clipboard.current
    if (!c) return
    let parentId = tree.start || 'root'
    if (sel?.kind === 'node' && sel.id !== AI_ID) {
      const pn = tree.nodes?.[sel.id]
      if (pn && !pn.type) parentId = sel.id   // 'q' uniquement (un nœud typé est terminal)
    }
    const src = nodes.find(n => n.id === parentId)
    const base = src ? { x: src.position.x + 40, y: src.position.y + 180 } : undefined
    const { tree: next, newNodeId: nid } = pasteNodeAsChild(tree, parentId, c, base)
    if (nid) { emit(next); setSel({ kind: 'node', id: nid }) }
  }, [sel, tree, nodes, emit])

  // Raccourcis clavier (ignorés quand on tape dans un champ) : Échap déselectionne,
  // Ctrl/Cmd+Z annule, Ctrl/Cmd+Y (ou Maj+Z) rétablit, Ctrl/Cmd+C/V copie/colle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'Escape') { setSel(null); return }
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      else if (k === 'c') { copySelected() }
      else if (k === 'v') { e.preventDefault(); paste() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo, copySelected, paste])

  // Supprime un nœud (bouton explicite de l'inspecteur).
  const removeNode = useCallback((id: string) => {
    const next = deleteNode(tree, id)
    if (structuralSig(next) !== structuralSig(tree)) { emit(next); setSel(null) }
    else setWarn("Suppression impossible : le message d'accueil et la dernière branche de la racine sont protégés.")
  }, [tree, emit])

  // Re-dispose TOUT le graphe via dagre dans la direction `d`. Écrase les pos
  // manuels ET efface les plis (option.bend, coords ABSOLUES devenues incohérentes
  // quand les nœuds bougent). Repositionne aussi la sentinelle IA (hors tree.nodes
  // -> via tree.aiPos, l'ancienne boucle l'oubliait). Persiste (emit). structuralSig
  // exclut pos -> l'effet de re-sync ne tournera pas : on met le canvas à jour ici.
  const relayoutTo = useCallback((d: 'TB' | 'LR') => {
    const auto = layout(tree, d)
    let next = clearAllBends(tree)
    for (const id of Object.keys(next.nodes || {})) {
      if (auto[id]) next = setNodePos(next, id, auto[id])
    }
    if (auto[AI_ID]) next = setNodePos(next, AI_ID, auto[AI_ID])
    setNodes(buildNodes(next, d, allowAI))
    emit(next)
  }, [tree, allowAI, emit, setNodes])

  // « Réorganiser » : re-layout dans la direction courante.
  const onReorganize = useCallback(() => relayoutTo(dir), [relayoutTo, dir])

  // Bascule Vertical/Horizontal : re-layout COMPLET dans la nouvelle direction —
  // réoriente les poignées (data.dir) ET réaligne tous les nœuds, donc pas de
  // mélange ancien/nouveau quand certains nœuds avaient été déplacés à la main.
  const applyDirection = useCallback((d: 'TB' | 'LR') => {
    setDir(d)
    relayoutTo(d)
  }, [relayoutTo])

  // Inspecteur sélectionné.
  const inspector = useMemo(() => {
    if (!sel) return <HelpPane />
    if (sel.kind === 'node') {
      if (sel.id === AI_ID) return <AiPane onRemove={removeAi} />
      return <NodeInspector tree={tree} nodeId={sel.id} emit={emit} addChild={addChildFrom} removeNode={removeNode} />
    }
    return <EdgeInspector tree={tree} edgeId={sel.id} allowAI={allowAI} emit={emit}
                          onDelete={() => { const m = /::(\d+)$/.exec(sel.id); if (m) { const next = deleteOption(tree, sel.id.replace(/::\d+$/, ''), Number(m[1])); const start = next.start || 'root'; if (next.nodes?.[start]?.options?.length) { emit(next); setSel(null) } else setWarn('La racine doit garder au moins une branche.') } }} />
  }, [sel, tree, allowAI, emit, addChildFrom, removeNode, removeAi])

  const canvasH = full ? 'calc(100vh - 140px)' : 'min(72vh, 820px)'
  return (
    <div style={full ? S.fullWrap : S.normalWrap}>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button type="button" onClick={undo} disabled={undoStack.current.length === 0}
                  title="Annuler (Ctrl+Z)"
                  style={{ ...S.toolBtn, opacity: undoStack.current.length ? 1 : 0.4, cursor: undoStack.current.length ? 'pointer' : 'default' }}>↶</button>
          <button type="button" onClick={redo} disabled={redoStack.current.length === 0}
                  title="Rétablir (Ctrl+Y)"
                  style={{ ...S.toolBtn, opacity: redoStack.current.length ? 1 : 0.4, cursor: redoStack.current.length ? 'pointer' : 'default' }}>↷</button>
        </div>
        <button type="button" onClick={onReorganize} style={S.toolBtn}>Réorganiser</button>
        <div style={S.toggleWrap}>
          <button type="button" onClick={() => applyDirection('TB')} style={S.toggleBtn(dir === 'TB')}>Vertical</button>
          <button type="button" onClick={() => applyDirection('LR')} style={S.toggleBtn(dir === 'LR')}>Horizontal</button>
        </div>
        <button type="button" onClick={() => setFull(f => !f)} style={S.toolBtn}>
          {full ? '✕ Quitter le plein écran' : '⛶ Plein écran'}
        </button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
          {LEGEND.map(l => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7B8D' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />{l.label}
            </span>
          ))}
        </div>
      </div>

      {warn && (
        <div style={{ fontSize: 12.5, color: '#E86A5F', background: '#FEF2F1', border: '1px solid #F8D7D3', borderRadius: 9, padding: '8px 12px' }}>
          {warn}
        </div>
      )}

      {/* Canvas + inspecteur */}
      <div style={{ ...S.row, ...(full ? { flex: '1 1 auto', minHeight: 0 } : null) }}>
        <div style={{ ...S.canvasWrap, height: canvasH }}>
          <ReactFlow
            nodes={nodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            connectionRadius={48}
            connectionLineStyle={{ stroke: '#8C6DFF', strokeWidth: 2 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#E8ECF0" gap={22} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ background: '#FBFCFD' }}
                     nodeColor={(n) => KIND_COLOR[((n.data as RFNodeData | undefined)?.kind) || 'q']} />
            <Panel position="top-left">
              <div style={{ fontSize: 11.5, color: '#6B7B8D', background: 'rgba(255,255,255,.9)', border: '1px solid #E8ECF0', borderRadius: 8, padding: '5px 9px', maxWidth: 280 }}>
                Astuce : tirez depuis le point <b style={{ color: '#1C3F5C' }}>●</b> en bas d'un nœud — vers un autre nœud pour <b>relier</b>, vers le vide pour <b>créer</b>. Sélectionnez une flèche puis glissez son <b>point</b> pour la <b>plier</b> (double-clic = redresser). Ou sélectionnez un nœud et « + Ajouter une réponse ».
              </div>
            </Panel>
          </ReactFlow>
        </div>
        <aside style={{ ...S.inspector, height: canvasH, overflowY: 'auto' }}>{inspector}</aside>
      </div>
    </div>
  )
}

// ====================== Inspecteurs ======================
function HelpPane() {
  return (
    <div style={{ fontSize: 13, color: '#6B7B8D', lineHeight: 1.5 }}>
      Sélectionnez un nœud ou une flèche pour l'éditer. Glissez depuis la poignée du bas d'un nœud pour créer une branche.
    </div>
  )
}

function AiPane({ onRemove }: { onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={S.inspTitle}>🤖 Nœud IA</div>
      <div style={{ fontSize: 13, color: '#6B7B8D', lineHeight: 1.5 }}>
        Ce nœud représente la bascule vers l'IA. Reliez une flèche d'un nœud vers lui
        (ou choisissez « 🤖 IA » comme destination d'une flèche dans son inspecteur) pour
        qu'une réponse laisse l'IA traiter les questions ouvertes.
      </div>
      <div style={{ fontSize: 12, color: '#9AA7B4', lineHeight: 1.5 }}>
        Il n'a pas de réglage propre. Le retirer supprime toutes les flèches qui mènent à l'IA.
      </div>
      <button type="button" onClick={onRemove} style={S.delBtn}>Retirer l'IA (toutes les branches IA)</button>
    </div>
  )
}

function NodeInspector({ tree, nodeId, emit, addChild, removeNode }:
  { tree: Tree; nodeId: string; emit: (t: Tree) => void; addChild: (id: string) => void; removeNode: (id: string) => void }) {
  const node = tree.nodes?.[nodeId]
  const isStart = nodeId === (tree.start || 'root')
  if (!node) return <HelpPane />
  const kind: 'q' | 'hum' | 'act' =
    node.type === 'handoff' ? 'hum' : (node.type === 'appointment' || node.type === 'lead') ? 'act' : 'q'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={S.inspTitle}>{isStart ? "Nœud d'accueil" : 'Nœud'}</div>
      {!isStart && (
        <label style={S.field}>
          <span style={S.lbl}>Type</span>
          <select value={kind} onChange={e => emit(setNodeType(tree, nodeId, e.target.value as 'q' | 'hum' | 'act'))} style={S.select}>
            <option value="q">Question</option>
            <option value="hum">Conseiller</option>
            <option value="act">Action</option>
          </select>
        </label>
      )}
      <label style={S.field}>
        <span style={S.lbl}>Message</span>
        <textarea
          value={node.message || ''}
          placeholder="Message affiché quand on clique — markdown : **gras**, *italique*, [lien](https://…), sauts de ligne"
          onChange={e => emit(setNodeMessage(tree, nodeId, e.target.value))}
          style={{ ...S.input, minHeight: 88, fontFamily: 'inherit', lineHeight: 1.45, resize: 'vertical' }}
        />
        {(node.message || '').trim() === '' && (
          <span style={{ fontSize: 11.5, color: '#E86A5F' }}>
            Le message ne peut pas être vide (l'enregistrement échouera).
          </span>
        )}
      </label>
      {node.type === 'appointment' && (
        <label style={S.field}>
          <span style={S.lbl}>URL de prise de rendez-vous</span>
          <input type="text" value={node.url || ''} placeholder="https://…"
                 onChange={e => emit(setNodeUrl(tree, nodeId, e.target.value))} style={S.input} />
          {!(node.url || '').startsWith('https://') && (
            <span style={{ fontSize: 11.5, color: '#E86A5F' }}>
              L'URL doit commencer par https:// (l'enregistrement échouera).
            </span>
          )}
        </label>
      )}
      {node.type === 'lead' && (
        <div style={S.field}>
          <span style={S.lbl}>Champs du formulaire</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(['email', 'name', 'phone', 'message'] as const).map(f => {
              const on = (node.fields || []).includes(f)
              return (
                <label key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={on || f === 'email'} disabled={f === 'email'}
                         onChange={e => {
                           const cur = node.fields || []
                           const next = e.target.checked ? [...new Set([...cur, f])] : cur.filter(x => x !== f)
                           emit(setNodeFields(tree, nodeId, next))
                         }} />
                  {f === 'email' ? 'Email (obligatoire)' : f === 'name' ? 'Nom' : f === 'phone' ? 'Téléphone' : 'Message'}
                </label>
              )
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, borderTop: '1px solid #F0F2F5', paddingTop: 12 }}>
        {kind === 'q' ? (
          <button type="button" onClick={() => addChild(nodeId)} style={S.addBtn}>+ Ajouter une réponse</button>
        ) : (
          <span style={{ fontSize: 11.5, color: '#9AA7B4' }}>
            Un nœud Conseiller/Action est terminal (pas de réponse sortante). Repassez-le en « Question » pour ajouter des réponses.
          </span>
        )}
        {!isStart && (
          <button type="button" onClick={() => removeNode(nodeId)} style={S.delBtn}>Supprimer ce nœud</button>
        )}
      </div>
    </div>
  )
}

function EdgeInspector({ tree, edgeId, allowAI, emit, onDelete }:
  { tree: Tree; edgeId: string; allowAI: boolean; emit: (t: Tree) => void; onDelete: () => void }) {
  const m = /^(.*)::(\d+)$/.exec(edgeId)
  if (!m) return <HelpPane />
  const parentId = m[1]
  const optIdx = Number(m[2])
  const opt = tree.nodes?.[parentId]?.options?.[optIdx]
  if (!opt) return <HelpPane />
  const choices = Object.keys(tree.nodes || {})
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={S.inspTitle}>Flèche (réponse)</div>
      <label style={S.field}>
        <span style={S.lbl}>Intitulé</span>
        <input type="text" value={opt.label} placeholder="Intitulé du bouton"
               onChange={e => emit(setOptionLabel(tree, parentId, optIdx, e.target.value))} style={S.input} />
        {opt.label.trim() === '' && (
          <span style={{ fontSize: 11.5, color: '#E86A5F' }}>
            L'intitulé ne peut pas être vide (l'enregistrement échouera).
          </span>
        )}
      </label>
      <label style={S.field}>
        <span style={S.lbl}>Va vers</span>
        <select value={opt.next} onChange={e => emit(setOptionTarget(tree, parentId, optIdx, e.target.value))} style={S.select}>
          {choices.map(id => (
            <option key={id} value={id}>
              {id === (tree.start || 'root') ? '🏠 Menu d’accueil' : (tree.nodes?.[id]?.message?.slice(0, 50) || id)}
            </option>
          ))}
          {allowAI && <option value={AI_ID}>🤖 IA (questions ouvertes)</option>}
        </select>
      </label>
      <button type="button" onClick={onDelete} style={S.delBtn}>Supprimer la flèche</button>
    </div>
  )
}

// ====================== Styles inline ======================
const S = {
  normalWrap: { display: 'flex', flexDirection: 'column' as const, gap: 14 },
  fullWrap: {
    position: 'fixed' as const, inset: 0, zIndex: 1000, background: '#fff',
    padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12, overflow: 'auto' as const,
  },
  row: {
    display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' as const,
  },
  canvasWrap: {
    flex: '1 1 560px', minWidth: 300,
    border: '1px solid #E8ECF0', borderRadius: 14, overflow: 'hidden', background: '#FBFCFD',
  },
  inspector: {
    flex: '0 0 320px', maxWidth: '100%', width: 320, minHeight: 200,
    background: '#fff', border: '1px solid #E8ECF0', borderRadius: 14, padding: 18,
  },
  inspTitle: { fontSize: 14, fontWeight: 700, color: '#1C3F5C' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  lbl: { fontSize: 12, fontWeight: 600, color: '#6B7B8D' },
  input: {
    width: '100%', boxSizing: 'border-box' as const, border: '1px solid #E2E8F0',
    borderRadius: 9, padding: '8px 11px', fontSize: 13, color: '#1C3F5C',
  },
  select: {
    width: '100%', boxSizing: 'border-box' as const, height: 36, border: '1px solid #E2E8F0',
    borderRadius: 9, padding: '0 8px', fontSize: 13, fontWeight: 600, background: '#fff',
    cursor: 'pointer', color: '#1C3F5C',
  },
  addBtn: {
    background: '#fff', color: '#1C3F5C', border: '1px dashed #CBD5DF', borderRadius: 10,
    padding: '8px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  },
  toolBtn: {
    background: '#F4F6F8', color: '#1C3F5C', border: 'none', borderRadius: 10,
    padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  toggleWrap: { display: 'inline-flex', gap: 5, background: '#F0F2F5', borderRadius: 10, padding: 4 },
  toggleBtn: (on: boolean) => ({
    padding: '7px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', background: on ? '#fff' : 'transparent', color: on ? '#1C3F5C' : '#6B7B8D',
  }),
  delBtn: {
    background: '#FEF2F1', color: '#E86A5F', border: '1px solid #F8D7D3', borderRadius: 9,
    padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
}

// ====================== Export (avec Provider) ======================
export default function TreeFlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
