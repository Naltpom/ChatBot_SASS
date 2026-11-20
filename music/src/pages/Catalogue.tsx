import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCatalog, type Catalog, type Piece } from '../api'
import { compact, useI18n } from '../i18n'
import { Price } from '../money'
import { Center, Icon, Paper } from '../components/ui'

const PAGE = 24

export default function CataloguePage() {
  const { t, lang } = useI18n()
  const [pieces, setPieces] = useState<Piece[]>([])
  const [meta, setMeta] = useState<Pick<Catalog, 'instruments' | 'total' | 'next_offset'> | null>(null)
  const [hero, setHero] = useState<Piece[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [ins, setIns] = useState('')
  const [sort, setSort] = useState('new')
  const gen = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)

  const load = useCallback(async (offset: number) => {
    const g = offset === 0 ? ++gen.current : gen.current
    setLoading(true)
    try {
      const d = await getCatalog({ q: q.trim(), instrument: ins, offset, limit: PAGE, sort })
      if (g !== gen.current) return
      setPieces(prev => (offset === 0 ? d.pieces : [...prev, ...d.pieces]))
      setMeta({ instruments: d.instruments, total: d.total, next_offset: d.next_offset })
      if (offset === 0 && !q && !ins && sort === 'new') setHero(d.pieces.slice(0, 3))
      setError(false)
    } catch {
      if (g === gen.current) setError(true)
    } finally {
      if (g === gen.current) setLoading(false)
    }
  }, [q, ins, sort])

  useEffect(() => {
    const h = setTimeout(() => load(0), q ? 250 : 0)
    return () => clearTimeout(h)
  }, [load, q])

  // défilement infini : la page suivante se charge quand la fin de la grille approche
  useEffect(() => {
    const el = sentinel.current
    if (!el || meta?.next_offset == null) return
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && meta?.next_offset != null) load(meta.next_offset)
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [meta?.next_offset, loading, load])

  const filtered = !!(q || ins)

  return (
    <main>
      <div className="announce">{t.announce} · <a href="#catalogue">{t.seeNew} ›</a></div>
      <section className="hero">
        <h1>{t.heroTitle1}<br /><span>{t.heroTitle2}</span></h1>
        <p>{t.heroText}</p>
        <div className="hero-ctas">
          <a className="btn" href="#catalogue">{t.shop}</a>
          <a className="link-more" href="https://www.instagram.com/ghosthands.music/" target="_blank" rel="noreferrer">{t.watchReels}</a>
        </div>
        {hero.length > 0 && (
          <div className="vitrine" aria-hidden="true">
            {hero[1] && <div className="side"><Paper src={hero[1].sheets[0].preview} title={hero[1].title} /></div>}
            <div className="mid"><Paper src={hero[0].sheets[0].preview} title={hero[0].title} /></div>
            {hero[2] && <div className="side"><Paper src={hero[2].sheets[0].preview} title={hero[2].title} /></div>}
          </div>
        )}
      </section>

      <div className="wrap" id="catalogue">
        <div className="toolbar section">
          <label htmlFor="q" className="sr">{t.search}</label>
          <input id="q" className="search" type="search" placeholder={t.search} value={q} onChange={e => setQ(e.target.value)} />
          {meta && meta.instruments.length > 1 && (
            <div className="chips" role="group" aria-label={t.instrument}>
              <button type="button" className="chip" aria-pressed={ins === ''} onClick={() => setIns('')}>{t.all}</button>
              {meta.instruments.map(i => (
                <button type="button" key={i.key} className="chip" aria-pressed={ins === i.key} onClick={() => setIns(i.key)}>{i.label}</button>
              ))}
            </div>
          )}
        </div>

        <section className="section">
          <div className="grid-head">
            <h2>{filtered ? t.results(meta?.total ?? 0) : <>{t.allSheets} <span>{t.newWeekSub}</span></>}</h2>
            <label className="sort">
              <span className="sr">{t.sortLabel}</span>
              <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t.sortLabel}>
                <option value="new">{t.sortNew}</option>
                <option value="popular">{t.sortPopular}</option>
                <option value="az">{t.sortAz}</option>
              </select>
            </label>
          </div>
          {error && !pieces.length ? <Center>{t.errNetwork}</Center>
            : !meta ? <Center>{t.loading}</Center>
            : pieces.length === 0 ? <p className="empty">{t.noResult}</p> : (
            <div className="grid">
              {pieces.map(p => {
                const many = p.sheets.length > 1
                return (
                  <Link key={p.slug} to={`/s/${p.slug}`} className="card">
                    <div className="card-tile">
                      <Paper src={p.sheets[0].preview} title={p.title} />
                      <span className="card-tags">
                        {p.is_new && <span className="card-new">{t.isNew}</span>}
                        <span className="card-ins">{p.sheets.map(s => s.instrument_label).join(' · ')}</span>
                      </span>
                    </div>
                    <div className="card-meta">
                      <span className="card-title">{p.title}</span>
                      <span className="card-sub">{[p.composer, t.pages(p.sheets[0].pages)].filter(Boolean).join(' · ')}</span>
                      <span className="card-foot">
                        <span className="card-price"><Price cents={p.from_cents} prefix={many ? t.from : undefined} /></span>
                        <span className="card-social">
                          {p.rating != null && <span title={t.rating(p.rating.toFixed(1), p.reviews)}>{Icon.star}{p.rating.toFixed(1)}</span>}
                          {p.likes != null && <span title="Instagram">{Icon.heart}{compact(p.likes, lang)}</span>}
                        </span>
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
          {loading && pieces.length > 0 && <p className="empty" style={{ textAlign: 'center' }}>{t.loadingMore}</p>}
        </section>

        <section className="values">
          <div>{Icon.note}<h3>{t.v1t}</h3><p>{t.v1}</p></div>
          <div>{Icon.eye}<h3>{t.v2t}</h3><p>{t.v2}</p></div>
          <div>{Icon.dl}<h3>{t.v3t}</h3><p>{t.v3}</p></div>
          <div>{Icon.lock}<h3>{t.v4t}</h3><p>{t.v4}</p></div>
        </section>
      </div>
    </main>
  )
}
