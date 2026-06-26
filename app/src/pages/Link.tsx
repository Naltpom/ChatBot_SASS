// Écran de consentement d'appairage (device flow OAuth du plugin WordPress).
// Route /link : un utilisateur CONNECTÉ au dashboard approuve (ou refuse) qu'un
// site WordPress puisse gérer ses chatbots Chapote. Le code court (XXXX-XXXX) est
// soit prérempli depuis l'URL (?code=…, lien verification_uri_complete fourni par
// le plugin), soit saisi à la main. Auth = même Bearer que le reste du dashboard
// (helper api()). Non connecté -> on mémorise le retour puis on file vers /login.
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { api, ApiError } from '../api'
import { errMsg } from '../utils/errors'
import { Btn, InfoBox } from '../ui'
import HatIcon from '../components/HatIcon'

const NAVY = '#1C3F5C'

// Réponse de /api/oauth/device/{info,approve,deny} (cf. DeviceInfoOut côté API).
interface DeviceInfo {
  user_code: string
  site_url: string | null
  status: string
}

// Affichage compact d'une URL de site (sans schéma ni www, sans slash final).
function prettySite(raw: string | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    return (u.host + (u.pathname === '/' ? '' : u.pathname)).replace(/^www\./, '')
  } catch {
    return raw
  }
}

