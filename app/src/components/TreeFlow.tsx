// TreeFlow — composant PARTAGÉ de l'arbre de conversation, pixel-conforme au
// template Chapote (BotCreate.dc.html / BotSettings.dc.html). Importé tel quel
// par la page de création (BotWizard) ET l'onglet « Arbre » (BotPage) : le rendu
// doit être IDENTIQUE entre les deux.
//
// Il est AUTONOME : légende des 4 types, toggle Vertical/Horizontal (état
// interne), canvas flowchart à fond pointillé, et carte « éditeur de branches »
// en dessous. Styles 100 % inline (ne touche pas styles.css).
//
// Mapping vue <-> tree_json réel (sans perte de données) :
//   tree = { start, nodes: { <id>: { message, options:[{label,next}], type?, url?, fields? } } }
//   Une OPTION (réponse) = tree.nodes[parentId].options[i] = { label, next }.
//     - type dérivé de la cible : IA si next==="__ai__" ; "hum" si node.type==="handoff" ;
//       "act" si node.type==="appointment"||"lead" ; sinon "q".
//     - answer = option.label · title/destination = message du nœud cible (ou son libellé).
//   Seules les options de type "q" (message simple) portent des sous-réponses : la vue
//   et l'éditeur DESCENDENT RÉCURSIVEMENT, à profondeur ILLIMITÉE, dans le nœud cible.
//   Éditer met à jour le label de l'option ET le message/type du nœud cible.
//   Changer de type RECONSTRUIT proprement le nœud cible (message/handoff/appointment/lead),
//   ou bascule l'option sur next="__ai__" pour IA — en PRÉSERVANT tout le reste du tree_json
//   (jamais de suppression de nœuds non concernés).
//
// SÉCURITÉ CYCLES : les arbres réels contiennent des RETOURS (« ↩ Retour au menu »
// next==="root", sous-branches pointant vers un ancêtre). On descend toujours en
// portant le CHEMIN d'ancêtres (ids) : si une cible est déjà sur le chemin (back-edge)
// ou absente / non-"q", c'est une FEUILLE — on l'affiche sans récurser. Aucune
// récursion infinie possible.

import { useEffect, useRef, useState } from 'react'
import type { Tree, TreeNode } from '../types/bot'

type BranchType = 'q' | 'ia' | 'hum' | 'act'

interface Props {
  tree: Tree
  onChange: (tree: Tree) => void
  allowAI?: boolean
}

// Couleurs (bord-gauche carte + pastille + badge) et libellés des badges.
const C: Record<BranchType, string> = { q: '#2F9E79', ia: '#8C6DFF', hum: '#E86A5F', act: '#2563EB' }
const B: Record<BranchType, string> = { q: 'Question', ia: 'IA', hum: 'Conseiller', act: 'Action' }

let _seq = 1
function newNodeId(nodes: Record<string, unknown>): string {
  let id: string
  do { id = 'n' + Date.now().toString(36).slice(-4) + _seq++ } while (nodes[id])
  return id
}

function asTree(raw: unknown): Tree {
  return raw && typeof raw === 'object' ? (raw as Tree) : {}
}
function clone(t: unknown): Tree {
  return JSON.parse(JSON.stringify(asTree(t)))
}

// Type de branche dérivé de l'option racine + de son nœud cible.
function branchType(t: Tree, next: string): BranchType {
  if (next === '__ai__') return 'ia'
  const node = t.nodes?.[next]
  if (!node) return 'q'
  if (node.type === 'handoff') return 'hum'
  if (node.type === 'appointment' || node.type === 'lead') return 'act'
  return 'q'
}

