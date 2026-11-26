// Stockage Drive de l'espace (obligatoire pour publier) : carte de réglages, bandeau presque plein / plein,
// et écran « Connecter votre Google Drive » à la 1re ouverture d'un espace qui n'en a pas.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addStorage, getAccounts, getStorages, patchStorage, removeStorage, startDriveOAuth, type Account, type Group, type Retention, type Storage, type StorageItem, type Storages } from '../api'
import { useLoad, useRole, useSession } from '../session'
import { Icon, Msg, Sheet } from './ui'
import { locale, t } from '../i18n'

const GB = 1024 ** 3
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= GB / 10 ? t('{n} Go', { n: (n / GB).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
    : t('{n} Mo', { n: Math.max(0, Math.round(n / (1024 * 1024))) })
}
const RETENTION: [Retention, string][] = [
  ['keep', 'Tout garder dans le Drive'],
  ['delete_after_publish', 'Supprimer la vidéo une fois publiée partout'],
  ['delete_after_days', 'Supprimer la vidéo X jours après publication'],
]

async function connectDrive(org: number | null, setErr: (s: string) => void, name?: string) {
  try { window.location.assign((await startDriveOAuth(org, name)).authorize_url) } catch (e) { setErr((e as Error).message) }
}

/** Jauge : octets rangés par Chapote sur le quota réservé (ou sur ce qui reste dans le Drive). */
function Gauge({ s }: { s: Storage }) {
  const cap = s.quota_gb ? s.quota_gb * GB : s.drive_free_bytes != null ? s.used_bytes + s.drive_free_bytes : null
  const pct = cap ? Math.min(100, Math.round((s.used_bytes / cap) * 100)) : 0
  const color = s.state === 'full' ? 'var(--danger)' : s.state === 'almost_full' ? 'var(--warn)' : 'var(--primary)'
  return (
    <div className="col" style={{ gap: 6 }}>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Stockage utilisé')}
           style={{ height: 10, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span className="tiny muted">
        {s.quota_gb ? t('{used} utilisés par Chapote sur {quota} Go réservés', { used: bytes(s.used_bytes), quota: s.quota_gb })
          : cap ? t('{used} utilisés par Chapote · {free} libres dans le Drive', { used: bytes(s.used_bytes), free: bytes(s.drive_free_bytes) })
          : t('{used} utilisés par Chapote', { used: bytes(s.used_bytes) })}
      </span>
    </div>
  )
}

/** Stockages de l'espace : un ou plusieurs Google Drive (ou dossiers d'un même Drive), dans l'ordre de remplissage,
 *  éventuellement attribués à des comptes ou à des groupes. */
export function StorageCard() {
  const { org, groups } = useSession()
  const { canAdmin } = useRole()
  const st = useLoad(() => getStorages(org), [org])
  const accounts = useLoad(() => getAccounts(org), [org])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [adding, setAdding] = useState(false)
  const data = st.data
  if (!data) return st.error ? <Msg kind="err">{st.error}</Msg> : null
  const list = data.storages
  const run = async (fn: () => Promise<Storages>, done?: string) => {
    setErr(''); setOk('')
    try { st.setData(await fn()); if (done) setOk(done) } catch (e) { setErr((e as Error).message) }
  }
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    run(async () => { await patchStorage(org, list[i].id, { position: list[j].position }); return patchStorage(org, list[j].id, { position: list[i].position }) })
  }
  return (
    <section className="card col" style={{ gap: 12 }} aria-labelledby="t-storage">
      <div className="row-nw" style={{ gap: 10 }}>
        <span className="empty-ico" style={{ width: 36, height: 36, flex: 'none' }}><Icon name="layers" /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 id="t-storage" style={{ margin: 0, fontSize: 16 }}>{t('Stockage')}</h2>
          <div className="tiny muted">{list.length ? (list.length > 1 ? t('{n} stockages · {used} utilisés', { n: list.length, used: bytes(data.used_bytes) }) : t('{n} stockage · {used} utilisés', { n: list.length, used: bytes(data.used_bytes) })) : t('Aucun Google Drive relié : obligatoire pour publier.')}</div>
        </div>
        {canAdmin && (list.length
          ? <button type="button" className="btn btn-sm" onClick={() => setAdding(a => !a)}><Icon name="plus" size={16} />{t('Ajouter')}</button>
          : <button type="button" className="btn btn-sm btn-primary" onClick={() => connectDrive(org, setErr)}>{t('Connecter Google Drive')}</button>)}
      </div>
      {adding && <AddStorage list={list} onCancel={() => setAdding(false)} onErr={setErr}
                             onFolder={(from, name) => run(() => addStorage(org, from, name), t('Dossier « {name} » créé.', { name })).then(() => setAdding(false))} />}
      {list.length > 1 && <p className="tiny muted" style={{ margin: 0 }}>{t('Chaque vidéo va dans le stockage attribué à son compte (ou à son groupe) ; sinon dans le premier stockage « tous les comptes » qui a de la place, dans l’ordre ci-dessous.')}</p>}
      {list.map((s, i) => (
        <StorageRow key={s.id} s={s} canAdmin={canAdmin} accounts={accounts.data || []} groups={groups}
                    first={i === 0} last={i === list.length - 1} onMove={d => move(i, d)}
                    onSave={body => run(() => patchStorage(org, s.id, body), t('Stockage enregistré.'))}
                    onRemove={() => {
                      if (window.confirm(list.length === 1 ? t('Retirer « {name} » ? Les fichiers déjà rangés restent dans le Drive. Sans stockage, impossible de publier.', { name: s.name }) : t('Retirer « {name} » ? Les fichiers déjà rangés restent dans le Drive.', { name: s.name })))
                        run(() => removeStorage(org, s.id), t('Stockage retiré.'))
                    }} />
      ))}
      {ok && <Msg kind="ok">{ok}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}
    </section>
  )
}

function AddStorage({ list, onFolder, onCancel, onErr }: { list: StorageItem[]; onFolder: (from: number, name: string) => void; onCancel: () => void; onErr: (s: string) => void }) {
  const { org } = useSession()
  const emails = [...new Map(list.filter(s => s.email).map(s => [s.email, s])).values()]
  const [from, setFrom] = useState<number>(emails[0]?.id || list[0].id)
  const [name, setName] = useState('')
  return (
    <div className="col" style={{ gap: 10, padding: 12, borderRadius: 12, background: 'var(--surface-2)' }}>
      <label className="field">{t('Nom du stockage')}
        <input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder={t('Ex. Kiwi, Clients musique, Archives 2027')} />
      </label>
      <label className="field">{t('Où')}
        <select className="input" value={from} onChange={e => setFrom(Number(e.target.value))}>
          {emails.map(s => <option key={s.id} value={s.id}>{t('Nouveau dossier dans le Drive de {email}', { email: s.email })}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={!name.trim()} onClick={() => onFolder(from, name.trim())}>{t('Créer le dossier')}</button>
        <button type="button" className="btn btn-sm" onClick={() => connectDrive(org, onErr, name.trim() || undefined)}>{t('Autre compte Google…')}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>{t('Annuler')}</button>
      </div>
      <span className="field-hint">{t('Chapote crée le dossier « cm.chapote.fr — nom » à la racine du Drive ; vous pouvez ensuite le déplacer ou le renommer.')}</span>
    </div>
  )
}

function StorageRow({ s, canAdmin, accounts, groups, first, last, onMove, onSave, onRemove }: {
  s: StorageItem; canAdmin: boolean; accounts: Account[]; groups: Group[]; first: boolean; last: boolean
  onMove: (d: number) => void; onSave: (body: Record<string, unknown>) => void; onRemove: () => void
}) {
  const [form, setForm] = useState<null | { name: string; quota: string; retention: Retention; days: string; accounts: string[]; groups: number[] }>(null)
  const assigned = [
    ...(s.assign?.groups || []).map(id => groups.find(g => g.id === id)?.name).filter(Boolean),
    ...(s.assign?.accounts || []).map(([p, id]) => accounts.find(a => a.platform === p && a.id === id)?.name).filter(Boolean),
  ] as string[]
  const edit = () => setForm({ name: s.name, quota: s.quota_gb ? String(s.quota_gb) : '', retention: s.retention || 'keep',
    days: String(s.delete_after_days || 30), accounts: (s.assign?.accounts || []).map(([p, id]) => `${p}:${id}`), groups: s.assign?.groups || [] })
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])
  const save = () => {
    if (!form) return
    onSave({ name: form.name, ...(form.quota.trim() ? { quota_gb: Number(form.quota) } : { clear_quota: true }), retention: form.retention,
      ...(form.retention === 'delete_after_days' ? { delete_after_days: Number(form.days) } : {}), set_assign: true,
      assign: { accounts: form.accounts.map(k => [k.split(':')[0], Number(k.split(':')[1])]), groups: form.groups } })
    setForm(null)
  }
  return (
    <div className="col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div className="row-nw" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
          <span className="strong ellipsis">{s.name}</span>
          <span className="tiny muted ellipsis">{s.email}{s.folder_url ? <> · <a href={s.folder_url} target="_blank" rel="noreferrer">{t('ouvrir le dossier')}</a></> : null}</span>
          <span className="tiny">{assigned.length ? <>{t('Pour :')} <b>{assigned.join(', ')}</b></> : <span className="muted">{t('Pour : tous les comptes (dans l’ordre)')}</span>}</span>
        </div>
        {canAdmin && (
          <span className="row-nw" style={{ gap: 2 }}>
            <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Monter « {name} »', { name: s.name })} disabled={first} onClick={() => onMove(-1)}><Icon name="up" size={16} /></button>
            <button type="button" className="btn btn-ghost icon-btn btn-sm" aria-label={t('Descendre « {name} »', { name: s.name })} disabled={last} onClick={() => onMove(1)}><Icon name="down" size={16} /></button>
          </span>
        )}
      </div>
      <Gauge s={s} />
      {s.error && <Msg kind="err">{s.error}</Msg>}
      {s.state === 'full' && <Msg kind="err">{t('Plein : ce stockage ne reçoit plus de vidéos.')}</Msg>}
      {s.state === 'almost_full' && <div className="msg msg-warn" role="status">{t('Presque plein (plus de 90 %).')}</div>}
      {!form && (
        <div className="row small" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted">{t('Conservation :')}</span>
          <b>{s.retention === 'delete_after_days' ? t('supprimer {n} j après publication', { n: s.delete_after_days }) : t(RETENTION.find(r => r[0] === s.retention)?.[1] || '')}</b>
          {canAdmin && <button type="button" className="linkbtn" onClick={edit}>{t('Modifier')}</button>}
          {canAdmin && <button type="button" className="linkbtn" style={{ color: 'var(--danger)' }} onClick={onRemove}>{t('Retirer')}</button>}
        </div>
      )}
      {form && (
        <div className="col" style={{ gap: 10 }}>
          <label className="field">{t('Nom')}<input className="input" value={form.name} maxLength={80} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{t('Pour quels comptes ?')}</legend>
            <span className="field-hint">{t('Rien de coché : tous les comptes, dans l’ordre des stockages.')}</span>
            {groups.length > 0 && <div className="row" style={{ gap: 6 }}>{groups.map(g => (
              <button key={g.id} type="button" className="chip" aria-pressed={form.groups.includes(g.id)} onClick={() => setForm({ ...form, groups: toggle(form.groups, g.id) })}>{t('Groupe {name}', { name: g.name })}</button>
            ))}</div>}
            <div className="row" style={{ gap: 6 }}>{accounts.map(a => {
              const k = `${a.platform}:${a.id}`
              return <button key={k} type="button" className="chip" aria-pressed={form.accounts.includes(k)} onClick={() => setForm({ ...form, accounts: toggle(form.accounts, k) })}>{a.name}</button>
            })}</div>
          </fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{t('Après publication')}</legend>
            {RETENTION.map(([v, label]) => (
              <label key={v} className="check"><input type="radio" name={`retention-${s.id}`} checked={form.retention === v} onChange={() => setForm({ ...form, retention: v })} /><span>{t(label)}</span></label>
            ))}
            {form.retention === 'delete_after_days' && (
              <label className="field">{t('Nombre de jours')}
                <input className="input" type="number" inputMode="numeric" min={1} max={365} value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} />
              </label>
            )}
            <span className="field-hint">{t('Seuls les fichiers rangés par Chapote (vidéo, couverture, légende) vont à la corbeille du Drive ; infos.json reste.')}</span>
          </fieldset>
          <label className="field">{t('Go réservés à Chapote')}
            <input className="input" type="number" inputMode="numeric" min={1} max={s.max_quota_gb || undefined} value={form.quota}
                   placeholder={t('Vide = tout l’espace libre du Drive')} onChange={e => setForm({ ...form, quota: e.target.value })} />
            {s.max_quota_gb != null && <span className="field-hint">{t('{n} Go au plus (espace libre du Drive).', { n: s.max_quota_gb })}</span>}
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={save}>{t('Enregistrer')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)}>{t('Annuler')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Bandeau (presque plein / plein) et écran de connexion du Drive à la 1re ouverture d'un espace sans Drive. */
export function StorageGate() {
  const { spaces, org } = useSession()
  const { canAdmin } = useRole()
  const sp = spaces.find(x => x.org_id === org)
  const s = sp?.storage
  const key = `cm.storage-gate.${org ?? 'perso'}`
  const [seen, setSeen] = useState(() => { try { return sessionStorage.getItem(key) === '1' } catch { return false } })
  const [err, setErr] = useState('')
  // Le Drive est celui du propriétaire des comptes : rien à demander à qui n'a pas de comptes à lui
  // (comptes partagés avec moi : c'est leur propriétaire qui range les vidéos).
  if (!s || !canAdmin || !(sp?.accounts || 0)) return null
  const later = () => { try { sessionStorage.setItem(key, '1') } catch { /* */ } setSeen(true) }
  if (s.state === 'missing') {
    return seen ? (
      <div className="msg msg-warn" role="status" style={{ margin: '0 0 12px' }}>
        {t('Connectez un Google Drive pour pouvoir publier.')} <Link to="/bibliotheque">{t('Stockage')}</Link>
      </div>
    ) : (
      <Sheet title={t('Connecter votre Google Drive')} onClose={later}>
        <div className="col" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>{t('Chapote range vos vidéos, légendes et couvertures dans')} <b>{t('votre')}</b> {t('Google Drive : c’est là qu’elles sont stockées, et vous les gardez.')}</p>
          <p className="small" style={{ margin: 0 }}>{t('Rien à choisir : Chapote crée son dossier « cm.chapote.fr » à la racine de votre Drive (renommez-le ou déplacez-le si vous voulez), et y range chaque vidéo par compte, mois et date.')}</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('Chapote ne voit que les fichiers qu’il crée, rien d’autre de votre Drive.')}</li>
            <li>{t('Vous choisissez combien de place lui réserver, et si les vidéos sont supprimées après publication.')}</li>
            <li>{t('Sans Drive relié, impossible de créer une publication.')}</li>
          </ul>
          {err && <Msg kind="err">{err}</Msg>}
          <button type="button" className="btn btn-primary" onClick={() => connectDrive(org, setErr)}>{t('Connecter Google Drive')}</button>
          <button type="button" className="btn btn-ghost" onClick={later}>{t('Plus tard')}</button>
        </div>
      </Sheet>
    )
  }
  if (s.state === 'full') return <div className="msg msg-err" role="alert" style={{ margin: '0 0 12px' }}>{t('Stockage Drive plein : les nouvelles publications sont bloquées.')} <Link to="/bibliotheque">{t('Gérer le stockage')}</Link></div>
  if (s.state === 'almost_full') return <div className="msg msg-warn" role="status" style={{ margin: '0 0 12px' }}>{t('Stockage Drive presque plein (plus de 90 %).')} <Link to="/bibliotheque">{t('Gérer le stockage')}</Link></div>
  return null
}
