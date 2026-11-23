// Retour de TikTok, Google ou Instagram après l'autorisation : échange du code côté serveur,
// puis retour à la page Comptes. Le code n'est jamais gardé dans l'adresse.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { exchangeOAuth, PLATFORM_LABEL, type Platform } from '../api'
import { Loading, Msg } from '../components/ui'
import { useSession } from '../session'

export default function Callback({ platform }: { platform: Platform }) {
  const nav = useNavigate()
  const { setOrg } = useSession()
  const [err, setErr] = useState('')
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    const p = new URLSearchParams(window.location.search)
    window.history.replaceState(null, '', window.location.pathname)
    const code = p.get('code'), state = p.get('state')
    if (p.get('error') || !code || !state) {
      setErr(p.get('error') === 'access_denied' || p.get('error_reason') === 'user_denied'
        ? 'Vous avez refusé l’accès : aucun compte n’a été connecté.'
        : `Connexion ${PLATFORM_LABEL[platform]} interrompue (${p.get('error_description') || p.get('error') || 'réponse incomplète'}).`)
      return
    }
    exchangeOAuth(platform, code, state)
      .then(r => { setOrg(r.org_id); nav('/comptes', { replace: true, state: { flash: `Compte ${PLATFORM_LABEL[platform]} connecté.` } }) })
      .catch(e => setErr((e as Error).message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ maxWidth: 520, margin: '24px auto', width: '100%' }}>
      <h1>Connexion {PLATFORM_LABEL[platform]}</h1>
      {err ? <><Msg kind="err">{err}</Msg><Link to="/comptes">Retour aux comptes</Link></> : <Loading label="Connexion du compte…" />}
    </div>
  )
}
