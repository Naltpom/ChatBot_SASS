// Compte : connexion / inscription (e-mail ou Google), puis « Mes partitions ».
// Le même compte fonctionne sur chapote.fr (cookie partagé par les sous-domaines).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, cancelSubscription, changePassword, getAccount, getRetention, googleLogin, login, patchProfile, register, requestVerifyEmail,
  retainSubscription, uploadAvatar, type AccountView, type Subscription } from '../api'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMoney } from '../money'
import { SubscriptionCard, useOffer } from '../components/Subscription'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { Center, Icon, Modal, Stars } from '../components/ui'
import Player from '../components/Player'

declare global {
  interface Window { google?: any }
}

function GoogleButton({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const { t, lang } = useI18n()
  const [err, setErr] = useState('')
  useEffect(() => {
    const render = () => {
      if (!window.google || !box.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (r: { credential: string }) => {
          try {
            const me: any = await googleLogin(r.credential)
            if (me?.twofa_required) { setErr('2FA'); return }
            onDone()
          } catch { setErr(t.errGeneric) }
        },
      })
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 320, locale: lang })
    }
    if (window.google) { render(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = render
    document.head.appendChild(s)
  }, [clientId, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div ref={box} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />
      {err && <div className="msg err" style={{ marginTop: 8 }}>{err === '2FA' ? 'chapote.fr' : err}</div>}
    </div>
  )
}

function AuthForm() {
  const { t } = useI18n()
  const { refresh, googleClientId } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const me: any = mode === 'in' ? await login(email, password) : await register(name || email.split('@')[0], email, password)
      if (me?.twofa_required) {
        // compte protégé par la double authentification : la connexion se fait sur chapote.fr
        window.location.assign('https://chapote.fr/login')
        return
      }
      await refresh()
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 409 ? t.emailTaken : ae.status === 401 ? t.authError : ae.status === 422 ? t.passwordHint : t.errGeneric)
    } finally { setBusy(false) }
  }

  return (
    <main className="auth">
      <h1>{mode === 'in' ? t.signIn : t.signUp}</h1>
      <p className="muted">{t.accountOptional}</p>
      {googleClientId && (
        <>
          <GoogleButton clientId={googleClientId} onDone={refresh} />
          <div className="or"><span>{t.or}</span></div>
        </>
      )}
      <form onSubmit={submit} className="auth-form">
        {mode === 'up' && (
          <label><span className="field-label">{t.name}</span>
            <input className="field" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
        )}
        <label><span className="field-label">{t.email}</span>
          <input className="field" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        <label><span className="field-label">{t.password}</span>
          <input className="field" type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                 autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
          {mode === 'up' && <span className="field-hint">{t.passwordHint}</span>}</label>
        {err && <div className="msg err" role="alert">{err}</div>}
        <button className="btn block" type="submit" disabled={busy}>{busy ? '…' : mode === 'in' ? t.signIn : t.signUp}</button>
      </form>
      <p className="switch">
        {mode === 'in' ? t.noAccount : t.haveAccount}{' '}
        <button type="button" className="linkish" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr('') }}>
          {mode === 'in' ? t.signUp : t.signIn}
        </button>
      </p>
    </main>
  )
}

type AccTab = 'profile' | 'security' | 'purchases' | 'sub'

