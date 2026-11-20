import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, getPiece, type Piece } from '../api'
import { useCart } from '../cart'
import { compact, useI18n } from '../i18n'
import { Price, useMoney } from '../money'
import { Center, Icon, Paper, Stars } from '../components/ui'
import { PlayBar, SheetCursor, useScorePlayer } from '../components/Player'
import Reviews from '../components/Reviews'
import { track } from '../track'

export default function PiecePage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
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
      const buyable = p.sheets.filter(s => s.published !== false && !s.owned)
      // une partition qu'on a déjà s'affiche d'abord (on arrive souvent de « Mes partitions ») ; la première en vente reste cochée
      const first = p.sheets.find(s => s.instrument === wanted) || p.sheets.find(s => s.owned) || buyable[0] || p.sheets[0]
      setPicked(first.published !== false && !first.owned ? [first.id] : [first.id, ...(buyable[0] ? [buyable[0].id] : [])])
    }).catch((e: ApiError) => {
      if (!alive) return
      // fiche privée : on renvoie au catalogue sans rien dire de son existence
      if (e.status === 404 && e.code === 'private') { navigate('/', { replace: true }); return }
      setError(e.status === 404 ? 'gone' : 'net')
    })
    return () => { alive = false }
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // aperçu montré : la première partition choisie
  const shown = useMemo(() => piece?.sheets.find(s => s.id === picked[0]) || piece?.sheets[0], [piece, picked])
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

  const canBuy = (s: Piece['sheets'][number]) => s.published !== false && !s.owned
  const buyable = piece.sheets.filter(canBuy)
  const chosen = buyable.filter(s => picked.includes(s.id))
  const list = chosen.reduce((a, s) => a + s.price_cents, 0)
  const bundle = piece.pricing?.bundle_cents
  const total = chosen.length >= 2 && bundle != null && bundle < list ? bundle : list
  const allList = buyable.reduce((a, s) => a + s.price_cents, 0)
  const pages = shown.pages_full || shown.pages_preview
  const full = !!shown.pages_full
  const toLines = () => chosen.map(s => ({ id: s.id, label: `${piece.title} — ${s.instrument_label}` }))
  const toggle = (id: number) => setPicked(p => (p.includes(id) ? (p.length > 1 ? p.filter(x => x !== id) : p) : [...p, id]))
  const view = (id: number) => setPicked(p => [id, ...p.filter(x => x !== id)])
  const ev = () => ({ piece: piece.slug, sheets: chosen.map(s => s.instrument), cents: total })
  const buy = () => { track('checkout_open', ev()); cart.openSheet(toLines()) }
  const addCart = () => { track('add_to_cart', ev()); cart.add(toLines()); setAdded(true); setTimeout(() => setAdded(false), 1800) }

  const onScroll = () => {
    const el = gallery.current
    if (!el) return
    const w = el.scrollWidth / Math.max(1, pages.length)
    setPage(Math.min(pages.length - 1, Math.round(el.scrollLeft / w)))
  }

  return (
    <main className="wrap">
      {piece.private && <div className="private-banner" role="status">{Icon.lock}<span>{piece.admin ? t.privateAdmin : t.privateOwner}</span></div>}
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">{t.allSheetsLink}</Link> › <span>{piece.title}</span></nav>
      <div className="piece">
        <section className="piece-gallery" aria-label={full ? t.fullSheet : t.freePreview}>
          {shown.has_notes && <PlayBar player={player} title={`${piece.title} — ${shown.instrument_label}`} />}
          <div className="gallery" ref={gallery} onScroll={onScroll}>
            {pages.map((src, i) => (
              <div className="page" key={src}>
                <div className="sheet-wrap">
                  <Paper src={src} alt={t.pageOf(i + 1, shown.pages)} title={piece.title} />
                  {shown.has_notes && <SheetCursor player={player} page={i} />}
                </div>
                {i > 0 && !full && <div className="lock"><span>{t.locked(2, shown.pages)}</span></div>}
              </div>
            ))}
          </div>
          {pages.length > 1 && <div className="dots" aria-hidden="true">{pages.map((_, i) => <i key={i} className={i === page ? 'on' : ''} />)}</div>}
          <p className="page-note">{t.pageOf(page + 1, shown.pages)} · {full ? t.fullSheet : page === 0 ? t.freePreview : t.locked(2, shown.pages)}</p>
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
            <a className="likes-pill" href={shown.reel_url || undefined} target="_blank" rel="noreferrer" onClick={() => track('reel_click', { piece: piece.slug })}>
              {shown.likes != null && <span className="likes-n">{Icon.heart}<b>{compact(shown.likes, lang)}</b> {t.likes('').trim()}</span>}
              {shown.reel_url && <span className="likes-go">{t.watchOn}</span>}
            </a>
          )}

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="sr">{t.instrument}</legend>
            <div className="ins-list">
              {piece.sheets.map(s => {
                if (!canBuy(s)) {
                  const seen = shown.id === s.id
                  return (
                    <button type="button" key={s.id} className={`ins ins-owned ${seen ? 'on' : ''}`} onClick={() => view(s.id)}>
                      <span className="tick" aria-hidden="true">{s.owned ? '✓' : Icon.lock}</span>
                      <span className="name"><b>{s.instrument_label}</b><small>{t.pages(s.pages)} · PDF</small></span>
                      <span className="price muted">{s.owned ? <Link to="/account" onClick={e => e.stopPropagation()}>{t.mySheets} ›</Link> : t.notForSale}</span>
                    </button>
                  )
                }
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
            {buyable.length > 1 && bundle != null && bundle < allList && (
              <p className="bundle-note">{t.bundle(euros(bundle), euros(allList))}</p>
            )}
          </fieldset>

          {piece.sheets.some(s => s.owned) && <p className="own-note">✓ {t.youOwn}</p>}
          {chosen.length > 0 && <div className="desk-buy">
            <button type="button" className="btn block" onClick={buy}>{chosen.length > 1 ? t.getSheets : t.getSheet} · {euros(total)}</button>
            <button type="button" className="btn ghost block" onClick={addCart}>{added ? t.added : t.addToCart}</button>
          </div>}

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

      {chosen.length > 0 && <div className="buybar">
        <div className="p"><small>{chosen.map(s => s.instrument_label).join(' + ')}</small><b><Price cents={total} /></b></div>
        <button type="button" className="btn" onClick={buy}>{chosen.length > 1 ? t.getSheets : t.getSheet}</button>
      </div>}
    </main>
  )
}
