// Stockage Drive de l'espace (obligatoire pour publier) : carte de réglages, bandeau presque plein / plein,
// et écran « Connecter votre Google Drive » à la 1re ouverture d'un espace qui n'en a pas.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { disconnectDriveArchive, getStorage, putStorage, startDriveOAuth, type Retention, type Storage } from '../api'
import { useLoad, useRole, useSession } from '../session'
import { Icon, Msg, Sheet } from './ui'

const GB = 1024 ** 3
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= GB / 10 ? `${(n / GB).toFixed(1).replace('.', ',')} Go` : `${Math.max(0, Math.round(n / (1024 * 1024)))} Mo`
}
const RETENTION: [Retention, string][] = [
  ['keep', 'Tout garder dans le Drive'],
  ['delete_after_publish', 'Supprimer la vidéo une fois publiée partout'],
  ['delete_after_days', 'Supprimer la vidéo X jours après publication'],
]

async function connectDrive(org: number | null, setErr: (s: string) => void) {
  try { window.location.assign((await startDriveOAuth(org)).authorize_url) } catch (e) { setErr((e as Error).message) }
}

/** Jauge : octets rangés par Chapote sur le quota réservé (ou sur ce qui reste dans le Drive). */
function Gauge({ s }: { s: Storage }) {
  const cap = s.quota_gb ? s.quota_gb * GB : s.drive_free_bytes != null ? s.used_bytes + s.drive_free_bytes : null
  const pct = cap ? Math.min(100, Math.round((s.used_bytes / cap) * 100)) : 0
  const color = s.state === 'full' ? 'var(--danger)' : s.state === 'almost_full' ? 'var(--warn)' : 'var(--primary)'
  return (
    <div className="col" style={{ gap: 6 }}>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Stockage utilisé"
           style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span className="tiny muted">
        {bytes(s.used_bytes)} utilisés par Chapote{s.quota_gb ? ` sur ${s.quota_gb} Go réservés` : cap ? ` · ${bytes(s.drive_free_bytes)} libres dans le Drive` : ''}
      </span>
    </div>
  )
}

export function StorageCard() {
  const { org } = useSession()
  const { canAdmin } = useRole()
  const st = useLoad(() => getStorage(org), [org])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [form, setForm] = useState<{ quota: string; retention: Retention; days: string } | null>(null)
  const s = st.data
  if (!s) return st.error ? <Msg kind="err">{st.error}</Msg> : null
  const edit = () => setForm({ quota: s.quota_gb ? String(s.quota_gb) : '', retention: s.retention || 'keep', days: String(s.delete_after_days || 30) })
  const save = async () => {
    if (!form) return
    setErr(''); setOk('')
    try {
      st.setData(await putStorage(org, { quota_gb: form.quota.trim() ? Number(form.quota) : null, retention: form.retention,
        delete_after_days: form.retention === 'delete_after_days' ? Number(form.days) : null }))
      setForm(null); setOk('Réglages du stockage enregistrés.')
    } catch (e) { setErr((e as Error).message) }
  }
  const off = async () => {
    if (!window.confirm('Déconnecter le Drive ? Les fichiers déjà rangés y restent, mais vous ne pourrez plus créer de publication.')) return
    try { await disconnectDriveArchive(org); st.reload() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <section className="card col" style={{ gap: 10 }} aria-labelledby="t-storage">
      <div className="row-nw" style={{ gap: 10 }}>
        <span className="empty-ico" style={{ width: 36, height: 36, flex: 'none' }}><Icon name="layers" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 id="t-storage" style={{ margin: 0, fontSize: 16 }}>Stockage</h2>
          <div className="tiny muted ellipsis">{s.connected ? `Google Drive relié${s.email ? ` : ${s.email}` : ''}` : 'Aucun Google Drive relié : obligatoire pour publier.'}</div>
        </div>
        {canAdmin && (s.connected
          ? <button type="button" className="btn btn-sm btn-ghost" onClick={off}>Déconnecter</button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={() => connectDrive(org, setErr)}>Connecter Google Drive</button>)}
      </div>
      {s.connected && <Gauge s={s} />}
      {s.state === 'full' && <Msg kind="err">Stockage plein : les nouvelles publications sont bloquées.</Msg>}
      {s.state === 'almost_full' && <div className="msg msg-warn" role="status">Stockage presque plein (plus de 90 %).</div>}
      {s.connected && !form && (
        <div className="row small" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">Conservation :</span>
          <b>{s.retention === 'delete_after_days' ? `supprimer ${s.delete_after_days} j après publication` : RETENTION.find(r => r[0] === s.retention)?.[1]}</b>
          {canAdmin && <button type="button" className="linkbtn" onClick={edit}>Modifier</button>}
        </div>
      )}
      {form && (
        <div className="col" style={{ gap: 10 }}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Après publication</legend>
            {RETENTION.map(([v, label]) => (
              <label key={v} className="check"><input type="radio" name="retention" checked={form.retention === v} onChange={() => setForm({ ...form, retention: v })} /><span>{label}</span></label>
            ))}
            {form.retention === 'delete_after_days' && (
              <label className="field">Nombre de jours
                <input className="input" type="number" inputMode="numeric" min={1} max={365} value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} />
              </label>
            )}
            <span className="field-hint">Seuls les fichiers rangés par Chapote (vidéo, couverture, légende) vont à la corbeille du Drive ; infos.json reste.</span>
          </fieldset>
          <label className="field">Go réservés à Chapote
            <input className="input" type="number" inputMode="numeric" min={1} max={s.max_quota_gb || undefined} value={form.quota}
                   placeholder="Vide = tout l’espace libre du Drive" onChange={e => setForm({ ...form, quota: e.target.value })} />
            {s.max_quota_gb != null && <span className="field-hint">{s.max_quota_gb} Go au plus (espace libre du Drive).</span>}
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={save}>Enregistrer</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>Annuler</button>
          </div>
        </div>
      )}
      {ok && <Msg kind="ok">{ok}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}
    </section>
  )
}

