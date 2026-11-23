// Bibliothèque : les vidéos des dossiers Google Drive partagés avec le robot de Chapote.
// Les monteurs déposent dans le Drive ; ici on retrouve chaque vidéo (miniature, durée, légende
// du .txt du même nom) et on la programme sur les comptes, sans rien renvoyer.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addSource, getAssetsPage, getRobot, getSources, patchAsset, patchSource, removeSource, scanSource,
  type Asset, type AssetState, type Source,
} from '../api'
import { Empty, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtSize } from '../format'
import { useLoad, useSession } from '../session'

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

/** Assistant « Ajouter un dossier Drive » : 1. partager au robot  2. coller le lien. */
function AddFolder({ robot, onClose, onAdded }: { robot: string; onClose: () => void; onAdded: (s: Source) => void }) {
  const { org, groups } = useSession()
  const [url, setUrl] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { onAdded(await addSource(org, url.trim(), group === '' ? null : group)) }
    catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Ajouter un dossier Google Drive" onClose={onClose}>
      <form className="col" style={{ gap: 18 }} onSubmit={submit}>
        <div className="col" style={{ gap: 8 }}>
          <div className="strong">1. Partagez le dossier avec le robot de Chapote</div>
          <CopyField value={robot} />
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>Dans Google Drive, clic droit sur le dossier (celui où les monteurs déposent) → <b>Partager</b>.</li>
            <li>Collez l'adresse ci-dessus, choisissez <b>Lecteur</b> (ou <b>Éditeur</b> pour que cm range les vidéos publiées), décochez « Envoyer une notification », puis <b>Partager</b>.</li>
          </ol>
          <p className="tiny muted" style={{ margin: 0 }}>Le robot ne voit que ce dossier, rien d'autre de votre Drive. Retirez-le du partage pour couper l'accès.</p>
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="strong">2. Collez le lien du dossier</div>
          <label className="field">Lien du dossier
            <input className="input" value={url} onChange={e => setUrl(e.target.value)} required autoFocus
                   placeholder="https://drive.google.com/drive/folders/…" inputMode="url" />
            <span className="field-hint">Ouvrez le dossier dans Google Drive et copiez l'adresse de la page.</span>
          </label>
          {groups.length > 0 && (
            <label className="field">Comptes proposés par défaut (facultatif)
              <select className="input" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Aucun groupe</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.accounts.length} comptes)</option>)}
              </select>
              <span className="field-hint">« Programmer » cochera d'office les comptes de ce groupe.</span>
            </label>
          )}
        </div>
        {err && <Msg kind="err">{err}</Msg>}
        <button className="btn btn-primary btn-lg" disabled={busy || !url.trim()}>{busy ? 'Vérification…' : 'Vérifier et relier'}</button>
      </form>
    </Sheet>
  )
}

function SourceCard({ s, onChanged, onRemoved }: { s: Source; onChanged: (s: Source) => void; onRemoved: () => void }) {
  const { org, groups } = useSession()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
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
            {s.last_scan_at && ` · relu ${fmtDateTime(s.last_scan_at)}`}
          </div>
          {group && <div className="tiny muted row-nw" style={{ gap: 6, marginTop: 2 }}><GroupDot color={group.color} />{group.name}</div>}
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
          <label className={`check${s.can_organize ? '' : ' disabled'}`}>
            <input type="checkbox" checked={s.move_published} disabled={!s.can_organize}
                   onChange={e => run(() => patchSource(org, s.id, { move_published: e.target.checked }))} />
            <span>Ranger les vidéos publiées dans un sous-dossier « Publié »
              <br /><span className="field-hint">{s.can_organize ? 'Une fois publiée sur tous ses comptes, la vidéo est déplacée dans le Drive.' : 'Partagez le dossier avec le robot en Éditeur pour activer cette option.'}</span></span>
          </label>
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
        <div className="row-nw" style={{ gap: 14, alignItems: 'flex-start' }}>
          {a.thumbnail ? <img src={a.thumbnail} alt="" width={90} height={130} style={{ width: 90, height: 130, objectFit: 'cover', borderRadius: 12, flex: 'none', background: 'var(--surface-2)' }} />
            : <span style={{ width: 90, height: 130, borderRadius: 12, background: 'var(--surface-2)', flex: 'none' }} />}
          <div className="col small" style={{ gap: 4, minWidth: 0 }}>
            <span className="ellipsis strong">{a.name}</span>
            <span className="muted">{fmtDuration(a.duration_sec)}{a.size ? ` · ${fmtSize(a.size)}` : ''}{a.height && a.width ? ` · ${a.width}×${a.height}` : ''}</span>
            <span className="muted">{a.source_name}{a.folder ? ` / ${a.folder}` : ''}</span>
            {a.drive_created_at && <span className="muted">Déposée le {fmtDate(a.drive_created_at)}</span>}
            <span className="muted">{a.published ? `Publiée ${a.published} fois${a.last_published_at ? `, dernière le ${fmtDate(a.last_published_at)}` : ''}` : 'Jamais publiée'}{a.scheduled ? ` · ${a.scheduled} à venir` : ''}</span>
            <a href={a.drive_url} target="_blank" rel="noreferrer" className="row-nw" style={{ gap: 4 }}>Ouvrir dans Drive <Icon name="external" size={14} /></a>
          </div>
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
      {(a.published > 0 || a.scheduled > 0) && <span className="vrank">{a.published > 0 ? 'Publiée' : 'Programmée'}</span>}
      {a.published === 0 && a.scheduled === 0 && <span className="vrank" style={{ background: 'var(--accent)' }}>Nouvelle</span>}
      <div className="vcard-body">
        <span className="small strong clamp2">{a.title}</span>
        <span className="tiny muted ellipsis">{fmtDuration(a.duration_sec)}{a.folder ? ` · ${a.folder}` : ''}</span>
      </div>
    </button>
  )
}