export default function AccountPage() {
  const { t } = useI18n()
  const { me, ready, refresh } = useAuth()
  const [data, setData] = useState<AccountView | null>(null)
  const [params] = useSearchParams()
  const { section } = useParams()
  const navigate = useNavigate()
  const subOk = params.get('sub') === 'ok'
  const SECTIONS: Record<string, AccTab> = { achats: 'purchases', abonnement: 'sub', profil: 'profile', securite: 'security' }
  const tab: AccTab = SECTIONS[section || ''] || (subOk ? 'sub' : 'purchases')

  const load = () => getAccount().then(setData).catch(() => me && setData({ user: { name: me.name, email: me.email, signup_app: null }, sheets: [] }))
  useEffect(() => {
    if (!me) { setData(null); return }
    // connexion demandée par une fiche (« Connecte-toi pour t'abonner ») : retour à la fiche
    const next = params.get('next')
    if (next && next.startsWith('/')) { navigate(next, { replace: true }); return }
    let alive = true, tries = 0
    const loop = () => getAccount().then(d => {
      if (!alive) return
      setData(d)
      // retour de Stripe : l'abonnement arrive par le webhook, quelques secondes après
      if (subOk && !d.subscription && tries++ < 10) setTimeout(loop, 2000)
    }).catch(() => alive && setData({ user: { name: me.name, email: me.email, signup_app: null }, sheets: [] }))
    loop()
    return () => { alive = false }
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Center>{t.loading}</Center>
  if (!me) return <AuthForm />

  const titles: Record<AccTab, string> = { purchases: t.accPurchases, sub: t.accSub, profile: t.accProfile, security: t.accSecurity }
  return (
    <main className="thanks account">
      <h1>{titles[tab]}</h1>
      {!data ? <Center>{t.loading}</Center>
        : tab === 'profile' ? <ProfileTab data={data} onSaved={() => { load(); refresh?.() }} />
        : tab === 'security' ? <SecurityTab data={data} />
        : tab === 'sub' ? <SubTab data={data} subOk={subOk} onChange={sub => setData(d => (d ? { ...d, subscription: sub } : d))} />
        : <PurchasesTab data={data} />}
    </main>
  )
}

function ProfileTab({ data, onSaved }: { data: AccountView; onSaved: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(data.user.name)
  const [nick, setNick] = useState(data.user.nickname || '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarV, setAvatarV] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try { await patchProfile({ name, nickname: nick }); setMsg({ ok: true, text: t.saved }); onSaved() }
    catch (err) { setMsg({ ok: false, text: (err as ApiError).message || t.errGeneric }) }
    finally { setBusy(false) }
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    setMsg(null)
    try { await uploadAvatar(f); setAvatarV(v => v + 1); onSaved() }
    catch (err) { setMsg({ ok: false, text: (err as ApiError).message || t.errGeneric }) }
  }
  const hasAvatar = !!data.user.avatar || avatarV > 0
  return (
    <section className="acc-panel">
      <div className="acc-card">
        <h3>{t.photo}</h3>
        <div className="acc-row">
          {hasAvatar ? <img className="acc-avatar" src={`/api/music/account/avatar?v=${avatarV}`} alt="" />
            : <span className="acc-avatar" aria-hidden="true">{(data.user.name || '?').slice(0, 1).toUpperCase()}</span>}
          <button type="button" className="btn ghost small" onClick={() => file.current?.click()}>{t.changePhoto}</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => pick(e.target.files?.[0])} />
        </div>
      </div>
      <form className="acc-card" onSubmit={save}>
        <label>{t.fullName}<input className="field" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required /></label>
        <label>{t.nickname}<input className="field" value={nick} onChange={e => setNick(e.target.value)} placeholder="@pseudo" autoComplete="nickname" />
          <small>{t.nicknameHint}</small></label>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        <div><button type="submit" className="btn small" disabled={busy}>{busy ? '…' : t.save}</button></div>
      </form>
    </section>
  )
}

function SecurityTab({ data }: { data: AccountView }) {
  const { t } = useI18n()
  const [verifySent, setVerifySent] = useState(false)
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const change = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try { await changePassword(cur, nw); setMsg({ ok: true, text: t.passwordChanged }); setCur(''); setNw('') }
    catch (err) { setMsg({ ok: false, text: (err as ApiError).message || t.errGeneric }) }
    finally { setBusy(false) }
  }
  const u = data.user
  return (
    <section className="acc-panel">
      <div className="acc-card">
        <h3>{t.email}</h3>
        <span>{u.email} · {u.email_verified ? <span className="ok-text">{t.emailVerified}</span> : t.emailNotVerified}</span>
        {u.email_verified === false && (verifySent ? <span className="ok-text">{t.verifySent}</span>
          : <div><button type="button" className="btn ghost small" onClick={() => requestVerifyEmail().then(() => setVerifySent(true)).catch(() => setVerifySent(true))}>{t.verifySend}</button></div>)}
        {u.email_verified === false && <small style={{ color: 'var(--mut)' }}>{t.verifyText(u.email)}</small>}
      </div>
      <div className="acc-card">
        <h3>{t.password}</h3>
        {u.password_login === false ? <span>{t.googleAccount}</span> : (
          <form onSubmit={change} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label>{t.currentPassword}<input className="field" type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" required /></label>
            <label>{t.newPassword}<input className="field" type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
            <div><button type="submit" className="btn small" disabled={busy}>{busy ? '…' : t.changePassword}</button></div>
          </form>
        )}
      </div>
      <div className="acc-card">
        <h3>{t.twofa}</h3>
        <span>{u.twofa_enabled ? <span className="ok-text">{t.twofaOn}</span> : t.twofaOff}</span>
        {u.security_url && <a href={u.security_url} target="_blank" rel="noreferrer">{t.twofaManage}</a>}
      </div>
    </section>
  )
}

function PurchasesTab({ data }: { data: AccountView }) {
  const { t } = useI18n()
  const [open, setOpen] = useState<number | null>(null)
  if (data.sheets.length === 0) return <p className="empty">{t.noSheetsYet}</p>
  return (
    <div className="dl-list">
      {data.sheets.map(s => (
        <div key={s.sheet_id} className="dl-row">
          <div className="dl" style={{ borderBottom: 0 }}>
            <span className="doc-tile" aria-hidden="true"><span /></span>
            <div className="info">
              <Link to={`/s/${s.piece_slug}`}><b>{s.piece_title}</b></Link>
              <small>{s.instrument_label} · {t.pages(s.pages)} · PDF</small>
              {s.my_rating != null && <Stars value={s.my_rating} small />}
            </div>
            {s.has_notes && (
              <button type="button" className="round" onClick={() => setOpen(open === s.sheet_id ? null : s.sheet_id)} aria-label={t.fullPlayer}>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
              </button>
            )}
            {s.download && <a className="go" href={s.download} aria-label={t.download}>{Icon.down}</a>}
          </div>
          {open === s.sheet_id && (
            <div style={{ padding: '0 16px 16px' }}>
              <Player sheetId={s.sheet_id} instrument="" title={s.piece_title}
                      pages={Array.from({ length: s.pages }, (_, i) => `/api/music/sheets/${s.sheet_id}/clear/${i + 1}.png`)} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SubTab({ data, subOk, onChange }: { data: AccountView; subOk: boolean; onChange: (s: Subscription) => void }) {
  const { t } = useI18n()
  const { eur } = useMoney()
  const offer = useOffer()
  const [step, setStep] = useState<'none' | 'confirm' | 'retain'>('none')
  const [retention, setRetention] = useState<{ percent: number; next_cents: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const sub = data.subscription
  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '')
  const ask = async () => {
    setMsg('')
    try {
      const r = await getRetention()
      if (r.eligible && r.percent && r.next_cents != null) { setRetention({ percent: r.percent, next_cents: r.next_cents }); setStep('retain'); return }
    } catch { /* pas d'offre : confirmation simple */ }
    setStep('confirm')
  }
  const doCancel = async () => {
    setBusy(true)
    try { const r = await cancelSubscription(); onChange(r.subscription); setStep('none') }
    catch (err) { setMsg((err as ApiError).message || t.errGeneric); setStep('none') }
    finally { setBusy(false) }
  }
  const doRetain = async () => {
    setBusy(true)
    try { const r = await retainSubscription(); onChange(r.subscription); setMsg(t.retained); setStep('none') }
    catch (err) { setMsg((err as ApiError).message || t.errGeneric); setStep('none') }
    finally { setBusy(false) }
  }
  if (!sub) return (
    <section className="acc-panel">
      {subOk ? <div className="msg ok">{t.subOk}</div> : offer?.variant === 'sub' ? <SubscriptionCard offer={offer} /> : <p className="empty">{t.noSub}</p>}
    </section>
  )
  const price = `${eur(sub.price_cents ?? sub.weekly_cents)} ${sub.plan ? t.planPer[sub.plan] : ''}`
  return (
    <section className="acc-panel">
      <div className="acc-card">
        <h3>✓ {t.subActive}</h3>
        {sub.plan && <span>{t.planName[sub.plan]} · {price}</span>}
        {sub.status === 'trialing' && sub.trial_end && <span>{t.subTrialUntil(day(sub.trial_end))}</span>}
        {sub.trial_downloads_left != null && <span>{t.subTrialLeft(sub.trial_downloads_left)}</span>}
        {sub.cancel_at_period_end ? <span>{t.subEnds(day(sub.current_period_end))}</span> : <span>{t.subRenews(price, day(sub.current_period_end))}</span>}
        {msg && <div className="msg ok">{msg}</div>}
        {!sub.cancel_at_period_end && <div><button type="button" className="linkish" onClick={ask}>{t.subCancel}</button></div>}
      </div>
      <Modal open={step === 'confirm'} title={t.cancelTitle} onClose={() => setStep('none')}>
        <p>{t.subCancelConfirm}</p>
        <div className="actions">
          <button type="button" className="btn block" onClick={() => setStep('none')}>{t.keepIt}</button>
          <button type="button" className="btn ghost block" onClick={doCancel} disabled={busy}>{busy ? '…' : t.cancelYes}</button>
        </div>
      </Modal>
      <Modal open={step === 'retain' && !!retention} title={t.retainTitle} onClose={() => setStep('none')}>
        {retention && <p>{t.retainText(retention.percent, `${eur(retention.next_cents)} ${sub.plan ? t.planPer[sub.plan] : ''}`)}</p>}
        <div className="actions">
          {retention && <button type="button" className="btn block" onClick={doRetain} disabled={busy}>{busy ? '…' : t.retainYes(retention.percent)}</button>}
          <button type="button" className="btn ghost block" onClick={() => setStep('confirm')}>{t.retainNo}</button>
        </div>
      </Modal>
    </section>
  )
}
