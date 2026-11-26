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
import { t } from '../../i18n'

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
    catch (e) { setErr((e as ApiError).status === 401 ? t('Code incorrect ou expiré.') : (e as Error).message) }
    finally { setBusy(false) }
  }
  if (challenge.methods.passkey && !challenge.methods.totp && !challenge.methods.recovery) {
    return (
      <>
        <h1>{t('Clé d’accès requise')}</h1>
        <Msg>{t('Ce compte se connecte avec une passkey.')} <a href={`${appUrl.replace(/\/$/, '')}/login`}>{t('Connectez-vous sur chapote.fr')}</a>{t(' : la session vaudra aussi ici.')}</Msg>
        <button type="button" className="btn btn-ghost" onClick={onBack}>← {t('Retour')}</button>
      </>
    )
  }
  return (
    <form className="col" style={{ gap: 18 }} onSubmit={submit}>
      <div className="col" style={{ gap: 6 }}>
        <h1>{t('Vérification')}</h1>
        <p className="muted">{recovery ? t('Saisissez un de vos codes de secours.') : t('Saisissez le code à 6 chiffres de votre application d’authentification.')}</p>
      </div>
      <label className="field">{recovery ? t('Code de secours') : t('Code')}
        <input className={`input${recovery ? '' : ' otp'}`} value={code} onChange={e => setCode(e.target.value)} autoFocus required
               inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 32 : 7}
               pattern={recovery ? undefined : '[0-9 ]{6,7}'} />
      </label>
      {err && <Msg kind="err">{err}</Msg>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? t('Vérification…') : t('Valider')}</button>
      {challenge.methods.totp && challenge.methods.recovery && (
        <button type="button" className="btn btn-ghost" onClick={() => { setRecovery(r => !r); setCode('') }}>
          {recovery ? t('Utiliser le code de l’application') : t('Utiliser un code de secours')}
        </button>
      )}
      <button type="button" className="btn btn-ghost small" onClick={onBack}>← {t('Changer de compte')}</button>
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
      setErr(ae.status === 401 ? t('E-mail ou mot de passe incorrect.') : ae.status === 429 ? t('Trop d’essais : patientez quelques minutes.') : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      {challenge ? <TwoFactor challenge={challenge} onDone={done} onBack={() => setChallenge(null)} /> : (
        <>
          <div className="col" style={{ gap: 6 }}>
            <h1>{t('Bon retour')}</h1>
            <p className="muted">{t('Connectez-vous pour retrouver votre planning et vos chiffres.')}</p>
          </div>
          {googleClientId && (
            <>
              <GoogleButton clientId={googleClientId} onResult={done} text="continue_with" />
              <div className="divider">{t('ou avec votre e-mail')}</div>
            </>
          )}
          <form className="col" style={{ gap: 16 }} onSubmit={submit} noValidate={false}>
            <label className="field" htmlFor="email">{t('E-mail')}
              <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                     autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder={t('vous@exemple.fr')} />
            </label>
            <div className="field">
              <div className="field-row">
                <label htmlFor="password">{t('Mot de passe')}</label>
                <Link to="/mot-de-passe-oublie" className="small" style={{ fontWeight: 500 }}>{t('Oublié ?')}</Link>
              </div>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? t('Connexion…') : t('Se connecter')}</button>
          </form>
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('Pas encore de compte ?')} <Link to={`/inscription${suite}`} style={{ fontWeight: 600 }}>{t('Créer un compte')}</Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
