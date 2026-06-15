import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { Btn, Card } from '../ui'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  return (
    <div className="center-page">
      <form onSubmit={submit}>
        <Card className="auth-card">
          <div className="auth-logo">
            <img src="/brand/icon.svg" alt="Chapote" />
            <span className="nm">Chapote</span>
          </div>
          <p style={{ margin: 0, textAlign: 'center', fontSize: 12.5, color: 'var(--mut)' }}>
            Connectez-vous (compte local ou intranet)
          </p>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Mot de passe" value={password}
                 onChange={e => setPassword(e.target.value)} required />
          {error && <div className="error">{error}</div>}
          <Btn type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
            {busy ? '…' : 'Se connecter'}
          </Btn>
          <Link to="/register" className="btn btn-ghost" style={{ justifyContent: 'center' }}>
            Pas de compte ? S'inscrire
          </Link>
        </Card>
      </form>
    </div>
  )
}
