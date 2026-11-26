// Feuille d'achat : récapitulatif, code promo, e-mail, consentement, paiement.
// Le prix affiché vient TOUJOURS du back (/api/music/quote) ; le paiement
// part vers Stripe Checkout (ou directement vers la page « merci » si gratuit).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, postCheckout, postQuote, type Quote } from '../api'
import { useCart } from '../cart'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { useMoney } from '../money'
import { savedPromo, track, trackCode, trackingOn } from '../track'
import { Icon, Paper } from './ui'

export default function CheckoutSheet() {
  const { t, lang } = useI18n()
  const { eur: euros, approx, currency } = useMoney()
  const cart = useCart()
  const lines = cart.sheet
  const [quote, setQuote] = useState<Quote | null>(null)
  // code reçu dans le lien (?code=INSTA20) : appliqué tout seul
  const [promo, setPromo] = useState('')
  // codes appliqués (2 au plus) ; celui du lien (?code=INSTA20) est déjà là
  const [codes, setCodes] = useState<string[]>(() => (savedPromo() ? [savedPromo()] : []))
  const appliedPromo = codes.join('+')
  // champ caché derrière « J'ai un code promo » (ou « un autre code » s'il y en a déjà un, ex. celui du lien) :
  // n'incite pas à aller chercher un code ailleurs
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoMsg, setPromoMsg] = useState('')
  const { me } = useAuth()
  const [email, setEmail] = useState('')
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
    postQuote(ids, codes).then(q => { if (alive) setQuote(q) })
      .catch((e: ApiError) => { if (alive) { setQuote(null); setErr(e.code === 'network' ? t.errNetwork : t.errGeneric) } })
    return () => { alive = false }
  }, [key, appliedPromo, lines === null]) // eslint-disable-line react-hooks/exhaustive-deps

  // code refusé : on garde le message et on le retire (seuls les codes valables restent au récapitulatif)
  useEffect(() => {
    if (!quote?.promo_error) return
    setPromoMsg(t.promoErr[quote.promo_error] || t.errGeneric)
    const ok = quote.promo_codes || []
    if (codes.some(c => !ok.includes(c))) setCodes(cs => cs.filter(c => ok.includes(c)))
  }, [quote]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const applyCode = (e: FormEvent) => {
    e.preventDefault()
    const c = promo.trim().toUpperCase()
    if (!c || codes.includes(c)) return
    track('promo', { code: c }); setPromoMsg(''); setCodes(cs => [...cs, c].slice(0, 2)); setPromo(''); setPromoOpen(false)
  }

  const pay = async () => {
    setErr('')
    if (!consent) { setErr(t.needConsent); return }
    if (free && !email.trim()) { setErr(t.emailRequired); return }
    setBusy(true)
    try {
      track('checkout', { cents: quote?.total_cents, sheets: ids.length, promo: quote?.promo_code || null })
      const r = await postCheckout({ sheet_ids: ids, promo_codes: quote?.promo_codes || [], email: email.trim() || undefined,
                                    consent, lang,
                                    track: trackingOn() ? trackCode() || undefined : undefined })
      // l'achat est parti : on retire ces partitions du panier
      ids.forEach(id => cart.lines.some(l => l.id === id) && cart.remove(id))
      window.location.assign(r.redirect)
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.code === 'network' ? t.errNetwork : ae.code === 'amount_too_low' ? t.minAmount
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

            <div>
              <label htmlFor="email" className="field-label">{free ? t.emailRequired : t.emailLabel}</label>
              <input id="email" className="field" type="email" inputMode="email" autoComplete="email" value={email}
                     onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              {!free && <span className="field-hint">{t.emailHint}</span>}
            </div>

            {quote && (
              <div className="sum">
                {quote.bundle_savings_cents > 0 && <div><span>{t.bundleSaving}</span><span>−{euros(quote.bundle_savings_cents)}</span></div>}
                {(quote.promos?.length || 0) > 0 && <div><span>{t.subtotal}</span><span>{euros(quote.subtotal_cents)}</span></div>}
                {quote.promos?.map(p => (
                  <div className="sum-promo" key={p.code}>
                    <span>{t.discount} {p.code} · −{p.kind === 'percent' ? `${p.value} %` : euros(p.value)}
                      <button type="button" className="sum-rm" aria-label={`${t.remove} ${p.code}`}
                              onClick={() => { setPromoMsg(''); setCodes(cs => cs.filter(x => x !== p.code)) }}>×</button></span>
                    <span>−{euros(p.cents)}</span>
                  </div>
                ))}
                {codes.length < 2 && (!promoOpen ? (
                  <div><button type="button" className="promo-toggle" aria-expanded={false} aria-controls="promo-box"
                          onClick={() => { setPromoOpen(true); setPromoMsg(''); track('promo_open', { second: codes.length > 0 }) }}>
                    {codes.length ? t.promoAnother : t.promo}</button></div>
                ) : (
                  <form id="promo-box" className="promo-row" onSubmit={applyCode}>
                    <label htmlFor="promo" className="sr">{t.code}</label>
                    <input id="promo" className="field" value={promo} placeholder={codes.length ? t.codeSecond : t.code} autoCapitalize="characters"
                           autoComplete="off" spellCheck={false} autoFocus
                           onChange={e => setPromo(e.target.value.toUpperCase())} />
                    <button type="submit" className="btn dark small">{t.apply}</button>
                  </form>
                ))}
                {promoMsg && <div className="msg err" role="alert">{promoMsg}</div>}
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
