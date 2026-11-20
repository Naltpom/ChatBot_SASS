// Avis des acheteurs vérifiés sur la page d'un morceau, et formulaire pour noter (acheteurs connectés).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getAccount, getReviews, postReview, type Piece, type ReviewItem } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { Stars } from './ui'

export default function Reviews({ piece }: { piece: Piece }) {
  const { t, lang } = useI18n()
  const { me } = useAuth()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [owned, setOwned] = useState<{ sheet_id: number; label: string; my_rating: number | null }[]>([])
  const [sheet, setSheet] = useState<number | null>(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = (offset: number) => getReviews(piece.slug, offset).then(r => {
    setItems(prev => (offset ? [...prev, ...r.reviews] : r.reviews)); setTotal(r.total); setNext(r.next_offset)
  }).catch(() => {})
  useEffect(() => { load(0) }, [piece.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me) { setOwned([]); return }
    const ids = new Set(piece.sheets.map(s => s.id))
    getAccount().then(a => {
      const mine = a.sheets.filter(s => ids.has(s.sheet_id)).map(s => ({ sheet_id: s.sheet_id, label: s.instrument_label, my_rating: s.my_rating }))
      setOwned(mine)
      if (mine.length) { setSheet(mine[0].sheet_id); setRating(mine[0].my_rating || 0) }
    }).catch(() => {})
  }, [me, piece])

  const send = async () => {
    if (!sheet || !rating) return
    setMsg(null)
    try {
      await postReview(sheet, rating, comment)
      setMsg({ ok: true, text: t.reviewThanks })
      setComment('')
      load(0)
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).status === 403 ? t.reviewBuyersOnly : t.errGeneric })
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <section className="reviews" aria-labelledby="reviews-title">
      <div className="reviews-head">
        <h2 id="reviews-title">{t.reviews}</h2>
        {piece.rating != null && <span className="muted"><Stars value={piece.rating} small /> {t.rating(piece.rating.toFixed(1), piece.reviews)}</span>}
      </div>

      {owned.length > 0 ? (
        <div className="review-form">
          <b>{t.rateIt}</b>
          {owned.length > 1 && (
            <select className="field" value={sheet ?? ''} onChange={e => setSheet(Number(e.target.value))} aria-label={t.instrument}>
              {owned.map(o => <option key={o.sheet_id} value={o.sheet_id}>{o.label}</option>)}
            </select>
          )}
          <Stars value={rating} onPick={setRating} label={t.rateIt} />
          <textarea className="field" rows={3} maxLength={2000} placeholder={t.reviewPlaceholder} value={comment} onChange={e => setComment(e.target.value)} />
          {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
          <button type="button" className="btn small" onClick={send} disabled={!rating}>{t.send}</button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>{me ? t.reviewBuyersOnly : <><Link to="/account">{t.signIn}</Link> — {t.reviewSignIn}</>}</p>
      )}

      {total === 0 ? <p className="muted">{t.noReviews}</p> : (
        <ul className="review-list">
          {items.map(r => (
            <li key={r.id}>
              <div className="review-top"><Stars value={r.rating} small label={t.stars(r.rating)} /><b>{r.author}</b>
                <span className="muted">· {t.verifiedBuyer} · {r.instrument_label} · {date(r.date)}</span></div>
              {r.comment && <p>{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
      {next != null && <button type="button" className="btn ghost small" onClick={() => load(next)}>{t.more}</button>}
    </section>
  )
}
