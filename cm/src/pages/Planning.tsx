import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cancelTarget, getPosts, patchTarget, publishNow, retryTarget, PLATFORM_LABEL, type Platform, type Target } from '../api'
import { Icon, Loading, Msg, PlatformTag, Seg, StatusText } from '../components/ui'
import { fmtDateTime, fmtTime, toLocalInput } from '../format'
import { useLoad } from '../session'

type Item = Target & { title: string; caption: string | null }

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function EditModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(toLocalInput(new Date(item.scheduled_at)))
  const [text, setText] = useState<string>(item.platform === 'youtube' ? item.options.title ?? '' : item.platform === 'tiktok' ? item.options.title ?? '' : item.options.caption ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const textKey = item.platform === 'instagram' ? 'caption' : 'title'
  const textLabel = item.platform === 'youtube' ? 'Titre YouTube' : 'Légende'
  const editText = !(item.platform === 'tiktok' && item.options.mode === 'draft')
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await patchTarget(item.id, { scheduled_at: new Date(when).toISOString(), ...(editText ? { options: { [textKey]: text } } : {}) })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal col" role="dialog" aria-modal="true" aria-labelledby="t-edit" onClick={e => e.stopPropagation()}>
        <h2 id="t-edit">Modifier · {item.account_name} ({PLATFORM_LABEL[item.platform]})</h2>
        <label className="field">Date et heure
          <input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
        </label>
        {editText && (
          <label className="field">{textLabel}
            {item.platform === 'youtube'
              ? <input className="input" value={text} maxLength={100} onChange={e => setText(e.target.value)} />
              : <textarea className="textarea" value={text} onChange={e => setText(e.target.value)} />}
          </label>
        )}
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        </div>
      </div>
    </div>
  )
}

