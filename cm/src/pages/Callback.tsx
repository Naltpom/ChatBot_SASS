// Retour de TikTok, Google ou Instagram après l'autorisation : échange du code côté serveur,
// puis retour à la page Comptes. Le code n'est jamais gardé dans l'adresse.
// Compte déjà connecté dans un autre espace Chapote : refusé. La personne qui vient de s'y
// connecter chez la plateforme (preuve qu'elle le contrôle) peut le reprendre.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, claimAccount, exchangeOAuth, PLATFORM_LABEL, type Platform } from '../api'
import { Loading, Msg } from '../components/ui'
import { useSession } from '../session'

export default function Callback({ platform }: { platform: Platform }) {
  const nav = useNavigate()
  const { setOrg, org, spaces } = useSession()
  const [err, setErr] = useState('')
  const [claim, setClaim] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
      .catch(e => {
        const ae = e as ApiError
        setErr(ae.message)
        if (ae.data?.code === 'account_taken' && ae.data.claim_token) setClaim(ae.data.claim_token)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const space = spaces.find(s => s.org_id === org)?.name || 'Espace perso'
  const takeOver = async () => {
    if (!claim || !window.confirm(`Reprendre ce compte dans « ${space} » ? Il sera retiré de l’autre espace, avec son planning à venir.`)) return
    setBusy(true)
    try {
      const r = await claimAccount(claim, org)
      nav('/comptes', { replace: true, state: { flash: `Compte ${PLATFORM_LABEL[platform]} repris dans « ${space} »${r.moved_targets ? `, avec ${r.moved_targets} publication${r.moved_targets > 1 ? 's' : ''} à venir` : ''}.` } })
    } catch (e) { setErr((e as Error).message); setClaim(null) } finally { setBusy(false) }
  }

  return (
    <div className="col" style={{ maxWidth: 560, margin: '24px auto', width: '100%' }}>
      <h1>Connexion {PLATFORM_LABEL[platform]}</h1>
      {!err && <Loading label="Connexion du compte…" />}
      {err && <Msg kind="err">{err}</Msg>}
      {claim && (
        <div className="card col" style={{ gap: 10 }}>
          <h2>Vous êtes responsable de ce compte ?</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Vous venez de vous connecter au compte {PLATFORM_LABEL[platform]} lui-même : c’est la preuve que vous le contrôlez.
            Vous pouvez donc le reprendre (par exemple après le départ de la personne qui l’avait relié). Il quittera l’autre
            espace avec ses publications à venir, et arrivera dans « {space} ».
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={takeOver}>Reprendre ce compte dans « {space} »</button>
          <p className="tiny muted" style={{ margin: 0 }}>Valable 15 minutes. Sinon, demandez à la personne en charge de vous le transférer.</p>
        </div>
      )}
      {err && <Link to="/comptes">Retour aux comptes</Link>}
    </div>
  )
}
