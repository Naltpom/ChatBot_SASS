// /youtube/callback — redirect OAuth Google du module YouTube « Chapote Publisher »
// (URI déclarée dans le client OAuth Google : https://chapote.fr/youtube/callback).
//
// L'API vérifie le state (JWT signé : tenant + utilisateur, 10 min, usage
// unique), échange le code côté serveur et enregistre le compte dans le tenant
// d'origine ; on revient ensuite sur la page YouTube de l'Espace client.
// Page autoportante (mise en page des pages légales), hors shell applicatif.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../AuthContext'
import { errMsg } from '../../utils/errors'
import { YouTubeAccount } from './common'

function readParams() {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  return {
    code: p.get('code'),
    state: p.get('state'),
    error: p.get('error'),
    errorDescription: p.get('error_description'),
  }
}

export default function YouTubeCallback() {
  const [{ code, state, error, errorDescription }] = useState(readParams)

  // Jamais indexée (complète l'en-tête X-Robots-Tag de nginx).
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px 90px', color: '#1f2937', fontSize: 15, lineHeight: 1.65 }}>
        <Link to="/" style={{ color: '#2563eb', fontSize: 14, textDecoration: 'none' }}>← Retour à l'accueil</Link>
        <h1 style={{ fontSize: 28, margin: '22px 0 8px' }}>Connexion YouTube</h1>
        {error ? (
          <ErrorBlock title={error === 'access_denied' ? 'Autorisation refusée' : `Erreur : ${error}`}
                      description={error === 'access_denied' ? "Vous avez refusé l'accès : aucune chaîne n'a été connectée." : errorDescription} />
        ) : !code || !state ? (
          <ErrorBlock title="Lien incomplet" description="Aucun code d'autorisation reçu. Relancez la connexion depuis l'Espace client." />
        ) : (
          <AutoExchange code={code} state={state} />
        )}
      </div>
    </div>
  )
}

function ErrorBlock({ title, description }: { title: string; description?: string | null }) {
  return (
    <div className="infobox danger" role="alert">
      <div className="ib-title">{title}</div>
      {description && <div>{description}</div>}
      <div style={{ marginTop: 8 }}><Link to="/app/youtube">Retour à la page YouTube de l'Espace client</Link></div>
    </div>
  )
}

function AutoExchange({ code, state }: { code: string; state: string }) {
  const { user, loading, setActiveOrg } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (loading || !user || started.current) return
    started.current = true  // le code est à usage unique (StrictMode monte deux fois)
    // Retire le code de la barre d'adresse (historique, copies d'URL).
    window.history.replaceState(null, '', window.location.pathname)
    api<{ account: YouTubeAccount; org_id: number | null }>('/api/youtube/oauth/exchange', { method: 'POST', body: { code, state } })
      .then(({ account, org_id }) => {
        const org = org_id ? user.organizations.find(o => o.id === org_id) : null
        if (org) setActiveOrg(org)
        const q = new URLSearchParams({ connected: account.title || 'YouTube' })
        if (!org_id && user.organizations.length) q.set('space', 'perso')
        navigate(`/app/youtube?${q}`, { replace: true })
      })
      .catch(e => setError(errMsg(e)))
  }, [loading, user, code, state, navigate, setActiveOrg])

  if (loading) return <p>Chargement…</p>
  if (!user) return <p>Connectez-vous à votre Espace client (<Link to="/login">connexion</Link>), puis relancez la connexion depuis la page YouTube.</p>
  if (error) return <ErrorBlock title="Connexion impossible" description={error} />
  return <p>Connexion de la chaîne YouTube en cours…</p>
}
