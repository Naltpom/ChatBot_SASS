// Bibliothèque : les vidéos des dossiers Google Drive partagés avec le robot de Chapote.
// Les monteurs déposent dans le Drive ; ici on retrouve chaque vidéo (miniature, durée, légende
// du .txt du même nom) et on la programme sur les comptes, sans rien renvoyer.
import { StorageCard } from '../components/Storage'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addIdentity, addSource, getAssetsPage, getFolders, getIdentities, getLibraryElsewhere, getRobot, getSources, patchAsset, patchIdentity, patchSource,
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
import { t } from '../i18n'

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000) } catch { /* presse-papiers refusé */ }
  }
  return (
    <div className="row-nw" style={{ gap: 8 }}>
      <input className="input" readOnly value={value} onFocus={e => e.currentTarget.select()} aria-label={t('Adresse du robot')} style={{ fontSize: 13 }} />
      <button type="button" className="btn btn-primary" onClick={copy}>{done ? <><Icon name="check" />{t('Copié')}</> : t('Copier')}</button>
    </div>
  )
}

/** Adresses Google d'où les dossiers partagés au robot sont reliés automatiquement. */
function GoogleAddresses({ compact = false }: { compact?: boolean }) {
  const { googleClientId, spaces, org } = useSession()
  const ids = useLoad(() => getIdentities(), [])
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const spaceName = (o: number | null) => spaces.find(x => x.org_id === o)?.name || t('Espace perso')
  const run = async (fn: () => Promise<Identities>) => {
    setErr('')
    try { ids.setData(await fn()); setAdding(false) } catch (e) { setErr((e as Error).message) }
  }
  const d = ids.data
  return (
    <div className="col" style={{ gap: 8 }}>
      {d && (
        <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          <li className="row-nw" style={{ gap: 8 }}><Icon name="check" size={16} /><span className="ellipsis">{d.account_email}</span><span className="tiny muted">{t('(compte Chapote)')}</span></li>
          {d.identities.map(i => (
            <li key={i.id} className="row-nw" style={{ gap: 8 }}>
              <Icon name="check" size={16} /><span className="ellipsis grow">{i.email}</span>
              {spaces.length > 1 && !compact ? (
                <select className="input select-sm" style={{ width: 'auto' }} aria-label={t('Espace des dossiers de {email}', { email: i.email })} value={i.org_id ?? ''}
                        onChange={e => run(() => patchIdentity(i.id, e.target.value ? Number(e.target.value) : null))}>
                  {spaces.map(sp => <option key={sp.org_id ?? 'perso'} value={sp.org_id ?? ''}>{sp.name}</option>)}
                </select>
              ) : <span className="tiny muted">→ {spaceName(i.org_id)}</span>}
              {!compact && <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Retirer {email}', { email: i.email })} onClick={() => run(() => removeIdentity(i.id))}><Icon name="close" /></button>}
            </li>
          ))}
        </ul>
      )}
      {googleClientId && (adding ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="tiny muted">{t("Connectez-vous avec le compte Google qui partage les dossiers (pour prouver que l'adresse est à vous). Ses dossiers iront dans « {space} ».", { space: spaceName(org) })}</span>
          <GoogleButton clientId={googleClientId} text="continue_with" onCredential={cred => run(() => addIdentity(cred, org))} />
        </div>
      ) : (
        <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
          <Icon name="plus" />{t('Associer un autre compte Google')}
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
    <Sheet title={t('Ajouter un dossier Google Drive')} onClose={onClose}>
      <div className="col" style={{ gap: 18 }}>
        <div className="col" style={{ gap: 8 }}>
          <div className="strong">{t('1. Partagez le dossier avec le robot de Chapote')}</div>
          <CopyField value={robot} />
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>{t('Dans Google Drive, clic droit sur le')} <b>{t('dossier')}</b> {t('des vidéos →')} <b>{t('Partager')}</b>.</li>
            <li>{t("Collez l'adresse ci-dessus, choisissez")} <b>{t('Lecteur')}</b> ({t('ou')} <b>{t('Éditeur')}</b> {t('pour que cm range les vidéos publiées), puis')} <b>{t('Envoyer')}</b>. {t('Notification cochée ou non : peu importe.')}</li>
          </ol>
          <p className="tiny muted" style={{ margin: 0 }}>{t("Le robot ne voit que ce dossier, rien d'autre de votre Drive. Retirez-le du partage pour couper l'accès.")}</p>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="strong">{t("2. C'est tout")}</div>
          <div className="msg msg-info row-nw" style={{ gap: 10 }} role="status">
            <span className="spinner" aria-hidden="true" />
            <span>{t("Le dossier apparaîtra ici tout seul, en général en moins d'une minute, s'il est partagé depuis l'une de ces adresses :")}</span>
          </div>
          <GoogleAddresses compact />
        </div>
        <details>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>{t('Partagé depuis une autre adresse (un monteur…) ? Collez le lien du dossier')}</summary>
          <form className="col" style={{ gap: 10, marginTop: 10 }} onSubmit={submit}>
            <label className="field">{t('Lien du dossier')}
              <input className="input" value={url} onChange={e => setUrl(e.target.value)} required
                     placeholder="https://drive.google.com/drive/folders/…" inputMode="url" />
              <span className="field-hint">{t("Ouvrez le dossier dans Google Drive et copiez l'adresse de la page.")}</span>
            </label>
            {groups.length > 0 && (
              <label className="field">{t('Comptes proposés par défaut (facultatif)')}
                <select className="input" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{t('Aucun groupe')}</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.accounts.length > 1 ? t('{n} comptes', { n: g.accounts.length }) : t('{n} compte', { n: g.accounts.length })})</option>)}
                </select>
              </label>
            )}
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? t('Vérification…') : t('Vérifier et relier')}</button>
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
          <a className="strong ellipsis" style={{ display: 'block', color: 'var(--text)' }} href={s.url} target="_blank" rel="noreferrer">{s.name || t('Dossier Drive')}</a>
          <div className="tiny muted">
            {s.videos > 1 ? t('{n} vidéos', { n: s.videos }) : t('{n} vidéo', { n: s.videos })}{s.new ? ` · ${t('{n} à publier', { n: s.new })}` : ''} · {s.role === 'writer' ? t('Éditeur') : t('Lecteur')}
            {s.role === 'writer' && s.can_upload === false && ` · ${t('dépôt de fichiers refusé par Google')}`}
            {s.can_upload === true && ` · ${t('archivage direct')}`}
            {s.last_scan_at && ` · ${t('relu {date}', { date: fmtDateTime(s.last_scan_at) })}`}
          </div>
          {group && <div className="tiny muted row-nw" style={{ gap: 6, marginTop: 2 }}><GroupDot color={group.color} />{group.name}</div>}
          {s.auto_drafts && <div className="tiny row-nw" style={{ gap: 6, marginTop: 2, color: 'var(--primary)' }}><Icon name="bolt" size={14} />{t('Publications préparées toutes seules')}</div>}
        </div>
        <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Réglages du dossier')} aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="menu" /></button>
      </div>
      {s.last_error && <Msg kind="err">{s.last_error}</Msg>}
      {!s.verified && s.shared_by && <p className="tiny muted" style={{ margin: 0 }}>{t('Partagé par {name}.', { name: s.shared_by })}</p>}
      {open && (
        <div className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <label className="field">{t('Comptes proposés par défaut')}
            <select className="input" value={s.group_id ?? ''}
                    onChange={e => run(() => patchSource(org, s.id, e.target.value ? { group_id: Number(e.target.value) } : { clear_group: true }))}>
              <option value="">{t('Aucun groupe')}</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          {canAdmin && (
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRecipe(true)}>
              <Icon name="bolt" />{s.auto_drafts ? t('Préparation automatique : réglages') : t('Préparer les publications toutes seules…')}
            </button>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => run(() => scanSource(org, s.id))}><Icon name="refresh" />{t('Relire maintenant')}</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={async () => {
              if (!window.confirm(t('Retirer « {name} » de Chapote ? Les publications pas encore parties depuis ce dossier seront annulées. Les fichiers restent dans votre Drive.', { name: s.name }))) return
              try { await removeSource(org, s.id); onRemoved() } catch (e) { setErr((e as Error).message) }
            }}><Icon name="trash" />{t('Retirer')}</button>
          </div>
        </div>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      {note && <Msg kind="ok">{note}</Msg>}
      {recipe && <RecipeSheet s={s} onClose={() => setRecipe(false)} onSaved={(n, proposed) => {
        setRecipe(false); onChanged({ ...s, ...n })
        setNote(!n.auto_drafts ? t('Préparation automatique désactivée.')
          : !proposed ? t('C’est activé.')
          : proposed > 1 ? t('C’est activé : {n} publications à valider.', { n: proposed }) : t('C’est activé : {n} publication à valider.', { n: proposed }))
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
               aria-label={t('Lecture de {title}', { title: a.title })} />
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          {fmtDuration(a.duration_sec)}{a.height && a.width ? ` · ${a.width}×${a.height}` : ''}{a.size ? ` · ${fmtSize(a.size)}` : ''}
          {a.drive_created_at ? ` · ${t('déposée le {date}', { date: fmtDate(a.drive_created_at) })}` : ''}
        </p>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          {a.published ? (a.last_published_at ? t('Publiée {n} fois, dernière le {date}', { n: a.published, date: fmtDate(a.last_published_at) }) : t('Publiée {n} fois', { n: a.published })) : t('Jamais publiée')}{a.scheduled ? ` · ${t('{n} à venir', { n: a.scheduled })}` : ''}
        </p>
        {a.links && Object.keys(a.links).length > 0 && (
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            {(Object.entries(a.links) as [Platform, string][]).map(([p, url]) => (
              <a key={p} className="btn btn-sm" href={url} target="_blank" rel="noreferrer"><PlatformLogo platform={p} size={14} />{t('Voir sur {platform}', { platform: PLATFORM_LABEL[p] })}</a>
            ))}
          </div>
        )}
        {a.kind === 'waiting' && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{t('En attente : planifiée par votre outil de publication, une histoire à la fois. Rien à valider ici.')}</p>}
        {a.kind === 'routine' && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{t('Programmée par votre outil de publication : elle arrive dans le planning toute seule.')}</p>}
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          {a.folder_url && <a className="btn btn-sm" href={a.folder_url} target="_blank" rel="noreferrer"><Icon name="layers" size={14} />{t('Dossier Drive')}</a>}
          <span className="small muted ellipsis" style={{ alignSelf: 'center', maxWidth: 220 }}>{a.source_name}{a.folder ? ` / ${a.folder}` : ''}</span>
        </div>
        <label className="field">{t('Titre')}<input className="input" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
        <label className="field">{t('Légende et hashtags')}
          <textarea className="textarea" value={caption} maxLength={2200} onChange={e => setCaption(e.target.value)} placeholder={t('Reprise sur chaque compte lors de la programmation')} />
          <span className="field-hint">{a.caption_from === 'txt' ? t('Lue dans le fichier .txt du même nom dans le Drive. Si vous la modifiez ici, le .txt ne l’écrasera plus.') : a.caption_from === 'user' ? t('Modifiée dans Chapote.') : t('Astuce : un fichier .txt du même nom que la vidéo, dans le Drive, remplit la légende tout seul.')}</span>
        </label>
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {dirty && <button type="button" className="btn" disabled={busy} onClick={save}>{t('Enregistrer')}</button>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={program}><Icon name="calendar" />{t('Programmer')}</button>
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
        return label ? <span className="vrank">{t(label)}</span> : <span className="vrank" style={{ background: 'var(--accent)' }}>{t('Nouvelle')}</span>
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
export function AssetGrid({ sourceId, folder, state, q, sort = 'recent', order, onOpen, refreshKey = 0, emptyText }:
  { sourceId?: number; folder?: string; state: AssetState; q: string; sort?: AssetSort; order?: Order; onOpen: (a: Asset) => void; refreshKey?: number; emptyText?: string }) {
  const { org } = useSession()
  const opts = { source_id: sourceId, folder, state, q: q || undefined, sort, order, limit: 40 }
  const first = useLoad(() => getAssetsPage(org, opts), [sourceId, folder, state, q, sort, order, org, refreshKey])
  const pages = useMorePages(first.data, cursor => getAssetsPage(org, { ...opts, cursor }), [org, sourceId, folder, state, q, sort, order])
  const items = pages.items
  if (first.error) return <Msg kind="err">{first.error}</Msg>
  if (!items) return <div className="vgrid"><Skeleton h={240} n={6} /></div>
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>{emptyText && !q ? emptyText : q ? t('Aucune vidéo ne correspond à « {q} ».', { q }) : state === 'new' ? t('Toutes les vidéos ont déjà été programmées.') : t('Aucune vidéo pour le moment.')}</p>
  return (
    <>
      <LiveCount n={items.length} more={!!pages.next} what={t('vidéos')} />
      <div className="vgrid">{items.map(a => <AssetCard key={a.id} a={a} onOpen={onOpen} />)}</div>
      <div ref={pages.sentinel} />
      {pages.busy && <Skeleton h={60} />}
    </>
  )
}

/** Navigation « comme dans le Drive » : fil d'Ariane et sous-dossiers du dossier ouvert. */
function FolderBrowser({ sources, source, path, onOpen, refreshKey }: {
  sources: Source[]; source?: number; path: string; onOpen: (source: number | undefined, path: string) => void; refreshKey: number
}) {
  const { org } = useSession()
  const view = useLoad(() => (source != null ? getFolders(org, source, path) : Promise.resolve(null)), [org, source, path, refreshKey])
  const src = sources.find(x => x.id === source)
  const parts = path ? path.split('/') : []
  const tiles: { key: string; name: string; videos: number; go: () => void }[] = source == null
    ? sources.map(x => ({ key: `s${x.id}`, name: x.name || t('Dossier Drive'), videos: x.videos, go: () => onOpen(x.id, '') }))
    : (view.data?.folders || []).map(f => ({ key: f.path, name: f.name, videos: f.videos, go: () => onOpen(source, f.path) }))
  return (
    <div className="col" style={{ gap: 10 }}>
      <nav aria-label={t('Dossiers')} className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" aria-current={source == null ? 'page' : undefined} onClick={() => onOpen(undefined, '')}>
          <Icon name="layers" size={14} />{t('Tous les dossiers')}
        </button>
        {src && <><span className="muted" aria-hidden>›</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-current={!parts.length ? 'page' : undefined} onClick={() => onOpen(src.id, '')}>{src.name}</button></>}
        {parts.map((p, i) => (
          <span key={i} className="row-nw" style={{ gap: 4 }}>
            <span className="muted" aria-hidden>›</span>
            <button type="button" className="btn btn-ghost btn-sm" aria-current={i === parts.length - 1 ? 'page' : undefined}
              onClick={() => source != null && onOpen(source, parts.slice(0, i + 1).join('/'))}>{p}</button>
          </span>
        ))}
      </nav>
      {view.error && <Msg kind="err">{view.error}</Msg>}
      {tiles.length > 0 && (
        <div className="folder-grid" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {tiles.map(f => (
            <button key={f.key} type="button" className="card row-nw" onClick={f.go}
              style={{ gap: 10, padding: '10px 12px', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'inherit' }}>
              <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>📁</span>
              <span className="col" style={{ gap: 0, minWidth: 0 }}>
                <span className="small strong ellipsis">{f.name}</span>
                <span className="tiny muted">{f.videos > 1 ? t('{n} vidéos', { n: f.videos }) : t('{n} vidéo', { n: f.videos })}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Espace affiché vide : où sont les vidéos de la personne (souvent l'espace d'équipe). */
function Elsewhere() {
  const { org, spaces, setOrg } = useSession()
  const other = useLoad(() => getLibraryElsewhere(org), [org])
  if (!other.data?.length) return null
  return (
    <Msg>
      <span className="col" style={{ gap: 8 }}>
        <span>{t('Aucune vidéo dans cet espace. Vos dossiers Drive sont reliés à un autre espace :')}</span>
        <span className="row" style={{ gap: 8 }}>
          {other.data.map(o => (
            <button key={o.org_id ?? 'perso'} type="button" className="btn btn-sm btn-primary" onClick={() => setOrg(o.org_id)}>
              <Icon name="layers" size={14} />{t('Ouvrir « {space} » ({n} vidéos)', { space: spaces.find(x => x.org_id === o.org_id)?.name || t('Espace perso'), n: o.videos })}
            </button>
          ))}
        </span>
        <span className="tiny muted">{t('Seuls les dossiers partagés avec l’adresse du robot de Chapote apparaissent ici : le reste de votre Drive reste privé.')}</span>
      </span>
    </Msg>
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
  const [path, setPath] = useState('')
  const [flat, setFlat] = useState(false)   // « Toutes les vidéos » (sous-dossiers compris) au lieu de la vue par dossiers
  const browse = (s: number | undefined, p: string) => { setSource(s); setPath(p) }
  const [allFolders, setAllFolders] = useState(false)
  const [open, setOpen] = useState<Asset | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const list = sources.data || []
  const { canAdmin } = useRole()
  const enabled = robot.data?.enabled && canAdmin
  const { spaces, org: where } = useSession()
  const sp = spaces.find(x => x.org_id === where)
  const owner = sp && sp.org_id != null ? (sp.owner ? sp.name : sp.owner_name || sp.name) : null

  return (
    <>
      <div className="page-head">
        <div><h1>{t('Bibliothèque')}</h1><p>{t('Les vidéos de vos dossiers Google Drive, prêtes à programmer.')}{owner ? <> {t('Comptes de')} <b>{owner}</b> {t('(choisissez un groupe ou un compte en haut des pages pour changer).')}</> : null}</p></div>
        {enabled && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />{t('Ajouter un dossier Drive')}</button>}
      </div>
      {flash && <Msg kind="ok">{flash}</Msg>}
      {robot.data && !robot.data.enabled && <Msg>{t("La bibliothèque Google Drive n'est pas encore activée sur Chapote.")}</Msg>}
      {robot.data?.enabled && !canAdmin && sources.data && list.length === 0 && <Msg>{t("Aucun dossier Drive relié à cet espace pour l'instant : un administrateur de l'équipe peut en ajouter.")}</Msg>}
      {sources.error && <Msg kind="err">{sources.error}</Msg>}
      {!sources.data && sources.loading && <Skeleton h={90} n={2} />}

      <StorageCard />
      {sources.data && (list.length === 0 || list.every(x => !x.videos)) && <Elsewhere />}
      {sources.data && list.length === 0 && enabled && (
        <Empty title={t('Reliez le dossier de vos monteurs')} icon="layers">
          <p style={{ margin: '0 0 14px' }}>{t("Partagez un dossier Google Drive avec le robot de Chapote : chaque vidéo déposée apparaît ici, avec sa légende si un fichier .txt du même nom l'accompagne. Vous n'avez plus qu'à programmer.")}</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />{t('Ajouter un dossier Drive')}</button>
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
              {allFolders ? t('Moins de dossiers') : t('Voir les {n} dossiers', { n: list.length })}
            </button>
          )}
          <div className="chips" role="group" aria-label={t('Afficher')}>
            {([['new', 'À publier'], ['used', 'Déjà programmées'], ['all', 'Toutes']] as [AssetState, string][]).map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={state === v} onClick={() => setState(v)}>{t(l)}</button>
            ))}
          </div>
          <div className="listbar">
            <SearchBox value={lst.input} onChange={lst.setInput} label={t('Rechercher une vidéo (nom, légende, dossier)')} />
            {list.length > 1 && (
              <select className="select select-sm" aria-label={t('Dossier')} value={source ?? ''} onChange={e => browse(e.target.value ? Number(e.target.value) : undefined, '')}>
                <option value="">{t('Tous les dossiers')}</option>
                {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <span className="sortctl"><SortControl list={lst} options={ASSET_SORTS.map(([v, l]) => [v, t(l)] as [AssetSort, string])} /></span>
            <select className="select select-sm" aria-label={t('Affichage')} value={flat ? 'flat' : 'tree'} onChange={e => setFlat(e.target.value === 'flat')}>
              <option value="tree">{t('Par dossiers')}</option>
              <option value="flat">{t('Toutes les vidéos')}</option>
            </select>
          </div>
          {!flat && !lst.q && <FolderBrowser sources={list} source={source} path={path} onOpen={browse} refreshKey={refreshKey} />}
          {/* Vue par dossiers : seulement les vidéos posées dans le dossier ouvert ; une recherche porte sur tout. */}
          {(flat || lst.q || source != null) && (
            <AssetGrid sourceId={source} folder={!flat && !lst.q && source != null ? (path || '/') : undefined} state={state} q={lst.q}
              sort={lst.sort} order={lst.order} onOpen={setOpen} refreshKey={refreshKey}
              emptyText={!flat && source != null ? t('Aucune vidéo posée directement dans ce dossier : ouvrez un sous-dossier.') : undefined} />
          )}
        </>
      )}

      {adding && robot.data?.email && (
        <AddFolder robot={robot.data.email} known={list.map(x => x.id)} onClose={() => setAdding(false)} onAdded={s => {
          setAdding(false)
          sources.setData([...list.filter(x => x.id !== s.id), s])
          setRefreshKey(k => k + 1)
          setFlash(s.scan?.ok === false || s.last_error ? t('Dossier « {name} » relié, mais sa lecture a échoué : {error}', { name: s.name, error: s.scan?.error || s.last_error || '' })
            : s.videos > 1 ? t('Dossier « {name} » relié : {n} vidéos trouvées.', { name: s.name, n: s.videos }) : t('Dossier « {name} » relié : {n} vidéo trouvée.', { name: s.name, n: s.videos }))
        }} />
      )}
      {open && <AssetSheet a={open} onClose={() => setOpen(null)} onSaved={a => { setOpen(a); setRefreshKey(k => k + 1) }} />}
      <p className="tiny muted" style={{ margin: 0 }}>{t("Les vidéos restent dans votre Drive. Chapote les télécharge seulement à l'heure de la publication, puis efface sa copie.")} <Link to="/planning">{t('Voir le planning')}</Link></p>
    </>
  )
}
