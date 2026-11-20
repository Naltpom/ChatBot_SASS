// Compte : connexion / inscription (e-mail ou Google), puis « Mes partitions ».
// Le même compte fonctionne sur chapote.fr (cookie partagé par les sous-domaines).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getAccount, googleLogin, login, register, requestVerifyEmail, type AccountView } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { Center, Icon, Stars } from '../components/ui'
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

export default function AccountPage() {
  const { t } = useI18n()
  const { me, ready, signOut } = useAuth()
  const [data, setData] = useState<AccountView | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [verifySent, setVerifySent] = useState(false)

  useEffect(() => {
    if (!me) { setData(null); return }
    getAccount().then(setData).catch(() => setData({ user: { name: me.name, email: me.email, signup_app: null }, sheets: [] }))
  }, [me])

  if (!ready) return <Center>{t.loading}</Center>
  if (!me) return <AuthForm />

  return (
    <main className="thanks">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h1>{t.mySheets}</h1>
        <button type="button" className="linkish" onClick={signOut}>{t.signOut}</button>
      </div>
      <p>{me.name} · {me.email}</p>
      {data && data.user.email_verified === false && (
        <div className="verify-box">
          <b>{t.verifyTitle}</b>
          <span>{t.verifyText(me.email)}</span>
          {verifySent ? <span className="ok-text">{t.verifySent}</span>
            : <button type="button" className="btn ghost" onClick={() => requestVerifyEmail().then(() => setVerifySent(true)).catch(() => setVerifySent(true))}>{t.verifySend}</button>}
        </div>
      )}
      {!data ? <Center>{t.loading}</Center> : data.sheets.length === 0 ? <p className="empty">{t.noSheetsYet}</p> : (
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
      )}
    </main>
  )
}
