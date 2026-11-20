// Feuille d'achat : récapitulatif, code promo, e-mail, consentement, paiement.
// Le prix affiché vient TOUJOURS du back (/api/music/quote) ; le paiement
// part vers Stripe Checkout (ou directement vers la page « merci » si gratuit).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, postCheckout, postQuote, type Quote } from '../api'
import { useCart } from '../cart'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { useMoney } from '../money'
import { Icon, Paper } from './ui'

export default function CheckoutSheet() {
  const { t, lang } = useI18n()
  const { eur: euros, approx, currency } = useMoney()
  const cart = useCart()
  const lines = cart.sheet
  const [quote, setQuote] = useState<Quote | null>(null)
  const [promo, setPromo] = useState('')
  const [appliedPromo, setAppliedPromo] = useState('')
  const { me } = useAuth()
  const [email, setEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  const [consent, setConsent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)

  const ids = (lines || []).map(l => l.id)
  const key = ids.join(',')

  useEffect(() => {
    if (!lines) return
    setErr('')
    if (ids.length === 0) { setQuote(null); return }
    let alive = true
    postQuote(ids, appliedPromo).then(q => { if (alive) setQuote(q) })
      .catch((e: ApiError) => { if (alive) { setQuote(null); setErr(e.code === 'network' ? t.errNetwork : t.errGeneric) } })
    return () => { alive = false }
  }, [key, appliedPromo, lines === null]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (me && !email) setEmail(me.email) }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lines) return
    dialog.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cart.closeSheet() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [lines === null]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lines) return null

  const free = quote?.total_cents === 0
  const promoError = quote?.promo_error ? (t.promoErr[quote.promo_error] || t.errGeneric) : ''

  const pay = async () => {
    setErr('')
    if (!consent) { setErr(t.needConsent); return }
    if (free && !email.trim()) { setErr(t.emailRequired); return }
    setBusy(true)
    try {
      const r = await postCheckout({ sheet_ids: ids, promo_code: quote?.promo_code || undefined, email: email.trim() || undefined,
                                    instagram: instagram.trim() || undefined, consent, lang })
      // l'achat est parti : on retire ces partitions du panier
      ids.forEach(id => cart.lines.some(l => l.id === id) && cart.remove(id))
      window.location.assign(r.redirect)
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.code === 'network' ? t.errNetwork : ae.code === 'amount_too_low' ? t.minAmount
        : ae.code === 'instagram_invalid' ? t.igLabel
        : t.promoErr[ae.code] || t.errGeneric)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) cart.closeSheet() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} ref={dialog}>
        <span className="grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="sheet-title">{t.yourOrder}</h2>
          <button type="button" className="round" onClick={cart.closeSheet} aria-label={t.close}>{Icon.close}</button>
        </div>

        {lines.length === 0 ? <p style={{ color: 'var(--mut)', margin: 0 }}>{t.empty}</p> : (
          <>
            {lines.map(l => {
              const q = quote?.lines.find(x => x.sheet_id === l.id)
              return (
                <div className="line" key={l.id}>
                  <div className="thumb"><Paper src={`/api/music/sheets/${l.id}/pages/1.png`} /></div>
                  <div className="info"><b>{l.label}</b><small>PDF</small></div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{q ? euros(q.list_cents) : '…'}</div>
                    <button type="button" className="rm" onClick={() => cart.remove(l.id)}>{t.remove}</button>
                  </div>
                </div>
              )
            })}

            <details className="promo" open={!!appliedPromo}>
              <summary>{t.promo}</summary>
              <div className="promo-row">
                <label htmlFor="promo" className="sr">{t.code}</label>
                <input id="promo" className="field" value={promo} placeholder={t.code} autoCapitalize="characters"
                       onChange={e => setPromo(e.target.value.toUpperCase())} />
                <button type="button" className="btn dark small" onClick={() => setAppliedPromo(promo.trim())}>{t.apply}</button>
              </div>
              {appliedPromo && quote && !quote.promo_error && <div className="msg ok" style={{ marginTop: 8 }}>{t.promoOk(appliedPromo)}</div>}
              {promoError && <div className="msg err" style={{ marginTop: 8 }}>{promoError}</div>}
            </details>

            <div>
              <label htmlFor="email" className="field-label">{free ? t.emailRequired : t.emailLabel}</label>
              <input id="email" className="field" type="email" inputMode="email" autoComplete="email" value={email}
                     onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              {!free && <span className="field-hint">{t.emailHint}</span>}
            </div>

            <div>
              <label htmlFor="ig" className="field-label">{t.igLabel}</label>
              <input id="ig" className="field" autoComplete="off" autoCapitalize="none" spellCheck={false} value={instagram}
                     onChange={e => setInstagram(e.target.value)} placeholder="@" />
              <span className="field-hint">{t.igHint}</span>
            </div>

            {quote && (
              <div className="sum">
                {quote.bundle_savings_cents > 0 && <div><span>{t.bundleSaving}</span><span>−{euros(quote.bundle_savings_cents)}</span></div>}
                {quote.discount_cents > 0 && <div><span>{t.discount} {quote.promo_code}</span><span>−{euros(quote.discount_cents)}</span></div>}
                <div className="tot"><span>{t.total}</span><b>{euros(quote.total_cents)}</b></div>
                {approx(quote.total_cents) && <div className="fx"><span /><span>{approx(quote.total_cents)}</span></div>}
              </div>
            )}

            <label className="consent">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>{t.consent} <Link to="/legal/terms" onClick={cart.closeSheet}>{t.consentLink}</Link>.</span>
            </label>

            {err && <div className="msg err" role="alert">{err}</div>}

            <button type="button" className="btn block" onClick={pay} disabled={busy || !quote}>
              {busy ? '…' : free ? t.getFree : t.pay(quote ? euros(quote.total_cents) : '')}
            </button>
            {!free && <p className="hint">{t.payHint}{currency ? ` · ${t.fxNote(currency)}` : ''}</p>}
          </>
        )}
      </div>
    </div>
  )
}
