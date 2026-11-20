import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCatalog, type Catalog } from '../api'
import { euros, useI18n } from '../i18n'
import { Center, Icon, Paper } from '../components/ui'

export default function CataloguePage() {
  const { t } = useI18n()
  const [data, setData] = useState<Catalog | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [ins, setIns] = useState('')

  useEffect(() => {
    let alive = true
    const h = setTimeout(() => {
      getCatalog(q.trim(), ins).then(d => { if (alive) { setData(d); setError(false) } }).catch(() => alive && setError(true))
    }, q ? 250 : 0)
    return () => { alive = false; clearTimeout(h) }
  }, [q, ins])

  const pieces = data?.pieces || []
  const hero = pieces.slice(0, 3)
  const filtered = !!(q || ins)
  const fresh = filtered ? [] : pieces.filter(p => p.is_new)
  const rest = filtered ? pieces : pieces.filter(p => !p.is_new)

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
          {data && data.instruments.length > 1 && (
            <div className="chips" role="group" aria-label={t.instrument}>
              <button type="button" className="chip" aria-pressed={ins === ''} onClick={() => setIns('')}>{t.all}</button>
              {data.instruments.map(i => (
                <button type="button" key={i.key} className="chip" aria-pressed={ins === i.key} onClick={() => setIns(i.key)}>{i.label}</button>
              ))}
            </div>
          )}
        </div>

        {error ? <Center>{t.errNetwork}</Center> : !data ? <Center>{t.loading}</Center> : (
          <>
            {fresh.length > 0 && (
              <section className="section">
                <h2>{t.newWeek} <span>{t.newWeekSub}</span></h2>
                <Grid pieces={fresh} />
              </section>
            )}
            <section className="section">
              {(rest.length > 0 || filtered) && <h2>{filtered ? t.results(pieces.length) : t.allSheets}</h2>}
              {pieces.length === 0 ? <p className="empty">{t.noResult}</p> : <Grid pieces={rest} />}
            </section>
          </>
        )}

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

function Grid({ pieces }: { pieces: Catalog['pieces'] }) {
  const { t } = useI18n()
  return (
    <div className="grid">
      {pieces.map(p => {
        const labels = p.sheets.map(s => s.instrument_label).join(' · ')
        const many = p.sheets.length > 1
        return (
          <Link key={p.slug} to={`/s/${p.slug}`} className="card">
            <div className="card-tile">
              {p.is_new && <span className="card-new">{t.isNew}</span>}
              <Paper src={p.sheets[0].preview} title={p.title} />
            </div>
            <div className="card-meta">
              <span className="card-ins">{labels}</span>
              <span className="card-title">{p.title}</span>
              <span className="card-sub">{[p.composer, t.pages(p.sheets[0].pages)].filter(Boolean).join(' · ')}</span>
              <span className="card-price">{many ? `${t.from} ` : ''}{euros(p.from_cents)}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
