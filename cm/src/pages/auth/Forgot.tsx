// Mot de passe oublié : envoie le lien de réinitialisation (réponse toujours neutre côté API).
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../../api'
import { Msg } from '../../components/ui'
import AuthLayout from './AuthLayout'
import { t } from '../../i18n'

export default function Forgot() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await forgotPassword(email.trim()); setSent(true) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <AuthLayout>
      <div className="col" style={{ gap: 6 }}>
        <h1>{t('Mot de passe oublié')}</h1>
        <p className="muted">{t('Indiquez l’e-mail de votre compte : nous vous envoyons un lien pour en choisir un nouveau.')}</p>
      </div>
      {sent ? (
        <>
          <Msg kind="ok">{t('Si un compte existe pour {email}, un e-mail vient de partir. Pensez à regarder les indésirables.', { email })}</Msg>
          <p className="small muted">{t('Compte créé avec Google ? Pas de mot de passe à réinitialiser : utilisez « Continuer avec Google ».')}</p>
        </>
      ) : (
        <form className="col" style={{ gap: 16 }} onSubmit={submit}>
          <label className="field" htmlFor="email">{t('E-mail')}
            <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                   autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} />
          </label>
          {err && <Msg kind="err">{err}</Msg>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? t('Envoi…') : t('Envoyer le lien')}</button>
        </form>
      )}
      <p className="muted" style={{ textAlign: 'center' }}><Link to="/connexion" style={{ fontWeight: 600 }}>← {t('Retour à la connexion')}</Link></p>
    </AuthLayout>
  )
}
