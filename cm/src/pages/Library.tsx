// Bibliothèque : les vidéos des dossiers Google Drive partagés avec le robot de Chapote.
// Les monteurs déposent dans le Drive ; ici on retrouve chaque vidéo (miniature, durée, légende
// du .txt du même nom) et on la programme sur les comptes, sans rien renvoyer.
import { StorageCard } from '../components/Storage'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addIdentity, addSource, getAssetsPage, getIdentities, getRobot, getSources, patchAsset, patchIdentity, patchSource,
  removeIdentity, removeSource, scanSource, type Asset, type AssetState, type Identities, type Source,
} from '../api'
import GoogleButton from '../components/GoogleButton'
import { RecipeSheet } from '../components/RecipeSheet'
import { PlatformLogo } from '../components/PlatformLogo'
import { Empty, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtSize } from '../format'
import { useLoad, useRole, useSession } from '../session'
import { LiveCount, SearchBox, SortControl, useListState, useMorePages } from '../components/list'
import { PLATFORM_LABEL, type Order, type Platform } from '../api'

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000) } catch { /* presse-papiers refusé */ }
  }
  return (
    <div className="row-nw" style={{ gap: 8 }}>
      <input className="input" readOnly value={value} onFocus={e => e.currentTarget.select()} aria-label="Adresse du robot" style={{ fontSize: 13 }} />
      <button type="button" className="btn btn-primary" onClick={copy}>{done ? <><Icon name="check" />Copié</> : 'Copier'}</button>
    </div>
  )
}

/** Adresses Google d'où les dossiers partagés au robot sont reliés automatiquement. */
function GoogleAddresses({ compact = false }: { compact?: boolean }) {
  const { googleClientId, spaces, org } = useSession()
  const ids = useLoad(() => getIdentities(), [])
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const spaceName = (o: number | null) => spaces.find(x => x.org_id === o)?.name || 'Espace perso'
  const run = async (fn: () => Promise<Identities>) => {
    setErr('')
    try { ids.setData(await fn()); setAdding(false) } catch (e) { setErr((e as Error).message) }
  }
  const d = ids.data
  return (
    <div className="col" style={{ gap: 8 }}>
      {d && (
        <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          <li className="row-nw" style={{ gap: 8 }}><Icon name="check" size={16} /><span className="ellipsis">{d.account_email}</span><span className="tiny muted">(compte Chapote)</span></li>
          {d.identities.map(i => (
            <li key={i.id} className="row-nw" style={{ gap: 8 }}>
              <Icon name="check" size={16} /><span className="ellipsis grow">{i.email}</span>
              {spaces.length > 1 && !compact ? (
                <select className="input select-sm" style={{ width: 'auto' }} aria-label={`Espace des dossiers de ${i.email}`} value={i.org_id ?? ''}
                        onChange={e => run(() => patchIdentity(i.id, e.target.value ? Number(e.target.value) : null))}>
                  {spaces.map(sp => <option key={sp.org_id ?? 'perso'} value={sp.org_id ?? ''}>{sp.name}</option>)}
                </select>
              ) : <span className="tiny muted">→ {spaceName(i.org_id)}</span>}
              {!compact && <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={`Retirer ${i.email}`} onClick={() => run(() => removeIdentity(i.id))}><Icon name="close" /></button>}
            </li>
          ))}
        </ul>
      )}
      {googleClientId && (adding ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="tiny muted">Connectez-vous avec le compte Google qui partage les dossiers (pour prouver que l'adresse est à vous). Ses dossiers iront dans « {spaceName(org)} ».</span>
          <GoogleButton clientId={googleClientId} text="continue_with" onCredential={cred => run(() => addIdentity(cred, org))} />
        </div>
      ) : (
        <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
          <Icon name="plus" />Associer un autre compte Google
        </button>
      ))}
      {err && <Msg kind="err">{err}</Msg>}
    </div>
  )
}

