import { useState } from 'react'
import { getVideos, PLATFORM_LABEL } from '../api'
import { Empty, Loading, Msg, PlatformTag, Seg } from '../components/ui'
import { fmtDate, fmtDuration, num } from '../format'
import { useLoad } from '../session'

export default function Videos() {
  const [platform, setPlatform] = useState('')
  const [sort, setSort] = useState<'recent' | 'views'>('recent')
  const videos = useLoad(org => getVideos(org, { platform, sort, limit: 200 }), [platform, sort])
  return (
    <>
      <div className="row between">
        <h1>Vidéos</h1>
        <div className="row" style={{ gap: 8 }}>
          <label className="row muted small" style={{ gap: 8 }}>Plateforme
            <select className="select" style={{ width: 'auto' }} value={platform} onChange={e => setPlatform(e.target.value)}>
              <option value="">Toutes</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="instagram">Instagram</option>
            </select>
          </label>
          <Seg label="Tri" value={sort} onChange={setSort} options={[['recent', 'Récentes'], ['views', 'Plus vues']]} />
        </div>
      </div>
      {videos.error && <Msg kind="err">{videos.error}</Msg>}
      {!videos.data && videos.loading && <Loading />}
      {videos.data && videos.data.length === 0 && (
        <Empty title="Aucune vidéo pour l'instant">Les vidéos récentes de vos comptes apparaissent ici après le premier relevé des chiffres.</Empty>
      )}
      {videos.data && videos.data.length > 0 && (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 760 }}>
              <thead><tr>
                <th scope="col">Vidéo</th><th scope="col">Compte</th><th scope="col">Publiée</th>
                <th scope="col" className="r">Vues</th><th scope="col" className="r">J'aime</th><th scope="col" className="r">Commentaires</th>
                <th scope="col" className="r">Partages</th>
              </tr></thead>
              <tbody>
                {videos.data.map(v => (
                  <tr key={v.id}>
                    <td style={{ maxWidth: 340 }}>
                      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                        {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: 36, height: 48, objectFit: 'cover', borderRadius: 6, flex: 'none' }} />
                          : <span style={{ width: 36, height: 48, borderRadius: 6, background: 'var(--surface-2)', flex: 'none' }} />}
                        <div className="grow">
                          {v.url ? <a className="ellipsis" style={{ display: 'block', fontWeight: 500 }} href={v.url} target="_blank" rel="noreferrer">{v.title || 'Sans titre'}</a>
                            : <span className="ellipsis" style={{ display: 'block', fontWeight: 500 }}>{v.title || 'Sans titre'}</span>}
                          <span className="tiny muted">{fmtDuration(v.duration_sec)}{v.via_chapote && ' · publiée depuis Chapote'}</span>
                        </div>
                      </div>
                    </td>
                    <td><PlatformTag platform={v.platform} label={v.account_name || PLATFORM_LABEL[v.platform]} /></td>
                    <td className="small muted">{v.published_at ? fmtDate(v.published_at) : '—'}</td>
                    <td className="r">{num(v.views)}</td><td className="r">{num(v.likes)}</td>
                    <td className="r">{num(v.comments)}</td><td className="r">{num(v.shares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
