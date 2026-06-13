// Builder visuel de l'arbre de décision — porté de builder.jsx (design), adapté
// au format tree_json de l'API : { start, nodes: { id: { message, options: [{label, next}] } } }.
// Un "choix" = une option ; sa cible est un nœud (nouveau ou EXISTANT -> boucle),
// ou "__ai__". Drag & drop natif : réordonner les bulles et les déplacer d'une
// branche à l'autre. Génération par IA depuis un texte/URL (plans payants).
import { useRef, useState } from 'react'
import { Check, Download, GripVertical, MessageSquare, Plus, Sparkles, Upload } from 'lucide-react'
import { api } from '../api'
import { Btn, Card, Chip, Divider, Field, InfoBox, SectionTitle, Seg } from '../ui'

// Nœuds typés : sans type = message classique (rétro-compat), 'appointment' =
// bouton « Prendre rendez-vous » (url https), 'lead' = formulaire de contact,
// 'handoff' = mise en relation avec un conseiller (live chat, aucun champ).
type TreeNode = {
  message: string
  options?: { label: string; next: string }[]
  type?: 'message' | 'appointment' | 'lead' | 'handoff'
  url?: string
  fields?: string[]
}
type Tree = { start: string; nodes: Record<string, TreeNode> }

const LEAD_FIELD_LABELS: [string, string][] = [
  ['email', 'Email'], ['name', 'Nom'], ['phone', 'Téléphone'], ['message', 'Message'],
]

interface Props {
  tree: Tree
  onChange: (tree: Tree) => void
  onExport?: () => void
  onImport?: (file: File) => void
  botId?: number              // requis pour la génération IA
  canGenerate?: boolean       // plans payants + permission contexte
  maxNodes?: number | null    // quota de bulles du plan (null = illimité)
  allowAI?: boolean           // false en mode arbre pur / plan free : pas d'escalade IA
}

type Sel = { parent: string; idx: number } | 'welcome' | null
type DragSrc = { parent: string; idx: number } | null

let counter = 1
function newNodeId(nodes: Record<string, any>) {
  let id
  do { id = 'n' + Date.now().toString(36).slice(-4) + counter++ } while (nodes[id])
  return id
}

