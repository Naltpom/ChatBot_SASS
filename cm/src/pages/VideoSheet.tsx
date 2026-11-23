// Fiche d'une vidéo : la même vidéo sur chaque plateforme (publiée ensemble depuis Chapote).
// Filtre Toutes / plateforme en haut : lecteur, chiffres et commentaires suivent le filtre.
// Lecteur officiel de la plateforme ; à défaut, la vidéo source lue depuis le Drive.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCommentsPage, getVideoSheet, PLATFORM_LABEL, type Comment, type Platform } from '../api'
import { CommentCard } from '../components/CommentCard'
import { useMorePages } from '../components/list'
import { PlatformLogo } from '../components/PlatformLogo'
import { Empty, Icon, Msg, Skeleton } from '../components/ui'
import { fmtDate, num } from '../format'
import { useLoad, useRole, useSession } from '../session'

const FIELDS: ['views' | 'likes' | 'comments' | 'shares', string][] = [['views', 'Vues'], ['likes', 'J’aime'], ['comments', 'Commentaires'], ['shares', 'Partages']]

export default function VideoSheet() {
  const { id } = useParams()
  const nav = useNavigate()
  const { org } = useSession()
  const { canEdit } = useRole()
  const sheet = useLoad(() => getVideoSheet(org, Number(id)), [id, org])
  const [p, setP] = useState<'all' | Platform>('all')
  const d = sheet.data
  const shown = d ? d.videos.filter(v => p === 'all' || v.platform === p) : []
  const player = shown.find(v => v.embed) || null
  const ids = shown.map(v => v.id).join(',')
  const first = useLoad(() => (ids ? getCommentsPage(org, { status: 'all', videos: ids }) : Promise.resolve(null)), [ids, org])
  const pages = useMorePages(first.data, cursor => getCommentsPage(org, { status: 'all', videos: ids, cursor }), [ids, org])
  const [changed, setChanged] = useState<Record<number, Comment | null>>({})
  const comments = (pages.items || []).map(c => (c.id in changed ? changed[c.id] : c)).filter(Boolean) as Comment[]
  const total = (f: 'views' | 'likes' | 'comments' | 'shares') => {
    const vals = shown.map(v => v[f]).filter((x): x is number => x != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const scope = p === 'all' ? 'toutes plateformes' : PLATFORM_LABEL[p]

  return (
    <>
      <div className="row-nw" style={{ gap: 8 }}>
        <button type="button" className="btn btn-ghost icon-btn" aria-label="Retour" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/videos'))}><Icon name="left" /></button>
        <h1 className="ellipsis" style={{ margin: 0, fontSize: 22 }}>{d?.title || (sheet.loading ? '…' : 'Vidéo')}</h1>
      </div>
      {sheet.error && <Msg kind="err">{sheet.error}</Msg>}
      {!d && sheet.loading && <Skeleton h={300} />}
      {d && (
        <div className="sheet-grid">
          <div className="col" style={{ gap: 12, alignItems: 'center' }}>
            {d.videos.length > 1 && (
              <div className="chips" role="group" aria-label="Plateforme" style={{ alignSelf: 'stretch' }}>
                <button type="button" className="chip" aria-pressed={p === 'all'} onClick={() => setP('all')}>Toutes</button>
                {d.videos.map(v => (
                  <button key={v.id} type="button" className="chip" aria-pressed={p === v.platform} onClick={() => setP(v.platform)}>
                    <PlatformLogo platform={v.platform} size={14} />{PLATFORM_LABEL[v.platform]}
                  </button>
                ))}
              </div>
            )}
            {d.asset?.stream ? (
              // La vidéo d'origine, lue depuis le Drive ; les plateformes ont leurs liens en dessous.
              <video className="player" src={d.asset.stream} poster={d.asset.thumbnail || undefined} controls preload="metadata" playsInline />
            ) : player ? (
              <iframe className="player" src={player.embed!} title={`Lecteur ${PLATFORM_LABEL[player.platform]}`}
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
            ) : (
              <div className="player player-empty">Lecteur indisponible pour cette plateforme</div>
            )}
            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              {shown.filter(v => v.url).map(v => (
                <a key={v.id} className="btn btn-sm" href={v.url!} target="_blank" rel="noreferrer"><PlatformLogo platform={v.platform} size={14} />Voir sur {PLATFORM_LABEL[v.platform]}</a>
              ))}
              {d.asset?.folder_url && <a className="btn btn-sm" href={d.asset.folder_url} target="_blank" rel="noreferrer"><Icon name="layers" size={14} />Dossier Drive</a>}
            </div>
          </div>

          <div className="col" style={{ gap: 18, minWidth: 0 }}>
            <section className="col" style={{ gap: 10 }} aria-labelledby="t-chiffres">
              <h2 id="t-chiffres" style={{ margin: 0 }}>Chiffres <span className="small muted" style={{ fontWeight: 400 }}>· {scope}</span></h2>
              <div className="kpis2">
                {FIELDS.map(([f, l]) => (
                  <div key={f} className="card kpi"><div className="kpi-label">{l}</div><div className="kpi-value">{num(total(f)) || '—'}</div></div>
                ))}
              </div>
              {d.videos.length > 1 && p === 'all' && (
                <div className="card card-flush table-wrap">
                  <table className="data">
                    <thead><tr><th scope="col">Plateforme</th>{FIELDS.map(([f, l]) => <th key={f} scope="col" className="r">{l}</th>)}</tr></thead>
                    <tbody>
                      {d.videos.map(v => (
                        <tr key={v.id}>
                          <td><span className="row-nw" style={{ gap: 6 }}><PlatformLogo platform={v.platform} size={14} />{v.account_name}</span></td>
                          {FIELDS.map(([f]) => <td key={f} className="r">{num(v[f])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {(d.caption || shown[0]?.published_at) && (
              <section className="col" style={{ gap: 6 }} aria-labelledby="t-leg">
                <h2 id="t-leg" style={{ margin: 0 }}>Légende</h2>
                {d.caption && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.caption}</p>}
                <p className="small muted" style={{ margin: 0 }}>
                  {shown[0]?.published_at ? `Publiée le ${fmtDate(shown[0].published_at)}` : ''}{d.post_id ? ' · depuis Chapote' : ''}
                </p>
              </section>
            )}

            <section className="col" style={{ gap: 10 }} aria-labelledby="t-cmt">
              <h2 id="t-cmt" style={{ margin: 0 }}>Commentaires <span className="small muted" style={{ fontWeight: 400 }}>· {scope}</span></h2>
              {!first.data && first.loading && <Skeleton h={70} n={2} />}
              {first.data && comments.length === 0 && (
                <Empty title="Pas de commentaire relevé" icon="comment">
                  {shown.some(v => v.comments) ? 'Les commentaires de cette vidéo apparaîtront ici dès que la plateforme permet à Chapote de les lire.' : 'Aucun commentaire pour l’instant.'}
                </Empty>
              )}
              {comments.length > 0 && (
                <div className="cgroup">
                  {comments.map(c => <CommentCard key={c.id} c={c} canEdit={canEdit} onChanged={n => setChanged(m => ({ ...m, [c.id]: n }))} />)}
                </div>
              )}
              <div ref={pages.sentinel} />
              <Link to="/commentaires" className="small">Tous les commentaires</Link>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
