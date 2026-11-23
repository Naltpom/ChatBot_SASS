// Calendrier : le passé montre les vidéos réellement publiées sur les comptes (relevées chez TikTok,
// YouTube et Instagram, publiées ou non depuis Chapote, avec leurs chiffres) et l'évolution des
// abonnés jour par jour ; le futur montre les publications programmées.
// Mobile : vue Agenda (bande des 7 jours + liste). Ordinateur : vue Semaine en 7 colonnes. Mois partout.
import { useEffect, useMemo, useState } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { PlanRow, PublicationSheet, useGroupOf, type Group_ } from './PlanningParts'
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

const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED'   // brouillon TikTok : encore à publier
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

/** Une vidéo au même moment sur plusieurs plateformes = un seul groupe. */
type Group = Group_ & { key: string; items: CalendarItem[]; at: string; title: string | null }
function groupItems(list: CalendarItem[]): Group[] {
  const out: Group[] = []
  const at = new Map<string, number>()
  for (const i of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
    const base = i.group || itemKey(i)
    let k = base, n = at.get(k), round = 0
    // Jamais deux vidéos du même compte dans un groupe ; regroupement par titre : 6 h d'écart au plus.
    while (n !== undefined && (out[n].items.some(x => x.platform === i.platform && x.account_id === i.account_id)
           || (base.startsWith('t') && Math.abs(new Date(i.at).getTime() - new Date(out[n].at).getTime()) > 6 * 3600e3))) {
      k = `${base}#${++round}`; n = at.get(k)
    }
    if (n === undefined) { at.set(k, out.length); out.push({ key: k, items: [i], at: i.at, title: i.title || null }) }
    else { const g = out[n]; g.items.push(i); if (!g.title && i.title) g.title = i.title }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
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
  const [openGroup, setOpenGroup] = useState<Group | null>(null)
  const groupOf = useGroupOf()
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
          : groupItems(list).map(gx => <PlanRow key={gx.key} g={gx} group={groupOf(gx.items)} onOpen={setOpenGroup} />)}
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
          {(!isCurrent || selected !== dayKey(today)) && <button type="button" className="btn btn-sm" onClick={goToday}><Icon name="calendar" size={14} />Aujourd’hui</button>}
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
                  : groupItems(list).map(gx => <PlanRow key={gx.key} g={gx} group={groupOf(gx.items)} onOpen={setOpenGroup} />)}
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
                    <span className="marks">{groupItems(list).slice(0, desktop ? 12 : 6).map(gx => <span key={gx.key} className="dot" style={{ background: 'var(--primary)', ...(gx.items.every(isPlanned) ? { opacity: .45 } : {}) }} />)}</span>
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

      <p className="tiny muted">Heures dans votre fuseau ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Une ligne par vidéo : ses plateformes sont en logos ; touchez-la pour le détail de chaque compte.</p>
      {openGroup && <PublicationSheet g={openGroup} group={groupOf(openGroup.items)} onClose={() => setOpenGroup(null)}
                                      onChanged={() => { setOpenGroup(null); cal.reload() }} />}
    </>
  )
}
