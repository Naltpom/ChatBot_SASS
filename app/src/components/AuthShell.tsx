// Carte centrée + constantes communes aux pages auth secondaires
// (ForgotPassword / ResetPassword / VerifyEmail). Extrait d'une page pour ne pas
// faire dépendre ces pages d'un détail d'implémentation d'une autre page.
import { Link } from 'react-router-dom'
import HatIcon from './HatIcon'

export const NAVY = '#1C3F5C'

export const INPUT_BASE: React.CSSProperties = {
  width: '100%', height: 46, border: '1px solid #D8DEE6', borderRadius: 12,
  padding: '0 14px', fontSize: 15, color: '#1E2A32', background: '#fff',
  fontFamily: 'inherit', outline: 'none',
}

// Longueur minimale du mot de passe côté UI — alignée sur le backend
// (api auth.PASSWORD_MIN_LENGTH). Source unique pour Register + ResetPassword.
export const PASSWORD_MIN_LENGTH = 8

export function Shell({ children, isMobile }: { children: React.ReactNode; isMobile: boolean }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? 16 : 32,
      background:
        'radial-gradient(circle at 15% 18%, rgba(47,158,121,.08), transparent 45%),' +
        'radial-gradient(circle at 85% 28%, rgba(140,109,255,.07), transparent 45%),#F0F2F5',
      fontFamily: "'Inter', system-ui, sans-serif", color: '#1E2A32',
    }}>
      <div style={{
        width: '100%', maxWidth: 440, background: '#fff',
        borderRadius: isMobile ? 22 : 24, padding: isMobile ? '32px 22px' : '44px 40px',
        boxShadow: '0 44px 100px -44px rgba(28,63,92,.42)',
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 26 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HatIcon size={19} color="#fff" />
          </span>
          <span style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 20, color: '#1E2A32' }}>Chapote</span>
        </Link>
        {children}
      </div>
    </div>
  )
}