export default function TreeBuilder({ tree, onChange, onExport, onImport, botId, canGenerate = false, maxNodes = null, allowAI = true }: Props) {
  const [sel, setSel] = useState<Sel>('welcome')
  const [dragSrc, setDragSrc] = useState<DragSrc>(null)
  const [dropHint, setDropHint] = useState<{ key: string; pos: 'before' | 'after' | 'into' } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [genMode, setGenMode] = useState<'text' | 'url'>('text')
  const [genText, setGenText] = useState('')
  const [genUrl, setGenUrl] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')

  const nodes = tree.nodes || {}
  const start = tree.start || 'root'
  const root = nodes[start] || { message: '', options: [] }
  const nodeCount = Object.keys(nodes).length
  const atNodeLimit = maxNodes != null && nodeCount >= maxNodes

  function mutate(fn: (t: Tree) => void) {
    const copy: Tree = JSON.parse(JSON.stringify(tree))
    fn(copy)
    onChange(copy)
  }

  function selectedOption(): { label: string; next: string } | null {
    if (!sel || sel === 'welcome') return null
    return nodes[sel.parent]?.options?.[sel.idx] || null
  }

  function nodeLabel(id: string): string {
    if (id === start) return 'Menu principal (accueil)'
    for (const n of Object.values(nodes)) {
      const opt = (n.options || []).find(o => o.next === id)
      if (opt) return opt.label
    }
    return id
  }

  function isReferenced(t: Tree, nodeId: string): boolean {
    return Object.values(t.nodes).some(n => (n.options || []).some(o => o.next === nodeId))
  }

  function gc(t: Tree, id: string) {
    if (id === '__ai__' || id === t.start || !t.nodes[id] || isReferenced(t, id)) return
    const children = (t.nodes[id].options || []).map(o => o.next)
    delete t.nodes[id]
    children.forEach(c => gc(t, c))
  }

  // ---------- Drag & drop ----------
  // Façon explorateur de fichiers : on dépose SUR les cartes, à n'importe
  // quelle profondeur. Bord haut/bas = insérer avant/après (ligne d'insertion),
  // centre = imbriquer comme sous-choix (la carte s'illumine).

  function subtreeOf(startId: string): Set<string> {
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (id === '__ai__' || seen.has(id) || !nodes[id]) return
      seen.add(id)
      for (const o of nodes[id].options || []) walk(o.next)
    }
    walk(startId)
    return seen
  }

  // Interdit : déposer une branche à l'intérieur de son propre sous-arbre
  // (la branche deviendrait inaccessible depuis la racine)
  function canDropInto(parentId: string): boolean {
    if (!dragSrc) return false
    const opt = nodes[dragSrc.parent]?.options?.[dragSrc.idx]
    if (!opt) return false
    if (opt.next !== '__ai__' && subtreeOf(opt.next).has(parentId)) return false
    return true
  }

  function moveOption(destParent: string, destIdx: number) {
    if (!dragSrc || !canDropInto(destParent)) return
    const s = dragSrc
    mutate(t => {
      const srcList = t.nodes[s.parent].options
      if (!srcList) return
      const [moved] = srcList.splice(s.idx, 1)
      let di = destIdx
      if (destParent === s.parent && s.idx < destIdx) di--
      if (!t.nodes[destParent].options) t.nodes[destParent].options = []
      t.nodes[destParent].options!.splice(di, 0, moved)
    })
    setDragSrc(null)
    setDropHint(null)
    setSel(null)
  }

  // Calcule l'action de dépôt pour une carte survolée
  function hintFor(e: React.DragEvent, parent: string, idx: number, targetId: string | null): { pos: 'before' | 'after' | 'into' } | null {
    if (!dragSrc) return null
    if (dragSrc.parent === parent && dragSrc.idx === idx) return null // soi-même
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - rect.top) / Math.max(1, rect.height)
    const canNest = targetId !== null && canDropInto(targetId)
    let pos: 'before' | 'after' | 'into'
    if (canNest && y >= 0.3 && y <= 0.7) pos = 'into'
    else pos = y < 0.5 ? 'before' : 'after'
    if (pos === 'into') return { pos }
    if (!canDropInto(parent)) return canNest ? { pos: 'into' } : null
    const di = pos === 'before' ? idx : idx + 1
    if (parent === dragSrc.parent && (di === dragSrc.idx || di === dragSrc.idx + 1)) {
      return canNest ? { pos: 'into' } : null // sans effet -> propose l'imbrication
    }
    return { pos }
  }

  function rowDragOver(e: React.DragEvent, parent: string, idx: number, targetId: string | null) {
    if (!dragSrc) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const hint = hintFor(e, parent, idx, targetId)
    const key = `${parent}:${idx}`
    if (!hint) {
      if (dropHint?.key === key) setDropHint(null)
      return
    }
    if (dropHint?.key !== key || dropHint.pos !== hint.pos) setDropHint({ key, pos: hint.pos })
  }

  function rowDrop(e: React.DragEvent, parent: string, idx: number, targetId: string | null) {
    e.preventDefault()
    e.stopPropagation()
    const hint = hintFor(e, parent, idx, targetId)
    if (!hint) { setDropHint(null); return }
    if (hint.pos === 'into' && targetId) {
      moveOption(targetId, (nodes[targetId].options || []).length)
    } else if (hint.pos === 'before') {
      moveOption(parent, idx)
    } else {
      moveOption(parent, idx + 1)
    }
  }

  function rowDragLeave(e: React.DragEvent, parent: string, idx: number) {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
    if (dropHint?.key === `${parent}:${idx}`) setDropHint(null)
  }

  // ---------- Édition ----------

  function updateOption(patch: Partial<{ label: string; next: string }>) {
    if (!sel || sel === 'welcome') return
    mutate(t => {
      const opt = t.nodes[sel.parent]?.options?.[sel.idx]
      if (opt) Object.assign(opt, patch)
    })
  }

  function updateTargetMessage(message: string) {
    const opt = selectedOption()
    if (!opt || opt.next === '__ai__') return
    mutate(t => { if (t.nodes[opt.next]) t.nodes[opt.next].message = message })
  }

  // ---------- Nœuds typés (message / rendez-vous / contact) ----------

  function setNodeType(nodeId: string, v: string) {
    mutate(t => {
      const n = t.nodes[nodeId]
      if (!n) return
      if (v === 'appointment') {
        n.type = 'appointment'
        if (typeof n.url !== 'string') n.url = ''
        delete n.fields
      } else if (v === 'lead') {
        if (n.type !== 'lead' || !Array.isArray(n.fields)) n.fields = ['email', 'message']
        n.type = 'lead'
        delete n.url
      } else if (v === 'handoff') {
        n.type = 'handoff'
        delete n.url
        delete n.fields
      } else {
        // Retour au message classique : on ne stocke JAMAIS type:'message'
        delete n.type
        delete n.url
        delete n.fields
      }
    })
  }

  function toggleLeadField(nodeId: string, field: string) {
    mutate(t => {
      const n = t.nodes[nodeId]
      if (!n) return
      const cur = n.fields || ['email']
      // Tableau ordonné, email toujours en tête
      n.fields = LEAD_FIELD_LABELS.map(([f]) => f)
        .filter(f => f === 'email' || (f === field ? !cur.includes(f) : cur.includes(f)))
    })
  }

  // Bloc « Type de réponse » de l'inspecteur (accueil + cibles dédiées)
  function nodeTypeFields(nodeId: string) {
    const node = nodes[nodeId]
    if (!node) return null
    const ntype = node.type || 'message'
    return (
      <>
        <Field label="Type de réponse">
          <Seg small value={ntype} onChange={v => setNodeType(nodeId, v)}
               options={[
                 { value: 'message', label: 'Message' },
                 { value: 'appointment', label: 'Rendez-vous' },
                 { value: 'lead', label: 'Contact' },
                 { value: 'handoff', label: 'Conseiller' },
               ]} />
        </Field>
        {ntype === 'appointment' && (
          <Field label="URL du calendrier"
                 hint="https obligatoire, 500 caractères max. Calendly et Cal.com s'affichent intégrés dans le chat ; toute autre URL s'ouvre en lien.">
            <input type="text" className="mono" placeholder="https://calendly.com/…"
                   value={node.url || ''}
                   onChange={e => mutate(t => { if (t.nodes[nodeId]) t.nodes[nodeId].url = e.target.value })} />
            {!/^https:\/\//.test(node.url || '') && (
              <div className="field-hint" style={{ color: 'var(--danger)' }}>
                L'URL doit commencer par https://
              </div>
            )}
          </Field>
        )}
        {ntype === 'lead' && (
          <Field label="Champs demandés"
                 hint="Le visiteur remplit un mini-formulaire ; chaque envoi apparaît dans l'onglet Leads.">
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
              {LEAD_FIELD_LABELS.map(([f, lbl]) => {
                const on = f === 'email' || (node.fields || []).includes(f)
                return (
                  <span key={f} className="row g6">
                    <button type="button" className={`perm-check ${on ? 'on' : ''}`}
                            disabled={f === 'email'} aria-label={lbl}
                            style={f === 'email' ? { opacity: .55, cursor: 'default' } : undefined}
                            onClick={() => f !== 'email' && toggleLeadField(nodeId, f)}>
                      {on && <Check size={13} />}
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {lbl}{f === 'email' ? ' (obligatoire)' : ''}
                    </span>
                  </span>
                )
              })}
            </div>
          </Field>
        )}
        {ntype === 'handoff' && (
          <InfoBox tone="info" title="Mise en relation avec un conseiller">
            Le message de ce nœud sert d'introduction, puis le visiteur est placé en file d'attente
            (onglet Inbox du bot). Sans prise en main sous 15 minutes, le bot reprend la main avec un
            message d'excuse.
          </InfoBox>
        )}
      </>
    )
  }

  function addChoice(parentId: string) {
    if (atNodeLimit) return
    mutate(t => {
      const id = newNodeId(t.nodes)
      t.nodes[id] = { message: 'Réponse à compléter…', options: [] }
      const parent = t.nodes[parentId]
      if (!parent.options) parent.options = []
      parent.options.push({ label: 'Nouveau choix', next: id })
    })
  }

  function removeSelected() {
    if (!sel || sel === 'welcome') return
    const s = sel
    const opt = selectedOption()
    mutate(t => {
      const parent = t.nodes[s.parent]
      parent.options = (parent.options || []).filter((_, i) => i !== s.idx)
      if (opt) gc(t, opt.next)
    })
    setSel(null)
  }

  function retarget(value: string) {
    if (!sel || sel === 'welcome') return
    const s = sel
    const opt = selectedOption()
    if (!opt || value === opt.next) return
    mutate(t => {
      const o = t.nodes[s.parent].options![s.idx]
      const old = o.next
      if (value === '__new__') {
        const id = newNodeId(t.nodes)
        t.nodes[id] = { message: 'Réponse à compléter…', options: [] }
        o.next = id
      } else {
        o.next = value
      }
      gc(t, old)
    })
  }

  async function generate() {
    if (!botId) return
    setGenError('')
    setGenBusy(true)
    try {
      const body = genMode === 'url' ? { url: genUrl.trim() } : { source_text: genText }
      const res = await api(`/api/bots/${botId}/tree/generate`, { method: 'POST', body })
      if (nodeCount > 2 && !window.confirm("Remplacer l'arbre actuel par l'arbre généré ?")) return
      onChange(res.tree_json)
      setSel('welcome')
      setGenText('')
      setGenUrl('')
    } catch (err: any) {
      setGenError(err.status === 429
        ? "Limite quotidienne atteinte : 10 générations d'arbre par jour et par organisation. Réessayez demain."
        : err.message)
    } finally {
      setGenBusy(false)
    }
  }

  // ---------- Rendu récursif d'un choix (option) ----------
  function OptionCard({ parent, idx, depth, path }: { parent: string; idx: number; depth: number; path: Set<string> }) {
    const opt = nodes[parent]?.options?.[idx]
    if (!opt) return null
    const isAI = opt.next === '__ai__'
    const target = isAI ? null : nodes[opt.next]
    const isCycle = !isAI && path.has(opt.next)
    const children = (!isAI && !isCycle && target?.options) || []
    const active = sel !== null && sel !== 'welcome' && sel.parent === parent && sel.idx === idx
    const isDragged = dragSrc !== null && dragSrc.parent === parent && dragSrc.idx === idx
    const nestTargetId = !isAI && !isCycle && target ? opt.next : null
    const hint = dropHint?.key === `${parent}:${idx}` ? dropHint.pos : null

    return (
      <div className="col" style={{ gap: 7, opacity: isDragged ? .35 : 1 }}>
        <div className={`row g8 tree-row ${hint === 'before' ? 'drop-before' : ''} ${hint === 'after' ? 'drop-after' : ''}`}
             draggable
             onDragStart={e => {
               e.stopPropagation()
               e.dataTransfer.effectAllowed = 'move'
               e.dataTransfer.setData('text/plain', opt.label)
               setDragSrc({ parent, idx })
             }}
             onDragEnd={() => { setDragSrc(null); setDropHint(null) }}
             onDragOver={e => rowDragOver(e, parent, idx, nestTargetId)}
             onDragLeave={e => rowDragLeave(e, parent, idx)}
             onDrop={e => rowDrop(e, parent, idx, nestTargetId)}>
          {depth > 0 && <span style={{ width: 18, height: 1.5, background: 'var(--border2)', flexShrink: 0 }} />}
          <button className={`tree-node-btn ${active ? 'active' : ''} ${isAI ? 'ai' : ''} ${hint === 'into' ? 'drop-into' : ''}`}
                  onClick={() => setSel({ parent, idx })}>
            <GripVertical size={13} style={{ color: 'var(--faint)', flexShrink: 0 }} />
            <span className="lbl">{opt.label}</span>
            {isAI && <Chip tone="warn">→ IA</Chip>}
            {isCycle && <Chip tone="mut">↩ {opt.next === start ? 'menu' : 'boucle'}</Chip>}
            {!isAI && target?.type === 'appointment' && <Chip tone="info">RDV</Chip>}
            {!isAI && target?.type === 'lead' && <Chip tone="go">Contact</Chip>}
            {!isAI && target?.type === 'handoff' && <Chip tone="acc">Conseiller</Chip>}
            {!isAI && !isCycle && children.length > 0 && <span className="cnt">{children.length}</span>}
          </button>
        </div>
        {children.length > 0 && (
          <div className="tree-children">
            {children.map((_, i) => (
              <OptionCard key={i} parent={opt.next} idx={i} depth={depth + 1}
                          path={new Set([...path, opt.next])} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const opt = selectedOption()
  const target = opt && opt.next !== '__ai__' ? nodes[opt.next] : null
  const targetIsShared = opt && opt.next !== '__ai__'
    ? Object.values(nodes).reduce((n, nd) => n + (nd.options || []).filter(o => o.next === opt.next).length, 0) > 1 || opt.next === start
    : false
  const rootOptions = root.options || []

  return (
    <div className="col g18">
      <SectionTitle
        sub="Le menu guidé affiché avant l'IA. Glissez-déposez les bulles pour réorganiser ou imbriquer les branches."
        right={
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {maxNodes != null && (
              <Chip tone={atNodeLimit ? 'warn' : 'mut'}>{nodeCount} / {maxNodes} bulles</Chip>
            )}
            {onExport && <Btn kind="ghost" small onClick={onExport}><Download size={13} /> Exporter JSON</Btn>}
            {onImport && (
              <>
                <Btn kind="ghost" small onClick={() => fileRef.current?.click()}><Upload size={13} /> Importer</Btn>
                <input ref={fileRef} type="file" accept=".json" hidden
                       onChange={e => e.target.files?.[0] && onImport(e.target.files[0])} />
              </>
            )}
          </div>
        }>
        Arbre de décision
      </SectionTitle>

      {atNodeLimit && (
        <InfoBox tone="warn" title="Quota de bulles atteint">
          Votre plan est limité à {maxNodes} bulles. Supprimez des nœuds ou passez au plan supérieur pour
          agrandir l'arbre.
        </InfoBox>
      )}

      <div className="grid-controls" style={{ gridTemplateColumns: '1fr 320px' }}>
        {/* Canvas */}
        <div className="col g14">
          <Card style={{ minHeight: 360 }}>
            <div className="row g8" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              <button className={`tree-welcome ${sel === 'welcome' ? 'active' : ''} ${dropHint?.key === 'welcome' ? 'drop-into' : ''}`}
                      onClick={() => setSel('welcome')}
                      onDragOver={e => {
                        if (!dragSrc || !canDropInto(start)) return
                        e.preventDefault()
                        if (dropHint?.key !== 'welcome') setDropHint({ key: 'welcome', pos: 'into' })
                      }}
                      onDragLeave={() => { if (dropHint?.key === 'welcome') setDropHint(null) }}
                      onDrop={e => { e.preventDefault(); moveOption(start, rootOptions.length) }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <MessageSquare size={13} /> Message d'accueil
              </button>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>puis le visiteur choisit :</span>
            </div>
            <div className="col" style={{ gap: 9 }}>
              {rootOptions.map((_, i) => (
                <OptionCard key={i} parent={start} idx={i} depth={0} path={new Set([start])} />
              ))}
            </div>
            <button className="tree-add-root" onClick={() => addChoice(start)} disabled={atNodeLimit}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: atNodeLimit ? .5 : 1 }}>
              <Plus size={13} /> Ajouter un choix racine
            </button>
          </Card>

          {/* Génération par IA */}
          {botId != null && canGenerate && (
            <Card>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={14} style={{ color: 'var(--acc)' }} /> Générer l'arbre avec l'IA
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 10, lineHeight: 1.5 }}>
                Collez votre FAQ / documentation, ou indiquez l'URL d'une page d'aide : l'IA construit un
                arbre de décision complet que vous pourrez retoucher.
              </div>
              <div className="col g10">
                <Seg small value={genMode} onChange={v => setGenMode(v as 'text' | 'url')}
                     options={[{ value: 'text', label: 'Texte collé' }, { value: 'url', label: "URL d'une page" }]} />
                {genMode === 'text' ? (
                  <textarea rows={5} value={genText} onChange={e => setGenText(e.target.value)}
                            placeholder={'Q : Quels sont vos horaires ?\nR : Du lundi au vendredi, 9h-18h…\n\nQ : Comment prendre rendez-vous ?\nR : …'} />
                ) : (
                  <input type="text" className="mono" value={genUrl} onChange={e => setGenUrl(e.target.value)}
                         placeholder="https://votre-site.fr/faq" />
                )}
                {genError && <div className="error">{genError}</div>}
                <div>
                  <Btn kind="soft" onClick={generate}
                       disabled={genBusy || (genMode === 'text' ? genText.trim().length < 50 : !genUrl.trim())}>
                    {genBusy ? 'Génération en cours…' : 'Générer l\'arbre'}
                  </Btn>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Inspecteur */}
        <Card>
          {sel === 'welcome' ? (
            <div className="col" style={{ gap: 13 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Message d'accueil</div>
                <Chip tone="mut">racine</Chip>
              </div>
              <Field label="Texte affiché à l'ouverture du chat">
                <textarea rows={4} value={root.message}
                          onChange={e => mutate(t => { t.nodes[t.start].message = e.target.value })} />
              </Field>
              {nodeTypeFields(start)}
            </div>
          ) : opt ? (
            <div className="col" style={{ gap: 13 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Éditer le nœud</div>
                {opt.next === '__ai__' ? <Chip tone="warn">Escalade IA</Chip> : <Chip tone="mut">{opt.next}</Chip>}
              </div>
              <Field label="Libellé du bouton">
                <input type="text" value={opt.label} onChange={e => updateOption({ label: e.target.value })} />
              </Field>

              <Field label="Cible du bouton"
                     hint="Pointez vers un nœud existant pour créer un retour ou une boucle (ex. « Retour au menu »).">
                <select value={opt.next} onChange={e => retarget(e.target.value)}>
                  {opt.next !== '__ai__' && !targetIsShared && (
                    <option value={opt.next}>Réponse dédiée (actuelle)</option>
                  )}
                  <option value="__new__">+ Nouvelle réponse vierge</option>
                  {(allowAI || opt.next === '__ai__') && (
                    <option value="__ai__">{allowAI ? "Escalade vers l'IA (texte libre)" : 'Escalade IA (inactive en mode arbre)'}</option>
                  )}
                  <optgroup label="Nœuds existants">
                    {Object.keys(nodes).map(id => (
                      <option key={id} value={id}>{nodeLabel(id)}</option>
                    ))}
                  </optgroup>
                </select>
              </Field>

              {opt.next !== '__ai__' && target && !targetIsShared && (
                <>
                  <Field label="Réponse du bot" hint="Affichée quand le visiteur clique ce choix.">
                    <textarea rows={4} value={target.message} onChange={e => updateTargetMessage(e.target.value)} />
                  </Field>
                  {nodeTypeFields(opt.next)}
                </>
              )}
              {opt.next !== '__ai__' && targetIsShared && (
                <InfoBox tone="info" title="Cible partagée">
                  Ce bouton renvoie vers « {nodeLabel(opt.next)} ». Pour modifier le texte de ce nœud,
                  sélectionnez-le directement dans l'arbre.
                </InfoBox>
              )}
              {opt.next === '__ai__' && allowAI && (
                <InfoBox tone="warn" title="Bascule vers l'IA">
                  Ce choix bascule la conversation en mode IA texte libre. En mode dégradé (cap budget), il
                  affiche un message de repli à la place.
                </InfoBox>
              )}
              {opt.next === '__ai__' && !allowAI && (
                <InfoBox tone="danger" title="Escalade IA inactive">
                  Ce bot est en mode arbre : ce bouton affichera un message d'indisponibilité au visiteur.
                  Redirigez-le vers un nœud existant ou supprimez-le.
                </InfoBox>
              )}

              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                {opt.next !== '__ai__' && !targetIsShared && (
                  <Btn kind="soft" small onClick={() => addChoice(opt.next)} disabled={atNodeLimit}>
                    <Plus size={13} /> Ajouter un sous-choix
                  </Btn>
                )}
                <Btn kind="danger" small onClick={removeSelected}>Supprimer</Btn>
              </div>
              <Divider />
              <div style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.55 }}>
                Glissez une bulle par sa poignée pour la réordonner ou la déposer dans une autre branche.
                L'arbre est aussi éditable en JSON via l'export/import (config-as-code).
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--faint)', fontSize: 12.5 }}>
              Sélectionnez un nœud pour l'éditer
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
