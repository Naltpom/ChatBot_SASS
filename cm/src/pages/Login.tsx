// Connexion avec le compte Chapote (le même que chapote.fr et music.chapote.fr) :
// e-mail + mot de passe ou Google, puis 2nd facteur (code TOTP ou code de secours) si activé.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, googleLogin, login, register, totpLogin, type TwoFAChallenge } from '../api'
import { Msg } from '../components/ui'
import { useSession } from '../session'

declare global {
  interface Window { google?: any }
}

function GoogleButton({ clientId, onResult }: { clientId: string; onResult: (r: unknown) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const render = () => {
      if (!window.google || !box.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (r: { credential: string }) => {
          try { onResult(await googleLogin(r.credential)) } catch (e) { setErr((e as Error).message) }
        },
      })
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 320, locale: 'fr' })
    }
    if (window.google) { render(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = render
    document.head.appendChild(s)
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ gap: 8 }}>
      <div ref={box} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />
      {err && <Msg kind="err">{err}</Msg>}
    </div>
  )
}

export default function Login() {
  const { refresh, googleClientId, appUrl } = useSession()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<TwoFAChallenge | null>(null)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const done = async (r: unknown) => {
    const c = r as Partial<TwoFAChallenge>
    if (c?.twofa_required && c.challenge) { setChallenge(c as TwoFAChallenge); return }
    await refresh()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (challenge) await done(await totpLogin(challenge.challenge, code.trim(), recovery))
      else await done(mode === 'in' ? await login(email, password) : await register(name || email.split('@')[0], email, password))
    } catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 409 ? 'Un compte existe déjà avec cet e-mail : connectez-vous.' :
             ae.status === 401 && !challenge ? 'E-mail ou mot de passe incorrect.' : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card col" style={{ gap: 20 }}>
        <div className="col" style={{ gap: 6, alignItems: 'center', textAlign: 'center' }}>
          <span className="brand-mark" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 18, borderRadius: 10 }}>C</span>
          <h1 style={{ fontSize: 22 }}>Chapote CM</h1>
          <p className="muted small" style={{ margin: 0 }}>Vos réseaux sociaux au même endroit. Même compte que chapote.fr.</p>
        </div>
        <form className="card col" onSubmit={submit} style={{ gap: 14 }}>
          {challenge ? (
            <>
              <h2>Double authentification</h2>
              <label className="field">{recovery ? 'Code de secours' : "Code de l'application d'authentification"}
                <input className="input" value={code} onChange={e => setCode(e.target.value)} autoFocus required
                       inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" />
              </label>
              <button type="button" className="btn btn-sm" onClick={() => { setRecovery(r => !r); setCode('') }}>
                {recovery ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
              </button>
              {challenge.methods.passkey && !challenge.methods.totp && (
                <Msg>Ce compte n'utilise qu'une passkey : <a href={`${appUrl.replace(/\/$/, '')}/login`}>connectez-vous sur chapote.fr</a>, la session vaut aussi ici.</Msg>
              )}
            </>
          ) : (
            <>
              {mode === 'up' && (
                <label className="field">Nom
                  <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                </label>
              )}
              <label className="field">E-mail
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
              </label>
              <label className="field">Mot de passe
                <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required
                       autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={mode === 'up' ? 8 : undefined} />
              </label>
            </>
          )}
          {err && <Msg kind="err">{err}</Msg>}
          <button className="btn btn-primary" disabled={busy}>
            {challenge ? 'Valider' : mode === 'in' ? 'Se connecter' : 'Créer mon compte'}
          </button>
          {!challenge && (
            <>
              {googleClientId && (<><div className="divider">ou</div><GoogleButton clientId={googleClientId} onResult={done} /></>)}
              <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
                {mode === 'in' ? <>Pas encore de compte ? <button type="button" className="btn btn-sm" onClick={() => setMode('up')}>Créer un compte</button></>
                  : <>Déjà un compte ? <button type="button" className="btn btn-sm" onClick={() => setMode('in')}>Se connecter</button></>}
              </p>
              {mode === 'in' && <a className="small" style={{ textAlign: 'center' }} href={`${appUrl.replace(/\/$/, '')}/forgot-password`}>Mot de passe oublié</a>}
            </>
          )}
        </form>
      </div>
    </div>
  )
}
