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
//
// L'API est l'AUTORITÉ sur la validité du redirect_uri et l'allowlist par
// utilisateur (anti consent-phishing) : le front ne RE-DÉCIDE PAS la validité, il
// consomme GET /api/oauth/authorize/preview et affiche ce qu'elle dit. Le seul
// contrôle côté front est STRUCTUREL (présence/forme des params PKCE) pour choisir
// l'écran à montrer.
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

// Réponse de l'endpoint de prévisualisation : l'API est l'AUTORITÉ sur la validité
// du redirect_uri et l'allowlist par utilisateur. Le front n'affiche que ça.
//  - valid                 : redirect_uri de forme acceptable (page admin du plugin).
//  - host                  : hôte EXACT à afficher (jamais re-parsé côté client).
//  - requires_confirmation : hôte valide mais NON enregistré alors que l'user a déjà
//                            d'autres sites → ajout d'un nouveau site à confirmer.
type Preview = { valid: boolean; host: string | null; requires_confirmation: boolean }

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
  // Coche de confirmation DÉLIBÉRÉE pour l'ajout d'un nouveau site (requires_confirmation).
  // Sans elle, l'ajout d'un domaine non enregistré se ferait en 1 clic (le verrou 400
  // de l'API serait contourné côté front). Inutile pour le 1er domaine / un domaine déjà connu.
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)

  // Non connecté : on mémorise le retour (params inclus) puis on redirige vers
  // le login. Après authentification, Login consomme cbsaas_after_login et y
  // revient (postLoginDest).
  useEffect(() => {
    if (!loading && !user) {
      try { sessionStorage.setItem('cbsaas_after_login', `/authorize${location.search}`) } catch { /* SSR / storage off */ }
    }
  }, [loading, user, location.search])

  // Connecté : on demande à l'API si le redirect_uri est acceptable et si son
  // hôte est déjà enregistré (allowlist). L'API décide ; le front affiche. Une
  // erreur réseau est traitée comme un preview invalide (fail-closed).
  useEffect(() => {
    if (loading || !user) return
    let cancelled = false
    setPreviewLoading(true)
    api<Preview>('/api/oauth/authorize/preview?redirect_uri=' + encodeURIComponent(redirectUri))
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(() => { if (!cancelled) setPreview({ valid: false, host: null, requires_confirmation: false }) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [loading, user, redirectUri])

  // Contrôle STRUCTUREL d'affichage (PAS de sécurité) : choisit l'écran à montrer
  // selon la présence/forme des params PKCE. La validité du redirect_uri vient
  // EXCLUSIVEMENT de l'API (preview).
  const structurelOk =
    (responseType === '' || responseType === 'code') &&
    clientId === 'chapote_wp' &&
    !!codeChallenge &&
    codeChallengeMethod === 'S256' &&
    scope === 'plugin'
  // Demande présentable au consentement : l'API valide le redirect_uri ET les
  // params PKCE sont structurellement corrects. Sinon → écran d'erreur.
  const requestOk = !!preview?.valid && structurelOk
  const host = preview?.host || null
  const needsConfirm = !!preview?.requires_confirmation

  // En attente de la résolution d'auth (init AuthContext / auto-login local).
  if (loading) return <div className="center-page">Chargement…</div>
  // Pas connecté → login (le retour a été mémorisé par l'effet ci-dessus).
  if (!user) return <Navigate to="/login" replace />
  if (previewLoading) return <div className="center-page">Chargement…</div>

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
          // Re-consentement : confirme explicitement l'ajout d'un site non encore
          // enregistré (sinon l'API refuse, anti consent-phishing). Jamais auto-true :
          // exige la coche délibérée de l'utilisateur.
          confirm_unregistered: needsConfirm && confirmChecked,
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
    // Anti open-redirect : on ne redirige QUE si preview.valid, c.-à-d. que le
    // redirect_uri a la FORME d'une page admin du plugin (/wp-admin/admin.php?page=…) ;
    // ce n'est PAS un test d'appartenance à l'allowlist. Le refus ne transmet aucun
    // secret (seulement error=access_denied&state) et le chemin reste borné à
    // /wp-admin/admin.php — pas d'exfiltration de code.
    window.location.href = appendQuery(redirectUri, { error: 'access_denied', state })
  }

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

        {requestOk ? (
          /* ---- Écran de consentement ---- */
          <>
            <div className="section-title" style={{ marginBottom: 6 }}>Autoriser ce site WordPress</div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '0 0 16px' }}>
              Autoriser le site <strong style={{ color: 'var(--ink)' }}>{host}</strong> à gérer vos
              chatbots Chapote (création, mise à jour, statistiques) ?
            </p>
            {needsConfirm && (
              <InfoBox tone="warn" title="Site non reconnu">
                Vous avez déjà autorisé d'autres sites. Confirmez que <strong>{host}</strong> est
                bien votre site WordPress.
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={e => setConfirmChecked(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>Je confirme que <strong>{host}</strong> est bien mon site WordPress.</span>
                </label>
              </InfoBox>
            )}
            <div className="infobox info" style={{ marginTop: needsConfirm ? 14 : 0, marginBottom: 16 }}>
              Connecté en tant que <strong>{user.email}</strong>. Vous pourrez révoquer cet accès à tout moment.
            </div>
            {error && <InfoBox tone="danger" title="Erreur">{error}</InfoBox>}
            <div style={{ display: 'flex', gap: 10, marginTop: error ? 14 : 0 }}>
              <Btn kind="primary" disabled={acting || (needsConfirm && !confirmChecked)} onClick={authorize}>
                {acting ? 'Autorisation…' : needsConfirm ? 'Confirmer et autoriser' : 'Autoriser'}
              </Btn>
              <Btn kind="ghost" disabled={acting} onClick={deny}>Refuser</Btn>
            </div>
          </>
        ) : (
          /* ---- Demande invalide (params manquants / malformés ou redirect_uri refusé) ---- */
          <>
            <div className="section-title" style={{ marginBottom: 8 }}>Demande d'autorisation invalide</div>
            <InfoBox tone="warn" title="Lien incomplet">
              Cette page d'autorisation a été ouverte avec des paramètres manquants ou incorrects.
              Relancez la connexion depuis le menu <strong>Chapote</strong> de votre administration WordPress.
            </InfoBox>
            {/* Anti open-redirect : « Retourner sur … » seulement si preview.valid,
                c.-à-d. forme de page admin du plugin (pas un test d'allowlist). */}
            {preview?.valid && (
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
