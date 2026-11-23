// Mise en page commune connexion / inscription / mot de passe oublié.
// Mobile : le formulaire seul, centré. Ordinateur : formulaire à gauche, panneau de marque à droite.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../../components/ui'

const PREVIEW = [
  { t: '18:30', p: 'tiktok', title: 'Clair de lune — tuto main gauche', s: 'Programmée' },
  { t: '18:30', p: 'youtube', title: 'Clair de lune — tuto main gauche', s: 'Programmée' },
  { t: '19:00', p: 'instagram', title: 'Coulisses du studio', s: 'Programmée' },
]

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
        <div style={{ background: '#1c1c1e', borderRadius: 24, padding: 18, maxWidth: 460 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#a1a1a6', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, color: '#fff' }}>Jeudi 26</span><span>+148 abonnés hier</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PREVIEW.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#2c2c2e', borderRadius: 14, padding: '10px 12px' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#fff', width: 44 }}>{x.t}</span>
                <span className={`dot dot-${x.p}`} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: '#f5f5f7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                <span style={{ fontSize: 12, color: '#2997ff' }}>{x.s}</span>
              </div>
            ))}
          </div>
        </div>
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
  const label = value.length < 8 ? '8 caractères minimum' : ['Faible', 'Correct', 'Bon', 'Excellent'][Math.max(0, score - 1)]
  return (
    <div className="col" style={{ gap: 6 }} aria-live="polite">
      <div className="strength">{[0, 1, 2, 3].map(i => <span key={i} style={i < score ? { background: colors[score - 1] } : undefined} />)}</div>
      <span className="field-hint">{value ? label : '8 caractères minimum. Une phrase de passe, c’est encore mieux.'}</span>
    </div>
  )
}
