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
//   Une BRANCHE = une option de la racine : tree.nodes[start].options[i] = { label, next }.
//     - type dérivé de la cible : IA si next==="__ai__" ; "hum" si node.type==="handoff" ;
//       "act" si node.type==="appointment"||"lead" ; sinon "q".
//     - answer = option.label · title/destination = message du nœud cible (ou son libellé).
//     - subs = options du nœud cible (mêmes règles, sans récursion plus profonde dans l'éditeur).
//   Éditer met à jour le label de l'option ET le message/type du nœud cible.
//   Changer de type RECONSTRUIT proprement le nœud cible (message/handoff/appointment/lead),
//   ou bascule l'option sur next="__ai__" pour IA — en PRÉSERVANT tout le reste du tree_json
//   (jamais de suppression de nœuds non concernés).

import { useState } from 'react'
import type { Tree } from '../types/bot'

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

  const t = asTree(tree)
  const nodes = t.nodes || {}
  const start = t.start || 'root'
  const root = nodes[start] || { message: '', options: [] }
  const rootOptions = root.options || []
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

  // ----- Vue : sous-étapes d'une branche (options du nœud cible) -----
  type SubView = { key: string; answer: string; title: string; type: BranchType; color: string; badge: string }
  function subsOf(next: string): SubView[] {
    if (next === '__ai__') return []
    const node = nodes[next]
    if (!node || !node.options) return []
    const keys = optionKeys(node.options)
    return node.options.map((o, j) => {
      const ty = branchType(t, o.next)
      return { key: keys[j], answer: o.label, title: destOf(o.next), type: ty, color: C[ty], badge: B[ty] }
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

  function setBranchType(idx: number, raw: string) {
    const ty = raw as BranchType
    if (ty === 'ia' && !allowAI) return
    mutate(d => applyType(d, start, idx, ty))
  }
  function setBranchAnswer(idx: number, v: string) {
    mutate(d => { const o = d.nodes![start].options![idx]; if (o) o.label = v })
  }
  function setBranchTitle(idx: number, v: string) {
    mutate(d => {
      const o = d.nodes![start].options![idx]
      if (!o || o.next === '__ai__') return
      const node = d.nodes![o.next]
      if (node) node.message = v
    })
  }
  function removeBranch(idx: number) {
    mutate(d => {
      const opts = d.nodes![start].options
      if (!opts) return
      const [removed] = opts.splice(idx, 1)
      if (removed) gc(d, removed.next)
    })
  }
  function addBranch() {
    mutate(d => {
      const nd = d.nodes!
      const id = newNodeId(nd)
      nd[id] = { message: 'Nouvelle destination', options: [] }
      if (!nd[start].options) nd[start].options = []
      nd[start].options!.push({ label: 'Nouvelle réponse', next: id })
    })
  }

  // ----- Sous-étapes -----
  function addSub(branchIdx: number) {
    mutate(d => {
      const nd = d.nodes!
      const opt = nd[start].options?.[branchIdx]
      if (!opt) return
      // Une sous-étape n'a de sens que sous un vrai nœud (type message/Question).
      let parentId = opt.next
      if (parentId === '__ai__' || !nd[parentId]) {
        parentId = newNodeId(nd)
        nd[parentId] = { message: 'Nouvelle destination', options: [] }
        opt.next = parentId
      }
      const parent = nd[parentId]
      // Un nœud typé (appointment/lead/handoff) ne porte pas de sous-options : on le neutralise.
      delete parent.type
      delete parent.url
      delete parent.fields
      if (!parent.options) parent.options = []
      const sid = newNodeId(nd)
      nd[sid] = { message: 'Destination', options: [] }
      parent.options.push({ label: 'Réponse', next: sid })
    })
  }
  function subOptionAt(d: Tree, branchIdx: number, subIdx: number) {
    const parentNext = d.nodes![start].options?.[branchIdx]?.next
    if (!parentNext || parentNext === '__ai__') return null
    const parent = d.nodes![parentNext]
    return parent?.options?.[subIdx] || null
  }
  function setSubType(branchIdx: number, subIdx: number, raw: string) {
    const ty = raw as BranchType
    if (ty === 'ia' && !allowAI) return
    mutate(d => {
      const parentNext = d.nodes![start].options?.[branchIdx]?.next
      if (!parentNext || parentNext === '__ai__' || !d.nodes![parentNext]) return
      applyType(d, parentNext, subIdx, ty)
    })
  }
  function setSubAnswer(branchIdx: number, subIdx: number, v: string) {
    mutate(d => { const o = subOptionAt(d, branchIdx, subIdx); if (o) o.label = v })
  }
  function setSubTitle(branchIdx: number, subIdx: number, v: string) {
    mutate(d => {
      const o = subOptionAt(d, branchIdx, subIdx)
      if (!o || o.next === '__ai__') return
      const node = d.nodes![o.next]
      if (node) node.message = v
    })
  }
  function removeSub(branchIdx: number, subIdx: number) {
    mutate(d => {
      const parentNext = d.nodes![start].options?.[branchIdx]?.next
      if (!parentNext || parentNext === '__ai__') return
      const parent = d.nodes![parentNext]
      if (!parent?.options) return
      const [removed] = parent.options.splice(subIdx, 1)
      if (removed) gc(d, removed.next)
    })
  }

  // ----- View model des branches (mêmes champs que le template) -----
  const branchKeys = optionKeys(rootOptions)
  const branches = rootOptions.map((o, i) => {
    const ty = branchType(t, o.next)
    const subs = subsOf(o.next)
    return {
      key: branchKeys[i],
      idx: i, answer: o.label, title: destOf(o.next), type: ty, color: C[ty], badge: B[ty],
      hasSubs: subs.length > 0, subs, isAI: o.next === '__ai__',
    }
  })

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
      padding: '28px 22px', overflow: 'auto', marginBottom: 22,
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
    row: {
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const,
      border: '1px solid #F0F2F5', borderRadius: 12, padding: '13px 14px',
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

      {/* ===== Canvas flowchart ===== */}
      <div style={S.canvas}>
        {isVert ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 560 }}>
            <div style={S.rootCard}>🌿 Message d'accueil</div>
            <div style={{ ...S.connV, height: 22 }} />
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {branches.length === 0 && (
                <span style={{ fontSize: 12.5, color: '#9AA7B4' }}>Aucune branche. Ajoutez-en une ci-dessous.</span>
              )}
              {branches.map(b => (
                <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={S.answerPill}>{b.answer}</div>
                  <div style={{ ...S.connV, height: 14 }} />
                  <div style={S.typedCard(b.color)}>
                    <div style={S.badge(b.color)}>{b.badge}</div>
                    <div style={S.title}>{b.title}</div>
                  </div>
                  {b.hasSubs && (
                    <>
                      <div style={{ ...S.connV, height: 14 }} />
                      <div style={{ display: 'flex', gap: 12 }}>
                        {b.subs.map(x => (
                          <div key={x.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={S.subPill}>{x.answer}</div>
                            <div style={{ ...S.connV, height: 12 }} />
                            <div style={S.subTypedCard(x.color)}>
                              <div style={{ ...S.badge(x.color), fontSize: 9 }}>{x.badge}</div>
                              <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{x.title}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
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
              {branches.map(b => (
                <div key={b.key} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={S.answerPill}>{b.answer}</div>
                  <div style={{ ...S.connH, width: 14 }} />
                  <div style={S.typedCard(b.color)}>
                    <div style={S.badge(b.color)}>{b.badge}</div>
                    <div style={S.title}>{b.title}</div>
                  </div>
                  {b.hasSubs && (
                    <>
                      <div style={{ ...S.connH, width: 14 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {b.subs.map(x => (
                          <div key={x.key} style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={S.subPill}>{x.answer}</div>
                            <div style={{ ...S.connH, width: 11 }} />
                            <div style={S.subTypedCard(x.color)}>
                              <div style={{ ...S.badge(x.color), fontSize: 9 }}>{x.badge}</div>
                              <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{x.title}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
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
          {branches.map(b => (
            <div key={b.key} style={{ border: '1px solid #F0F2F5', borderRadius: 12, padding: '13px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={S.dot(b.color)} />
                <select value={b.type} onChange={e => setBranchType(b.idx, e.target.value)} style={S.select}>
                  {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="text" value={b.answer} placeholder="Réponse" style={S.answerInput}
                       onChange={e => setBranchAnswer(b.idx, e.target.value)} />
                {arrow}
                <input type="text" value={b.isAI ? '' : b.title} placeholder={b.isAI ? "L'IA prend le relais" : 'Destination'}
                       disabled={b.isAI} style={{ ...S.destInput, opacity: b.isAI ? .6 : 1 }}
                       onChange={e => setBranchTitle(b.idx, e.target.value)} />
                <button type="button" title="Ajouter une sous-étape" onClick={() => addSub(b.idx)}
                        disabled={b.isAI}
                        style={{ ...S.iconBtn, opacity: b.isAI ? .5 : 1, cursor: b.isAI ? 'not-allowed' : 'pointer' }}>
                  +
                </button>
                <button type="button" onClick={() => removeBranch(b.idx)} style={S.delBtn}>✕</button>
              </div>

              {b.hasSubs && (
                <div style={S.subWrap}>
                  {b.subs.map((x, j) => (
                    <div key={x.key} style={S.subRow}>
                      <span style={{ ...S.dot(x.color), width: 11, height: 11 }} />
                      <select value={x.type} onChange={e => setSubType(b.idx, j, e.target.value)}
                              style={{ ...S.select, height: 32, borderRadius: 8, padding: '0 7px', fontSize: 12 }}>
                        {subTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input type="text" value={x.answer} placeholder="Réponse"
                             style={{ ...S.answerInput, width: 120, height: 32, borderRadius: 8, padding: '0 10px', fontSize: 12.5 }}
                             onChange={e => setSubAnswer(b.idx, j, e.target.value)} />
                      <input type="text" value={x.type === 'ia' ? '' : x.title} placeholder={x.type === 'ia' ? "L'IA prend le relais" : 'Destination'}
                             disabled={x.type === 'ia'}
                             style={{ ...S.destInput, minWidth: 120, height: 32, borderRadius: 8, padding: '0 10px', fontSize: 12.5, opacity: x.type === 'ia' ? .6 : 1 }}
                             onChange={e => setSubTitle(b.idx, j, e.target.value)} />
                      <button type="button" onClick={() => removeSub(b.idx, j)}
                              style={{ ...S.delBtn, width: 30, height: 30, borderRadius: 8, fontSize: 13 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
