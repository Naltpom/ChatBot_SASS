// Toutes les vidéos relevées sur les comptes du périmètre, avec leurs chiffres.
// Recherche et tri (dans les deux sens) faits par l'API, pages au défilement.
// Mobile : liste de cartes + tri. Ordinateur : tableau aux en-têtes triables.
import { StatsTabs } from '../components/StatsTabs'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LiveCount, SearchBox, SortControl, SortTh, useListState, useMorePages } from '../components/list'
import { PlatformLogo } from '../components/PlatformLogo'
import { getVideosPage, PLATFORM_LABEL, PLATFORMS, type Platform } from '../api'
import { Empty, Icon, Msg, PlatformTag, Skeleton } from '../components/ui'
import { fmtDate, fmtDuration, num, pct, short } from '../format'
import { useLoad, useSession } from '../session'
import { t } from '../i18n'

type Sort = 'recent' | 'views' | 'likes' | 'comments' | 'shares' | 'engagement' | 'title'
const SORTS: [Sort, string][] = [['recent', 'Date de publication'], ['views', 'Vues'], ['engagement', 'Interactions'],
  ['likes', 'J’aime'], ['comments', 'Commentaires'], ['shares', 'Partages'], ['title', 'Titre']]

export default function Videos() {
  const [platform, setPlatform] = useState<'' | Platform>('')
  const list = useListState<Sort>('recent', s => (s === 'title' ? 'asc' : 'desc'))
  const { scope } = useSession()
  const opts = { platform, sort: list.sort, order: list.order, q: list.q || undefined, limit: 30 }
  // Première page via le cache partagé, pages suivantes au défilement (curseur X-Next-Cursor).
  const first = useLoad(s => getVideosPage(s, opts), [platform, list.sort, list.order, list.q])
  const pages = useMorePages(first.data, cursor => getVideosPage(scope, { ...opts, cursor }), [scope, platform, list.sort, list.order, list.q])
  const { next, busy, sentinel } = pages
  const videos = { ...first, data: pages.items }
  const eng = (v: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }) =>
    v.views ? ((v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0)) / v.views : null
  return (
    <>
      <div className="page-head">
        <div><h1>{t('Statistiques')}</h1><p>{t('Toutes les vidéos relevées chez les plateformes, publiées ou non depuis Chapote.')}</p></div>
      </div>
      <StatsTabs />
      <div className="listbar">
        <SearchBox value={list.input} onChange={list.setInput} label={t('Rechercher une vidéo (titre)')} />
        <span className="only-mobile sortctl"><SortControl list={list} options={SORTS.map(([v, l]) => [v, t(l)] as [Sort, string])} /></span>
      </div>
      <LiveCount n={videos.data?.length ?? null} more={!!next} what={t('vidéos')} />
      <div className="chips" role="group" aria-label={t('Plateforme')}>
        <button type="button" className="chip" aria-pressed={platform === ''} onClick={() => setPlatform('')}>{t('Toutes')}</button>
        {PLATFORMS.map(p => (
          <button key={p} type="button" className="chip" aria-pressed={platform === p} onClick={() => setPlatform(p)}>
            <PlatformLogo platform={p} size={14} />{PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>
      {videos.error && <Msg kind="err">{videos.error}</Msg>}
      {!videos.data && videos.loading && <Skeleton h={86} n={5} />}
      {videos.data && videos.data.length === 0 && (
        list.q ? <Empty title={t('Aucune vidéo trouvée')} icon="search">{t('Aucun titre ne contient « {q} ».', { q: list.q })}</Empty>
          : <Empty title={t("Aucune vidéo pour l'instant")} icon="video">{t('Les vidéos de vos comptes apparaissent ici après le premier relevé des chiffres.')}</Empty>
      )}
      {videos.data && videos.data.length > 0 && (
        <>
          <ul className="list card card-flush list-pad only-mobile">
            {videos.data.map(v => (
              <li key={v.id} style={{ alignItems: 'flex-start' }}>
                {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={56} height={76} style={{ width: 56, height: 76, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />
                  : <span style={{ width: 56, height: 76, borderRadius: 10, background: 'var(--surface-2)', flex: 'none' }} />}
                <div className="grow col" style={{ gap: 4 }}>
                  {v.id ? <Link className="strong clamp2" style={{ color: 'var(--text)' }} to={`/videos/${v.id}`}>{v.title || t('Sans titre')}</Link>
                    : <span className="strong clamp2">{v.title || t('Sans titre')}</span>}
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
                  <SortTh col="title" list={list}>{t('Vidéo')}</SortTh><th scope="col">{t('Compte')}</th><SortTh col="recent" list={list}>{t('Publiée')}</SortTh>
                  <SortTh col="views" list={list} right>{t('Vues')}</SortTh><SortTh col="likes" list={list} right>{t("J'aime")}</SortTh><SortTh col="comments" list={list} right>{t('Commentaires')}</SortTh>
                  <SortTh col="shares" list={list} right>{t('Partages')}</SortTh><th scope="col" className="r">{t('Enreg.')}</th><SortTh col="engagement" list={list} right>{t('Interactions')}</SortTh>
                </tr></thead>
                <tbody>
                  {videos.data.map(v => (
                    <tr key={v.id}>
                      <td style={{ maxWidth: 420 }}>
                        <div className="row-nw" style={{ gap: 12 }}>
                          {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" width={56} height={76} style={{ width: 38, height: 52, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                            : <span style={{ width: 38, height: 52, borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }} />}
                          <div className="grow">
                            {v.id ? <Link className="ellipsis strong" style={{ display: 'block' }} to={`/videos/${v.id}`}>{v.title || t('Sans titre')}</Link>
                              : <span className="ellipsis strong" style={{ display: 'block' }}>{v.title || t('Sans titre')}</span>}
                            <span className="tiny muted">{fmtDuration(v.duration_sec)}{v.via_chapote && ` · ${t('publiée depuis Chapote')}`}</span>
                          </div>
                        </div>
                      </td>
                      <td><PlatformTag platform={v.platform} label={v.account_name || PLATFORM_LABEL[v.platform]} /></td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{v.published_at ? fmtDate(v.published_at) : '—'}</td>
                      <td className="r strong">{num(v.views)}</td><td className="r">{num(v.likes)}</td>
                      <td className="r">{num(v.comments)}</td><td className="r">{num(v.shares)}</td><td className="r">{num(v.saves)}</td>
                      <td className="r" title={eng(v) != null ? t('Taux d’engagement {rate}', { rate: pct(eng(v)) }) : undefined}>{num((v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
          {busy && <Skeleton h={72} n={2} />}
          {!next && videos.data.length > 30 && <p className="tiny muted" style={{ textAlign: 'center' }}>{t('{n} vidéos · fin de la liste', { n: videos.data.length })}</p>}
        </>
      )}
    </>
  )
}