/** Assistant « Ajouter un dossier Drive » : partager au robot, et le dossier apparaît tout seul. */
function AddFolder({ robot, known, onClose, onAdded }: { robot: string; known: number[]; onClose: () => void; onAdded: (s: Source) => void }) {
  const { org, groups } = useSession()
  const [url, setUrl] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Le robot relève les nouveaux partages toutes les minutes : on guette l'arrivée du dossier.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const list = await getSources(org)
        const fresh = list.find(x => !known.includes(x.id))
        if (fresh) onAdded(fresh)
      } catch { /* réessai au prochain passage */ }
    }, 8000)
    return () => clearInterval(t)
  }, [org, known.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { onAdded(await addSource(org, url.trim(), group === '' ? null : group)) }
    catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Ajouter un dossier Google Drive" onClose={onClose}>
      <div className="col" style={{ gap: 18 }}>
        <div className="col" style={{ gap: 8 }}>
          <div className="strong">1. Partagez le dossier avec le robot de Chapote</div>
          <CopyField value={robot} />
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>Dans Google Drive, clic droit sur le <b>dossier</b> des vidéos → <b>Partager</b>.</li>
            <li>Collez l'adresse ci-dessus, choisissez <b>Lecteur</b> (ou <b>Éditeur</b> pour que cm range les vidéos publiées), puis <b>Envoyer</b>. Notification cochée ou non : peu importe.</li>
          </ol>
          <p className="tiny muted" style={{ margin: 0 }}>Le robot ne voit que ce dossier, rien d'autre de votre Drive. Retirez-le du partage pour couper l'accès.</p>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="strong">2. C'est tout</div>
          <div className="msg msg-info row-nw" style={{ gap: 10 }} role="status">
            <span className="spinner" aria-hidden="true" />
            <span>Le dossier apparaîtra ici tout seul, en général en moins d'une minute, s'il est partagé depuis l'une de ces adresses :</span>
          </div>
          <GoogleAddresses compact />
        </div>
        <details>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Partagé depuis une autre adresse (un monteur…) ? Collez le lien du dossier</summary>
          <form className="col" style={{ gap: 10, marginTop: 10 }} onSubmit={submit}>
            <label className="field">Lien du dossier
              <input className="input" value={url} onChange={e => setUrl(e.target.value)} required
                     placeholder="https://drive.google.com/drive/folders/…" inputMode="url" />
              <span className="field-hint">Ouvrez le dossier dans Google Drive et copiez l'adresse de la page.</span>
            </label>
            {groups.length > 0 && (
              <label className="field">Comptes proposés par défaut (facultatif)
                <select className="input" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Aucun groupe</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.accounts.length} comptes)</option>)}
                </select>
              </label>
            )}
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? 'Vérification…' : 'Vérifier et relier'}</button>
          </form>
        </details>
      </div>
    </Sheet>
  )
}

function SourceCard({ s, onChanged, onRemoved }: { s: Source; onChanged: (s: Source) => void; onRemoved: () => void }) {
  const { org, groups } = useSession()
  const [open, setOpen] = useState(false)
  const [recipe, setRecipe] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const { canAdmin } = useRole()
  const group = groups.find(g => g.id === s.group_id)
  const run = async (fn: () => Promise<Source | unknown>) => {
    setErr('')
    try { const r = await fn(); if (r && typeof r === 'object' && 'folder_id' in r) onChanged(r as Source) }
    catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="row-nw" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="empty-ico" style={{ width: 40, height: 40, flex: 'none' }}><Icon name="layers" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <a className="strong ellipsis" style={{ display: 'block', color: 'var(--text)' }} href={s.url} target="_blank" rel="noreferrer">{s.name || 'Dossier Drive'}</a>
          <div className="tiny muted">
            {s.videos} vidéo{s.videos > 1 ? 's' : ''}{s.new ? ` · ${s.new} à publier` : ''} · {s.role === 'writer' ? 'Éditeur' : 'Lecteur'}
            {s.role === 'writer' && s.can_upload === false && ' · dépôt de fichiers refusé par Google'}
            {s.can_upload === true && ' · archivage direct'}
            {s.last_scan_at && ` · relu ${fmtDateTime(s.last_scan_at)}`}
          </div>
          {group && <div className="tiny muted row-nw" style={{ gap: 6, marginTop: 2 }}><GroupDot color={group.color} />{group.name}</div>}
          {s.auto_drafts && <div className="tiny row-nw" style={{ gap: 6, marginTop: 2, color: 'var(--primary)' }}><Icon name="bolt" size={14} />Publications préparées toutes seules</div>}
        </div>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label="Réglages du dossier" aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="menu" /></button>
      </div>
      {s.last_error && <Msg kind="err">{s.last_error}</Msg>}
      {!s.verified && s.shared_by && <p className="tiny muted" style={{ margin: 0 }}>Partagé par {s.shared_by}.</p>}
      {open && (
        <div className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <label className="field">Comptes proposés par défaut
            <select className="input" value={s.group_id ?? ''}
                    onChange={e => run(() => patchSource(org, s.id, e.target.value ? { group_id: Number(e.target.value) } : { clear_group: true }))}>
              <option value="">Aucun groupe</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          {canAdmin && (
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRecipe(true)}>
              <Icon name="bolt" />{s.auto_drafts ? 'Préparation automatique : réglages' : 'Préparer les publications toutes seules…'}
            </button>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => run(() => scanSource(org, s.id))}><Icon name="refresh" />Relire maintenant</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
              if (!window.confirm(`Retirer « ${s.name} » de Chapote ? Les publications pas encore parties depuis ce dossier seront annulées. Les fichiers restent dans votre Drive.`)) return
              try { await removeSource(org, s.id); onRemoved() } catch (e) { setErr((e as Error).message) }
            }}><Icon name="trash" />Retirer</button>
          </div>
        </div>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      {note && <Msg kind="ok">{note}</Msg>}
      {recipe && <RecipeSheet s={s} onClose={() => setRecipe(false)} onSaved={(n, proposed) => {
        setRecipe(false); onChanged({ ...s, ...n })
        setNote(n.auto_drafts ? `C’est activé${proposed ? ` : ${proposed} publication${proposed > 1 ? 's' : ''} à valider` : ''}.` : 'Préparation automatique désactivée.')
      }} />}
    </div>
  )
}

