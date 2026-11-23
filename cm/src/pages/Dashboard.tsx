// Accueil : chiffres clés du périmètre (espace + groupe), courbe, prochaines publications, comptes et
// vidéos phares. Mobile : tout en une colonne, vidéos en carrousel. Ordinateur : deux colonnes.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getOverview, getPosts, getProposalCount, type Account, type Target } from '../api'
import { Avatar, Delta, Empty, Icon, Msg, PlatformTag, Seg, Skeleton } from '../components/ui'
import ViewsChart from '../components/ViewsChart'
import { fmtTime, greeting, num, relDay, short, signed } from '../format'
import { useLoad, useSession } from '../session'

export function accountState(a: Account): { label: string; tone: string } {
  if (a.needs_reconnect) return { label: 'À reconnecter', tone: 'danger' }
  if (a.mode === 'routine') return { label: 'Routine', tone: 'muted' }
  if (a.stats?.error) return { label: 'Relevé en échec', tone: 'warn' }
  return { label: 'Connecté', tone: 'ok' }
}

export default function Dashboard() {
  const { me, group } = useSession()
  const [days, setDays] = useState(30)
  const [metric, setMetric] = useState<'views' | 'followers'>('views')
  const ov = useLoad(s => getOverview(s, days), [days])
  const drafts = useLoad(s => getProposalCount(s.org))
  const upcoming = useLoad(s => getPosts(s, new Date(), new Date(Date.now() + 14 * 86400000), { status: 'upcoming', limit: 12 }))

  const next: (Target & { title: string })[] = (upcoming.data || [])
    .flatMap(p => p.targets.filter(t => t.status === 'SCHEDULED' || t.status === 'AWAITING_ROUTINE').map(t => ({ ...t, title: p.title })))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  // Une ligne par vidéo et par heure, avec les comptes concernés.
  const groups: { key: string; at: string; title: string; targets: Target[] }[] = []
  for (const t of next) {
    const key = `${t.post_id}|${t.scheduled_at.slice(0, 16)}`
    const g = groups.find(x => x.key === key)
    if (g) g.targets.push(t)
    else groups.push({ key, at: t.scheduled_at, title: t.title, targets: [t] })
  }

  const d = ov.data
  const first = (me?.name || '').split(' ')[0]
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
          <p>Chiffres relevés plusieurs fois par jour.</p>
        </div>
        <Seg label="Période" value={days} onChange={setDays} options={[[7, '7 j'], [30, '30 j'], [90, '90 j']]} />
      </div>

      {ov.error && <Msg kind="err">{ov.error}</Msg>}
      {!d && ov.loading && <div className="kpis"><Skeleton h={104} n={4} /></div>}
      {(drafts.data?.open || 0) > 0 && (
        <Link to="/a-valider" className="card row-nw draft-banner" style={{ gap: 12, textDecoration: 'none', color: 'var(--text)' }}>
          <span className="nav-badge" style={{ marginLeft: 0 }}>{drafts.data!.open}</span>
          <span className="grow strong">Brouillon{drafts.data!.open > 1 ? 's' : ''} à valider depuis vos dossiers Drive</span>
          <Icon name="right" />
        </Link>
      )}
      {d && d.totals.accounts === 0 && (
        <Empty title={group ? 'Aucun compte dans ce groupe' : 'Connectez votre premier compte'} icon="users">
          <p style={{ marginBottom: 16 }}>{group ? 'Ajoutez des comptes à ce groupe depuis la page Comptes.' : 'TikTok, YouTube ou Instagram : vos chiffres et votre planning apparaîtront ici.'}</p>
          <Link className="btn btn-primary" to="/comptes">{group ? 'Gérer les groupes' : 'Connecter un compte'}</Link>
        </Empty>
      )}
      {d && d.totals.accounts > 0 && (
        <>
          <section aria-label="Chiffres clés" className="kpis">
            <Link to="/stats" className="kpi">
              <div className="kpi-label"><Icon name="eye" size={15} />Vues</div>
              <div className="kpi-value">{short(d.totals.views)}</div>
              <div className="kpi-sub">{d.totals.views_gained != null ? <><Delta value={d.totals.views_gained} /> en {days} j</> : 'cumul des comptes'}</div>
            </Link>
            <Link to="/stats" className="kpi">
              <div className="kpi-label"><Icon name="users" size={15} />Abonnés</div>
              <div className="kpi-value">{short(d.totals.followers)}</div>
              <div className="kpi-sub">{d.totals.accounts} compte{d.totals.accounts > 1 ? 's' : ''}</div>
            </Link>
            <Link to="/planning" className="kpi">
              <div className="kpi-label"><Icon name="check" size={15} />Publiées</div>
              <div className="kpi-value">{num(d.totals.published)}</div>
              <div className="kpi-sub">depuis Chapote, {days} j</div>
            </Link>
            <Link to="/planning" className="kpi">
              <div className="kpi-label"><Icon name="clock" size={15} />Programmées</div>
              <div className="kpi-value">{num(d.totals.upcoming)}</div>
              <div className="kpi-sub" style={{ color: 'var(--accent)' }}>Voir le planning</div>
            </Link>
          </section>
          {d.totals.failed_recent > 0 && (
            <Msg kind="err">{d.totals.failed_recent} publication{d.totals.failed_recent > 1 ? 's' : ''} en échec ces 7 derniers jours. <Link to="/planning">Voir le planning</Link></Msg>
          )}

          <div className="grid-2">
            <section className="card col" aria-labelledby="t-courbe">
              <div className="card-head">
                <h2 id="t-courbe">{metric === 'views' ? 'Vues cumulées' : 'Abonnés'}</h2>
                <Seg label="Mesure" value={metric} onChange={setMetric} options={[['views', 'Vues'], ['followers', 'Abonnés']]} />
              </div>
              <ViewsChart series={d.series} metric={metric} />
            </section>
            <section className="card col" aria-labelledby="t-avenir">
              <div className="card-head"><h2 id="t-avenir">À venir</h2><Link to="/planning">Planning</Link></div>
              {groups.length === 0 ? (
                <div className="col" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <p className="muted small">Rien de programmé ces deux prochaines semaines.</p>
                  <Link to="/nouvelle" className="btn btn-sm"><Icon name="plus" size={16} />Programmer une vidéo</Link>
                </div>
              ) : (
                <ul className="list">
                  {groups.slice(0, 6).map(g => (
                    <li key={g.key}>
                      <div style={{ width: 58, flex: 'none', lineHeight: 1.25 }} className="tiny muted">
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmtTime(g.at)}</div>{relDay(g.at)}
                      </div>
                      <div className="grow col" style={{ gap: 4 }}>
                        <div className="ellipsis strong">{g.title}</div>
                        <div className="row" style={{ gap: 4 }}>
                          {g.targets.slice(0, 3).map(t => <PlatformTag key={t.id} platform={t.platform} label={t.account_name} />)}
                          {g.targets.length > 3 && <span className="ptag" title={g.targets.slice(3).map(t => t.account_name).join(', ')}>+{g.targets.length - 3} comptes</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {d.top_videos.length > 0 && (
            <section aria-labelledby="t-top" className="col">
              <div className="card-head"><h2 id="t-top">Vidéos phares · {days} j</h2><Link to="/videos">Toutes les vidéos</Link></div>
              <div className="hscroll">
                {d.top_videos.map(v => (
                  <Link key={v.id} className="vcard" to={`/videos/${v.id}`}>
                    {v.thumbnail_url && <img className="vthumb" src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" />}
                    <div className="vcard-body">
                      <div className="ellipsis small strong">{v.title || 'Sans titre'}</div>
                      <div className="tiny muted row" style={{ gap: 6 }}><span aria-hidden="true" className={`dot dot-${v.platform}`} />{short(v.views)} vues · {short(v.likes)} j’aime</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card card-flush" aria-labelledby="t-comptes">
            <div className="card-head" style={{ padding: '16px 16px 4px' }}>
              <h2 id="t-comptes">Comptes</h2><Link to="/comptes">Gérer</Link>
            </div>
            <ul className="list list-pad">
              {/* À reconnecter d'abord, puis les plus suivis ; 8 au plus (le détail est dans Stats). */}
              {[...d.accounts].sort((x, y) => Number(y.needs_reconnect) - Number(x.needs_reconnect)
                || (y.stats?.followers ?? -1) - (x.stats?.followers ?? -1)).slice(0, 8).map(a => {
                const st = accountState(a)
                return (
                  <li key={`${a.platform}-${a.id}`}>
                    <Avatar src={a.avatar_url} name={a.name} platform={a.platform} />
                    <div className="grow">
                      <div className="ellipsis strong">{a.name}</div>
                      <div className={`tiny status-${st.tone}`}>{st.label}</div>
                    </div>
                    {a.stats_available && a.stats ? (
                      <div className="num" style={{ textAlign: 'right' }}>
                        <div className="strong">{short(a.stats.followers)}</div>
                        <div className="tiny muted">{a.stats.delta_followers != null ? `${signed(a.stats.delta_followers)} abonnés` : 'abonnés'}</div>
                      </div>
                    ) : <span className="tiny muted" style={{ textAlign: 'right', maxWidth: 140 }}>Chiffres bientôt</span>}
                    <div className="num only-desktop" style={{ textAlign: 'right', minWidth: 110 }}>
                      <div className="strong">{short(a.stats?.views)}</div>
                      <div className="tiny muted">{a.stats?.delta_views != null ? `${signed(a.stats.delta_views)} vues` : 'vues'}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
            {d.accounts.length > 8 && <div style={{ padding: '0 16px 14px' }}><Link to="/stats" className="small">Voir les {d.accounts.length} comptes</Link></div>}
          </section>
        </>
      )}
    </>
  )
}
