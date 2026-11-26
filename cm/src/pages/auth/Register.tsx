// Inscription : Google en un clic, ou e-mail + mot de passe (rien d'autre : le nom vient de l'e-mail, modifiable ensuite).
// E-mail vérifié quand on quitte le champ ; critère du mot de passe coché pendant la frappe ; rappel du choix fait
// dans la démo de la page d'accueil. Le compte créé est un compte
// Chapote (espace perso) valable aussi sur chapote.fr et music.chapote.fr.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getAiPublic, putAiConsent, register, type AiPublic } from '../../api'
import GoogleButton from '../../components/GoogleButton'
import { Msg } from '../../components/ui'
import { useSession } from '../../session'
import AuthLayout, { PasswordStrength } from './AuthLayout'
import { PasswordInput } from './fields'
import { TwoFactor, useAuthDone } from './Login'
import { demoChoiceText, readDemoChoice } from '../../landing/Demo'
import { t } from '../../i18n'

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const emailProblem = (v: string) => !v.trim() ? t('Indiquez votre e-mail.') : !v.includes('@') ? t('Il manque le @ (ex. vous@exemple.fr).') : !EMAIL_OK.test(v.trim()) ? t('Adresse incomplète : vérifiez la partie après le @ (ex. vous@exemple.fr).') : ''

export default function Register() {
  const { googleClientId, appUrl } = useSession()
  const { challenge, setChallenge, done } = useAuthDone()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<React.ReactNode>('')
  const [busy, setBusy] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const demo = useMemo(readDemoChoice, [])
  // Accord IA : case SÉPARÉE, facultative, non cochée (docs/CM_MCP.md §3). Seulement si la fonction est proposée.
  const [ai, setAi] = useState<AiPublic | null>(null)
  const [aiOk, setAiOk] = useState(false)
  useEffect(() => { getAiPublic().then(setAi).catch(() => setAi(null)) }, [])
  const suite = window.location.search
  const legal = appUrl.replace(/\/$/, '') + '/legal'

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    const pb = emailProblem(email)
    if (pb) { setEmailErr(pb); document.getElementById('email')?.focus(); return }
    if (password.length < 8) { setErr(t('Mot de passe trop court : 8 caractères minimum.')); return }
    setBusy(true)
    try {
      const res = await register(email.trim().split('@')[0], email.trim(), password)
      if (aiOk) await putAiConsent({ enabled: true, source: 'inscription' }).catch(() => { /* réglable ensuite */ })
      await done(res)
    }
    catch (e) {
      const ae = e as ApiError
      setErr(ae.status === 409 ? <>{t('Un compte existe déjà avec cet e-mail.')} <Link to={`/connexion${suite}`}>{t('Se connecter')}</Link></> : ae.message)
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout aside={<h2>{t('Planifiez une fois.')}<br /><span className="em">{t('Publiez partout.')}</span></h2>}>
      {challenge ? <TwoFactor challenge={challenge} onDone={done} onBack={() => setChallenge(null)} /> : (
        <>
          <ol className="reg-steps" aria-label={t('Étapes')}>
            <li className="on" aria-current="step">{t('Compte')}</li><li>{t('Réseaux')}</li><li>{t('Première vidéo')}</li>
          </ol>
          <div className="col" style={{ gap: 6 }}>
            <h1>{t('Créer un compte')}</h1>
            <p className="muted">{t('Un e-mail et un mot de passe. Ensuite, connectez vos réseaux.')}</p>
          </div>
          {demo && <p className="reg-demo">{t('Comme dans la démo, vous pourrez programmer sur {choice}. Créez votre compte pour le faire avec vos vraies vidéos.', { choice: demoChoiceText(demo) })}</p>}
          {googleClientId && (
            <>
              <GoogleButton clientId={googleClientId} onResult={done} text="signup_with" />
              <div className="divider">{t('ou avec votre e-mail')}</div>
            </>
          )}
          <form className="col" style={{ gap: 16 }} onSubmit={submit}>
            <label className="field" htmlFor="email">{t('E-mail')}
              <input id="email" className="input" type="email" value={email} required aria-invalid={!!emailErr} aria-describedby={emailErr ? 'email-err' : undefined}
                     onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr(emailProblem(e.target.value)) }}
                     onBlur={() => email && setEmailErr(emailProblem(email))}
                     autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder={t('vous@exemple.fr')} />
              {emailErr && <span id="email-err" className="field-err" role="alert">{emailErr}</span>}
            </label>
            <div className="field">
              <label htmlFor="password">{t('Mot de passe')}</label>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
              <p className={`reg-crit${password.length >= 8 ? ' ok' : ''}`}><span aria-hidden="true">{password.length >= 8 ? '✓' : '○'}</span>{password.length >= 8 ? t('Au moins 8 caractères : c’est bon') : t('Au moins 8 caractères ({n}/8)', { n: password.length })}</p>
              <PasswordStrength value={password} />
            </div>
            {err && <Msg kind="err">{err}</Msg>}
            {ai?.enabled && (
              <label className="check small">
                <input type="checkbox" checked={aiOk} onChange={e => setAiOk(e.target.checked)} />
                <span>{t('Activer l’assistant IA sur mes données (facultatif). L’assistant peut lire vos statistiques et votre planning pour répondre à vos questions. Ces données sont traitées par {provider}, notre fournisseur d’IA.', { provider: ai.provider || t('notre prestataire d’IA') })} <Link to="/politique-ia" target="_blank">{t('Politique IA')}</Link></span>
              </label>
            )}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <><span className="spin" aria-hidden="true" />{t('Création du compte…')}</> : t('Créer mon compte gratuitement')}</button>
            <p className="tiny muted" style={{ textAlign: 'center' }}>
              {t('En créant un compte, vous acceptez les')} <a href={`${legal}/cgu`} target="_blank" rel="noreferrer">{t('conditions d’utilisation')}</a>{' '}
              {t('et la')} <a href={`${legal}/confidentialite`} target="_blank" rel="noreferrer">{t('politique de confidentialité')}</a>.
            </p>
          </form>
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('Déjà un compte ?')} <Link to={`/connexion${suite}`} style={{ fontWeight: 600 }}>{t('Se connecter')}</Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
