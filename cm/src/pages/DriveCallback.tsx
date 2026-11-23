// Retour de Google après l'accord « Google Drive » (archivage) : échange du code côté serveur,
// puis retour à la Bibliothèque. Le code n'est jamais gardé dans l'adresse.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { exchangeDriveOAuth } from '../api'
import { Loading, Msg } from '../components/ui'
import { useSession } from '../session'

export default function DriveCallback() {
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
      setErr(p.get('error') === 'access_denied' ? 'Vous avez refusé l’accès : le Drive n’a pas été connecté.'
        : `Connexion Google Drive interrompue (${p.get('error') || 'réponse incomplète'}).`)
      return
    }
    exchangeDriveOAuth(code, state)
      .then(r => { setOrg(r.org_id); nav('/bibliotheque', { replace: true }) })
      .catch(e => setErr((e as Error).message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ maxWidth: 560, margin: '24px auto', width: '100%' }}>
      <h1>Connexion Google Drive</h1>
      {!err && <Loading label="Connexion du Drive…" />}
      {err && <><Msg kind="err">{err}</Msg><Link to="/bibliotheque">Retour à la Bibliothèque</Link></>}
    </div>
  )
}