/** Grille de vidéos de la bibliothèque, chargée au défilement. Réutilisée par le composeur. */
export function AssetGrid({ sourceId, state, q, onOpen, refreshKey = 0 }:
  { sourceId?: number; state: AssetState; q: string; onOpen: (a: Asset) => void; refreshKey?: number }) {
  const { org } = useSession()
  const first = useLoad(() => getAssetsPage(org, { source_id: sourceId, state, q, limit: 40 }), [sourceId, state, q, org, refreshKey])
  const [more, setMore] = useState<Asset[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => { setMore([]); setNext(first.data?.next ?? null) }, [first.data])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !next || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || busy || !next) return
      setBusy(true)
      try { const p = await getAssetsPage(org, { source_id: sourceId, state, q, limit: 40, cursor: next }); setMore(m => [...m, ...p.items]); setNext(p.next) }
      catch { setNext(null) } finally { setBusy(false) }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, busy, org, sourceId, state, q])
  const items = first.data ? [...first.data.items, ...more] : null
  if (first.error) return <Msg kind="err">{first.error}</Msg>
  if (!items) return <div className="vgrid"><Skeleton h={240} n={6} /></div>
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>{q ? 'Aucune vidéo ne correspond.' : state === 'new' ? 'Toutes les vidéos ont déjà été programmées.' : 'Aucune vidéo pour le moment.'}</p>
  return (
    <>
      <div className="vgrid">{items.map(a => <AssetCard key={a.id} a={a} onOpen={onOpen} />)}</div>
      <div ref={sentinel} />
      {busy && <Skeleton h={60} />}
    </>
  )
}

export default function Library() {
  const { org } = useSession()
  const robot = useLoad(() => getRobot(), [])
  const sources = useLoad(() => getSources(org), [org])
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState('')
  const [state, setState] = useState<AssetState>('new')
  const [q, setQ] = useState('')
  const [source, setSource] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState<Asset | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const list = sources.data || []
  const enabled = robot.data?.enabled

  return (
    <>
      <div className="page-head">
        <div><h1>Bibliothèque</h1><p>Les vidéos de vos dossiers Google Drive, prêtes à programmer.</p></div>
        {enabled && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Ajouter un dossier Drive</button>}
      </div>
      {flash && <Msg kind="ok">{flash}</Msg>}
      {robot.data && !enabled && <Msg>La bibliothèque Google Drive n'est pas encore activée sur Chapote.</Msg>}
      {sources.error && <Msg kind="err">{sources.error}</Msg>}
      {!sources.data && sources.loading && <Skeleton h={90} n={2} />}

      {sources.data && list.length === 0 && enabled && (
        <Empty title="Reliez le dossier de vos monteurs" icon="layers">
          <p style={{ margin: '0 0 14px' }}>Partagez un dossier Google Drive avec le robot de Chapote : chaque vidéo déposée apparaît ici, avec sa légende si un fichier .txt du même nom l'accompagne. Vous n'avez plus qu'à programmer.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Ajouter un dossier Drive</button>
        </Empty>
      )}

      {list.length > 0 && (
        <>
          <div className="grid-3">
            {list.map(s => (
              <SourceCard key={s.id} s={s}
                onChanged={n => { sources.setData(list.map(x => (x.id === n.id ? { ...x, ...n } : x))); setRefreshKey(k => k + 1) }}
                onRemoved={() => { sources.setData(list.filter(x => x.id !== s.id)); setRefreshKey(k => k + 1); if (source === s.id) setSource(undefined) }} />
            ))}
          </div>
          <div className="row between" style={{ gap: 10 }}>
            <div className="chips" role="group" aria-label="Afficher">
              {([['new', 'À publier'], ['used', 'Déjà programmées'], ['all', 'Toutes']] as [AssetState, string][]).map(([v, l]) => (
                <button key={v} type="button" className="chip" aria-pressed={state === v} onClick={() => setState(v)}>{l}</button>
              ))}
              {list.length > 1 && list.map(s => (
                <button key={s.id} type="button" className="chip" aria-pressed={source === s.id} onClick={() => setSource(source === s.id ? undefined : s.id)}>
                  <Icon name="layers" size={14} />{s.name}
                </button>
              ))}
            </div>
            <input className="input" style={{ maxWidth: 260 }} type="search" placeholder="Rechercher (nom, légende, dossier)" aria-label="Rechercher une vidéo"
                   value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <AssetGrid sourceId={source} state={state} q={q.trim()} onOpen={setOpen} refreshKey={refreshKey} />
        </>
      )}

      {adding && robot.data?.email && (
        <AddFolder robot={robot.data.email} onClose={() => setAdding(false)} onAdded={s => {
          setAdding(false)
          sources.setData([...list.filter(x => x.id !== s.id), s])
          setRefreshKey(k => k + 1)
          setFlash(s.scan?.ok === false ? `Dossier « ${s.name} » relié, mais sa lecture a échoué : ${s.scan.error}` : `Dossier « ${s.name} » relié : ${s.videos} vidéo${s.videos > 1 ? 's' : ''} trouvée${s.videos > 1 ? 's' : ''}.`)
        }} />
      )}
      {open && <AssetSheet a={open} onClose={() => setOpen(null)} onSaved={a => { setOpen(a); setRefreshKey(k => k + 1) }} />}
      <p className="tiny muted" style={{ margin: 0 }}>Les vidéos restent dans votre Drive. Chapote les télécharge seulement à l'heure de la publication, puis efface sa copie. <Link to="/planning">Voir le planning</Link></p>
    </>
  )
}
