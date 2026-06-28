// Réinitialisation du mot de passe — lit ?token= dans l'URL, formulaire nouveau
// mot de passe (+ confirmation, mêmes règles qu'à l'inscription : 8 car. min) ->
// POST /api/auth/password/reset. Succès -> redirection vers /login.
import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useIsMobile } from '../hooks/useMediaQuery'
import { errMsg } from '../utils/errors'
import { Shell, NAVY, INPUT_BASE, PASSWORD_MIN_LENGTH } from '../components/AuthShell'

export default function ResetPassword() {
  const isMobile = useIsMobile(760)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Redirection automatique vers la connexion après le succès.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => navigate('/login'), 2500)
    return () => clearTimeout(t)
  }, [done, navigate])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pwd.length < PASSWORD_MIN_LENGTH) { setError(`Mot de passe trop court (${PASSWORD_MIN_LENGTH} caractères minimum).`); return }
    if (pwd !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return }
    setBusy(true)
    try {
      await api('/api/auth/password/reset', { method: 'POST', body: { token, new_password: pwd } })
      setDone(true)
    } catch (err: unknown) {
      setError(errMsg(err, 'Lien invalide ou expiré. Redemandez une réinitialisation.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell isMobile={isMobile}>
      <h3 style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 23, margin: '0 0 8px' }}>
        Nouveau mot de passe
      </h3>
      {done ? (
        <>
          <p style={{ fontSize: 14, color: '#6B7B8D', margin: '0 0 22px', lineHeight: 1.55 }}>
            Votre mot de passe a été modifié. Vous allez être redirigé vers la connexion…
          </p>
          <Link to="/login" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
            Se connecter maintenant →
          </Link>
        </>
      ) : !token ? (
        <>
          <p style={{ fontSize: 14, color: '#C0473D', margin: '0 0 22px', lineHeight: 1.55 }}>
            Lien invalide : aucun jeton fourni. Redemandez une réinitialisation.
          </p>
          <Link to="/forgot-password" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
            Mot de passe oublié →
          </Link>
        </>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="reset-pwd" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 }}>
            Nouveau mot de passe <span style={{ fontWeight: 500, color: '#9AA7B4' }}>({PASSWORD_MIN_LENGTH} caractères min.)</span>
          </label>
          <input id="reset-pwd" type="password" value={pwd} onChange={e => setPwd(e.target.value)} required
                 autoComplete="new-password" aria-invalid={error ? true : undefined} placeholder="••••••••" style={INPUT_BASE} />
          <label htmlFor="reset-pwd-confirm" style={{ display: 'block', fontSize: 13, fontWeight: 600, margin: '18px 0 7px' }}>
            Confirmer le mot de passe
          </label>
          <input id="reset-pwd-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                 autoComplete="new-password" aria-invalid={error ? true : undefined} placeholder="••••••••" style={INPUT_BASE} />
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
            {busy ? 'Validation…' : 'Changer mon mot de passe'}
          </button>
        </form>
      )}
    </Shell>
  )
}
