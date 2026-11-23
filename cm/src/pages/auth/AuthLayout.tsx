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
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, letterSpacing: '.08em', color: '#9fb7c9', display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ width: 32, height: 2, background: '#2F9E79' }} />TIKTOK · YOUTUBE · INSTAGRAM
        </div>
        {aside ?? (
          <h2>Une vidéo.<br />Tous vos comptes.<br /><span className="em">Au bon moment.</span></h2>
        )}
        <div style={{ background: '#0c1d2b', borderRadius: 20, padding: 18, border: '1px solid rgba(255,255,255,.08)', maxWidth: 460 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#9fb7c9', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, color: '#fff' }}>Jeudi 26</span><span>+148 abonnés hier</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PREVIEW.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#13293b', borderRadius: 12, padding: '10px 12px' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#fff', width: 44 }}>{x.t}</span>
                <span className={`dot dot-${x.p}`} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: '#dbe6ee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                <span style={{ fontSize: 12, color: '#6fd3ae' }}>{x.s}</span>
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