function AssetSheet({ a, onClose, onSaved }: { a: Asset; onClose: () => void; onSaved: (a: Asset) => void }) {
  const { org } = useSession()
  const nav = useNavigate()
  const [title, setTitle] = useState(a.title)
  const [caption, setCaption] = useState(a.caption || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = title !== a.title || caption !== (a.caption || '')
  const save = async () => {
    setBusy(true); setErr('')
    try { const r = await patchAsset(org, a.id, { title, caption }); onSaved(r); return r }
    catch (e) { setErr((e as Error).message); return null } finally { setBusy(false) }
  }
  const program = async () => {
    if (dirty && !(await save())) return
    nav(`/nouvelle?video=${a.id}`)
  }
  return (
    <Sheet title={a.title} onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <video className="player" src={a.stream || `/api/cm/assets/${a.id}/stream`} poster={a.thumbnail || undefined}
               controls preload="metadata" playsInline style={{ alignSelf: 'center', width: 'min(100%, 260px)' }}
               aria-label={`Lecture de ${a.title}`} />
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          {fmtDuration(a.duration_sec)}{a.height && a.width ? ` · ${a.width}×${a.height}` : ''}{a.size ? ` · ${fmtSize(a.size)}` : ''}
          {a.drive_created_at ? ` · déposée le ${fmtDate(a.drive_created_at)}` : ''}
        </p>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          {a.published ? `Publiée ${a.published} fois${a.last_published_at ? `, dernière le ${fmtDate(a.last_published_at)}` : ''}` : 'Jamais publiée'}{a.scheduled ? ` · ${a.scheduled} à venir` : ''}
        </p>
        {a.links && Object.keys(a.links).length > 0 && (
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            {(Object.entries(a.links) as [Platform, string][]).map(([p, url]) => (
              <a key={p} className="btn btn-sm" href={url} target="_blank" rel="noreferrer"><PlatformLogo platform={p} size={14} />Voir sur {PLATFORM_LABEL[p]}</a>
            ))}
          </div>
        )}
        {a.kind === 'waiting' && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>En attente : planifiée par votre outil de publication, une histoire à la fois. Rien à valider ici.</p>}
        {a.kind === 'routine' && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>Programmée par votre outil de publication : elle arrive dans le planning toute seule.</p>}
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          {a.folder_url && <a className="btn btn-sm" href={a.folder_url} target="_blank" rel="noreferrer"><Icon name="layers" size={14} />Dossier Drive</a>}
          <span className="small muted ellipsis" style={{ alignSelf: 'center', maxWidth: 220 }}>{a.source_name}{a.folder ? ` / ${a.folder}` : ''}</span>
        </div>
        <label className="field">Titre<input className="input" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
        <label className="field">Légende et hashtags
          <textarea className="textarea" value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} placeholder="Reprise sur chaque compte lors de la programmation" />
          <span className="field-hint">{a.caption_from === 'txt' ? 'Lue dans le fichier .txt du même nom dans le Drive. Si vous la modifiez ici, le .txt ne l’écrasera plus.' : a.caption_from === 'user' ? 'Modifiée dans Chapote.' : 'Astuce : un fichier .txt du même nom que la vidéo, dans le Drive, remplit la légende tout seul.'}</span>
        </label>
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {dirty && <button type="button" className="btn" disabled={busy} onClick={save}>Enregistrer</button>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={program}><Icon name="calendar" />Programmer</button>
        </div>
      </div>
    </Sheet>
  )
}

export function AssetCard({ a, onOpen }: { a: Asset; onOpen: (a: Asset) => void }) {
  return (
    <button type="button" className="vcard" onClick={() => onOpen(a)} style={{ border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
      {a.thumbnail ? <img className="vthumb" src={a.thumbnail} alt="" loading="lazy" decoding="async" /> : <div className="vthumb" />}
      {(() => {
        const label = a.published > 0 || a.kind === 'published' ? 'Publiée' : a.scheduled > 0 || a.kind === 'routine' ? 'Programmée'
          : a.kind === 'reserve' ? 'Réserve' : a.kind === 'waiting' ? 'En attente' : null
        return label ? <span className="vrank">{label}</span> : <span className="vrank" style={{ background: 'var(--accent)' }}>Nouvelle</span>
      })()}
      <div className="vcard-body">
        <span className="small strong clamp2">{a.title}</span>
        <span className="tiny muted ellipsis">{fmtDuration(a.duration_sec)}{a.folder ? ` · ${a.folder}` : ''}</span>
      </div>
    </button>
  )
}

/** Grille de vidéos de la bibliothèque, chargée au défilement. Recherche et tri par l'API.
 *  Réutilisée par le composeur. */
export function AssetGrid({ sourceId, state, q, sort = 'recent', order, onOpen, refreshKey = 0 }:
  { sourceId?: number; state: AssetState; q: string; sort?: AssetSort; order?: Order; onOpen: (a: Asset) => void; refreshKey?: number }) {
  const { org } = useSession()
  const opts = { source_id: sourceId, state, q: q || undefined, sort, order, limit: 40 }
  const first = useLoad(() => getAssetsPage(org, opts), [sourceId, state, q, sort, order, org, refreshKey])
  const pages = useMorePages(first.data, cursor => getAssetsPage(org, { ...opts, cursor }), [org, sourceId, state, q, sort, order])
  const items = pages.items
  if (first.error) return <Msg kind="err">{first.error}</Msg>
  if (!items) return <div className="vgrid"><Skeleton h={240} n={6} /></div>
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>{q ? `Aucune vidéo ne correspond à « ${q} ».` : state === 'new' ? 'Toutes les vidéos ont déjà été programmées.' : 'Aucune vidéo pour le moment.'}</p>
  return (
    <>
      <LiveCount n={items.length} more={!!pages.next} what="vidéos" />
      <div className="vgrid">{items.map(a => <AssetCard key={a.id} a={a} onOpen={onOpen} />)}</div>
      <div ref={pages.sentinel} />
      {pages.busy && <Skeleton h={60} />}
    </>
  )
}

export type AssetSort = 'recent' | 'name' | 'duration' | 'size'
const ASSET_SORTS: [AssetSort, string][] = [['recent', 'Date d’ajout'], ['name', 'Nom'], ['duration', 'Durée'], ['size', 'Taille']]

/** Colonnes selon le nombre de cartes : 1, 2, 3, 4 → 2×2, sinon 3 (jamais de rangée presque vide). */
const gridCols = (n: number) => (n <= 1 ? 1 : n === 2 || n === 4 ? 2 : 3)
const autogrid = (n: number) => ({ ['--cols' as string]: String(gridCols(n)), ['--cols-md' as string]: String(Math.min(gridCols(n), 2)) })

export default function Library() {
  const { org } = useSession()
  const robot = useLoad(() => getRobot(), [])
  const sources = useLoad(() => getSources(org), [org])
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState('')
  const [state, setState] = useState<AssetState>('new')
  const lst = useListState<AssetSort>('recent', v => (v === 'name' ? 'asc' : 'desc'))
  const [source, setSource] = useState<number | undefined>(undefined)
  const [allFolders, setAllFolders] = useState(false)
  const [open, setOpen] = useState<Asset | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const list = sources.data || []
  const { canAdmin } = useRole()
  const enabled = robot.data?.enabled && canAdmin

  return (
    <>
      <div className="page-head">
        <div><h1>Bibliothèque</h1><p>Les vidéos de vos dossiers Google Drive, prêtes à programmer.</p></div>
        {enabled && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Ajouter un dossier Drive</button>}
      </div>
      {flash && <Msg kind="ok">{flash}</Msg>}
      {robot.data && !robot.data.enabled && <Msg>La bibliothèque Google Drive n'est pas encore activée sur Chapote.</Msg>}
      {robot.data?.enabled && !canAdmin && sources.data && list.length === 0 && <Msg>Aucun dossier Drive relié à cet espace pour l'instant : un administrateur de l'équipe peut en ajouter.</Msg>}
      {sources.error && <Msg kind="err">{sources.error}</Msg>}
      {!sources.data && sources.loading && <Skeleton h={90} n={2} />}

      <StorageCard />
      {sources.data && list.length === 0 && enabled && (
        <Empty title="Reliez le dossier de vos monteurs" icon="layers">
          <p style={{ margin: '0 0 14px' }}>Partagez un dossier Google Drive avec le robot de Chapote : chaque vidéo déposée apparaît ici, avec sa légende si un fichier .txt du même nom l'accompagne. Vous n'avez plus qu'à programmer.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Ajouter un dossier Drive</button>
        </Empty>
      )}

      {list.length > 0 && (
        <>
          <div className="autogrid" style={autogrid(Math.min(list.length, allFolders ? list.length : 6))}>
            {(allFolders ? list : list.slice(0, 6)).map(s => (
              <SourceCard key={s.id} s={s}
                onChanged={n => { sources.setData(list.map(x => (x.id === n.id ? { ...x, ...n } : x))); setRefreshKey(k => k + 1) }}
                onRemoved={() => { sources.setData(list.filter(x => x.id !== s.id)); setRefreshKey(k => k + 1); if (source === s.id) setSource(undefined) }} />
            ))}
          </div>
          {list.length > 6 && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} aria-expanded={allFolders} onClick={() => setAllFolders(v => !v)}>
              {allFolders ? 'Moins de dossiers' : `Voir les ${list.length} dossiers`}
            </button>
          )}
          <div className="chips" role="group" aria-label="Afficher">
            {([['new', 'À publier'], ['used', 'Déjà programmées'], ['all', 'Toutes']] as [AssetState, string][]).map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={state === v} onClick={() => setState(v)}>{l}</button>
            ))}
          </div>
          <div className="listbar">
            <SearchBox value={lst.input} onChange={lst.setInput} label="Rechercher une vidéo (nom, légende, dossier)" />
            {list.length > 1 && (
              <select className="select select-sm" aria-label="Dossier" value={source ?? ''} onChange={e => setSource(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Tous les dossiers</option>
                {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <span className="sortctl"><SortControl list={lst} options={ASSET_SORTS} /></span>
          </div>
          <AssetGrid sourceId={source} state={state} q={lst.q} sort={lst.sort} order={lst.order} onOpen={setOpen} refreshKey={refreshKey} />
        </>
      )}

      {adding && robot.data?.email && (
        <AddFolder robot={robot.data.email} known={list.map(x => x.id)} onClose={() => setAdding(false)} onAdded={s => {
          setAdding(false)
          sources.setData([...list.filter(x => x.id !== s.id), s])
          setRefreshKey(k => k + 1)
          setFlash(s.scan?.ok === false || s.last_error ? `Dossier « ${s.name} » relié, mais sa lecture a échoué : ${s.scan?.error || s.last_error}` : `Dossier « ${s.name} » relié : ${s.videos} vidéo${s.videos > 1 ? 's' : ''} trouvée${s.videos > 1 ? 's' : ''}.`)
        }} />
      )}
      {open && <AssetSheet a={open} onClose={() => setOpen(null)} onSaved={a => { setOpen(a); setRefreshKey(k => k + 1) }} />}
      <p className="tiny muted" style={{ margin: 0 }}>Les vidéos restent dans votre Drive. Chapote les télécharge seulement à l'heure de la publication, puis efface sa copie. <Link to="/planning">Voir le planning</Link></p>
    </>
  )
}
