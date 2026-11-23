// Toutes les vidéos relevées sur les comptes du périmètre, avec leurs chiffres.
// Mobile : liste de cartes. Ordinateur : tableau complet triable.
import { useEffect, useRef, useState } from 'react'
import { PlatformLogo } from '../components/PlatformLogo'
import { getVideosPage, PLATFORM_LABEL, PLATFORMS, type Platform, type Video } from '../api'
import { Empty, Icon, Msg, PlatformTag, Skeleton } from '../components/ui'
import { fmtDate, fmtDuration, num, pct, short } from '../format'
import { useLoad, useSession } from '../session'

type Sort = 'recent' | 'views' | 'likes' | 'comments' | 'shares' | 'engagement'

export default function Videos() {
  const [platform, setPlatform] = useState<'' | Platform>('')
  const [sort, setSort] = useState<Sort>('recent')
  const { scope } = useSession()
  // Première page via le cache partagé, pages suivantes au défilement (curseur X-Next-Cursor).
  const first = useLoad(s => getVideosPage(s, { platform, sort, limit: 30 }), [platform, sort])
  const [more, setMore] = useState<Video[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => { setMore([]); setNext(first.data?.next ?? null) }, [first.data])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !next || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || busy || !next) return
      setBusy(true)
      try { const p = await getVideosPage(scope, { platform, sort, limit: 30, cursor: next }); setMore(m => [...m, ...p.items]); setNext(p.next) }
      catch { setNext(null) } finally { setBusy(false) }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, busy, scope, platform, sort])
  const videos = { ...first, data: first.data ? [...first.data.items, ...more] : null }
  const eng = (v: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }) =>
    v.views ? ((v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0)) / v.views : null
  return (
    <>
      <div className="page-head">
        <div><h1>Vidéos</h1><p>Relevées chez les plateformes, publiées ou non depuis Chapote.</p></div>
        <select className="select select-sm" aria-label="Classer par" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="recent">Plus récentes</option><option value="views">Plus vues</option><option value="engagement">Plus d’interactions</option>
          <option value="likes">Plus de j’aime</option><option value="comments">Plus commentées</option><option value="shares">Plus partagées</option>
        </select>
      </div>
      <div className="chips" role="group" aria-label="Plateforme">
        <button type="button" className="chip" aria-pressed={platform === ''} onClick={() => setPlatform('')}>Toutes</button>
        {PLATFORMS.map(p => (
          <button key={p} type="button" className="chip" aria-pressed={platform === p} onClick={() => setPlatform(p)}>
            <PlatformLogo platform={p} size={14} />{PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>
      {videos.error && <Msg kind="err">{videos.error}</Msg>}
      {!videos.data && videos.loading && <Skeleton h={86} n={5} />}
      {videos.data && videos.data.length === 0 && (
        <Empty title="Aucune vidéo pour l'instant" icon="video">Les vidéos de vos comptes apparaissent ici après le premier relevé des chiffres.</Empty>
      )}
      {videos.data && videos.data.length > 0 && (
        <>
          <ul className="list card card-flush list-pad only-mobile">
            {videos.data.map(v => (
              <li key={v.id} style={{ alignItems: 'flex-start' }}>
                {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={56} height={76} style={{ width: 56, height: 76, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />
                  : <span style={{ width: 56, height: 76, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }} />}
                <div className="grow col" style={{ gap: 4 }}>
                  {v.url ? <a className="strong clamp2" style={{ color: 'var(--text)' }} href={v.url} target="_blank" rel="noreferrer">{v.title || 'Sans titre'}</a>
                    : <span className="strong clamp2">{v.title || 'Sans titre'}</span>}
                  <span className="tiny muted row-nw" style={{ gap: 6 }}><span aria-hidden="true" className={`dot dot-${v.platform}`} /><span className="ellipsis">{v.account_name}</span>· {v.published_at ? fmtDate(v.published_at) : '—'}</span>
                  <span className="metrics">
                    <span><Icon name="eye" size={13} /> <b>{short(v.views)}</b></span>
                    <span><Icon name="heart" size={13} /> <b>{short(v.likes)}</b></span>
                    {v.comments != null && <span><Icon name="comment" size={13} /> <b>{short(v.comments)}</b></span>}
                    {v.shares != null && <span><Icon name="share" size={13} /> <b>{short(v.shares)}</b></span>}
                    {v.saves != null && <span><Icon name="bookmark" size={13} /> <b>{short(v.saves)}</b></span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <section className="card card-flush only-desktop">
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th scope="col">Vidéo</th><th scope="col">Compte</th><th scope="col">Publiée</th>
                  <th scope="col" className="r">Vues</th><th scope="col" className="r">J'aime</th><th scope="col" className="r">Commentaires</th>
                  <th scope="col" className="r">Partages</th><th scope="col" className="r">Enreg.</th><th scope="col" className="r">Engagement</th>
                </tr></thead>
                <tbody>
                  {videos.data.map(v => (
                    <tr key={v.id}>
                      <td style={{ maxWidth: 420 }}>
                        <div className="row-nw" style={{ gap: 12 }}>
                          {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={56} height={76} style={{ width: 38, height: 52, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                            : <span style={{ width: 38, height: 52, borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }} />}
                          <div className="grow">
                            {v.url ? <a className="ellipsis strong" style={{ display: 'block' }} href={v.url} target="_blank" rel="noreferrer">{v.title || 'Sans titre'}</a>
                              : <span className="ellipsis strong" style={{ display: 'block' }}>{v.title || 'Sans titre'}</span>}
                            <span className="tiny muted">{fmtDuration(v.duration_sec)}{v.via_chapote && ' · publiée depuis Chapote'}</span>
                          </div>
                        </div>
                      </td>
                      <td><PlatformTag platform={v.platform} label={v.account_name || PLATFORM_LABEL[v.platform]} /></td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{v.published_at ? fmtDate(v.published_at) : '—'}</td>
                      <td className="r strong">{num(v.views)}</td><td className="r">{num(v.likes)}</td>
                      <td className="r">{num(v.comments)}</td><td className="r">{num(v.shares)}</td><td className="r">{num(v.saves)}</td>
                      <td className="r">{pct(eng(v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
          {busy && <Skeleton h={72} n={2} />}
          {!next && videos.data.length > 30 && <p className="tiny muted" style={{ textAlign: 'center' }}>{videos.data.length} vidéos · fin de la liste</p>}
        </>
      )}
    </>
  )
}