/** Bandeau (presque plein / plein) et écran de connexion du Drive à la 1re ouverture d'un espace sans Drive. */
export function StorageGate() {
  const { spaces, org } = useSession()
  const { canAdmin } = useRole()
  const s = spaces.find(x => x.org_id === org)?.storage
  const key = `cm.storage-gate.${org ?? 'perso'}`
  const [seen, setSeen] = useState(() => { try { return sessionStorage.getItem(key) === '1' } catch { return false } })
  const [err, setErr] = useState('')
  if (!s) return null
  const later = () => { try { sessionStorage.setItem(key, '1') } catch { /* */ } setSeen(true) }
  if (s.state === 'missing') {
    return seen ? (
      <div className="msg msg-warn" role="status" style={{ margin: '0 0 12px' }}>
        Connectez un Google Drive pour pouvoir publier. <Link to="/bibliotheque">Stockage</Link>
      </div>
    ) : (
      <Sheet title="Connecter votre Google Drive" onClose={later}>
        <div className="col" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>Chapote range vos vidéos, légendes et couvertures dans <b>votre</b> Google Drive : c’est là qu’elles sont stockées, et vous les gardez.</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Chapote ne voit que les fichiers qu’il crée, rien d’autre de votre Drive.</li>
            <li>Vous choisissez combien de place lui réserver, et si les vidéos sont supprimées après publication.</li>
            <li>Sans Drive relié, impossible de créer une publication.</li>
          </ul>
          {err && <Msg kind="err">{err}</Msg>}
          {canAdmin
            ? <button type="button" className="btn btn-primary" onClick={() => connectDrive(org, setErr)}>Connecter Google Drive</button>
            : <Msg>Demandez à un administrateur de l’espace de connecter un Google Drive.</Msg>}
          <button type="button" className="btn btn-ghost" onClick={later}>Plus tard</button>
        </div>
      </Sheet>
    )
  }
  if (s.state === 'full') return <div className="msg msg-err" role="alert" style={{ margin: '0 0 12px' }}>Stockage Drive plein : les nouvelles publications sont bloquées. <Link to="/bibliotheque">Gérer le stockage</Link></div>
  if (s.state === 'almost_full') return <div className="msg msg-warn" role="status" style={{ margin: '0 0 12px' }}>Stockage Drive presque plein (plus de 90 %). <Link to="/bibliotheque">Gérer le stockage</Link></div>
  return null
}
