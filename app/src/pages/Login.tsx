import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

function useIsMobile(maxWidth = 760) {
  const query = `(max-width: ${maxWidth}px)`
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return isMobile
}

const NAVY = '#1C3F5C'
const INPUT_BASE: React.CSSProperties = {
  width: '100%',
  height: 46,
  border: '1px solid #D8DEE6',
  borderRadius: 12,
  padding: '0 14px',
  fontSize: 15,
  color: '#1E2A32',
  background: '#fff',
  transition: 'border-color .2s, box-shadow .2s',
  fontFamily: 'inherit',
}

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 16.5c0-.6.4-1 1-1.1 2.2-.6 4.4-.9 7-.9s4.8.3 7 .9c.6.1 1 .5 1 1.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 15.1l1.2-7.2c.2-1.1 1.2-1.9 2.3-1.9h2c1.1 0 2.1.8 2.3 1.9l1.2 7.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5 12.5l4 4 10-10.5" stroke="#7FE3BE" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      navigate('/app')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function focus(e: React.FocusEvent<HTMLInputElement>) {
    e.target.style.borderColor = '#2F9E79'
    e.target.style.boxShadow = '0 0 0 3px rgba(47,158,121,.15)'
  }
  function blur(e: React.FocusEvent<HTMLInputElement>) {
    e.target.style.borderColor = '#D8DEE6'
    e.target.style.boxShadow = 'none'
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 16 : 32,
        background:
          'radial-gradient(circle at 15% 18%, rgba(47,158,121,.08), transparent 45%),' +
          'radial-gradient(circle at 85% 28%, rgba(140,109,255,.07), transparent 45%),' +
          '#F0F2F5',
        fontFamily: "'Inter', system-ui, sans-serif",
        color: '#1E2A32',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 440 : 920,
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          background: '#fff',
          borderRadius: isMobile ? 22 : 28,
          overflow: 'hidden',
          boxShadow: '0 44px 100px -44px rgba(28,63,92,.42)',
        }}
      >
        {/* Left — navy gradient (masqué en mobile, on garde le formulaire seul) */}
        {!isMobile && (
        <div
          style={{
            background: 'linear-gradient(165deg, #1C3F5C, #15344b)',
            color: '#fff',
            padding: '48px 44px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                background: 'rgba(255,255,255,.13)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BrandMark />
            </span>
            <span style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 21 }}>Chapote</span>
          </div>
          <h2
            style={{
              fontFamily: "'Clash Display', sans-serif",
              fontWeight: 600,
              fontSize: 30,
              margin: '38px 0 0',
              lineHeight: 1.15,
            }}
          >
            Bon retour 👋
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: '#A8C0D0', margin: '12px 0 0' }}>
            Pilotez vos bots hybrides, vos plafonds IA et votre relais humain — depuis un seul endroit.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 30 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#D6E2EA' }}>
              <Check />Arbre guidé illimité
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#D6E2EA' }}>
              <Check />IA plafonnée, budget maîtrisé
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#D6E2EA' }}>
              <Check />Données 100% françaises
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12.5, color: '#7FA0B5', marginTop: 30 }}>
            🇫🇷 Hébergement français · Conforme RGPD
          </div>
        </div>
        )}

        {/* Right — form */}
        <div style={{ padding: isMobile ? '32px 22px' : '48px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h3 style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 23, margin: '0 0 24px' }}>
            Se connecter
          </h3>

          <form onSubmit={submit}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={focus}
              onBlur={blur}
              required
              autoComplete="email"
              placeholder="vous@entreprise.fr"
              style={INPUT_BASE}
            />

            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, margin: '18px 0 7px' }}>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={focus}
              onBlur={blur}
              required
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              style={INPUT_BASE}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#6B7B8D', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  style={{ accentColor: '#2F9E79', width: 15, height: 15 }}
                />
                Se souvenir de moi
              </label>
              <a href="#" style={{ fontSize: 13.5, color: NAVY, fontWeight: 600, textDecoration: 'none' }}>
                Mot de passe oublié ?
              </a>
            </div>

            {error && (
              <div
                style={{
                  margin: '18px 0 0',
                  padding: '11px 14px',
                  borderRadius: 12,
                  background: 'rgba(232,106,95,.1)',
                  border: '1px solid rgba(232,106,95,.28)',
                  color: '#C0473D',
                  fontSize: 13.5,
                  lineHeight: 1.4,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: '100%',
                height: 48,
                marginTop: 22,
                background: NAVY,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 15.5,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
                transition: 'transform .15s, opacity .15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { if (!busy) e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
            >
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '22px 0' }}>
            <span style={{ flex: 1, height: 1, background: '#E8ECF0' }} />
            <span style={{ fontSize: 12.5, color: '#9AA7B4' }}>ou</span>
            <span style={{ flex: 1, height: 1, background: '#E8ECF0' }} />
          </div>

          <button
            type="button"
            onClick={() => {}}
            style={{
              width: '100%',
              height: 46,
              background: '#fff',
              color: '#1E2A32',
              border: '1px solid #D8DEE6',
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 14.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              transition: 'border-color .2s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = NAVY }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#D8DEE6' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 01-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-7.9z" />
              <path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.8 0-5.2-1.9-6.1-4.5H2.3v2.8A11 11 0 0012 23z" />
              <path fill="#FBBC05" d="M5.9 14.1a6.6 6.6 0 010-4.2V7.1H2.3a11 11 0 000 9.8z" />
              <path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 002.3 7.1l3.6 2.8C6.8 7.3 9.2 5.4 12 5.4z" />
            </svg>
            Continuer avec Google
          </button>

          <p style={{ textAlign: 'center', fontSize: 14, color: '#6B7B8D', margin: '24px 0 0' }}>
            Pas encore de compte ?{' '}
            <Link to="/register" style={{ color: NAVY, fontWeight: 600, textDecoration: 'none' }}>
              Créer un compte gratuitement
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
