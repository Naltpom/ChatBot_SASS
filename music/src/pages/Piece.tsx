import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, getPiece, type Piece } from '../api'
import { useCart } from '../cart'
import { compact, useI18n } from '../i18n'
import { Price, useMoney } from '../money'
import { Center, Icon, Paper, Stars } from '../components/ui'
import { PlayBar, SheetCursor, useScorePlayer } from '../components/Player'
import Reviews from '../components/Reviews'

export default function PiecePage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const { t, lang } = useI18n()
  const { eur: euros } = useMoney()
  const cart = useCart()
  const [piece, setPiece] = useState<Piece | null>(null)
  const [error, setError] = useState<'gone' | 'net' | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [page, setPage] = useState(0)
  const [added, setAdded] = useState(false)
  const gallery = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setPiece(null); setError(null)
    getPiece(slug).then(p => {
      if (!alive) return
      setPiece(p)
      document.title = `${p.title} — sheet music · Ghost Hands`
      const wanted = params.get('i')
      const first = p.sheets.find(s => s.instrument === wanted) || p.sheets[0]
      setPicked([first.id])
    }).catch((e: ApiError) => alive && setError(e.status === 404 ? 'gone' : 'net'))
    return () => { alive = false }
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // aperçu montré : la première partition choisie
  const shown = useMemo(() => piece?.sheets.find(s => picked.includes(s.id)) || piece?.sheets[0], [piece, picked])
  useEffect(() => { setPage(0); gallery.current?.scrollTo({ left: 0 }) }, [shown?.id])
  const player = useScorePlayer(shown?.id ?? 0)
  // pendant la lecture, la galerie suit la page du curseur
  useEffect(() => player.subscribe((_, pos) => {
    const el = gallery.current
    if (!el || !pos || !player.playing) return
    const w = el.scrollWidth / Math.max(1, el.children.length)
    if (Math.round(el.scrollLeft / w) !== pos.page) el.scrollTo({ left: pos.page * w, behavior: 'smooth' })
  }), [player.playing, player.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Center><p>{error === 'gone' ? t.pieceGone : t.errNetwork}</p><Link to="/">{t.backHome}</Link></Center>
  if (!piece || !shown) return <Center>{t.loading}</Center>

  const chosen = piece.sheets.filter(s => picked.includes(s.id))
  const list = chosen.reduce((a, s) => a + s.price_cents, 0)
  const bundle = piece.pricing?.bundle_cents
  const total = chosen.length >= 2 && bundle != null && bundle < list ? bundle : list
  const allList = piece.sheets.reduce((a, s) => a + s.price_cents, 0)
  const toLines = () => chosen.map(s => ({ id: s.id, label: `${piece.title} — ${s.instrument_label}` }))
  const toggle = (id: number) => setPicked(p => (p.includes(id) ? (p.length > 1 ? p.filter(x => x !== id) : p) : [...p, id]))
  const buy = () => cart.openSheet(toLines())
  const addCart = () => { cart.add(toLines()); setAdded(true); setTimeout(() => setAdded(false), 1800) }

  const onScroll = () => {
    const el = gallery.current
    if (!el) return
    const w = el.scrollWidth / Math.max(1, shown.pages)
    setPage(Math.min(shown.pages - 1, Math.round(el.scrollLeft / w)))
  }

  return (
    <main className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">{t.allSheetsLink}</Link> › <span>{piece.title}</span></nav>
      <div className="piece">
        <section className="piece-gallery" aria-label={t.freePreview}>
          <div className="gallery" ref={gallery} onScroll={onScroll}>
            {shown.pages_preview.map((src, i) => (
              <div className="page" key={src}>
                <div className="sheet-wrap">
                  <Paper src={src} alt={t.pageOf(i + 1, shown.pages)} title={piece.title} />
                  {shown.has_notes && <SheetCursor player={player} page={i} />}
                </div>
                {i > 0 && <div className="lock"><span>{t.locked(2, shown.pages)}</span></div>}
              </div>
            ))}
          </div>
          {shown.pages > 1 && <div className="dots" aria-hidden="true">{shown.pages_preview.map((_, i) => <i key={i} className={i === page ? 'on' : ''} />)}</div>}
          <p className="page-note">{t.pageOf(page + 1, shown.pages)} · {page === 0 ? t.freePreview : t.locked(2, shown.pages)}</p>
          {shown.has_notes && <PlayBar player={player} title={`${piece.title} — ${shown.instrument_label}`} />}
        </section>

        <section className="piece-buy">
          {piece.sheets.some(s => s.released_at && Date.now() - Date.parse(s.released_at) < 7 * 864e5) && <span className="new-tag">{t.isNew}</span>}
          <h1>{piece.title}</h1>
          <p className="piece-sub">{[piece.composer, piece.public_domain ? t.publicDomain : null].filter(Boolean).join(' · ')}</p>
          <div className="social">
            {piece.rating != null && <span><Stars value={piece.rating} small /> {t.rating(piece.rating.toFixed(1), piece.reviews)}</span>}
            {piece.downloads > 0 && <span>↓ {t.downloads(piece.downloads)}</span>}
          </div>
          {(shown.likes != null || shown.reel_url) && (
            <a className="likes-pill" href={shown.reel_url || undefined} target="_blank" rel="noreferrer">
              {shown.likes != null && <span className="likes-n">{Icon.heart}<b>{compact(shown.likes, lang)}</b> {t.likes('').trim()}</span>}
              {shown.reel_url && <span className="likes-go">{t.watchOn}</span>}
            </a>
          )}

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="sr">{t.instrument}</legend>
            <div className="ins-list">
              {piece.sheets.map(s => {
                const on = picked.includes(s.id)
                return (
                  <label key={s.id} className={`ins ${on ? 'on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                    <span className="name"><b>{s.instrument_label}</b><small>{t.pages(s.pages)} · PDF</small></span>
                    <span className="price"><Price cents={s.price_cents} /></span>
                  </label>
                )
              })}
            </div>
            {piece.sheets.length > 1 && bundle != null && bundle < allList && (
              <p className="bundle-note">{t.bundle(euros(bundle), euros(allList))}</p>
            )}
          </fieldset>

          <div className="desk-buy">
            <button type="button" className="btn block" onClick={buy}>{chosen.length > 1 ? t.getSheets : t.getSheet} · {euros(total)}</button>
            <button type="button" className="btn ghost block" onClick={addCart}>{added ? t.added : t.addToCart}</button>
          </div>

          <ul className="perks">
            <li>{Icon.dl}{t.instant}</li>
            <li>{Icon.note}{t.exact}</li>
            <li>{Icon.lock}{t.secure}</li>
          </ul>

          <section className="details">
            <h2>{t.details}</h2>
            <dl>
              <dt>{t.format}</dt><dd>{t.formatV}</dd>
              <dt>{t.source}</dt><dd>{t.sourceV}</dd>
              <dt>{t.useL}</dt><dd>{t.useV}</dd>
            </dl>
          </section>
        </section>
      </div>

      <Reviews piece={piece} />

      <div className="buybar">
        <div className="p"><small>{chosen.map(s => s.instrument_label).join(' + ')}</small><b><Price cents={total} /></b></div>
        <button type="button" className="btn" onClick={buy}>{chosen.length > 1 ? t.getSheets : t.getSheet}</button>
      </div>
    </main>
  )
}
