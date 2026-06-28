// Confirmation d'adresse email — lit ?token= dans l'URL, appelle au montage
// POST /api/auth/verify-email/confirm puis affiche le succès ou l'échec. Si une
// session est ouverte, on rafraîchit le user (la bannière disparaît).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { errMsg } from '../utils/errors'
import { Shell, NAVY } from '../components/AuthShell'

const MINT = '#2F9E79'

export default function VerifyEmail() {
  const isMobile = useIsMobile(760)
  const { user, refreshUser } = useAuth()
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending')
  const [error, setError] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // StrictMode : un seul appel
    ran.current = true
    const token = new URLSearchParams(window.location.search).get('token') || ''
    if (!token) { setState('error'); setError('Lien invalide : aucun jeton fourni.'); return }
    api('/api/auth/verify-email/confirm', { method: 'POST', body: { token } })
      .then(async () => {
        setState('ok')
        // Met à jour la session ouverte (la bannière "Confirmez votre email" disparaît).
        if (user) { try { await refreshUser() } catch { /* best-effort */ } }
      })
      .catch((err: unknown) => {
        setState('error')
        setError(errMsg(err, 'Lien de confirmation invalide ou expiré.'))
      })
  }, [user, refreshUser])

  return (
    <Shell isMobile={isMobile}>
      <h3 style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 23, margin: '0 0 12px' }}>
        Confirmation de l'e-mail
      </h3>
      {state === 'pending' && (
        <p style={{ fontSize: 14, color: '#6B7B8D', lineHeight: 1.55 }}>Vérification en cours…</p>
      )}
      {state === 'ok' && (
        <>
          <p style={{ fontSize: 14, color: '#1E2A32', margin: '0 0 22px', lineHeight: 1.55 }}>
            <span style={{ color: MINT, fontWeight: 700 }}>✓</span> Votre adresse e-mail est confirmée. Merci !
          </p>
          <Link to={user ? '/app' : '/login'} style={{ color: NAVY, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
            {user ? 'Aller au tableau de bord →' : 'Se connecter →'}
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <p style={{ fontSize: 14, color: '#C0473D', margin: '0 0 22px', lineHeight: 1.55 }}>{error}</p>
          <Link to={user ? '/app' : '/login'} style={{ color: NAVY, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
            {user ? 'Retour au tableau de bord →' : 'Retour à la connexion →'}
          </Link>
        </>
      )}
    </Shell>
  )
}
