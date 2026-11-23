// Connexion avec le compte Chapote (le même que chapote.fr et music.chapote.fr) :
// Google ou e-mail + mot de passe, puis 2nd facteur (code TOTP ou code de secours) si activé.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, login, totpLogin, type TwoFAChallenge } from '../../api'
import GoogleButton from '../../components/GoogleButton'
import { Msg } from '../../components/ui'
import { useSession } from '../../session'
import AuthLayout from './AuthLayout'
import { PasswordInput } from './fields'

export function useAuthDone() {
  const { refresh } = useSession()
  const [challenge, setChallenge] = useState<TwoFAChallenge | null>(null)
  const done = async (r: unknown) => {
    const c = r as Partial<TwoFAChallenge>
    if (c?.twofa_required && c.challenge) { setChallenge(c as TwoFAChallenge); return }
    await refresh()          // la route /connexion renvoie alors vers ?suite=
  }
  return { challenge, setChallenge, done }
}

export function TwoFactor({ challenge, onDone, onBack }: { challenge: TwoFAChallenge; onDone: (r: unknown) => Promise<void>; onBack: () => void }) {
  const { appUrl } = useSession()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(!challenge.methods.totp && challenge.methods.recovery)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await onDone(await totpLogin(challenge.challenge, code.replace(/\s/g, ''), recovery)) }
    catch (e) { setErr((e as ApiError).status === 401 ? 'Code incorrect ou expiré.' : (e as Error).message) }
    finally { setBusy(false) }
  }
  if (challenge.methods.passkey && !challenge.methods.totp && !challenge.methods.recovery) {
    return (
      <>
        <h1>Clé d’accès requise</h1>
        <Msg>Ce compte se connecte avec une passkey. <a href={`${appUrl.replace(/\/$/, '')}/login`}>Connectez-vous sur chapote.fr</a> : la session vaudra aussi ici.</Msg>
        <button type="button" className="btn btn-ghost" onClick={onBack}>← Retour</button>
      </>
    )
  }
  return (
    <form className="col" style={{ gap: 18 }} onSubmit={submit}>
      <div className="col" style={{ gap: 6 }}>
        <h1>Vérification</h1>
        <p className="muted">{recovery ? 'Saisissez un de vos codes de secours.' : 'Saisissez le code à 6 chiffres de votre application d’authentification.'}</p>
      </div>
      <label className="field">{recovery ? 'Code de secours' : 'Code'}
        <input className={`input${recovery ? '' : ' otp'}`} value={code} onChange={e => setCode(e.target.value)} autoFocus required
               inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 32 : 7}
               pattern={recovery ? undefined : '[0-9 ]{6,7}'} />
      </label>
      {err && <Msg kind="err">{err}</Msg>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Vérification…' : 'Valider'}</button>
      {challenge.methods.totp && challenge.methods.recovery && (
        <button type="button" className="btn btn-ghost" onClick={() => { setRecovery(r => !r); setCode('') }}>
          {recovery ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
        </button>
      )}
      <button type="button" className="btn btn-ghost small" onClick={onBack}>← Changer de compte</button>
    </form>
  )
}

export default function Login() {
  const { googleClientId } = useSession()
  const { challenge, setChallenge, done } = useAuthDone()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const suite = window.location.search

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await done(await login(email.trim(), password)) }
    catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 401 ? 'E-mail ou mot de passe incorrect.' : ae.status === 429 ? 'Trop d’essais : patientez quelques minutes.' : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      {challenge ? <TwoFactor challenge={challenge} onDone={done} onBack={() => setChallenge(null)} /> : (
        <>
          <div className="col" style={{ gap: 6 }}>
            <h1>Bon retour</h1>
            <p className="muted">Connectez-vous pour retrouver votre planning et vos chiffres.</p>
          </div>
          {googleClientId && (
            <>
              <GoogleButton clientId={googleClientId} onResult={done} text="continue_with" />
              <div className="divider">ou avec votre e-mail</div>
            </>
          )}
          <form className="col" style={{ gap: 16 }} onSubmit={submit} noValidate={false}>
            <label className="field" htmlFor="email">E-mail
              <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                     autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.fr" />
            </label>
            <div className="field">
              <div className="field-row">
                <label htmlFor="password">Mot de passe</label>
                <Link to="/mot-de-passe-oublie" className="small" style={{ fontWeight: 500 }}>Oublié ?</Link>
              </div>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
          </form>
          <p className="muted" style={{ textAlign: 'center' }}>
            Pas encore de compte ? <Link to={`/inscription${suite}`} style={{ fontWeight: 600 }}>Créer un compte</Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
