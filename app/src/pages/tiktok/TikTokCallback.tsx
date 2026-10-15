// /tiktok/callback — redirect OAuth de l'app TikTok « Chapote Publisher ».
//
// Deux modes :
//  - automatique : state émis par le tableau de bord (préfixe « web_ ») -> l'API
//    vérifie le state (cookie httpOnly), échange le code côté serveur, stocke les
//    jetons chiffrés, puis on revient sur /tiktok ;
//  - manuel : ?manual=1, ou state d'un autre émetteur (scripts/tiktok.py) -> le
//    code est seulement affiché pour `python3 scripts/tiktok.py exchange`, il
//    n'est envoyé nulle part.
// Page autoportante (mise en page des pages légales), hors shell applicatif.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../AuthContext'
import { errMsg } from '../../utils/errors'
import { TikTokAccount, useNoIndex } from './common'

const WEB_STATE_PREFIX = 'web_'

function readParams() {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  return {
    code: p.get('code'),
    state: p.get('state'),
    error: p.get('error'),
    errorDescription: p.get('error_description'),
    manual: p.get('manual') === '1',
  }
}

export default function TikTokCallback() {
  useNoIndex()
  const [params] = useState(readParams)
  const { code, state, error, errorDescription } = params
  const manual = !!code && (params.manual || !state || !state.startsWith(WEB_STATE_PREFIX))

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px 90px', color: '#1f2937', fontSize: 15, lineHeight: 1.65 }}>
        <Link to="/" style={{ color: '#2563eb', fontSize: 14, textDecoration: 'none' }}>← Retour à l'accueil</Link>
        <h1 style={{ fontSize: 28, margin: '22px 0 8px' }}>Autorisation TikTok</h1>
        {error ? (
          <ErrorBlock code={error} description={errorDescription} />
        ) : !code ? (
          <p>Aucun code reçu.</p>
        ) : manual ? (
          <ManualCode code={code} state={state} />
        ) : (
          <AutoExchange code={code} state={state!} />
        )}
      </div>
    </div>
  )
}

function ErrorBlock({ code, description }: { code: string; description?: string | null }) {
  return (
    <div className="infobox danger" role="alert">
      <div className="ib-title">Erreur : {code}</div>
      {description && <div>{description}</div>}
      <div style={{ marginTop: 8 }}><Link to="/tiktok">Retour au tableau de bord TikTok</Link></div>
    </div>
  )
}

function ManualCode({ code, state }: { code: string; state: string | null }) {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      inputRef.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
  }
  return (
    <>
      <p>Copiez ce code et collez-le dans la commande <code>python3 scripts/tiktok.py exchange</code>. Il expire après quelques minutes.</p>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, margin: '18px 0 6px' }} htmlFor="tt-code">Code d'autorisation</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="tt-code" ref={inputRef} className="mono" type="text" readOnly value={code}
               spellCheck={false} autoComplete="off" style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="btn btn-primary" onClick={copy}>Copier</button>
      </div>
      <p aria-live="polite" style={{ fontSize: 13, color: '#15803d', minHeight: '1.2em' }}>{copied ? 'Code copié.' : ''}</p>
      {state && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, margin: '18px 0 6px' }} htmlFor="tt-state">State</label>
          <input id="tt-state" className="mono" type="text" readOnly value={state} spellCheck={false} autoComplete="off" />
        </>
      )}
    </>
  )
}

function AutoExchange({ code, state }: { code: string; state: string }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (loading || !user?.is_superadmin || started.current) return
    started.current = true  // le code est à usage unique (StrictMode monte deux fois)
    // Retire le code de la barre d'adresse (historique, copies d'URL).
    window.history.replaceState(null, '', window.location.pathname)
    api<TikTokAccount>('/api/admin/tiktok/oauth/exchange', { method: 'POST', body: { code, state } })
      .then(acc => navigate(`/tiktok?connected=${encodeURIComponent(acc.display_name || acc.open_id)}`, { replace: true }))
      .catch(e => setError(errMsg(e)))
  }, [loading, user, code, state, navigate])

  if (loading) return <p>Chargement…</p>
  if (!user) return <p>Connectez-vous à votre session administrateur (<Link to="/login">connexion</Link>), puis relancez la connexion TikTok depuis <Link to="/tiktok">le tableau de bord</Link>.</p>
  if (!user.is_superadmin) return <p>Accès réservé à l'administrateur.</p>
  if (error) return <ErrorBlock code="Connexion impossible" description={error} />
  return <p>Connexion du compte TikTok en cours…</p>
}
