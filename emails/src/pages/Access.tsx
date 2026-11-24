// Accès Claude : adresse du connecteur, connexions actives (familles de jetons OAuth) et clients
// inscrits, avec révocation. Révoquer coupe l'accès immédiatement ; Claude devra se reconnecter.
import { useState } from 'react'
import { getClients, getTokens, revokeAll, revokeClient, revokeToken } from '../api'
import { Msg, Skeleton, when } from '../components/ui'
import { useLoad, useSession } from '../session'

export default function Access() {
  const { config } = useSession()
  const tokens = useLoad(getTokens)
  const clients = useLoad(getClients)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const url = config?.mcp_url || `${window.location.origin}/mcp`

  const act = async (fn: () => Promise<unknown>, ok: string, ask?: string) => {
    if (ask && !confirm(ask)) return
    try { await fn(); setMsg({ kind: 'ok', text: ok }); tokens.reload(); clients.reload() }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* refusé */ }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1>Accès Claude</h1>
          <p className="muted">Connecteur personnalisé claude.ai et connexions autorisées.</p>
        </div>
      </div>

      <section className="card col" style={{ gap: 10 }}>
        <h2>Ajouter le connecteur dans Claude</h2>
        <ol className="steps">
          <li>Dans Claude : <strong>Customize → Connectors → Add custom connector</strong>.</li>
          <li>Adresse du serveur :
            <span className="row" style={{ gap: 8, marginTop: 6 }}>
              <code className="url">{url}</code>
              <button type="button" className="btn btn-sm" onClick={copy}>{copied ? 'Copié' : 'Copier'}</button>
            </span>
          </li>
          <li>« Connect » ouvre cette page : connexion avec 2FA, puis « Autoriser ».</li>
        </ol>
      </section>

      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}

      <section className="col" style={{ gap: 10 }}>
        <div className="page-head">
          <h2>Connexions actives</h2>
          {!!tokens.data?.length && (
            <button className="btn btn-danger btn-sm" onClick={() => act(revokeAll, 'Toutes les connexions sont révoquées.',
              'Révoquer toutes les connexions ? Claude n’aura plus accès jusqu’à une nouvelle autorisation.')}>Tout révoquer</button>
          )}
        </div>
        {tokens.error && <Msg kind="err">{tokens.error}</Msg>}
        {!tokens.data && !tokens.error && <Skeleton n={2} h={56} />}
        {tokens.data?.length === 0 && <p className="muted small">Aucune connexion active.</p>}
        {tokens.data?.map(t => (
          <div key={t.id} className="card box">
            <div className="box-main">
              <div className="col" style={{ gap: 2 }}>
                <strong>{t.client_name || 'Client sans nom'}</strong>
                <span className="small muted">Autorisé par {t.user_email} le {when(t.connected_at)} · Dernier appel : {when(t.last_used_at)}</span>
                <span className="tiny muted">Reconnexion requise après le {when(t.refresh_expires_at)} sans usage</span>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => act(() => revokeToken(t.id), 'Connexion révoquée.')}>Révoquer</button>
            </div>
          </div>
        ))}
      </section>

      <section className="col" style={{ gap: 10 }}>
        <h2>Clients OAuth inscrits</h2>
        {clients.error && <Msg kind="err">{clients.error}</Msg>}
        {!clients.data && !clients.error && <Skeleton n={2} h={56} />}
        {clients.data?.length === 0 && <p className="muted small">Aucun client. Claude s’inscrit tout seul à la première connexion.</p>}
        {clients.data?.map(c => (
          <div key={c.id} className={`card box${c.revoked_at ? ' off' : ''}`}>
            <div className="box-main">
              <div className="col" style={{ gap: 2 }}>
                <span className="row" style={{ gap: 8 }}>
                  <strong>{c.client_name || 'Client sans nom'}</strong>
                  {c.revoked_at && <span className="chip chip-warn">Révoqué</span>}
                </span>
                <span className="small muted">Retour vers {c.redirect_hosts.join(', ')} · inscrit le {when(c.created_at)} · {c.active_tokens} connexion(s)</span>
                <span className="tiny muted"><code>{c.client_id}</code></span>
              </div>
              {!c.revoked_at && (
                <button className="btn btn-sm" onClick={() => act(() => revokeClient(c.id), 'Client révoqué.',
                  'Révoquer ce client et toutes ses connexions ?')}>Révoquer</button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
