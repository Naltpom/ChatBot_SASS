// Inscription : Google en un clic, ou e-mail + mot de passe (rien d'autre : le nom vient de l'e-mail, modifiable ensuite).
// E-mail vérifié quand on quitte le champ ; critère du mot de passe coché pendant la frappe ; rappel du choix fait
// dans la démo de la page d'accueil. Le compte créé est un compte
// Chapote (espace perso) valable aussi sur chapote.fr et music.chapote.fr.
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, register } from '../../api'
import GoogleButton from '../../components/GoogleButton'
import { Msg } from '../../components/ui'
import { useSession } from '../../session'
import AuthLayout, { PasswordStrength } from './AuthLayout'
import { PasswordInput } from './fields'
import { TwoFactor, useAuthDone } from './Login'
import { demoChoiceText, readDemoChoice } from '../../landing/Demo'

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const emailProblem = (v: string) => !v.trim() ? 'Indiquez votre e-mail.' : !v.includes('@') ? 'Il manque le @ (ex. vous@exemple.fr).' : !EMAIL_OK.test(v.trim()) ? 'Adresse incomplète : vérifiez la partie après le @ (ex. vous@exemple.fr).' : ''

export default function Register() {
  const { googleClientId, appUrl } = useSession()
  const { challenge, setChallenge, done } = useAuthDone()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<React.ReactNode>('')
  const [busy, setBusy] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const demo = useMemo(readDemoChoice, [])
  const suite = window.location.search
  const legal = appUrl.replace(/\/$/, '') + '/legal'

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    const pb = emailProblem(email)
    if (pb) { setEmailErr(pb); document.getElementById('email')?.focus(); return }
    if (password.length < 8) { setErr('Mot de passe trop court : 8 caractères minimum.'); return }
    setBusy(true)
    try { await done(await register(email.trim().split('@')[0], email.trim(), password)) }
    catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 409 ? <>Un compte existe déjà avec cet e-mail. <Link to={`/connexion${suite}`}>Se connecter</Link></> : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout aside={<h2>Programmez une fois.<br /><span className="em">Publiez partout.</span></h2>}>
      {challenge ? <TwoFactor challenge={challenge} onDone={done} onBack={() => setChallenge(null)} /> : (
        <>
          <ol className="reg-steps" aria-label="Étapes">
            <li className="on" aria-current="step">Compte</li><li>Réseaux</li><li>Première vidéo</li>
          </ol>
          <div className="col" style={{ gap: 6 }}>
            <h1>Créer un compte</h1>
            <p className="muted">Un e-mail et un mot de passe. Ensuite, connectez vos réseaux.</p>
          </div>
          {demo && <p className="reg-demo">Comme dans la démo, vous pourrez programmer sur {demoChoiceText(demo)}. Créez votre compte pour le faire avec vos vraies vidéos.</p>}
          {googleClientId && (
            <>
              <GoogleButton clientId={googleClientId} onResult={done} text="signup_with" />
              <div className="divider">ou avec votre e-mail</div>
            </>
          )}
          <form className="col" style={{ gap: 16 }} onSubmit={submit}>
            <label className="field" htmlFor="email">E-mail
              <input id="email" className="input" type="email" value={email} required aria-invalid={!!emailErr} aria-describedby={emailErr ? 'email-err' : undefined}
                     onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr(emailProblem(e.target.value)) }}
                     onBlur={() => email && setEmailErr(emailProblem(email))}
                     autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="vous@exemple.fr" />
              {emailErr && <span id="email-err" className="field-err" role="alert">{emailErr}</span>}
            </label>
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
              <p className={`reg-crit${password.length >= 8 ? ' ok' : ''}`}><span aria-hidden="true">{password.length >= 8 ? '✓' : '○'}</span>Au moins 8 caractères{password.length >= 8 ? ' : c’est bon' : ` (${password.length}/8)`}</p>
              <PasswordStrength value={password} />
            </div>
            {err && <Msg kind="err">{err}</Msg>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <><span className="spin" aria-hidden="true" />Création du compte…</> : 'Créer mon compte gratuitement'}</button>
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
