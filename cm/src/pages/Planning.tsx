// Calendrier : le passé montre les vidéos réellement publiées sur les comptes (relevées chez TikTok,
// YouTube et Instagram, publiées ou non depuis Chapote, avec leurs chiffres) et l'évolution des
// abonnés jour par jour ; le futur montre les publications programmées.
// Mobile : vue Agenda (bande des 7 jours + liste). Ordinateur : vue Semaine en 7 colonnes. Mois partout.
import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchBox } from '../components/list'
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
import { t, locale } from '../i18n'

type View = 'agenda' | 'day' | 'week' | 'month'
/** Filtre d'état : action = échec ou brouillon TikTok à publier dans l'app (ce qui vous attend) ; done = publiée ;
 *  planned = programmée ou en cours d'envoi (rien à faire). Même règles que mobile/src/features/planning/calendar.ts. */
type Kind = 'all' | 'action' | 'done' | 'planned'
const KINDS: Kind[] = ['all', 'action', 'done', 'planned']
const KIND_KEY = 'cm.planning.status'

const isPlanned = (i: CalendarItem) => i.kind === 'target' && i.status !== 'PUBLISHED'   // brouillon TikTok : encore à publier
const itemKey = (i: CalendarItem) => `${i.kind}-${i.id}`
const needsAction = (i: CalendarItem) => i.kind === 'target' && (i.status === 'FAILED' || i.status === 'INBOX')
const matchesKind = (i: CalendarItem, k: Kind) =>
  k === 'all' || (k === 'action' ? needsAction(i) : k === 'done' ? !isPlanned(i) : isPlanned(i) && !needsAction(i))
/** Garde les publications dont au moins une plateforme correspond (toutes ses plateformes restent affichées). */
function byKind(list: CalendarItem[], k: Kind): CalendarItem[] {
  if (k === 'all') return list
  const keyOf = (i: CalendarItem) => i.group || itemKey(i)
  const hit = new Set(list.filter(i => matchesKind(i, k)).map(keyOf))
  return list.filter(i => hit.has(keyOf(i)))
}
function storedKind(): Kind {
  try { const v = localStorage.getItem(KIND_KEY) as Kind | null; return v && KINDS.includes(v) ? v : 'all' } catch { return 'all' }
}

