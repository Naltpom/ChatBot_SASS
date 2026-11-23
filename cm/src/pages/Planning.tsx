// Calendrier : le passé montre les vidéos réellement publiées sur les comptes (relevées chez TikTok,
// YouTube et Instagram, publiées ou non depuis Chapote, avec leurs chiffres) et l'évolution des
// abonnés jour par jour ; le futur montre les publications programmées.
// Mobile : vue Agenda (bande des 7 jours + liste). Ordinateur : vue Semaine en 7 colonnes. Mois partout.
import { useEffect, useMemo, useState } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { Link, useLocation } from 'react-router-dom'
import {
  cancelTarget, getCalendar, patchTarget, publishNow, retryTarget, PLATFORM_LABEL, PLATFORMS,
  type CalendarDay, type CalendarItem, type Platform,
} from '../api'
import { Delta, Empty, Icon, Msg, PlatformTag, Seg, Sheet, Skeleton, StatusText } from '../components/ui'
import { addDays, dayKey, fmtDateTime, fmtTime, num, sameDay, short, startOfWeek, toLocalInput } from '../format'
import { useDesktop } from '../hooks'
import { useLoad, useSession } from '../session'

type View = 'agenda' | 'week' | 'month'
type Kind = 'all' | 'done' | 'planned'

const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED' && i.status !== 'INBOX'
const itemKey = (i: CalendarItem) => `${i.kind}-${i.id}`

function range(view: View, anchor: Date): [Date, Date] {
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const start = startOfWeek(first)
    return [start, addDays(start, 42)]
  }
  const s = startOfWeek(anchor)
  return [s, addDays(s, 7)]
}

