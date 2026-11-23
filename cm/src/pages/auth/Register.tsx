// Inscription : Google en un clic, ou nom + e-mail + mot de passe. Le compte créé est un compte
// Chapote (espace perso) valable aussi sur chapote.fr et music.chapote.fr.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, register } from '../../api'
import GoogleButton from '../../components/GoogleButton'
import { Msg } from '../../components/ui'
import { useSession } from '../../session'
import AuthLayout, { PasswordStrength } from './AuthLayout'
import { PasswordInput } from './fields'
import { TwoFactor, useAuthDone } from './Login'

export default function Register() {
  const { googleClientId, appUrl } = useSession()
  const { challenge, setChallenge, done } = useAuthDone()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<React.ReactNode>('')
  const [busy, setBusy] = useState(false)
  const suite = window.location.search
  const legal = appUrl.replace(/\/$/, '') + '/legal'

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (password.length < 8) { setErr('Mot de passe trop court : 8 caractères minimum.'); return }
    setBusy(true)
    try { await done(await register(name.trim() || email.split('@')[0], email.trim(), password)) }
    catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 409 ? <>Un compte existe déjà avec cet e-mail. <Link to={`/connexion${suite}`}>Se connecter</Link></> : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout aside={<h2>Programmez une fois.<br /><span className="em">Publiez partout.</span></h2>}>
      {challenge ? <TwoFactor challenge={challenge} onDone={done} onBack={() => setChallenge(null)} /> : (
        <>
          <div className="col" style={{ gap: 6 }}>
            <h1>Créer un compte</h1>
            <p className="muted">Quelques secondes, puis connectez vos réseaux.</p>
          </div>
          {googleClientId && (
            <>
              <GoogleButton clientId={googleClientId} onResult={done} text="signup_with" />
              <div className="divider">ou avec votre e-mail</div>
            </>
          )}
          <form className="col" style={{ gap: 16 }} onSubmit={submit}>
            <label className="field" htmlFor="name">Nom ou pseudo
              <input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={80} placeholder="Ghost Hands" />
            </label>
            <label className="field" htmlFor="email">E-mail
              <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                     autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.fr" />
            </label>
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
              <PasswordStrength value={password} />
            </div>
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}</button>
            <p className="tiny muted" style={{ textAlign: 'center' }}>
              En créant un compte, vous acceptez les <a href={`${legal}/cgu`} target="_blank" rel="noreferrer">conditions d’utilisation</a> et
              la <a href={`${legal}/confidentialite`} target="_blank" rel="noreferrer">politique de confidentialité</a>.
            </p>
          </form>
          <p className="muted" style={{ textAlign: 'center' }}>
            Déjà un compte ? <Link to={`/connexion${suite}`} style={{ fontWeight: 600 }}>Se connecter</Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
