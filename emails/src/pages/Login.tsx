// Connexion avec le compte Chapote (le même que chapote.fr) : Google ou e-mail + mot de passe, puis
// 2nd facteur OBLIGATOIRE ici : passkey, code de l'application ou code de secours.
// Passkeys : enregistrées sur chapote.fr (RP ID « chapote.fr »), elles valent sur emails.chapote.fr
// (sous-domaine) ; l'API accepte cette origine quand le module est actif.
import { startAuthentication } from '@simplewebauthn/browser'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, login, passkeyBegin, passkeyComplete, totpLogin, type TwoFAChallenge } from '../api'
import GoogleButton from '../components/GoogleButton'
import { Brand, Msg } from '../components/ui'
import { goToSuite, useSession } from '../session'

function TwoFactor({ challenge, onDone, onBack }: { challenge: TwoFAChallenge; onDone: () => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(!challenge.methods.totp && challenge.methods.recovery)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const canPasskey = challenge.methods.passkey && typeof window.PublicKeyCredential !== 'undefined'

  const passkey = async () => {
    setErr(''); setBusy(true)
    try {
      const { options } = await passkeyBegin(challenge.challenge)
      const credential = await startAuthentication(JSON.parse(options))
      await passkeyComplete(challenge.challenge, credential)
      await onDone()
    } catch (e) {
      const name = (e as Error)?.name
      setErr(name === 'NotAllowedError' ? 'Passkey annulée ou introuvable sur cet appareil.'
        : (e as ApiError).status === 401 ? 'Passkey refusée.' : (e as Error).message)
    } finally { setBusy(false) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await totpLogin(challenge.challenge, code.replace(/\s/g, ''), recovery); await onDone() }
    catch (e) { setErr((e as ApiError).status === 401 ? 'Code incorrect ou expiré.' : (e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 6 }}>
        <h1>Vérification</h1>
        <p className="muted">La double authentification est obligatoire pour emails.chapote.fr.</p>
      </div>
      {canPasskey && <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={passkey}>Utiliser ma passkey</button>}
      {(challenge.methods.totp || challenge.methods.recovery) && (
        <form className="col" style={{ gap: 14 }} onSubmit={submit}>
          {canPasskey && <div className="divider">ou avec un code</div>}
          <label className="field">{recovery ? 'Code de secours' : 'Code de l’application'}
            <input className={`input${recovery ? '' : ' otp'}`} value={code} onChange={e => setCode(e.target.value)} required autoFocus={!canPasskey}
                   inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 32 : 7}
                   pattern={recovery ? undefined : '[0-9 ]{6,7}'} />
          </label>
          <button className={`btn btn-lg btn-block ${canPasskey ? '' : 'btn-primary'}`} disabled={busy}>{busy ? 'Vérification…' : 'Valider'}</button>
          {challenge.methods.totp && challenge.methods.recovery && (
            <button type="button" className="btn btn-ghost" onClick={() => { setRecovery(r => !r); setCode('') }}>
              {recovery ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
            </button>
          )}
        </form>
      )}
      {err && <Msg kind="err">{err}</Msg>}
      <button type="button" className="btn btn-ghost small" onClick={onBack}>← Changer de compte</button>
    </div>
  )
}

export default function Login() {
  const { config, refresh } = useSession()
  const navigate = useNavigate()
  const [challenge, setChallenge] = useState<TwoFAChallenge | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const suite = new URLSearchParams(window.location.search).get('suite')

  const finish = async () => {
    if (suite?.startsWith('/oauth/')) { window.location.assign(suite); return }
    await refresh()
    goToSuite(suite, navigate)
  }
  const done = async (r: unknown) => {
    const c = r as Partial<TwoFAChallenge>
    if (c?.twofa_required && c.challenge) { setChallenge(c as TwoFAChallenge); return }
    await finish()      // compte sans 2FA : l'écran d'accès expliquera comment l'activer
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await done(await login(email.trim(), password)) }
    catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 401 ? 'E-mail ou mot de passe incorrect.' : ae.status === 429 ? 'Trop d’essais : patientez quelques minutes.' : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-card card">
        <Brand />
        {challenge ? <TwoFactor challenge={challenge} onDone={finish} onBack={() => setChallenge(null)} /> : (
          <>
            <div className="col" style={{ gap: 6 }}>
              <h1>Connexion</h1>
              <p className="muted">{suite?.startsWith('/oauth/')
                ? 'Connectez-vous pour autoriser Claude à accéder à vos boîtes mail.'
                : 'Administration des boîtes mail accessibles à Claude. Réservé au superadmin.'}</p>
            </div>
            {config?.google_client_id && (
              <>
                <GoogleButton clientId={config.google_client_id} onResult={done} />
                <div className="divider">ou avec votre e-mail</div>
              </>
            )}
            <form className="col" style={{ gap: 14 }} onSubmit={submit}>
              <label className="field">E-mail
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                       autoComplete="username webauthn" inputMode="email" autoCapitalize="none" spellCheck={false} />
              </label>
              <label className="field">Mot de passe
                <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
              </label>
              {err && <Msg kind="err">{err}</Msg>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
            </form>
          </>
        )}
        <p className="tiny muted" style={{ textAlign: 'center' }}>Même compte que chapote.fr.</p>
      </div>
    </div>
  )
}