function Slot({ item, onChange, onEdit, withDate }: { item: Item; onChange: () => void; onEdit: (i: Item) => void; withDate?: boolean }) {
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setErr('')
    try { await fn(); onChange() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <article className={`slot${item.status === 'FAILED' ? ' failed' : ''}`}>
      <div className="row between tiny muted" style={{ gap: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{withDate ? fmtDateTime(item.scheduled_at) : fmtTime(item.scheduled_at)}</span>
        <StatusText status={item.status} />
      </div>
      <div className="small" style={{ fontWeight: 500, wordBreak: 'break-word' }}>{item.title}</div>
      <div><PlatformTag platform={item.platform} label={item.account_name || PLATFORM_LABEL[item.platform]} /></div>
      {item.error_message && <div className="tiny" style={{ color: 'var(--danger)' }}>{item.error_message}</div>}
      {item.notice && <div className="tiny muted">{item.notice}</div>}
      {item.url && <a className="tiny row" style={{ gap: 4 }} href={item.url} target="_blank" rel="noreferrer">Voir sur {PLATFORM_LABEL[item.platform]} <Icon name="external" /></a>}
      {(item.status === 'SCHEDULED' || item.can_retry || item.status === 'AWAITING_ROUTINE') && (
        <div className="row" style={{ gap: 6 }}>
          {item.status === 'SCHEDULED' && <>
            <button type="button" className="btn btn-sm" onClick={() => onEdit(item)}>Modifier</button>
            <button type="button" className="btn btn-sm" onClick={() => act(() => publishNow(item.id), 'Publier maintenant sur ce compte ?')}>Publier maintenant</button>
          </>}
          {item.can_retry && <button type="button" className="btn btn-sm" onClick={() => act(() => retryTarget(item.id))}>Réessayer</button>}
          {item.can_edit && <button type="button" className="btn btn-sm btn-danger" onClick={() => act(() => cancelTarget(item.id), 'Annuler cette publication ?')}>Annuler</button>}
        </div>
      )}
      {err && <div className="tiny" style={{ color: 'var(--danger)' }} role="alert">{err}</div>}
    </article>
  )
}

export default function Planning() {
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'week' | 'list'>('week')
  const [platform, setPlatform] = useState<'' | Platform>('')
  const [editing, setEditing] = useState<Item | null>(null)
  const range = useMemo(() => view === 'week'
    ? [weekStart, new Date(weekStart.getTime() + 7 * 86400000)]
    : [new Date(Date.now() - 7 * 86400000), new Date(Date.now() + 90 * 86400000)], [weekStart, view])
  const posts = useLoad(org => getPosts(org, range[0], range[1]), [range[0].getTime(), range[1].getTime()])

  const items: Item[] = (posts.data || [])
    .flatMap(p => p.targets.map(t => ({ ...t, title: p.title, caption: p.caption })))
    .filter(t => t.status !== 'CANCELLED' && (!platform || t.platform === platform))
    .filter(t => { const d = new Date(t.scheduled_at); return d >= range[0] && d < range[1] })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000))
  const today = new Date()
  const label = `${days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const shift = (n: number) => setWeekStart(w => new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7 * n))

  return (
    <>
      <div className="row between">
        <div className="row">
          <h1>Planning</h1>
          {view === 'week' && <>
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn icon-btn" aria-label="Semaine précédente" onClick={() => shift(-1)}><Icon name="left" /></button>
              <button type="button" className="btn icon-btn" aria-label="Semaine suivante" onClick={() => shift(1)}><Icon name="right" /></button>
            </div>
            <span className="muted">{label}</span>
            {!sameDay(weekStart, startOfWeek(today)) && <button type="button" className="btn btn-sm" onClick={() => setWeekStart(startOfWeek(today))}>Cette semaine</button>}
          </>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="row muted small" style={{ gap: 8 }}>Plateforme
            <select className="select" style={{ width: 'auto' }} value={platform} onChange={e => setPlatform(e.target.value as '' | Platform)}>
              <option value="">Toutes</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option>
            </select>
          </label>
          <Seg label="Affichage" value={view} onChange={setView} options={[['week', 'Semaine'], ['list', 'Liste']]} />
          <button type="button" className="btn icon-btn" aria-label="Actualiser" onClick={posts.reload}><Icon name="refresh" /></button>
        </div>
      </div>

      {flash && <Msg kind="ok">{flash}</Msg>}
      {posts.error && <Msg kind="err">{posts.error}</Msg>}
      {!posts.data && posts.loading && <Loading />}
      {posts.data && view === 'week' && (
        <div className="table-wrap">
          <div className="week">
            {days.map(d => {
              const list = items.filter(t => sameDay(new Date(t.scheduled_at), d))
              return (
                <section key={d.toISOString()} aria-label={d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} className="col" style={{ gap: 10 }}>
                  <h2 className={`day-head${sameDay(d, today) ? ' today' : ''}`}>
                    {d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
                    {sameDay(d, today) && <span className="muted" style={{ fontWeight: 400 }}> aujourd'hui</span>}
                  </h2>
                  {list.length === 0 ? <p className="tiny muted" style={{ margin: 0, padding: 4 }}>Rien de prévu</p>
                    : list.map(t => <Slot key={t.id} item={t} onChange={posts.reload} onEdit={setEditing} />)}
                </section>
              )
            })}
          </div>
        </div>
      )}
      {posts.data && view === 'list' && (
        items.length === 0 ? <p className="muted">Rien entre il y a 7 jours et dans 3 mois. <Link to="/nouvelle">Nouvelle publication</Link></p> : (
          <div className="col" style={{ maxWidth: 720 }}>
            {items.map(t => <Slot key={t.id} item={t} onChange={posts.reload} onEdit={setEditing} withDate />)}
          </div>
        )
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Heures dans votre fuseau ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Chaque compte a sa propre heure et son propre statut.
      </p>
      {editing && <EditModal item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); posts.reload() }} />}
    </>
  )
}
