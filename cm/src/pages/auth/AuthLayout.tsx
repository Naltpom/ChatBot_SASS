// Mise en page commune connexion / inscription / mot de passe oublié.
// Mobile : le formulaire seul, centré. Ordinateur : formulaire à gauche, panneau de marque à droite
// avec la démo de l'app qui se joue toute seule.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../../components/ui'
import Demo from '../../landing/Demo'

export default function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-main">
        <div className="auth-top">
          <Brand to="/" />
          <Link to="/" className="small muted">← Accueil</Link>
        </div>
        <div className="auth-form">{children}</div>
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Un seul compte pour chapote.fr, music.chapote.fr et cm.chapote.fr.
        </p>
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <div style={{ fontSize: 15, fontWeight: 600, color: '#a1a1a6' }}>TikTok · YouTube Shorts · Instagram Reels</div>
        {aside ?? (
          <h2>Publiez partout.<br /><span className="em">Voyez tout.</span></h2>
        )}
        <div className="dm-frame"><Demo autoOnly /></div>
      </aside>
    </div>
  )
}

export function PasswordStrength({ value }: { value: string }) {
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++
  const colors = ['var(--danger)', 'var(--warn)', 'var(--accent)', 'var(--ok)']
  const label = value.length < 8 ? 'Une phrase de passe, c’est encore mieux.' : ['Faible', 'Correct', 'Bon', 'Excellent'][Math.max(0, score - 1)]
  return (
    <div className="col" style={{ gap: 6 }} aria-live="polite">
      <div className="strength">{[0, 1, 2, 3].map(i => <span key={i} style={i < score ? { background: colors[score - 1] } : undefined} />)}</div>
      <span className="field-hint">{label}</span>
    </div>
  )
}