function Thumb({ item }: { item: CalendarItem }) {
  if (item.kind === 'video' && item.thumbnail_url) return <img className="event-thumb" src={item.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" />
  return <span className="event-thumb"><Icon name={item.kind === 'video' ? 'video' : 'clock'} /></span>
}

function EventCard({ item, onOpen, compact }: { item: CalendarItem; onOpen: (i: CalendarItem) => void; compact?: boolean }) {
  const planned = isPlanned(item)
  const failed = item.kind === 'target' && item.status === 'FAILED'
  return (
    <button type="button" className={`event${planned ? ' planned' : ''}${failed ? ' failed' : ''}`} onClick={() => onOpen(item)}>
      {!compact && <Thumb item={item} />}
      <span className="event-body">
        <span className="event-time">
          <span aria-hidden="true" className={`dot dot-${item.platform}`} />{fmtTime(item.at)}
          <span className="grow" />
          {item.kind === 'target' ? <StatusText status={item.status} /> : item.via_chapote ? <span className="tiny faint">via Chapote</span> : null}
        </span>
        <span className="small strong clamp2" style={{ wordBreak: 'break-word' }}>{item.title || 'Sans titre'}</span>
        <span className="tiny muted ellipsis">{item.account_name || PLATFORM_LABEL[item.platform]}</span>
        {item.kind === 'video' && (
          <span className="metrics">
            <span><b>{short(item.views)}</b> vues</span>
            {item.likes != null && <span><b>{short(item.likes)}</b> j’aime</span>}
            {!compact && item.comments != null && <span><b>{short(item.comments)}</b> com.</span>}
          </span>
        )}
      </span>
    </button>
  )
}

function DayStats({ d }: { d: CalendarDay | undefined }) {
  if (!d || d.followers_delta == null || d.followers_delta === 0) return null
  return <span className="tiny strong"><Delta value={d.followers_delta} /> abonnés</span>
}

export default function Planning() {
  const desktop = useDesktop()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const { group } = useSession()
  const [view, setView] = useState<View>(desktop ? 'week' : 'agenda')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => dayKey(new Date()))
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [kind, setKind] = useState<Kind>('all')
  const [open, setOpen] = useState<CalendarItem | null>(null)
  useEffect(() => { setView(v => (desktop && v === 'agenda' ? 'week' : !desktop && v === 'week' ? 'agenda' : v)) }, [desktop])

  const [start, end] = useMemo(() => range(view, anchor), [view, anchor])
  const cal = useLoad(s => getCalendar(s, start, end), [start.getTime(), end.getTime()])

  const items = (cal.data?.items || [])
    .filter(i => !(i.kind === 'target' && i.status === 'CANCELLED'))
    .filter(i => !platforms.length || platforms.includes(i.platform))
    .filter(i => kind === 'all' || (kind === 'planned' ? isPlanned(i) : !isPlanned(i)))
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const i of items) { const k = dayKey(new Date(i.at)); m.set(k, [...(m.get(k) || []), i]) }
    return m
  }, [items])
  const stats = useMemo(() => new Map((cal.data?.days || []).map(d => [d.day, d])), [cal.data])

  const today = new Date()
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
  const shift = (n: number) => setAnchor(a => view === 'month' ? new Date(a.getFullYear(), a.getMonth() + n, 1) : addDays(a, 7 * n))
  const label = view === 'month'
    ? anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : `${week[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${week[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
  const isCurrent = view === 'month' ? anchor.getMonth() === today.getMonth() && anchor.getFullYear() === today.getFullYear()
    : sameDay(startOfWeek(anchor), startOfWeek(today))
  const goToday = () => { setAnchor(new Date()); setSelected(dayKey(new Date())) }
  const togglePlatform = (p: Platform) => setPlatforms(ps => ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p])

  // Résumé de la période affichée.
  const done = items.filter(i => !isPlanned(i))
  const planned = items.filter(isPlanned)
  const periodViews = done.reduce((s, i) => s + (i.kind === 'video' ? i.views || 0 : 0), 0)
  const periodFollowers = (cal.data?.days || []).reduce((s, d) => s + (d.followers_delta || 0), 0)

  const jump = (k: string) => {
    setSelected(k)
    if (view === 'agenda') document.getElementById(`jour-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const dayList = (k: string, date: Date) => {
    const list = byDay.get(k) || []
    return (
      <section key={k} id={`jour-${k}`} className="agenda-day" aria-label={date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}>
        <div className={`agenda-day-head${sameDay(date, today) ? ' today' : ''}`}>
          <h2>{date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          <DayStats d={stats.get(k)} />
        </div>
        {list.length === 0
          ? <p className="tiny muted" style={{ padding: '2px 2px 4px' }}>{date < today && !sameDay(date, today) ? 'Aucune publication' : 'Rien de prévu'}</p>
          : list.map(i => <EventCard key={itemKey(i)} item={i} onOpen={setOpen} />)}
      </section>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Planning</h1>
          <p>Ce qui est parti, avec ses chiffres, et ce qui va partir.</p>
        </div>
        <Seg label="Affichage" value={view} onChange={setView}
             options={desktop ? [['week', 'Semaine'], ['month', 'Mois']] : [['agenda', 'Agenda'], ['month', 'Mois']]} />
      </div>

      {flash && <Msg kind="ok">{flash}</Msg>}

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="btn icon-btn btn-sm" aria-label={view === 'month' ? 'Mois précédent' : 'Semaine précédente'} onClick={() => shift(-1)}><Icon name="left" /></button>
          <button type="button" className="btn icon-btn btn-sm" aria-label={view === 'month' ? 'Mois suivant' : 'Semaine suivante'} onClick={() => shift(1)}><Icon name="right" /></button>
          <span className="label">{label}</span>
          {!isCurrent && <button type="button" className="btn btn-sm btn-ghost" onClick={goToday}>Aujourd’hui</button>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Seg label="Type" value={kind} onChange={setKind} options={[['all', 'Tout'], ['done', 'Publié'], ['planned', 'Programmé']]} />
          <button type="button" className="btn icon-btn btn-sm only-desktop" aria-label="Actualiser" onClick={cal.reload}><Icon name="refresh" /></button>
        </div>
      </div>
      <div className="chips" role="group" aria-label="Plateformes">
        {PLATFORMS.map(p => (
          <button key={p} type="button" className="chip" aria-pressed={platforms.includes(p)} onClick={() => togglePlatform(p)}>
            <PlatformLogo platform={p} size={14} />{PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>
      {cal.data && (
          <span className="tiny muted row" style={{ gap: '4px 14px' }}>
            <span><b className="num" style={{ color: 'var(--text)' }}>{done.length}</b> publiée{done.length > 1 ? 's' : ''}</span>
            {periodViews > 0 && <span><b className="num" style={{ color: 'var(--text)' }}>{short(periodViews)}</b> vues</span>}
            {periodFollowers !== 0 && <span><Delta value={periodFollowers} /> abonnés</span>}
            <span><b className="num" style={{ color: 'var(--text)' }}>{planned.length}</b> programmée{planned.length > 1 ? 's' : ''}</span>
          </span>
        )}

      {cal.error && <Msg kind="err">{cal.error}</Msg>}
      {!cal.data && cal.loading && <div className="col"><Skeleton h={56} /><Skeleton h={84} n={3} /></div>}

      {cal.data && view === 'agenda' && (
        <>
          <div className="daystrip" role="group" aria-label="Jours de la semaine">
            {week.map(d => {
              const k = dayKey(d)
              const ps = [...new Set((byDay.get(k) || []).map(i => i.platform))]
              return (
                <button key={k} type="button" aria-pressed={selected === k} className={sameDay(d, today) ? 'today' : ''} onClick={() => jump(k)}
                        aria-label={d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}>
                  {d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}
                  <b>{d.getDate()}</b>
                  <span className="marks">{ps.map(p => <span key={p} className={`dot dot-${p}`} />)}</span>
                </button>
              )
            })}
          </div>
          <div className="agenda">{week.map(d => dayList(dayKey(d), d))}</div>
        </>
      )}

      {cal.data && view === 'week' && (
        <div className="week">
          {week.map(d => {
            const k = dayKey(d)
            const list = byDay.get(k) || []
            const past = d < today && !sameDay(d, today)
            return (
              <section key={k} className={`week-col${sameDay(d, today) ? ' today' : ''}${past ? ' past' : ''}`}
                       aria-label={d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}>
                <div className="week-head">
                  <h2>{d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}</h2>
                  <DayStats d={stats.get(k)} />
                </div>
                {list.length === 0 ? <p className="tiny faint">{past ? 'Aucune publication' : 'Rien de prévu'}</p>
                  : list.map(i => <EventCard key={itemKey(i)} item={i} onOpen={setOpen} />)}
                {!past && <Link to="/nouvelle" className="btn btn-sm btn-ghost" style={{ marginTop: 'auto', color: 'var(--muted)' }}><Icon name="plus" size={16} />Programmer</Link>}
              </section>
            )
          })}
        </div>
      )}

      {cal.data && view === 'month' && (
        <div className="grid-2">
          <div className="col" style={{ gap: 6 }}>
            <div className="month" aria-hidden="true">
              {week.map(d => <div key={d.getDay()} className="month-dow">{d.toLocaleDateString('fr-FR', { weekday: desktop ? 'long' : 'narrow' })}</div>)}
            </div>
            <div className="month" role="grid" aria-label={label}>
              {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map(d => {
                const k = dayKey(d)
                const list = byDay.get(k) || []
                const views = list.reduce((s, x) => s + (x.kind === 'video' ? x.views || 0 : 0), 0)
                const dl = stats.get(k)?.followers_delta
                return (
                  <button key={k} type="button" role="gridcell" aria-pressed={selected === k}
                          className={`month-cell${d.getMonth() !== anchor.getMonth() ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}`}
                          onClick={() => setSelected(k)} aria-label={`${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} : ${list.length} élément(s)`}>
                    <span className="d">{d.getDate()}</span>
                    <span className="marks">{list.slice(0, desktop ? 12 : 6).map(x => <span key={itemKey(x)} className={`dot dot-${x.platform}`} style={isPlanned(x) ? { opacity: .45 } : undefined} />)}</span>
                    {desktop && views > 0 && <span className="mini">{short(views)} vues</span>}
                    {desktop && dl != null && dl !== 0 && <span className="mini"><Delta value={dl} /></span>}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="col">
            {dayList(selected, new Date(`${selected}T12:00:00`))}
          </div>
        </div>
      )}

      {cal.data && items.length === 0 && view !== 'month' && (
        <Empty title="Rien sur cette période" icon="calendar">
          <p style={{ marginBottom: 14 }}>Les vidéos publiées sur vos comptes apparaissent ici après le relevé des chiffres ; programmez la suite depuis Chapote.</p>
          <Link className="btn btn-primary" to="/nouvelle"><Icon name="plus" size={16} />Nouvelle publication</Link>
        </Empty>
      )}

      <p className="tiny muted">Heures dans votre fuseau ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Chaque compte a sa propre heure et son propre statut.</p>
      {open && <ItemSheet item={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); cal.reload() }} />}
    </>
  )
}

function ItemSheet({ item, onClose, onChanged }: { item: CalendarItem; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setErr(''); setBusy(true)
    try { await fn(); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (item.kind === 'video') {
    const cells: [string, number | null][] = [['Vues', item.views], ['J’aime', item.likes], ['Commentaires', item.comments], ['Partages', item.shares], ['Enregistrements', item.saves]]
    return (
      <Sheet title={item.title || 'Sans titre'} onClose={onClose}>
        <div className="row-nw" style={{ alignItems: 'flex-start' }}>
          {item.thumbnail_url && <img src={item.thumbnail_url} alt="" referrerPolicy="no-referrer" style={{ width: 84, borderRadius: 12, aspectRatio: '9/13', objectFit: 'cover', flex: 'none' }} />}
          <div className="col" style={{ gap: 6 }}>
            <PlatformTag platform={item.platform} label={item.account_name} />
            <span className="small muted">Publiée {fmtDateTime(item.at)}{item.via_chapote ? ' · depuis Chapote' : ''}</span>
          </div>
        </div>
        <div className="mgrid">
          {cells.filter(([, v]) => v != null).map(([l, v]) => (
            <div key={l}><div className="m-label">{l}</div><div className="m-value">{num(v)}</div></div>
          ))}
        </div>
        {item.views ? (
          <p className="small muted">Engagement : {(((item.likes || 0) + (item.comments || 0) + (item.shares || 0) + (item.saves || 0)) / item.views * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des vues.</p>
        ) : null}
        {item.url && <a className="btn btn-block" href={item.url} target="_blank" rel="noreferrer">Voir sur {PLATFORM_LABEL[item.platform]} <Icon name="external" /></a>}
      </Sheet>
    )
  }

  const t = item
  if (editing) return <EditTarget item={t} onClose={() => setEditing(false)} onSaved={onChanged} />
  return (
    <Sheet title={t.title} onClose={onClose}>
      <div className="row" style={{ gap: 8 }}><PlatformTag platform={t.platform} label={t.account_name} /><StatusText status={t.status} /></div>
      <div className="small"><span className="muted">{t.status === 'PUBLISHED' ? 'Publiée' : 'Prévue'} </span><strong>{fmtDateTime(t.published_at || t.scheduled_at)}</strong></div>
      {t.error_message && <Msg kind="err">{t.error_message}</Msg>}
      {t.notice && <Msg>{t.notice}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}
      <div className="col" style={{ gap: 8 }}>
        {t.status === 'SCHEDULED' && <>
          <button type="button" className="btn btn-block" disabled={busy} onClick={() => setEditing(true)}><Icon name="edit" />Modifier l’heure ou le texte</button>
          <button type="button" className="btn btn-block" disabled={busy} onClick={() => act(() => publishNow(t.id), 'Publier maintenant sur ce compte ?')}><Icon name="bolt" />Publier maintenant</button>
        </>}
        {t.can_retry && <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => act(() => retryTarget(t.id))}><Icon name="refresh" />Réessayer</button>}
        {t.url && <a className="btn btn-block" href={t.url} target="_blank" rel="noreferrer">Voir sur {PLATFORM_LABEL[t.platform]} <Icon name="external" /></a>}
        {t.can_edit && <button type="button" className="btn btn-block btn-danger" disabled={busy} onClick={() => act(() => cancelTarget(t.id), 'Annuler cette publication sur ce compte ?')}><Icon name="trash" />Annuler la publication</button>}
      </div>
    </Sheet>
  )
}

function EditTarget({ item, onClose, onSaved }: { item: Extract<CalendarItem, { kind: 'target' }>; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(toLocalInput(new Date(item.scheduled_at)))
  const textKey = item.platform === 'instagram' ? 'caption' : 'title'
  const [text, setText] = useState<string>(item.options[textKey] ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const editText = !(item.platform === 'tiktok' && item.options.mode === 'draft')
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await patchTarget(item.id, { scheduled_at: new Date(when).toISOString(), ...(editText ? { options: { [textKey]: text } } : {}) })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Sheet title={`Modifier · ${item.account_name || PLATFORM_LABEL[item.platform]}`} onClose={onClose}>
      <label className="field">Date et heure
        <input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
      </label>
      {editText && (
        <label className="field">{item.platform === 'youtube' ? 'Titre YouTube' : 'Légende'}
          {item.platform === 'youtube'
            ? <input className="input" value={text} maxLength={100} onChange={e => setText(e.target.value)} />
            : <textarea className="textarea" value={text} onChange={e => setText(e.target.value)} />}
        </label>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row-nw">
        <button type="button" className="btn grow" onClick={onClose}>Retour</button>
        <button type="button" className="btn btn-primary grow" onClick={save} disabled={busy}>Enregistrer</button>
      </div>
    </Sheet>
  )
}