function range(view: View, anchor: Date): [Date, Date] {
  if (view === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const start = startOfWeek(first)
    return [start, addDays(start, 42)]
  }
  if (view === 'day') {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    return [d, addDays(d, 1)]
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
  return <span className="tiny strong"><Delta value={d.followers_delta} /> {t('abonnés')}</span>
}

export default function Planning() {
  const desktop = useDesktop()
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const { group } = useSession()
  const [view, setView] = useState<View>(desktop ? 'week' : 'agenda')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => dayKey(new Date()))
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [kind, setKindState] = useState<Kind>(storedKind)
  const setKind = (k: Kind) => { setKindState(k); try { localStorage.setItem(KIND_KEY, k) } catch { /* stockage refusé */ } }
  const [openGroup, setOpenGroup] = useState<Group | null>(null)
  const groupOf = useGroupOf()
  useEffect(() => { setView(v => (desktop && v === 'agenda' ? 'week' : !desktop && (v === 'week' || v === 'day') ? 'agenda' : v)) }, [desktop])

  const [start, end] = useMemo(() => range(view, anchor), [view, anchor])
  const cal = useLoad(s => getCalendar(s, start, end), [start.getTime(), end.getTime()])
  // Recherche (titre, légende) faite par le serveur, sur environ un an en arrière et six mois devant.
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const t = setTimeout(() => setSearch(input.trim()), 300); return () => clearTimeout(t) }, [input])
  const found = useLoad(s => (search ? getCalendar(s, addDays(new Date(), -365), addDays(new Date(), 180), search) : Promise.resolve(null)), [search])
  const filters = (list: CalendarItem[]) => byKind(list
    .filter(i => !(i.kind === 'target' && i.status === 'CANCELLED'))
    .filter(i => !platforms.length || platforms.includes(i.platform)), kind)
  const results = useMemo(() => {
    if (!search || !found.data) return []
    const m = new Map<string, CalendarItem[]>()
    for (const i of filters(found.data.items)) { const k = dayKey(new Date(i.at)); m.set(k, [...(m.get(k) || []), i]) }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))   // la plus récente d'abord
  }, [search, found.data, platforms, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = filters(cal.data?.items || [])
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const i of items) { const k = dayKey(new Date(i.at)); m.set(k, [...(m.get(k) || []), i]) }
    return m
  }, [items])
  const stats = useMemo(() => new Map((cal.data?.days || []).map(d => [d.day, d])), [cal.data])

  const today = new Date()
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
  const shift = (n: number) => {
    if (view === 'day') {                    // vue Jour : jour précédent / suivant
      const d = addDays(new Date(`${selected}T12:00:00`), n)
      setAnchor(d); setSelected(dayKey(d))
      return
    }
    setAnchor(a => view === 'month' ? new Date(a.getFullYear(), a.getMonth() + n, 1) : addDays(a, 7 * n))
    if (view !== 'month') setSelected(k => dayKey(addDays(new Date(`${k}T12:00:00`), 7 * n)))   // même jour, autre semaine
  }
  const label = view === 'day'
    ? new Date(`${selected}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
    : view === 'month'
    ? anchor.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
    : `${week[0].toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – ${week[6].toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`
  const isCurrent = view === 'day' ? selected === dayKey(today) : view === 'month' ? anchor.getMonth() === today.getMonth() && anchor.getFullYear() === today.getFullYear()
    : sameDay(startOfWeek(anchor), startOfWeek(today))
  const goToday = () => { setAnchor(new Date()); setSelected(dayKey(new Date())) }
  const togglePlatform = (p: Platform) => setPlatforms(ps => ps.includes(p) ? ps.filter(x => x !== p) : [...ps, p])

  // Résumé de la période affichée.
  const done = items.filter(i => !isPlanned(i))
  const planned = items.filter(isPlanned)
  const periodViews = done.reduce((s, i) => s + (i.kind === 'video' ? i.views || 0 : 0), 0)
  const periodFollowers = (cal.data?.days || []).reduce((s, d) => s + (d.followers_delta || 0), 0)

  const jump = (k: string) => setSelected(k)
  // Agenda (téléphone) : un seul jour affiché ; glisser à gauche / à droite = jour suivant / précédent.
  const goDay = (n: number) => {
    const d = addDays(new Date(`${selected}T12:00:00`), n)
    setSelected(dayKey(d))
    if (!week.some(w => sameDay(w, d))) setAnchor(d)          // autre semaine : elle est chargée
  }
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current
    touch.current = null
    if (!t0) return
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) goDay(dx < 0 ? 1 : -1)
  }

  const dayList = (k: string, date: Date) => {
    const list = byDay.get(k) || []
    return (
      <section key={k} id={`jour-${k}`} className="agenda-day" aria-label={date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}>
        <div className={`agenda-day-head${sameDay(date, today) ? ' today' : ''}`}>
          <h2>{date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          <DayStats d={stats.get(k)} />
        </div>
        {list.length === 0
          ? <p className="tiny muted" style={{ padding: '2px 2px 4px' }}>{date < today && !sameDay(date, today) ? t('Aucune publication') : t('Rien de prévu')}</p>
          : groupItems(list).map(gx => <PlanRow key={gx.key} g={gx} group={groupOf(gx.items)} onOpen={setOpenGroup} />)}
      </section>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Planning')}</h1>
          <p>{t('Ce qui est parti, avec ses chiffres, et ce qui va partir.')}</p>
        </div>
        <Seg label={t('Affichage')} value={view} onChange={setView}
             options={desktop ? [['day', t('Jour')], ['week', t('Semaine')], ['month', t('Mois')]] : [['agenda', t('Agenda')], ['month', t('Mois')]]} />
      </div>

      {flash && <Msg kind="ok">{flash}</Msg>}

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="btn icon-btn btn-sm" aria-label={view === 'month' ? t('Mois précédent') : view === 'day' ? t('Jour précédent') : t('Semaine précédente')} onClick={() => shift(-1)}><Icon name="left" /></button>
          <button type="button" className="btn icon-btn btn-sm" aria-label={view === 'month' ? t('Mois suivant') : view === 'day' ? t('Jour suivant') : t('Semaine suivante')} onClick={() => shift(1)}><Icon name="right" /></button>
          <span className="label">{label}</span>
          {(!isCurrent || selected !== dayKey(today)) && <button type="button" className="btn btn-sm" onClick={goToday}><Icon name="calendar" size={14} />{t('Aujourd’hui')}</button>}
        </div>
        <div className="cal-search"><SearchBox value={input} onChange={setInput} label={t('Rechercher une vidéo')} placeholder={t('Rechercher (titre, légende)')} /></div>
        <div className="row" style={{ gap: 8 }}>
          <select className="select select-sm" aria-label={t('Afficher')} value={kind} onChange={e => setKind(e.target.value as Kind)}>
            <option value="all">{t('Tout')}</option>
            <option value="action">{t('Action requise')}</option>
            <option value="done">{t('Publié')}</option>
            <option value="planned">{t('Non publié')}</option>
          </select>
          <button type="button" className="btn icon-btn btn-sm only-desktop" aria-label={t('Actualiser')} onClick={cal.reload}><Icon name="refresh" /></button>
        </div>
      </div>
      <div className="chips" role="group" aria-label={t('Plateformes')}>
        {PLATFORMS.map(p => (
          <button key={p} type="button" className="chip" aria-pressed={platforms.includes(p)} onClick={() => togglePlatform(p)}>
            <PlatformLogo platform={p} size={14} />{PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>
      {search && (
        <section className="col" style={{ gap: 12 }} aria-label={t('Résultats de la recherche')} aria-busy={found.loading}>
          {found.error && <Msg kind="err">{found.error}</Msg>}
          {!found.data && found.loading && <Skeleton h={84} n={3} />}
          {found.data && (
            <p className="tiny muted" role="status" style={{ margin: 0 }}>
              {results.length ? t('{n} vidéo(s) pour « {search} »', { n: results.reduce((n, [, l]) => n + groupItems(l).length, 0), search }) : t('Aucune vidéo pour « {search} »', { search })}
            </p>
          )}
          {results.map(([k, list]) => (
            <section key={k} className="agenda-day" aria-label={new Date(`${k}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
              <div className="agenda-day-head"><h2>{new Date(`${k}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</h2></div>
              {groupItems(list).map(gx => <PlanRow key={gx.key} g={gx} group={groupOf(gx.items)} onOpen={setOpenGroup} />)}
            </section>
          ))}
        </section>
      )}
      {!search && cal.data && (
          <span className="tiny muted row" style={{ gap: '4px 14px' }}>
            <span><b className="num" style={{ color: 'var(--text)' }}>{done.length}</b> {done.length > 1 ? t('publiées') : t('publiée')}</span>
            {periodViews > 0 && <span><b className="num" style={{ color: 'var(--text)' }}>{short(periodViews)}</b> {t('vues')}</span>}
            {periodFollowers !== 0 && <span><Delta value={periodFollowers} /> {t('abonnés')}</span>}
            <span><b className="num" style={{ color: 'var(--text)' }}>{planned.length}</b> {planned.length > 1 ? t('programmées') : t('programmée')}</span>
          </span>
        )}

      {cal.error && <Msg kind="err">{cal.error}</Msg>}
      {!cal.data && cal.loading && <div className="col"><Skeleton h={56} /><Skeleton h={84} n={3} /></div>}

      {!search && cal.data && view === 'agenda' && (
        <>
          <div className="daystrip" role="group" aria-label={t('Jours de la semaine')}>
            {week.map(d => {
              const k = dayKey(d)
              const ps = [...new Set((byDay.get(k) || []).map(i => i.platform))]
              return (
                <button key={k} type="button" aria-pressed={selected === k} className={sameDay(d, today) ? 'today' : ''} onClick={() => jump(k)}
                        aria-label={d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric' })}>
                  {d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '')}
                  <b>{d.getDate()}</b>
                  <span className="marks">{ps.map(p => <span key={p} className={`dot dot-${p}`} />)}</span>
                </button>
              )
            })}
          </div>
          <div className="agenda" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {dayList(selected, new Date(`${selected}T12:00:00`))}
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => goDay(-1)}><Icon name="left" size={16} />{t('Jour précédent')}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => goDay(1)}>{t('Jour suivant')}<Icon name="right" size={16} /></button>
            </div>
          </div>
        </>
      )}

      {!search && cal.data && view === 'day' && (
        <div className="agenda" style={{ maxWidth: 760 }}>{dayList(selected, new Date(`${selected}T12:00:00`))}</div>
      )}

      {!search && cal.data && view === 'week' && (
        <div className="week">
          {week.map(d => {
            const k = dayKey(d)
            const list = byDay.get(k) || []
            const past = d < today && !sameDay(d, today)
            return (
              <section key={k} className={`week-col${sameDay(d, today) ? ' today' : ''}${past ? ' past' : ''}`}
                       aria-label={d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric' })}>
                <div className="week-head">
                  <h2>{d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric' })}</h2>
                  <DayStats d={stats.get(k)} />
                </div>
                {list.length === 0 ? <p className="tiny faint">{past ? t('Aucune publication') : t('Rien de prévu')}</p>
                  : groupItems(list).map(gx => <PlanRow key={gx.key} g={gx} group={groupOf(gx.items)} onOpen={setOpenGroup} />)}
                {!past && <Link to="/nouvelle" className="btn btn-sm btn-ghost" style={{ marginTop: 'auto', color: 'var(--muted)' }}><Icon name="plus" size={16} />{t('Programmer')}</Link>}
              </section>
            )
          })}
        </div>
      )}

      {!search && cal.data && view === 'month' && (
        <div className="grid-2">
          <div className="col" style={{ gap: 6 }}>
            <div className="month" aria-hidden="true">
              {week.map(d => <div key={d.getDay()} className="month-dow">{d.toLocaleDateString(locale(), { weekday: desktop ? 'long' : 'narrow' })}</div>)}
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
                          onClick={() => setSelected(k)} aria-label={t('{day} : {n} élément(s)', { day: d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }), n: list.length })}>
                    <span className="d">{d.getDate()}</span>
                    <span className="marks">{groupItems(list).slice(0, desktop ? 12 : 6).map(gx => <span key={gx.key} className="dot" style={{ background: 'var(--primary)', ...(gx.items.every(isPlanned) ? { opacity: .45 } : {}) }} />)}</span>
                    {desktop && views > 0 && <span className="mini">{t('{n} vues', { n: short(views) })}</span>}
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

      {!search && cal.data && items.length === 0 && view !== 'month' && kind !== 'all' && (
        <Empty title={t('Rien pour ce filtre sur cette période')} icon="calendar">
          <button type="button" className="btn btn-sm" onClick={() => setKind('all')}>{t('Tout afficher')}</button>
        </Empty>
      )}
      {!search && cal.data && items.length === 0 && view !== 'month' && kind === 'all' && (
        <Empty title={t('Rien sur cette période')} icon="calendar">
          <p style={{ marginBottom: 14 }}>{t('Les vidéos publiées sur vos comptes apparaissent ici après le relevé des chiffres ; programmez la suite depuis Chapote.')}</p>
          <Link className="btn btn-primary" to="/nouvelle"><Icon name="plus" size={16} />{t('Nouvelle publication')}</Link>
        </Empty>
      )}

      <p className="tiny muted">{t('Heures dans votre fuseau ({zone}). Une ligne par vidéo : ses plateformes sont en logos ; touchez-la pour le détail de chaque compte.', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
      {openGroup && <PublicationSheet g={openGroup} group={groupOf(openGroup.items)} onClose={() => setOpenGroup(null)}
                                      onChanged={() => { setOpenGroup(null); cal.reload() }} />}
    </>
  )
}
