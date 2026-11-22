// Abonnement « toutes les partitions » (test A/B des liens « SHEET ») : carte d'offre sur la fiche, téléchargement du PDF
// pour qui a la partition (achat ou abonnement).
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ApiError, getOffer, subscribe, type Offer, type Plan } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { useMoney } from '../money'
import { savedPromo, track, trackCode, trackingOn } from '../track'

export function useOffer(): Offer | null {
  const [offer, setOffer] = useState<Offer | null>(null)
  useEffect(() => { getOffer(trackCode(), savedPromo() || undefined).then(setOffer).catch(() => setOffer(null)) }, [])
  return offer
}

export function SubscriptionCard({ offer }: { offer: Offer }) {
  const { t, lang } = useI18n()
  const { eur } = useMoney()
  const { me } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const code = savedPromo()
  const trial = offer.trial_days > 0
  const [plan, setPlan] = useState<Plan>('month')
  const cents = (p: Plan) => offer.plans.find(x => x.plan === p)?.cents ?? 0
  const price = `${eur(cents(plan))} ${t.planPer[plan]}`
  const monthsFree = cents('month') ? Math.floor(12 - cents('year') / cents('month')) : 0  // arrondi vers le bas : jamais plus que la vraie économie
  const go = async () => {
    setErr('')
    if (!consent) { setErr(t.needConsent); return }
    setBusy(true)
    track('subscribe', { trial, plan, cents: cents(plan) })
    try {
      const r = await subscribe({ plan, promo_code: code || undefined, consent, lang, track: trackingOn() ? trackCode() || undefined : undefined })
      window.location.href = r.redirect
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.message || t.errGeneric)
      setBusy(false)
    }
  }
  return (
    <section className="sub-card" aria-label={t.subTitle}>
      <div className="sub-head"><b>{t.subTitle}</b></div>
      {trial && <span className="sub-trial">🎁 {t.subTrial(offer.trial_days * 24)}</span>}
      <div className="plans" role="radiogroup" aria-label={t.subTitle}>
        {offer.plans.map(p => (
          <button type="button" key={p.plan} role="radio" aria-checked={plan === p.plan}
                  className={`plan ${plan === p.plan ? 'on' : ''}`} onClick={() => { setPlan(p.plan); track('plan', { plan: p.plan }) }}>
            <span className="plan-name">{t.planName[p.plan]}</span>
            <b>{eur(p.cents)}</b>
            <small>{t.planPer[p.plan]}</small>
            {p.plan === 'year' && monthsFree > 0 && <span className="plan-save">{t.planSave(monthsFree)}</span>}
          </button>
        ))}
      </div>
      <ul>
        <li>{t.subPoint1}</li>
        <li>{t.subPoint2}</li>
      </ul>
      {!me ? (
        <Link className="btn block" to={`/account?next=${encodeURIComponent(pathname)}`} onClick={() => track('subscribe_signin')}>{t.subSignIn}</Link>
      ) : !open ? (
        <button type="button" className="btn block" onClick={() => { track('subscribe_open', { trial }); setOpen(true) }}>{trial ? t.subCtaTrial : t.subCta}</button>
      ) : (
        <div className="sub-confirm">
          <p className="hint">{trial ? t.subTrialNote(offer.trial_downloads, price) : t.subNote(price)}</p>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>{t.subConsent(price)} <Link to="/legal/terms">{t.consentLink}</Link>.</span>
          </label>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button type="button" className="btn block" onClick={go} disabled={busy}>{busy ? '…' : t.subGo}</button>
        </div>
      )}
    </section>
  )
}

/** Télécharge le PDF d'une partition qu'on a (achat ou abonnement) ; affiche la raison d'un refus (limite de l'essai). */
export function PdfButton({ url, name }: { url: string; name: string }) {
  const { t } = useI18n()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const get = async () => {
    setMsg(''); setBusy(true)
    track('pdf', { name })
    try {
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        setMsg(j?.detail?.message || t.errGeneric)
        return
      }
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch { setMsg(t.errNetwork) } finally { setBusy(false) }
  }
  return (
    <div className="pdf-btn">
      <button type="button" className="btn ghost block" onClick={get} disabled={busy}>{busy ? '…' : `⬇ ${t.downloadPdf}`}</button>
      {msg && <div className="msg err" role="alert">{msg}</div>}
    </div>
  )
}
