// Statistiques du périmètre (espace + groupe) sur une période : totaux, détail par plateforme (avec
// les seuls chiffres que chaque plateforme fournit vraiment), par compte, meilleurs moments pour
// publier (jour × heure, en heure locale) et vidéos qui marchent le mieux.
import { useMemo, useState } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { Link } from 'react-router-dom'
import { getStats, getVideos, PLATFORM_LABEL, type DetailedStats, type Metric, type Platform } from '../api'
import { Avatar, Delta, Empty, Icon, Msg, Seg, Skeleton } from '../components/ui'
import { METRIC_LABEL, num, pct, short } from '../format'
import { useLoad, useSession } from '../session'
import { LiveCount, SearchBox, SortControl, useListState } from '../components/list'

const ALL: Metric[] = ['followers', 'views', 'likes', 'comments', 'shares', 'saves']
const SLOTS = ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h']
const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']

function Heatmap({ posts }: { posts: DetailedStats['posts'] }) {
  const grid = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => ({ n: 0, views: 0 })))
    for (const p of posts) {
      if (p.views == null) continue
      const d = new Date(p.published_at)
      const c = g[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)]
      c.n++; c.views += p.views
    }
    return g
  }, [posts])
  const avgs = grid.flat().filter(c => c.n).map(c => c.views / c.n)
  const max = Math.max(1, ...avgs)
  let best: { d: number; s: number; avg: number } | null = null
  grid.forEach((row, d) => row.forEach((c, s) => { if (c.n && (!best || c.views / c.n > best.avg)) best = { d, s, avg: c.views / c.n } }))
  const b = best as { d: number; s: number; avg: number } | null
  if (!avgs.length) return <p className="muted small">La carte se remplit dès que des vidéos avec des vues sont relevées sur la période.</p>
  return (
    <div className="col" style={{ gap: 12 }}>
      {b && <p className="small">Meilleur créneau : <strong>{['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][b.d]} entre {b.s * 3} h et {b.s * 3 + 3} h</strong> · {short(Math.round(b.avg))} vues en moyenne.</p>}
      <div className="heat" role="table" aria-label="Vues moyennes par jour et par tranche de 3 heures">
        <span />
        {SLOTS.map(s => <span key={s} className="hl" role="columnheader">{s}</span>)}
        {grid.map((row, d) => (
          <div key={d} style={{ display: 'contents' }} role="row">
            <span className="lab" role="rowheader">{DOW[d]}</span>
            {row.map((c, s) => (
              <span key={s} role="cell" className="cell" title={c.n ? `${DOW[d]} ${SLOTS[s]} : ${c.n} vidéo(s), ${short(Math.round(c.views / c.n))} vues en moyenne` : `${DOW[d]} ${SLOTS[s]} : aucune vidéo`}
                    style={c.n ? { background: `color-mix(in srgb, var(--brand) ${Math.round(18 + 82 * (c.views / c.n) / max)}%, var(--surface-2))` } : undefined}>
                <span className="sr-only">{c.n ? `${c.n} vidéo(s), ${Math.round(c.views / c.n)} vues en moyenne` : 'aucune vidéo'}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="tiny muted">Heure de publication dans votre fuseau. Plus la case est foncée, plus les vidéos publiées à ce moment ont été vues.</p>
    </div>
  )
}

function MetricCell({ m, row, available }: { m: Metric; row: Record<string, any>; available: boolean }) {
  const v = row[m] as number | null
  return (
    <div>
      <div className="m-label">{METRIC_LABEL[m]}</div>
      {available ? (
        <div className="m-value">{short(v)}{m === 'followers' && row.followers_delta != null && <span className="tiny" style={{ marginLeft: 6 }}><Delta value={row.followers_delta} /></span>}</div>
      ) : <div className="na">non fourni</div>}
    </div>
  )
}

type AccSort = 'views' | 'posts' | 'engagement_rate' | 'followers' | 'followers_delta' | 'likes' | 'name'
const ACC_SORTS: [AccSort, string][] = [['views', 'Vues'], ['followers', 'Abonnés'], ['followers_delta', 'Abonnés gagnés'],
  ['engagement_rate', 'Engagement'], ['posts', 'Vidéos'], ['likes', 'J’aime'], ['name', 'Nom']]

export default function Stats() {
  const { group } = useSession()
  const [days, setDays] = useState(30)
  const [sort, setSort] = useState<'views' | 'engagement' | 'likes' | 'comments' | 'shares'>('views')
  const acc = useListState<AccSort>('views', s => (s === 'name' ? 'asc' : 'desc'), 'c')
  const st = useLoad(s => getStats(s, days, { q: acc.q || undefined, sort: acc.sort, order: acc.order }), [days, acc.q, acc.sort, acc.order])
  const top = useLoad(s => getVideos(s, { sort, days, limit: 12 }), [sort, days])
  const d = st.data

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Statistiques</h1>
          <p>Vidéos publiées sur la période, chiffres à jour.</p>
        </div>
        <Seg label="Période" value={days} onChange={setDays} options={[[7, '7 j'], [30, '30 j'], [90, '90 j'], [365, '1 an']]} />
      </div>
      {st.error && <Msg kind="err">{st.error}</Msg>}
      {!d && st.loading && <div className="kpis k6"><Skeleton h={104} n={6} /></div>}
      {d && d.totals.accounts === 0 && (
        <Empty title="Aucun compte" icon="chart"><Link className="btn btn-primary" to="/comptes">Connecter un compte</Link></Empty>
      )}
      {d && d.totals.accounts > 0 && (
        <>
          <section className="kpis k6" aria-label="Totaux">
            <div className="kpi"><div className="kpi-label">Abonnés</div><div className="kpi-value">{short(d.totals.followers)}</div>
              <div className="kpi-sub">{d.totals.followers_delta != null ? <><Delta value={d.totals.followers_delta} /> en {days} j</> : `${d.totals.accounts} comptes`}</div></div>
            <div className="kpi"><div className="kpi-label">Vues</div><div className="kpi-value">{short(d.totals.views)}</div>
              <div className="kpi-sub">{d.totals.avg_views != null ? `${short(d.totals.avg_views)} par vidéo` : '—'}</div></div>
            <div className="kpi"><div className="kpi-label">Engagement</div><div className="kpi-value">{pct(d.totals.engagement_rate)}</div>
              <div className="kpi-sub">{short(d.totals.interactions)} interactions</div></div>
            <div className="kpi"><div className="kpi-label">Vidéos</div><div className="kpi-value">{num(d.totals.posts)}</div>
              <div className="kpi-sub">publiées en {days} j</div></div>
            <div className="kpi"><div className="kpi-label">J’aime</div><div className="kpi-value">{short(d.totals.likes)}</div>
              <div className="kpi-sub">{short(d.totals.comments)} commentaires</div></div>
            <div className="kpi"><div className="kpi-label">Partages</div><div className="kpi-value">{short(d.totals.shares)}</div>
              <div className="kpi-sub">{d.totals.saves != null ? `${short(d.totals.saves)} enregistrements` : 'TikTok et Instagram'}</div></div>
          </section>

          <section className="grid-3" aria-label="Par plateforme">
            {d.platforms.map(p => (
              <article key={p.platform} className="card pcard">
                <div className="pcard-head">
                  <PlatformLogo platform={p.platform} size={36} />
                  <div className="grow"><h2>{PLATFORM_LABEL[p.platform]}</h2><div className="tiny muted">{p.accounts} compte{p.accounts > 1 ? 's' : ''} · {p.posts} vidéo{p.posts > 1 ? 's' : ''}</div></div>
                  <div style={{ textAlign: 'right' }}><div className="strong">{pct(p.engagement_rate)}</div><div className="tiny muted">engagement</div></div>
                </div>
                <div className="mgrid">{ALL.map(m => <MetricCell key={m} m={m} row={p} available={p.metrics.includes(m)} />)}</div>
                {d.totals.views ? (
                  <div className="col" style={{ gap: 4 }}>
                    <div className="bar" aria-hidden="true"><span style={{ width: `${Math.round(100 * (p.views || 0) / d.totals.views)}%`, background: `var(--${p.platform})` }} /></div>
                    <span className="tiny muted">{Math.round(100 * (p.views || 0) / d.totals.views)} % des vues de la période</span>
                  </div>
                ) : null}
              </article>
            ))}
          </section>

          <div className="grid-2">
            <section className="card col" aria-labelledby="t-moments">
              <h2 id="t-moments">Meilleurs moments pour publier</h2>
              <Heatmap posts={d.posts} />
            </section>
            <section className="card card-flush" aria-labelledby="t-acc">
              <div className="card-head" style={{ padding: '16px 16px 4px' }}><h2 id="t-acc">Par compte</h2></div>
              <div className="listbar" style={{ padding: '8px 16px 0' }}>
                <SearchBox value={acc.input} onChange={acc.setInput} label="Rechercher un compte" />
                <SortControl list={acc} options={ACC_SORTS} />
              </div>
              <LiveCount n={d.accounts.length} what="comptes" />
              {d.accounts.length === 0 && <p className="muted small" style={{ padding: '8px 16px' }}>Aucun compte ne correspond à « {acc.q} ».</p>}
              <ul className="list list-pad">
                {d.accounts.map(a => (
                  <li key={`${a.platform}-${a.id}`}>
                    <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
                    <div className="grow">
                      <div className="ellipsis strong">{a.name}</div>
                      <div className="metrics">
                        <span><b>{short(a.views)}</b> vues</span>
                        <span><b>{a.posts}</b> vidéo{a.posts > 1 ? 's' : ''}</span>
                        <span><b>{pct(a.engagement_rate)}</b></span>
                      </div>
                    </div>
                    <div className="num" style={{ textAlign: 'right' }}>
                      <div className="strong">{a.stats_available ? short(a.followers) : '—'}</div>
                      <div className="tiny">{a.followers_delta != null ? <Delta value={a.followers_delta} /> : <span className="muted">abonnés</span>}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="col" aria-labelledby="t-top">
            <div className="card-head">
              <h2 id="t-top">Vidéos qui marchent</h2>
              <div className="row" style={{ gap: 8 }}>
                <select className="select select-sm" aria-label="Classer par" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
                  <option value="views">Les plus vues</option><option value="engagement">Plus d’interactions</option>
                  <option value="likes">Plus de j’aime</option><option value="comments">Plus commentées</option><option value="shares">Plus partagées</option>
                </select>
                <Link to="/videos" className="small">Toutes</Link>
              </div>
            </div>
            {top.data && top.data.length === 0 && <p className="muted small">Aucune vidéo relevée sur la période.</p>}
            <div className="vgrid">
              {(top.data || []).map((v, i) => (
                <Link key={v.id} className="vcard" to={`/videos/${v.id}`}>
                  {v.thumbnail_url && <img className="vthumb" src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />}
                  <span className="vrank">#{i + 1}</span>
                  <div className="vcard-body">
                    <div className="ellipsis small strong">{v.title || 'Sans titre'}</div>
                    <div className="tiny muted row-nw" style={{ gap: 6 }}><span aria-hidden="true" className={`dot dot-${v.platform}`} /><span className="ellipsis">{v.account_name}</span></div>
                    <div className="metrics"><span><Icon name="eye" size={13} /> <b>{short(v.views)}</b></span><span><Icon name="heart" size={13} /> <b>{short(v.likes)}</b></span>
                      {v.comments != null && <span><Icon name="comment" size={13} /> <b>{short(v.comments)}</b></span>}
                      {v.shares != null && <span><Icon name="share" size={13} /> <b>{short(v.shares)}</b></span>}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <p className="tiny muted">
            Chiffres fournis par les API officielles : {(Object.entries(d.metrics) as [Platform, Metric[]][]).map(([p, ms]) => `${PLATFORM_LABEL[p]} (${ms.map(m => METRIC_LABEL[m].toLowerCase()).join(', ')})`).join(' · ')}.
            Les duos et collages ne sont pas fournis par l’API TikTok, ni les partages par l’API YouTube Data.
          </p>
        </>
      )}
    </>
  )
}
