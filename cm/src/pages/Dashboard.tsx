import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getOverview, getPosts, type Account, type Target } from '../api'
import { Avatar, Empty, Loading, Msg, PlatformTag, Seg } from '../components/ui'
import ViewsChart from '../components/ViewsChart'
import { fmtTime, num, relDay, short, signed } from '../format'
import { useLoad } from '../session'

function accountState(a: Account): { label: string; tone: string } {
  if (a.needs_reconnect) return { label: 'À reconnecter', tone: 'danger' }
  if (a.mode === 'routine') return { label: 'Géré par la routine', tone: 'muted' }
  if (!a.stats_available) return { label: 'Connecté', tone: 'ok' }
  if (a.stats?.error) return { label: 'Relevé en échec', tone: 'warn' }
  return { label: 'Connecté', tone: 'ok' }
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const [metric, setMetric] = useState<'views' | 'followers'>('views')
  const ov = useLoad(org => getOverview(org, days), [days])
  const upcoming = useLoad(org => getPosts(org, new Date(), new Date(Date.now() + 14 * 86400000)))

  const next: (Target & { title: string })[] = (upcoming.data || [])
    .flatMap(p => p.targets.filter(t => t.status === 'SCHEDULED' || t.status === 'AWAITING_ROUTINE').map(t => ({ ...t, title: p.title })))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  // Regroupe les cibles d'une même vidéo à la même heure.
  const groups: { key: string; at: string; title: string; platforms: string[] }[] = []
  for (const t of next) {
    const key = `${t.post_id}|${t.scheduled_at.slice(0, 16)}`
    const g = groups.find(x => x.key === key)
    const lbl = t.account_name || t.platform
    if (g) g.platforms.push(lbl)
    else groups.push({ key, at: t.scheduled_at, title: t.title, platforms: [lbl] })
  }

  const d = ov.data
  return (
    <>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Tableau de bord</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Tous vos comptes. Chiffres relevés toutes les quelques heures.</p>
        </div>
        <Seg label="Période" value={days} onChange={setDays} options={[[7, '7 jours'], [30, '30 jours'], [90, '90 jours']]} />
      </div>

      {ov.error && <Msg kind="err">{ov.error}</Msg>}
      {!d && ov.loading && <Loading />}
      {d && d.totals.accounts === 0 && (
        <Empty title="Aucun compte connecté">
          <p style={{ margin: '0 0 14px' }}>Connectez TikTok, YouTube ou Instagram pour suivre vos chiffres et programmer vos vidéos.</p>
          <Link className="btn btn-primary" to="/comptes">Connecter un compte</Link>
        </Empty>
      )}
      {d && d.totals.accounts > 0 && (
        <>
          <section aria-label="Chiffres clés" className="tiles">
            <div className="card"><div className="tile-label">Vues totales</div><div className="tile-value">{short(d.totals.views)}</div>
              <div className="tile-sub">{d.totals.views_gained != null ? `${signed(d.totals.views_gained)} sur ${days} jours` : 'cumul des comptes'}</div></div>
            <div className="card"><div className="tile-label">Abonnés</div><div className="tile-value">{short(d.totals.followers)}</div>
              <div className="tile-sub">{d.totals.accounts} compte{d.totals.accounts > 1 ? 's' : ''}</div></div>
            <div className="card"><div className="tile-label">Vidéos publiées</div><div className="tile-value">{num(d.totals.published)}</div>
              <div className="tile-sub">depuis Chapote, {days} jours</div></div>
            <div className="card"><div className="tile-label">Programmées</div><div className="tile-value">{num(d.totals.upcoming)}</div>
              <Link className="tile-sub" to="/planning" style={{ color: 'var(--accent)' }}>Voir le planning</Link></div>
          </section>
          {d.totals.failed_recent > 0 && (
            <Msg kind="err">{d.totals.failed_recent} publication{d.totals.failed_recent > 1 ? 's' : ''} en échec ces 7 derniers jours. <Link to="/planning">Voir le planning</Link></Msg>
          )}

          <div className="split">
            <section className="card main col" aria-labelledby="t-courbe">
              <div className="card-head">
                <h2 id="t-courbe">{metric === 'views' ? 'Vues cumulées' : 'Abonnés'}</h2>
                <Seg label="Mesure" value={metric} onChange={setMetric} options={[['views', 'Vues'], ['followers', 'Abonnés']]} />
              </div>
              <ViewsChart series={d.series} metric={metric} />
            </section>
            <section className="card side" aria-labelledby="t-avenir">
              <div className="card-head"><h2 id="t-avenir">À venir</h2><Link className="small" to="/planning">Planning</Link></div>
              {groups.length === 0 ? (
                <p className="muted small" style={{ margin: '12px 0 0' }}>Rien de programmé. <Link to="/nouvelle">Nouvelle publication</Link></p>
              ) : (
                <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
                  {groups.slice(0, 6).map(g => (
                    <li key={g.key} className="row" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--surface-2)', flexWrap: 'nowrap' }}>
                      <div style={{ width: 64, flex: 'none', textAlign: 'center', lineHeight: 1.3 }} className="tiny muted">
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{fmtTime(g.at)}</div>{relDay(g.at)}
                      </div>
                      <div className="grow">
                        <div className="ellipsis" style={{ fontWeight: 500 }}>{g.title}</div>
                        <div className="muted small ellipsis">{g.platforms.join(' · ')}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card card-flush" aria-labelledby="t-comptes">
            <div className="card-head" style={{ padding: '18px 20px' }}>
              <h2 id="t-comptes">Comptes</h2><Link className="small" to="/comptes">Gérer les comptes</Link>
            </div>
            <div className="table-wrap">
              <table className="data" style={{ minWidth: 640 }}>
                <thead><tr>
                  <th scope="col">Compte</th><th scope="col">Plateforme</th><th scope="col" className="r">Abonnés</th>
                  <th scope="col" className="r">Vues</th><th scope="col" className="r">Vues sur {days} j</th><th scope="col">État</th>
                </tr></thead>
                <tbody>
                  {d.accounts.map(a => {
                    const st = accountState(a)
                    return (
                      <tr key={`${a.platform}-${a.id}`}>
                        <td><span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Avatar src={a.avatar_url} name={a.name} /><span style={{ fontWeight: 500 }}>{a.name}</span></span></td>
                        <td><PlatformTag platform={a.platform} /></td>
                        {a.stats_available ? (
                          <>
                            <td className="r">{num(a.stats?.followers)}</td>
                            <td className="r">{num(a.stats?.views)}</td>
                            <td className="r muted">{signed(a.stats?.delta_views)}</td>
                          </>
                        ) : (
                          <td colSpan={3} className="r muted small">Chiffres après la validation {a.platform === 'tiktok' ? 'TikTok' : ''}</td>
                        )}
                        <td><span className={`status status-${st.tone}`}>{st.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {d.top_videos.length > 0 && (
            <section aria-labelledby="t-top" className="col">
              <div className="card-head"><h2 id="t-top">Vidéos les plus vues ({days} jours)</h2><Link className="small" to="/videos">Toutes les vidéos</Link></div>
              <div className="vgrid">
                {d.top_videos.map(v => (
                  <a key={v.id} className="vcard" href={v.url || undefined} target="_blank" rel="noreferrer">
                    {v.thumbnail_url ? <img className="vthumb" src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <div className="vthumb" />}
                    <div style={{ padding: '10px 12px' }}>
                      <div className="ellipsis small" style={{ fontWeight: 500 }}>{v.title || 'Sans titre'}</div>
                      <div className="tiny muted row" style={{ gap: 6 }}><span aria-hidden="true" className={`dot dot-${v.platform}`} />{short(v.views)} vues</div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}
