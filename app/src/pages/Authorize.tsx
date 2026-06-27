// Écran de CONSENTEMENT OAuth (Authorization Code + PKCE) du plugin WordPress.
// Route /authorize : le plugin construit une URL
//   {APP_URL}/authorize?response_type=code&client_id=chapote_wp
//     &redirect_uri={WP_ADMIN_URL}&state={state}
//     &code_challenge={challenge}&code_challenge_method=S256&scope=plugin
// et y envoie le navigateur. Un utilisateur CONNECTÉ au dashboard approuve (ou
// refuse) que le site WordPress (identifié par l'HÔTE de redirect_uri) puisse
// gérer ses chatbots Chapote. Non connecté → on mémorise le retour (même clé
// que Login : cbsaas_after_login) puis on file vers /login.
//
//   Autoriser → POST /api/oauth/authorize (JWT dashboard via api()) renvoie
//     {redirect_url} (= redirect_uri + ?code=…&state=…) → on y redirige.
//   Refuser   → on redirige vers redirect_uri avec error=access_denied&state.
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { api } from '../api'
import { errMsg } from '../utils/errors'
import { Btn, InfoBox } from '../ui'
import HatIcon from '../components/HatIcon'

const NAVY = '#1C3F5C'

// Concatène des paramètres à une URL en choisissant le bon séparateur (? ou &)
// selon que l'URL contient déjà une query. Les valeurs vides sont ignorées,
// les autres sont encodées.
function appendQuery(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  if (!qs) return base
  return base + (base.includes('?') ? '&' : '?') + qs
}

// Hôte affichable d'une URL absolue (sans schéma), ou null si non parseable.
function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host.replace(/^www\./, '')
  } catch {
    return null
  }
}

export default function Authorize() {
  const { user, loading } = useAuth()
  const location = useLocation()

  const params = new URLSearchParams(location.search)
  const responseType = params.get('response_type') || ''
  const clientId = params.get('client_id') || ''
  const redirectUri = params.get('redirect_uri') || ''
  const state = params.get('state') || ''
  const codeChallenge = params.get('code_challenge') || ''
  const codeChallengeMethod = params.get('code_challenge_method') || ''
  const scope = params.get('scope') || ''

  const [acting, setActing] = useState(false)
  const [error, setError] = useState('')

  // Non connecté : on mémorise le retour (params inclus) puis on redirige vers
  // le login. Après authentification, Login consomme cbsaas_after_login et y
  // revient (postLoginDest). Même mécanisme que l'ex-page /link.
  useEffect(() => {
    if (!loading && !user) {
      try { sessionStorage.setItem('cbsaas_after_login', `/authorize${location.search}`) } catch { /* SSR / storage off */ }
    }
  }, [loading, user, location.search])

  const host = redirectUri ? hostOf(redirectUri) : null
  // Le redirect_uri doit être absolu et http(s) pour pouvoir afficher l'hôte et
  // construire la redirection de refus. La validation FINE (https/localhost,
  // S256, scope, client) reste côté backend ; ici on filtre l'évidemment cassé.
  const redirectOk = !!host && /^https?:\/\//i.test(redirectUri)
  // Demande structurellement valide → on présente le consentement. Sinon, écran
  // d'erreur (avec « Refuser » si on peut au moins renvoyer vers le site).
  const requestOk =
    redirectOk &&
    (responseType === '' || responseType === 'code') &&
    clientId === 'chapote_wp' &&
    !!codeChallenge &&
    codeChallengeMethod === 'S256' &&
    scope === 'plugin'

  // En attente de la résolution d'auth (init AuthContext / auto-login local).
  if (loading) return <div className="center-page">Chargement…</div>
  // Pas connecté → login (le retour a été mémorisé par l'effet ci-dessus).
  if (!user) return <Navigate to="/login" replace />

  async function authorize() {
    setError('')
    setActing(true)
    try {
      const { redirect_url } = await api<{ redirect_url: string }>('/api/oauth/authorize', {
        method: 'POST',
        body: {
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          scope,
        },
      })
      // Succès → on quitte le dashboard vers le site WordPress (code one-time).
      window.location.href = redirect_url
    } catch (err: unknown) {
      // On reste sur la page (pas de redirection) pour afficher l'erreur.
      setActing(false)
      setError(errMsg(err, 'Autorisation impossible, réessayez.'))
    }
  }

  function deny() {
    // Refus explicite → on renvoie l'utilisateur au site avec error=access_denied
    // (le plugin interprète et nettoie son URL). state rejoué pour l'anti-CSRF.
    window.location.href = appendQuery(redirectUri, { error: 'access_denied', state })
  }

  return (
    <div className="center-page" style={{ padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 460 }}>
        {/* En-tête de marque (cohérent Login / Register / ex-/link). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 10, background: NAVY,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <HatIcon size={19} color="#fff" />
          </span>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 19, color: 'var(--ink)' }}>Chapote</span>
        </div>

        {requestOk ? (
          /* ---- Écran de consentement ---- */
          <>
            <div className="section-title" style={{ marginBottom: 6 }}>Autoriser ce site WordPress</div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
              Autoriser le site <strong style={{ color: 'var(--ink)' }}>{host}</strong> à gérer vos
              chatbots Chapote (création, mise à jour, statistiques) ?
            </p>
            <div className="infobox info" style={{ marginBottom: 16 }}>
              Connecté en tant que <strong>{user.email}</strong>. Vous pourrez révoquer cet accès à tout moment.
            </div>
            {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}
            <div style={{ display: 'flex', gap: 10, marginTop: error ? 14 : 0 }}>
              <Btn kind="primary" disabled={acting} onClick={authorize}>
                {acting ? 'Autorisation…' : 'Autoriser'}
              </Btn>
              <Btn kind="ghost" disabled={acting} onClick={deny}>Refuser</Btn>
            </div>
          </>
        ) : (
          /* ---- Demande invalide (params manquants / malformés) ---- */
          <>
            <div className="section-title" style={{ marginBottom: 8 }}>Demande d'autorisation invalide</div>
            <InfoBox tone="warn" title="Lien incomplet">
              Cette page d'autorisation a été ouverte avec des paramètres manquants ou incorrects.
              Relancez la connexion depuis le menu <strong>Chapote</strong> de votre administration WordPress.
            </InfoBox>
            {redirectOk && (
              <div style={{ marginTop: 16 }}>
                <Btn kind="ghost" onClick={deny}>Retourner sur {host}</Btn>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
