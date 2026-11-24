// Journal d'audit : chaque appel d'outil MCP et chaque étape OAuth (date, client, outil, boîte,
// statut, durée). Jamais de contenu : ni requête, ni objet, ni destinataire.
import { useEffect, useState } from 'react'
import { getAudit, type AuditItem } from '../api'
import { Msg, Skeleton, when } from '../components/ui'

const TOOLS = ['list_accounts', 'list_folders', 'search_messages', 'search_all', 'get_message', 'get_thread',
  'get_attachment', 'create_draft', 'send_message', 'mark', 'move', 'trash', 'oauth.consent', 'oauth.token',
  'oauth.revoke', 'oauth.refresh_replay', 'oauth.code_replay']
const STATUS: Record<string, string> = { ok: 'OK', error: 'Erreur', denied: 'Refusé' }

export default function Audit() {
  const [items, setItems] = useState<AuditItem[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [tool, setTool] = useState('')
  const [status, setStatus] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (cursor?: number | null) => {
    setBusy(true)
    try {
      const r = await getAudit({ cursor, tool, status, mailbox: mailbox.trim() })
      setItems(cur => (cursor && cur ? [...cur, ...r.items] : r.items))
      setNext(r.next_cursor)
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [tool, status]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1>Journal</h1>
          <p className="muted">Appels de Claude et autorisations, du plus récent au plus ancien. Aucun contenu de message n’est conservé.</p>
        </div>
      </div>
      <form className="row filters" onSubmit={e => { e.preventDefault(); load() }}>
        <select className="input" value={tool} onChange={e => setTool(e.target.value)} aria-label="Outil">
          <option value="">Tous les outils</option>
          {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" placeholder="Boîte (slug)" value={mailbox} onChange={e => setMailbox(e.target.value)} />
        <button className="btn">Filtrer</button>
      </form>
      {err && <Msg kind="err">{err}</Msg>}
      {!items && !err && <Skeleton n={4} h={40} />}
      {items?.length === 0 && <p className="muted small">Aucun appel.</p>}
      {!!items?.length && (
        <div className="table-wrap card card-flush">
          <table>
            <thead><tr><th>Date</th><th>Outil</th><th>Boîte</th><th>Statut</th><th>Client</th><th className="num">Durée</th></tr></thead>
            <tbody>
              {items.map(a => (
                <tr key={a.id}>
                  <td className="nowrap">{when(a.at)}</td>
                  <td><code>{a.tool}</code></td>
                  <td>{a.mailbox || '—'}</td>
                  <td><span className={`status status-${a.status}`}>{STATUS[a.status] || a.status}</span>{a.error_code && <span className="tiny muted"> {a.error_code}</span>}</td>
                  <td className="small">{a.client || '—'}</td>
                  <td className="num small">{a.duration_ms != null ? `${a.duration_ms} ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && <button className="btn" disabled={busy} onClick={() => load(next)}>{busy ? 'Chargement…' : 'Plus ancien'}</button>}
    </div>
  )
}
