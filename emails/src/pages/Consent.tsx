// Écran de consentement OAuth : /oauth/authorize (API) a validé la demande de Claude et la session
// (superadmin + 2FA), puis renvoie ici avec une demande signée (?req=, 10 min) ou une erreur (?erreur=).
// « Autoriser » crée le code d'autorisation et renvoie le navigateur vers Claude.
import { useState } from 'react'
import { getConsent, postConsent } from '../api'
import { Brand, Msg, Skeleton } from '../components/ui'
import { useLoad, useSession } from '../session'

const ERRORS: Record<string, string> = {
  invalid_client: 'Ce client n’est pas (ou plus) inscrit. Relancez la connexion depuis Claude.',
  invalid_redirect_uri: 'Adresse de retour non reconnue pour ce client.',
  superadmin_required: 'Seul le superadmin peut autoriser l’accès aux boîtes mail.',
  twofa_setup_required: 'Activez la double authentification sur chapote.fr avant d’autoriser Claude.',
  twofa_session_required: 'Reconnectez-vous en validant la double authentification, puis relancez la connexion depuis Claude.',
  rate_limited: 'Trop de tentatives : patientez une minute.',
}

export default function Consent() {
  const { signOut } = useSession()
  const params = new URLSearchParams(window.location.search)
  const req = params.get('req') || ''
  const error = params.get('erreur')
  const info = useLoad(() => (req ? getConsent(req) : Promise.reject(new Error('Demande absente.'))), [req])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const answer = async (approve: boolean) => {
    setBusy(true); setErr('')
    try { window.location.assign((await postConsent(req, approve)).redirect) }
    catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-card card">
        <Brand />
        {error ? (
          <>
            <h1>Autorisation impossible</h1>
            <Msg kind="err">{ERRORS[error] || 'Demande invalide.'}</Msg>
            {error === 'twofa_session_required' && <button className="btn" onClick={signOut}>Se déconnecter</button>}
          </>
        ) : info.error ? (
          <>
            <h1>Autorisation impossible</h1>
            <Msg kind="err">{info.error}</Msg>
          </>
        ) : !info.data ? <Skeleton n={3} h={48} /> : (
          <>
            <div className="col" style={{ gap: 6 }}>
              <h1>Autoriser {info.data.client_name} ?</h1>
              <p className="muted">
                <strong>{info.data.client_name}</strong> demande l’accès à vos boîtes mail au nom de {info.data.user_email}.
                Vous serez renvoyé vers <strong>{info.data.redirect_host}</strong>.
              </p>
            </div>
            <div className="card card-sub col" style={{ gap: 8 }}>
              <span className="small strong">Boîtes accessibles</span>
              {info.data.mailboxes.length === 0 && <span className="small muted">Aucune boîte active pour l’instant.</span>}
              {info.data.mailboxes.map(m => (
                <div key={m.slug} className="row between small" style={{ gap: 8 }}>
                  <span>{m.address}</span>
                  <span className="muted">lecture, brouillons{m.allow_send ? ', envoi' : ''}{m.allow_delete ? ', corbeille' : ''}</span>
                </div>
              ))}
            </div>
            <p className="tiny muted">Accès valable jusqu’à révocation (page « Accès Claude ») ; chaque appel est journalisé.</p>
            {err && <Msg kind="err">{err}</Msg>}
            <div className="col" style={{ gap: 8 }}>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => answer(true)}>Autoriser</button>
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => answer(false)}>Refuser</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
