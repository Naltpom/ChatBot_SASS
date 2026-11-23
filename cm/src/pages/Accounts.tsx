import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { addRoutineAccount, disconnect, getAccounts, startOAuth, syncAccount, PLATFORM_LABEL, PLATFORMS, type Account, type Platform } from '../api'
import { Avatar, Icon, Loading, Msg } from '../components/ui'
import { fmtDateTime, num } from '../format'
import { useLoad, useSession } from '../session'

const HINT: Record<Platform, string> = {
  tiktok: "Pour connecter un autre compte, connectez-vous d'abord à ce compte sur tiktok.com dans ce navigateur.",
  youtube: "Pour une chaîne de marque, choisissez-la sur l'écran Google qui s'ouvre.",
  instagram: 'Compte professionnel (Créateur ou Entreprise) seulement.',
}

export default function Accounts() {
  const { org, config } = useSession()
  const loc = useLocation()
  const accounts = useLoad(getAccounts)
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok' | 'info'; text: string } | null>(
    (loc.state as { flash?: string } | null)?.flash ? { kind: 'ok', text: (loc.state as { flash: string }).flash } : null)
  const [routineName, setRoutineName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const enabled = (p: Platform) => (p === 'tiktok' ? config?.tiktok : p === 'youtube' ? config?.youtube : config?.instagram_api) ?? false
  const connect = async (p: Platform) => {
    setBusy(p); setMsg(null)
    try { window.location.assign((await startOAuth(p, org)).authorize_url) }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); setBusy(null) }
  }
  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    try {
      const r = await fn() as { warning?: string | null } | undefined
      setMsg(r && typeof r === 'object' && 'warning' in r && r.warning ? { kind: 'info', text: r.warning } : ok ? { kind: 'ok', text: ok } : null)
      accounts.reload()
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) } finally { setBusy(null) }
  }
  const addRoutine = (e: FormEvent) => {
    e.preventDefault()
    if (!routineName.trim()) return
    run('routine', () => addRoutineAccount(org, routineName), 'Compte ajouté : la routine publiera les Reels programmés et enverra les chiffres.')
      .then(() => setRoutineName(''))
  }

  return (
    <>
      <div>
        <h1>Comptes</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>Les comptes connectés ne sont visibles que dans cet espace.</p>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {accounts.error && <Msg kind="err">{accounts.error}</Msg>}
      {!accounts.data && accounts.loading && <Loading />}
      {accounts.data && PLATFORMS.map(p => {
        const list = accounts.data!.filter(a => a.platform === p)
        return (
          <section key={p} className="card col" aria-labelledby={`t-${p}`}>
            <div className="card-head">
              <h2 id={`t-${p}`} className="row" style={{ gap: 8 }}><span aria-hidden="true" className={`dot dot-${p}`} />{PLATFORM_LABEL[p]}</h2>
              {enabled(p) ? (
                <button type="button" className="btn" disabled={busy === p} onClick={() => connect(p)}>
                  {list.length ? 'Connecter un autre compte' : `Connecter ${PLATFORM_LABEL[p]}`}
                </button>
              ) : <span className="muted small">{p === 'instagram' ? 'Connexion officielle bientôt disponible (validation Meta)' : 'Module indisponible'}</span>}
            </div>
            {list.length === 0 && <p className="muted small" style={{ margin: 0 }}>Aucun compte. {enabled(p) && HINT[p]}</p>}
            {list.map(a => <AccountRow key={a.id} a={a} busy={busy} onSync={() => run(`s${p}${a.id}`, () => syncAccount(org, a), 'Chiffres actualisés.')}
              onRemove={() => { if (window.confirm(`Déconnecter ${a.name} ? Les publications à venir sur ce compte ne partiront plus.`)) run(`d${p}${a.id}`, () => disconnect(org, a)) }}
              onReconnect={() => connect(p)} />)}
            {p === 'instagram' && (
              <form onSubmit={addRoutine} className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, alignItems: 'flex-end' }}>
                <label className="field grow" style={{ flex: '1 1 240px' }}>Compte géré par la routine Claude
                  <input className="input" value={routineName} onChange={e => setRoutineName(e.target.value)} placeholder="@nom.du.compte" />
                  <span className="field-hint">Sans connexion officielle : la routine publie les Reels programmés et envoie les chiffres.</span>
                </label>
                <button className="btn" disabled={busy === 'routine' || !routineName.trim()}>Ajouter</button>
              </form>
            )}
          </section>
        )
      })}
      {config && !config.tiktok_stats && (
        <p className="muted small" style={{ margin: 0 }}>Statistiques TikTok : elles s'afficheront après la validation de l'accès aux chiffres par TikTok, puis une reconnexion des comptes.</p>
      )}
    </>
  )
}

function AccountRow({ a, busy, onSync, onRemove, onReconnect }: { a: Account; busy: string | null; onSync: () => void; onRemove: () => void; onReconnect: () => void }) {
  return (
    <div className="row" style={{ borderTop: '1px solid var(--surface-2)', paddingTop: 12, flexWrap: 'wrap' }}>
      <Avatar src={a.avatar_url} name={a.name} />
      <div className="grow" style={{ flex: '1 1 200px' }}>
        <div style={{ fontWeight: 500 }}>{a.name}</div>
        <div className="tiny muted">
          {a.mode === 'routine' ? 'Géré par la routine' : a.needs_reconnect ? <span className="status-danger">À reconnecter</span> : 'Connecté'}
          {a.stats?.updated_at && ` · chiffres du ${fmtDateTime(a.stats.updated_at)}`}
          {a.stats?.error && <> · <span className="status-warn">{a.stats.error}</span></>}
        </div>
      </div>
      {a.stats_available && a.stats && (
        <div className="row tiny muted num" style={{ gap: 16 }}>
          <span><strong style={{ color: 'var(--text)', fontSize: 14 }}>{num(a.stats.followers)}</strong> abonnés</span>
          <span><strong style={{ color: 'var(--text)', fontSize: 14 }}>{num(a.stats.views)}</strong> vues</span>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {a.needs_reconnect && <button type="button" className="btn btn-sm btn-primary" onClick={onReconnect}>Reconnecter</button>}
        {a.stats_available && a.mode !== 'routine' && !a.needs_reconnect && (
          <button type="button" className="btn btn-sm" onClick={onSync} disabled={busy === `s${a.platform}${a.id}`}><Icon name="refresh" />Actualiser</button>
        )}
        <button type="button" className="btn btn-sm btn-danger" onClick={onRemove} disabled={busy === `d${a.platform}${a.id}`}>
          {a.mode === 'routine' ? 'Retirer' : 'Déconnecter'}
        </button>
      </div>
    </div>
  )
}
