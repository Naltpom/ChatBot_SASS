// Mot de passe oublié — saisie de l'email -> POST /api/auth/password/forgot.
// Réponse TOUJOURS neutre (pas d'énumération) : on affiche la même confirmation
// que le compte existe ou non. Style aligné sur Login (carte centrée).
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useIsMobile } from '../hooks/useMediaQuery'
import { errMsg } from '../utils/errors'
import { Shell, NAVY, INPUT_BASE } from '../components/AuthShell'

export default function ForgotPassword() {
  const isMobile = useIsMobile(760)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/api/auth/password/forgot', { method: 'POST', body: { email: email.trim() } })
      setSent(true)
    } catch (err: unknown) {
      setError(errMsg(err, 'Demande impossible. Réessayez.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell isMobile={isMobile}>
      <h3 style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 23, margin: '0 0 8px' }}>
        Mot de passe oublié
      </h3>
      {sent ? (
        <>
          <p style={{ fontSize: 14, color: '#6B7B8D', margin: '0 0 22px', lineHeight: 1.55 }}>
            Si un compte existe pour cette adresse, un e-mail vient d'être envoyé avec un lien
            de réinitialisation. Pensez à vérifier vos spams.
          </p>
          <Link to="/login" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
            ← Retour à la connexion
          </Link>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, color: '#6B7B8D', margin: '0 0 22px', lineHeight: 1.55 }}>
            Saisissez l'adresse e-mail de votre compte : nous vous enverrons un lien pour
            choisir un nouveau mot de passe.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="forgot-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 }}>Email</label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-invalid={error ? true : undefined}
              placeholder="vous@entreprise.fr"
              style={INPUT_BASE}
            />
            {error && (
              <div role="alert" style={{ margin: '18px 0 0', padding: '11px 14px', borderRadius: 12,
                            background: 'rgba(232,106,95,.1)', border: '1px solid rgba(232,106,95,.28)',
                            color: '#C0473D', fontSize: 13.5, lineHeight: 1.4 }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={busy}
                    style={{ width: '100%', height: 48, marginTop: 22, background: NAVY, color: '#fff',
                             border: 'none', borderRadius: 12, fontWeight: 600, fontSize: 15.5,
                             cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: 'inherit' }}>
              {busy ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </form>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7B8D', margin: '24px 0 0' }}>
            <Link to="/login" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none' }}>
              ← Retour à la connexion
            </Link>
          </p>
        </>
      )}
    </Shell>
  )
}