export default function Link() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const urlCode = new URLSearchParams(location.search).get('code') || ''
  const [code, setCode] = useState(urlCode)
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [acting, setActing] = useState<null | 'approve' | 'deny'>(null)
  const [result, setResult] = useState<null | { kind: 'approved' | 'denied'; site: string | null }>(null)
  const [error, setError] = useState('')

  // Récupère l'objet d'appairage (consentement). 404 = code inconnu/expiré.
  async function verify(raw: string) {
    const value = raw.trim()
    if (!value) return
    setError('')
    setInfo(null)
    setChecking(true)
    try {
      const data = await api<DeviceInfo>(`/api/oauth/device/info?user_code=${encodeURIComponent(value)}`)
      setInfo(data)
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) setError('Code inconnu ou expiré.')
      else setError(errMsg(err, 'Vérification impossible.'))
    } finally {
      setChecking(false)
    }
  }

  // Code présent dans l'URL : on vérifie automatiquement dès que l'utilisateur
  // est connu (évite un aller-retour de saisie). On ne dépend QUE de l'auth +
  // du code d'URL (pas de `verify` dans les deps) pour ne lancer qu'un appel.
  useEffect(() => {
    if (!loading && user && urlCode) verify(urlCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, urlCode])

  // Non connecté : on mémorise le retour (code inclus) puis on redirige vers le
  // login. Après authentification, Login consomme `cbsaas_after_login` et y revient.
  useEffect(() => {
    if (!loading && !user) {
      try { sessionStorage.setItem('cbsaas_after_login', `/link${location.search}`) } catch { /* SSR / storage off */ }
    }
  }, [loading, user, location.search])

  async function decide(action: 'approve' | 'deny') {
    if (!info) return
    setError('')
    setActing(action)
    try {
      const data = await api<DeviceInfo>(`/api/oauth/device/${action}`, {
        method: 'POST',
        body: { user_code: info.user_code },
      })
      setResult({ kind: action === 'approve' ? 'approved' : 'denied', site: data.site_url ?? info.site_url })
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) setError('Code inconnu ou expiré.')
      else if (err instanceof ApiError && err.status === 400) setError('Cet appairage n’est plus valide (déjà traité ou expiré).')
      else setError(errMsg(err, 'Action impossible, réessayez.'))
    } finally {
      setActing(null)
    }
  }

  // En attente de la résolution d'auth (init AuthContext / auto-login local).
  if (loading) return <div className="center-page">Chargement…</div>
  // Pas connecté -> login (le retour a été mémorisé par l'effet ci-dessus).
  if (!user) return <Navigate to="/login" replace />

  const site = prettySite(info?.site_url ?? null)

  return (
    <div className="center-page" style={{ padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 460 }}>
        {/* En-tête de marque (cohérent Login / Register). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 10, background: NAVY,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <HatIcon size={19} color="#fff" />
          </span>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 19, color: 'var(--ink)' }}>Chapote</span>
        </div>

        {result ? (
          /* ---- Résultat final (autorisé / refusé) ---- */
          result.kind === 'approved' ? (
            <>
              <div className="section-title" style={{ marginBottom: 8 }}>Appareil autorisé ✓</div>
              <InfoBox tone="go" title="Connexion établie">
                {result.site
                  ? <>Le site <strong>{prettySite(result.site)}</strong> peut désormais gérer vos chatbots. Retournez sur WordPress, l’appairage va se finaliser automatiquement.</>
                  : <>Le plugin WordPress peut désormais gérer vos chatbots. Retournez sur WordPress, l’appairage va se finaliser automatiquement.</>}
              </InfoBox>
              <div style={{ marginTop: 16 }}>
                <Btn kind="ghost" onClick={() => navigate('/app')}>Aller au tableau de bord</Btn>
              </div>
            </>
          ) : (
            <>
              <div className="section-title" style={{ marginBottom: 8 }}>Appairage refusé</div>
              <InfoBox tone="warn" title="Aucune autorisation accordée">
                La demande a été refusée. Aucun site n’a accès à vos chatbots. Vous pouvez fermer cette page.
              </InfoBox>
              <div style={{ marginTop: 16 }}>
                <Btn kind="ghost" onClick={() => navigate('/app')}>Aller au tableau de bord</Btn>
              </div>
            </>
          )
        ) : info && info.status === 'pending' ? (
          /* ---- Écran de consentement ---- */
          <>
            <div className="section-title" style={{ marginBottom: 6 }}>Autoriser cet appareil</div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
              {site
                ? <>Autoriser le plugin WordPress du site <strong style={{ color: 'var(--ink)' }}>{site}</strong> à gérer vos chatbots Chapote (création, mise à jour, statistiques) ?</>
                : <>Autoriser ce plugin WordPress à gérer vos chatbots Chapote (création, mise à jour, statistiques) ?</>}
            </p>
            <div className="infobox info" style={{ marginBottom: 16 }}>
              Code d’appairage : <strong style={{ fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>{info.user_code}</strong>
            </div>
            {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}
            <div style={{ display: 'flex', gap: 10, marginTop: error ? 14 : 0 }}>
              <Btn kind="primary" disabled={acting !== null} onClick={() => decide('approve')}>
                {acting === 'approve' ? 'Autorisation…' : 'Autoriser'}
              </Btn>
              <Btn kind="ghost" disabled={acting !== null} onClick={() => decide('deny')}>
                {acting === 'deny' ? 'Refus…' : 'Refuser'}
              </Btn>
            </div>
          </>
        ) : info ? (
          /* ---- Code trouvé mais déjà traité (approved/denied/expired/consumed) ---- */
          <>
            <div className="section-title" style={{ marginBottom: 8 }}>Demande déjà traitée</div>
            <InfoBox tone="warn" title="Rien à faire">
              {info.status === 'approved' || info.status === 'consumed'
                ? 'Cet appairage a déjà été autorisé. Retournez sur WordPress pour continuer.'
                : info.status === 'denied'
                ? 'Cet appairage a été refusé.'
                : 'Ce code a expiré. Relancez l’appairage depuis WordPress pour obtenir un nouveau code.'}
            </InfoBox>
          </>
        ) : (
          /* ---- Saisie / vérification du code ---- */
          <>
            <div className="section-title" style={{ marginBottom: 6 }}>Connecter un site WordPress</div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
              Saisissez le code affiché par le plugin Chapote dans votre administration WordPress.
            </p>
            <form onSubmit={e => { e.preventDefault(); verify(code) }}>
              <label className="field-label" htmlFor="device-code">Code d’appairage</label>
              <input
                id="device-code"
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoFocus
                style={{ width: '100%', fontFamily: 'var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase' }}
              />
              {error && <div style={{ marginTop: 14 }}><InfoBox tone="danger" title="Erreur">{error}</InfoBox></div>}
              <div style={{ marginTop: 16 }}>
                <Btn type="submit" kind="primary" disabled={checking || !code.trim()}>
                  {checking ? 'Vérification…' : 'Vérifier'}
                </Btn>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