export default function TreeFlow({ tree, onChange, allowAI = true }: Props) {
  const [orient, setOrient] = useState<'vert' | 'horiz'>('vert')

  // ----- Zoom / déplacement (pan) du canvas flowchart -----
  // Viewport à overflow caché : le flowchart est translaté/zoomé via transform.
  // Glisser = pan (pointer events, souris + tactile), molette = zoom, boutons +/−.
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [grabbing, setGrabbing] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const clampZoom = (z: number) => Math.min(2, Math.max(0.4, Math.round(z * 100) / 100))
  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }) }
  function onPanDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    setGrabbing(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPanMove(e: React.PointerEvent) {
    if (!drag.current) return
    setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) })
  }
  function endPan() { drag.current = null; setGrabbing(false) }
  // Molette = zoom : listener NON-passif (addEventListener) pour pouvoir
  // preventDefault sans le warning React sur les handlers passifs.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom(z => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const t = asTree(tree)
  const nodes = t.nodes || {}
  const start = t.start || 'root'
  const root = nodes[start] || { message: '', options: [] }
  const welcome = root.message || ''

  function mutate(fn: (draft: Tree) => void) {
    const copy = clone(tree)
    if (!copy.nodes) copy.nodes = {}
    if (!copy.start) copy.start = start
    if (!copy.nodes[copy.start]) copy.nodes[copy.start] = { message: welcome, options: [] }
    fn(copy)
    onChange(copy)
  }

  // ----- Vue : titre/destination d'une branche -----
  function destOf(next: string): string {
    if (next === '__ai__') return "L'IA répond aux questions ouvertes"
    const node = nodes[next]
    if (!node) return next
    return node.message || ''
  }

  // Clé React STABLE pour une liste d'options : le nœud cible (o.next) est un id
  // unique, donc une bonne clé qui SUIT le nœud lors d'un réordonnancement /
  // suppression (l'index, lui, glisserait sur le voisin). Seul '__ai__' n'est
  // pas unique -> on le désambiguïse par occurrence. (Pas l'index : il ne sert
  // que de suffixe de secours sur les doublons __ai__.)
  function optionKeys(opts: { next: string }[]): string[] {
    const seen: Record<string, number> = {}
    return opts.map(o => {
      const n = seen[o.next] = (seen[o.next] || 0) + 1
      return n === 1 ? o.next : `${o.next}#${n}`
    })
  }

  // ----- Mutations : reconstruit le nœud cible selon le type choisi -----
  // PRÉSERVE message + options + url/fields pertinents, ne touche aux autres nœuds.
  function applyType(draft: Tree, parentId: string, optIdx: number, ty: BranchType) {
    const nd = draft.nodes!
    const parent = nd[parentId]
    if (!parent || !parent.options) return
    const opt = parent.options[optIdx]
    if (!opt) return

    if (ty === 'ia') {
      if (!allowAI) return
      const old = opt.next
      opt.next = '__ai__'
      // L'ancien nœud dédié devient orphelin -> on le retire s'il n'est plus référencé.
      gc(draft, old)
      return
    }

    // Pour les types non-IA : il faut un VRAI nœud cible. Si l'option pointe
    // actuellement vers l'IA, on crée un nœud dédié.
    let targetId = opt.next
    if (targetId === '__ai__' || !nd[targetId]) {
      targetId = newNodeId(nd)
      nd[targetId] = { message: '', options: [] }
      opt.next = targetId
    }
    const node = nd[targetId]
    if (ty === 'hum') {
      node.type = 'handoff'
      delete node.url
      delete node.fields
    } else if (ty === 'act') {
      // « Action » : on conserve un éventuel appointment, sinon formulaire lead par défaut.
      if (node.type !== 'appointment' && node.type !== 'lead') {
        node.type = 'lead'
        if (!Array.isArray(node.fields)) node.fields = ['email', 'message']
        delete node.url
      }
    } else {
      // « Question » : message simple, on retire les clés typées.
      delete node.type
      delete node.url
      delete node.fields
    }
  }

  // Retire un nœud devenu inaccessible (ni racine, ni référencé ailleurs), récursivement.
  function gc(draft: Tree, id: string) {
    if (id === '__ai__' || !draft.nodes || id === draft.start || !draft.nodes[id]) return
    const referenced = Object.values(draft.nodes).some(n => (n.options || []).some(o => o.next === id))
    if (referenced) return
    const children = (draft.nodes[id].options || []).map(o => o.next)
    delete draft.nodes[id]
    children.forEach(c => gc(draft, c))
  }

  // ----- Primitives GÉNÉRIQUES par id de nœud parent + index d'option -----
  // Un seul jeu d'opérations, réutilisé à toute profondeur (racine incluse :
  // parentId === start). addOption convertit d'abord le parent en vrai « q ».

  // Garantit que `parentId` est un nœud « q » porteur d'options (neutralise un
  // éventuel type appointment/lead/handoff), comme l'ancien addSub. Renvoie le nœud.
  function ensureQ(nd: Record<string, TreeNode>, parentId: string) {
    const parent = nd[parentId]
    if (!parent) return null
    delete parent.type
    delete parent.url
    delete parent.fields
    if (!parent.options) parent.options = []
    return parent
  }

  // Ajoute une sous-réponse sous l'option d'id cible `targetNext` du parent (ou
  // sous la racine pour « + Branche »). Si la cible n'est pas un vrai nœud
  // (__ai__ / manquant), on en crée un et on repointe l'option.
  function addOption(parentId: string, optIdx: number | null) {
    mutate(d => {
      const nd = d.nodes!
      let containerId = parentId
      if (optIdx !== null) {
        const opt = nd[parentId]?.options?.[optIdx]
        if (!opt) return
        if (opt.next === '__ai__' || !nd[opt.next]) {
          const nid = newNodeId(nd)
          nd[nid] = { message: 'Nouvelle destination', options: [] }
          opt.next = nid
        }
        containerId = opt.next
      }
      const parent = ensureQ(nd, containerId)
      if (!parent) return
      const sid = newNodeId(nd)
      nd[sid] = { message: 'Destination', options: [] }
      parent.options!.push({ label: 'Réponse', next: sid })
    })
  }

  function setType(parentId: string, optIdx: number, raw: string) {
    const ty = raw as BranchType
    if (ty === 'ia' && !allowAI) return
    mutate(d => { if (d.nodes![parentId]) applyType(d, parentId, optIdx, ty) })
  }
  function setLabel(parentId: string, optIdx: number, v: string) {
    mutate(d => { const o = d.nodes![parentId]?.options?.[optIdx]; if (o) o.label = v })
  }
  function setTitle(parentId: string, optIdx: number, v: string) {
    mutate(d => {
      const o = d.nodes![parentId]?.options?.[optIdx]
      if (!o || o.next === '__ai__') return
      const node = d.nodes![o.next]
      if (node) node.message = v
    })
  }
  function removeOption(parentId: string, optIdx: number) {
    mutate(d => {
      const opts = d.nodes![parentId]?.options
      if (!opts) return
      const [removed] = opts.splice(optIdx, 1)
      if (removed) gc(d, removed.next)
    })
  }
  function addBranch() { addOption(start, null) }

  // ----- View model RÉCURSIF d'une option -----
  // `ancestors` = ids des nœuds du chemin courant (parent inclus). Une option
  // dont la cible y figure (back-edge) ou est __ai__/typée est une FEUILLE.
  interface OptView {
    key: string
    parentId: string
    idx: number
    answer: string
    title: string
    type: BranchType
    color: string
    badge: string
    isAI: boolean
    backEdge: boolean      // pointe vers un ancêtre (boucle) -> feuille, pas d'expansion
    expandable: boolean    // 'q' non-feuille -> peut recevoir des sous-réponses + récursion
    children: OptView[]
  }
  function optionsOf(parentId: string, ancestors: string[]): OptView[] {
    const node = nodes[parentId]
    if (!node || !node.options) return []
    const keys = optionKeys(node.options)
    return node.options.map((o, j) => {
      const ty = branchType(t, o.next)
      const isAI = o.next === '__ai__'
      const target = isAI ? null : nodes[o.next]
      const backEdge = !isAI && ancestors.includes(o.next)
      // Expandable uniquement si vrai nœud « q » existant, hors back-edge.
      const expandable = !isAI && !!target && !backEdge && ty === 'q'
      return {
        key: keys[j], parentId, idx: j,
        answer: o.label, title: destOf(o.next), type: ty, color: C[ty], badge: B[ty],
        isAI, backEdge, expandable,
        children: expandable ? optionsOf(o.next, [...ancestors, o.next]) : [],
      }
    })
  }
  const branches = optionsOf(start, [start])

  // Options du <select> de type (IA masqué si allowAI===false). Seul le libellé
  // de la 1re option (« Question ») diffère entre branches et sous-étapes.
  const typeOpts = (qLabel: string): { value: BranchType; label: string }[] => [
    { value: 'q', label: qLabel },
    ...(allowAI ? [{ value: 'ia' as BranchType, label: 'IA' }] : []),
    { value: 'hum', label: 'Conseiller' },
    { value: 'act', label: 'Action' },
  ]
  const typeOptions = typeOpts('Question (arbre)')
  const subTypeOptions = typeOpts('Question')

  const isVert = orient === 'vert'

  // ===================== STYLES INLINE (template) =====================
  const S = {
    legendWrap: { display: 'flex', flexWrap: 'wrap' as const, gap: 14, alignItems: 'center' },
    legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7B8D' },
    legendDot: (c: string) => ({ width: 10, height: 10, borderRadius: 3, background: c }),
    toggleWrap: { display: 'inline-flex', gap: 5, background: '#F0F2F5', borderRadius: 10, padding: 4 },
    toggleBtn: (on: boolean) => ({
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 8,
      border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      background: on ? '#fff' : 'transparent', color: on ? '#1C3F5C' : '#6B7B8D', transition: 'all .2s',
    }),
    canvas: {
      border: '1px solid #E8ECF0', borderRadius: 14, background: '#FBFCFD',
      backgroundImage: 'radial-gradient(#E8ECF0 1px,transparent 1px)', backgroundSize: '22px 22px',
      position: 'relative' as const, overflow: 'hidden', height: 440, marginBottom: 22,
      touchAction: 'none' as const, userSelect: 'none' as const,
    },
    zoomBtn: {
      width: 28, height: 28, border: 'none', borderRadius: 7, background: '#F4F6F8',
      color: '#1C3F5C', fontSize: 16, fontWeight: 700, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    },
    rootCard: {
      background: '#1C3F5C', color: '#fff', borderRadius: 11, padding: '11px 18px',
      fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap' as const,
      boxShadow: '0 8px 20px -10px rgba(28,63,92,.5)',
    },
    answerPill: {
      background: '#fff', border: '1px solid #D8DEE6', borderRadius: 999, padding: '5px 12px',
      fontSize: 12, fontWeight: 600, color: '#1C3F5C', whiteSpace: 'nowrap' as const,
      maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis',
    },
    subPill: {
      background: '#fff', border: '1px solid #D8DEE6', borderRadius: 999, padding: '5px 10px',
      fontSize: 11, fontWeight: 600, color: '#1C3F5C', whiteSpace: 'nowrap' as const,
      maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
    },
    typedCard: (c: string) => ({
      border: '1px solid #E8ECF0', borderLeft: `4px solid ${c}`, borderRadius: 11,
      padding: '9px 13px', background: '#fff', minWidth: 140,
      boxShadow: '0 6px 16px -12px rgba(28,63,92,.3)',
    }),
    subTypedCard: (c: string) => ({
      border: '1px solid #E8ECF0', borderLeft: `4px solid ${c}`, borderRadius: 10,
      padding: '8px 11px', background: '#fff', minWidth: 108,
    }),
    badge: (c: string) => ({
      fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', color: c, textTransform: 'uppercase' as const,
    }),
    title: { fontSize: 12.5, fontWeight: 600, marginTop: 2 },
    connV: { width: 2, background: '#CBD5DF' },
    connH: { height: 2, background: '#CBD5DF' },
    editorCard: { background: '#fff', border: '1px solid #E8ECF0', borderRadius: 16, padding: 24 },
    addBtn: {
      background: '#fff', color: '#1C3F5C', border: '1px dashed #CBD5DF', borderRadius: 10,
      padding: '8px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
    },
    dot: (c: string) => ({ width: 12, height: 12, borderRadius: '50%', background: c, flexShrink: 0 }),
    select: {
      height: 36, border: '1px solid #E2E8F0', borderRadius: 9, padding: '0 8px',
      fontSize: 12.5, fontWeight: 600, background: '#fff', cursor: 'pointer', color: '#1C3F5C',
    },
    answerInput: {
      width: 150, height: 36, border: '1px solid #E2E8F0', borderRadius: 9, padding: '0 11px',
      fontSize: 13, fontWeight: 600, color: '#1C3F5C',
    },
    destInput: {
      flex: 1, minWidth: 140, height: 36, border: '1px solid #E2E8F0', borderRadius: 9,
      padding: '0 11px', fontSize: 13,
    },
    iconBtn: {
      width: 34, height: 34, border: '1px solid #E2E8F0', borderRadius: 9, background: '#fff',
      color: '#1C3F5C', fontSize: 16, cursor: 'pointer', flexShrink: 0,
    },
    delBtn: {
      width: 34, height: 34, border: 'none', borderRadius: 9, background: '#F4F6F8',
      color: '#9AA7B4', fontSize: 14, cursor: 'pointer', flexShrink: 0,
    },
    subWrap: {
      marginTop: 10, paddingLeft: 22, display: 'flex', flexDirection: 'column' as const,
      gap: 8, borderLeft: '2px solid #F0F2F5',
    },
    subRow: { display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' as const },
  }

  const arrow = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="#CBD5DF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  // ===================== ÉDITEUR : ligne d'option RÉCURSIVE =====================
  // depth=0 = branche racine (carte épaisse), depth>=1 = sous-réponse (compacte).
  // Le bouton « + sous-réponse » n'apparaît que sur une option non-IA, non-feuille
  // boucle (back-edge) : cliquer = addOption(option.next). La récursion s'arrête
  // d'elle-même (children non vides seulement si `expandable`).
  function renderEditorRow(o: OptView, depth: number) {
    const compact = depth > 0
    const canChild = !o.isAI && !o.backEdge   // hum/act/q éditables ouvrent une sous-réponse (conversion en « q »)
    return (
      <div key={o.key} style={depth === 0
        ? { border: '1px solid #F0F2F5', borderRadius: 12, padding: '13px 14px' }
        : undefined}>
        <div style={compact ? S.subRow : { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={compact ? { ...S.dot(o.color), width: 11, height: 11 } : S.dot(o.color)} />
          <select value={o.type} onChange={e => setType(o.parentId, o.idx, e.target.value)}
                  style={compact ? { ...S.select, height: 32, borderRadius: 8, padding: '0 7px', fontSize: 12 } : S.select}>
            {(compact ? subTypeOptions : typeOptions).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <input type="text" value={o.answer} placeholder="Réponse"
                 style={compact
                   ? { ...S.answerInput, width: 120, height: 32, borderRadius: 8, padding: '0 10px', fontSize: 12.5 }
                   : S.answerInput}
                 onChange={e => setLabel(o.parentId, o.idx, e.target.value)} />
          {arrow}
          <input type="text" value={o.isAI ? '' : o.title}
                 placeholder={o.isAI ? "L'IA prend le relais" : 'Destination'}
                 disabled={o.isAI}
                 style={compact
                   ? { ...S.destInput, minWidth: 120, height: 32, borderRadius: 8, padding: '0 10px', fontSize: 12.5, opacity: o.isAI ? .6 : 1 }
                   : { ...S.destInput, opacity: o.isAI ? .6 : 1 }}
                 onChange={e => setTitle(o.parentId, o.idx, e.target.value)} />
          <button type="button" title={o.backEdge ? 'Lien retour (boucle) — pas de sous-réponse' : 'Ajouter une sous-réponse'}
                  onClick={() => addOption(o.parentId, o.idx)} disabled={!canChild}
                  style={compact
                    ? { ...S.iconBtn, width: 30, height: 30, borderRadius: 8, fontSize: 14, opacity: canChild ? 1 : .5, cursor: canChild ? 'pointer' : 'not-allowed' }
                    : { ...S.iconBtn, opacity: canChild ? 1 : .5, cursor: canChild ? 'pointer' : 'not-allowed' }}>
            +
          </button>
          <button type="button" onClick={() => removeOption(o.parentId, o.idx)}
                  style={compact ? { ...S.delBtn, width: 30, height: 30, borderRadius: 8, fontSize: 13 } : S.delBtn}>✕</button>
        </div>
        {o.children.length > 0 && (
          <div style={S.subWrap}>
            {o.children.map(c => renderEditorRow(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // ===================== CANVAS : nœud RÉCURSIF (vert + horiz) =====================
  // Rend la pile « pastille réponse -> carte typée -> (récursivement) ses enfants ».
  // depth>=1 réutilise les variantes « sub » (pills/cartes plus petites). Une
  // option back-edge ou non-expandable n'affiche QUE sa pastille (feuille).
  function renderCanvasOpt(o: OptView, depth: number) {
    const pill = depth === 0 ? S.answerPill : S.subPill
    const card = depth === 0 ? S.typedCard(o.color) : S.subTypedCard(o.color)
    const badge = depth === 0 ? S.badge(o.color) : { ...S.badge(o.color), fontSize: 9 }
    const titleStyle = depth === 0 ? S.title : { fontSize: 11.5, fontWeight: 600 as const, marginTop: 2 }
    const connLen = depth === 0 ? 14 : 12
    // Back-edge : feuille terminale = juste la pastille (lien de retour/boucle).
    if (o.backEdge) {
      return <div key={o.key} style={pill}>{o.answer}</div>
    }
    if (isVert) {
      return (
        <div key={o.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={pill}>{o.answer}</div>
          <div style={{ ...S.connV, height: connLen }} />
          <div style={card}>
            <div style={badge}>{o.badge}</div>
            <div style={titleStyle}>{o.title}</div>
          </div>
          {o.children.length > 0 && (
            <>
              <div style={{ ...S.connV, height: connLen }} />
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {o.children.map(c => renderCanvasOpt(c, depth + 1))}
              </div>
            </>
          )}
        </div>
      )
    }
    return (
      <div key={o.key} style={{ display: 'flex', alignItems: 'center' }}>
        <div style={pill}>{o.answer}</div>
        <div style={{ ...S.connH, width: connLen }} />
        <div style={card}>
          <div style={badge}>{o.badge}</div>
          <div style={titleStyle}>{o.title}</div>
        </div>
        {o.children.length > 0 && (
          <>
            <div style={{ ...S.connH, width: connLen }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {o.children.map(c => renderCanvasOpt(c, depth + 1))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ===== Légende + toggle orientation ===== */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div style={S.legendWrap}>
          {(['q', 'ia', 'hum', 'act'] as BranchType[]).map(k => (
            <span key={k} style={S.legendItem}>
              <span style={S.legendDot(C[k])} />{B[k]}
            </span>
          ))}
        </div>
        <div style={S.toggleWrap}>
          <button type="button" onClick={() => setOrient('vert')} style={S.toggleBtn(isVert)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 4v16M12 20l-5-5M12 20l5-5M6 4h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>Vertical
          </button>
          <button type="button" onClick={() => setOrient('horiz')} style={S.toggleBtn(!isVert)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M4 12h16M20 12l-5-5M20 12l-5 5M4 6v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>Horizontal
          </button>
        </div>
      </div>

      {/* ===== Canvas flowchart (zoom + déplacement) ===== */}
      <div
        ref={viewportRef}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        style={{ ...S.canvas, cursor: grabbing ? 'grabbing' : 'grab' }}
      >
        {/* Contrôles de zoom (ne déclenchent pas le pan) */}
        <div onPointerDown={e => e.stopPropagation()} style={{
          position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
          background: '#fff', border: '1px solid #E8ECF0', borderRadius: 10, padding: 4,
          boxShadow: '0 6px 16px -10px rgba(28,63,92,.4)',
        }}>
          <button type="button" title="Dézoomer" onClick={() => setZoom(z => clampZoom(z * 0.9))} style={S.zoomBtn}>−</button>
          <button type="button" title="Réinitialiser la vue" onClick={resetView}
                  style={{ ...S.zoomBtn, width: 'auto', padding: '0 8px', fontSize: 11.5 }}>{Math.round(zoom * 100)}%</button>
          <button type="button" title="Zoomer" onClick={() => setZoom(z => clampZoom(z * 1.1))} style={S.zoomBtn}>+</button>
        </div>
        <div style={{ position: 'absolute', left: 12, bottom: 8, zIndex: 5, fontSize: 11, color: '#9AA7B4', pointerEvents: 'none' }}>
          Glissez pour déplacer · molette pour zoomer
        </div>
        {/* Contenu zoomé/déplacé */}
        <div style={{
          padding: '28px 22px', width: 'fit-content', willChange: 'transform',
          transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0',
        }}>
        {isVert ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 560 }}>
            <div style={S.rootCard}>🌿 Message d'accueil</div>
            <div style={{ ...S.connV, height: 22 }} />
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {branches.length === 0 && (
                <span style={{ fontSize: 12.5, color: '#9AA7B4' }}>Aucune branche. Ajoutez-en une ci-dessous.</span>
              )}
              {branches.map(b => renderCanvasOpt(b, 0))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minWidth: 560 }}>
            <div style={{ ...S.rootCard, padding: '11px 16px', fontSize: 13 }}>🌿 Accueil</div>
            <div style={{ ...S.connH, width: 22 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {branches.length === 0 && (
                <span style={{ fontSize: 12.5, color: '#9AA7B4' }}>Aucune branche. Ajoutez-en une ci-dessous.</span>
              )}
              {branches.map(b => renderCanvasOpt(b, 0))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ===== Éditeur de branches ===== */}
      <div style={S.editorCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 700, fontSize: 17, margin: 0 }}>
            Arbre de conversation
          </h3>
          <button type="button" onClick={addBranch} style={S.addBtn}>+ Branche</button>
        </div>
        <p style={{ fontSize: 13, color: '#9AA7B4', margin: '0 0 16px' }}>
          Choisissez le type (couleur), l'intitulé de la réponse et sa destination : question, IA, conseiller ou action.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {branches.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9AA7B4', fontSize: 13, padding: 12 }}>
              Aucune branche pour l'instant.
            </div>
          )}
          {branches.map(b => renderEditorRow(b, 0))}
        </div>

      </div>
    </div>
  )
}
