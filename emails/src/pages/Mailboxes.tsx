// Boîtes mail accessibles à Claude : liste, ajout (préréglages Email Pro OVH / Gmail), modification,
// test de connexion IMAP + SMTP, droits (envoi, corbeille). Le mot de passe n'est jamais relu : on
// sait seulement qu'il existe ; le laisser vide en modification le conserve.
import { useState, type FormEvent } from 'react'
import {
  createMailbox, deleteMailbox, getMailboxes, getPresets, testMailbox, testUnsaved, updateMailbox,
  type CheckResult, type Mailbox, type MailboxInput, type Preset, type Tls,
} from '../api'
import { Msg, Sheet, Skeleton, Toggle, when } from '../components/ui'
import { useLoad } from '../session'

const PRESET_LABEL: Record<string, string> = { 'ovh-email-pro': 'Email Pro OVH', gmail: 'Gmail' }

function CheckLine({ r }: { r: CheckResult }) {
  if (!r.ok) return <Msg kind="err">{r.error}</Msg>
  const sp = r.special || {}
  return (
    <Msg kind="ok">
      Connexion réussie (IMAP{r.folders != null ? ` : ${r.folders} dossiers` : ''}, SMTP).{' '}
      Envoyés : {sp.sent || 'introuvable'} · Brouillons : {sp.drafts || 'introuvable'} · Corbeille : {sp.trash || 'introuvable'}
    </Msg>
  )
}

const EMPTY: MailboxInput = {
  preset: 'gmail', slug: '', address: '', label: '', username: '', password: '',
  allow_send: false, allow_delete: false, save_sent: false, is_active: true,
}

function Editor({ box, presets, onClose, onSaved }: { box: Mailbox | null; presets: Preset[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<MailboxInput>(() => box ? { ...box, password: '' } : { ...EMPTY, ...pick(presets, 'gmail') })
  const [advanced, setAdvanced] = useState(!!box && !box.preset)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const set = <K extends keyof MailboxInput>(k: K, v: MailboxInput[K]) => setF(x => ({ ...x, [k]: v }))
  const preset = presets.find(p => p.id === f.preset)

  const choosePreset = (id: string) => {
    if (!id) { setF(x => ({ ...x, preset: null })); setAdvanced(true); return }
    setF(x => ({ ...x, preset: id, ...pick(presets, id) }))
  }
  const payload = (): MailboxInput => {
    const out: MailboxInput = { ...f, username: (f.username || '').trim() || (f.address || '').trim() }
    if (!out.password) delete out.password
    return out
  }
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (box) await updateMailbox(box.id, payload())
      else await createMailbox(payload())
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const test = async () => {
    setErr(''); setCheck(null); setBusy(true)
    try {
      if (f.password) setCheck(await testUnsaved({ ...payload(), slug: f.slug || 'essai' }))
      else if (box) setCheck(await testMailbox(box.id))
      else setErr('Saisissez le mot de passe pour tester.')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!box || !confirm(`Supprimer la boîte « ${box.slug} » ? Claude n'y aura plus accès.`)) return
    setBusy(true)
    try { await deleteMailbox(box.id); onSaved() } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <Sheet title={box ? `Modifier « ${box.slug} »` : 'Ajouter une boîte'} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={save}>
        <label className="field">Type de boîte
          <select className="input" value={f.preset || ''} onChange={e => choosePreset(e.target.value)}>
            {presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="">Autre (réglages manuels)</option>
          </select>
          {preset && <span className="field-hint">{preset.help}</span>}
        </label>
        <div className="grid-2">
          <label className="field">Adresse
            <input className="input" type="email" required value={f.address || ''} onChange={e => set('address', e.target.value)}
                   placeholder={f.preset === 'gmail' ? 'prenom@gmail.com' : 'contact@chapote.fr'} />
          </label>
          <label className="field">Identifiant pour Claude
            <input className="input" required pattern="[a-z0-9][a-z0-9\-]{0,38}[a-z0-9]|[a-z0-9]" value={f.slug || ''}
                   onChange={e => set('slug', e.target.value.toLowerCase())} placeholder="contact" />
            <span className="field-hint">Minuscules, chiffres, tirets. Paramètre « account » des outils.</span>
          </label>
          <label className="field">Nom affiché (expéditeur)
            <input className="input" value={f.label || ''} onChange={e => set('label', e.target.value)} placeholder="Chapote" />
          </label>
          <label className="field">Identifiant de connexion
            <input className="input" value={f.username || ''} onChange={e => set('username', e.target.value)} placeholder="= adresse" autoComplete="off" />
          </label>
        </div>
        <label className="field">{f.preset === 'gmail' ? 'Mot de passe d’application' : 'Mot de passe'}
          <input className="input" type="password" value={f.password || ''} onChange={e => set('password', e.target.value)}
                 required={!box} autoComplete="new-password" placeholder={box?.has_password ? 'Inchangé' : ''} />
          {f.preset === 'gmail' && <span className="field-hint">16 lettres, créé sur myaccount.google.com/apppasswords (validation en 2 étapes requise). Les espaces sont retirés.</span>}
        </label>

        {preset && <button type="button" className="linkbtn small" onClick={() => setAdvanced(a => !a)}>{advanced ? 'Masquer' : 'Afficher'} les réglages serveur</button>}
        {advanced && (
          <div className="grid-2">
            <ServerFields label="IMAP" host={f.imap_host} port={f.imap_port} tls={f.imap_tls}
                          onChange={(h, p, t) => setF(x => ({ ...x, imap_host: h, imap_port: p, imap_tls: t }))} />
            <ServerFields label="SMTP" host={f.smtp_host} port={f.smtp_port} tls={f.smtp_tls}
                          onChange={(h, p, t) => setF(x => ({ ...x, smtp_host: h, smtp_port: p, smtp_tls: t }))} />
          </div>
        )}

        <div className="col" style={{ gap: 10 }}>
          <Toggle checked={!!f.allow_send} onChange={v => set('allow_send', v)} label="Claude peut envoyer"
                  hint="Sinon, brouillons seulement (relus et envoyés par vous)." />
          <Toggle checked={!!f.allow_delete} onChange={v => set('allow_delete', v)} label="Claude peut mettre à la corbeille"
                  hint="Jamais de suppression définitive." />
          <Toggle checked={!!f.save_sent} onChange={v => set('save_sent', v)} label="Copier les envois dans Envoyés"
                  hint="Inutile pour Gmail, qui le fait lui-même." />
          <Toggle checked={!!f.is_active} onChange={v => set('is_active', v)} label="Boîte active" />
        </div>

        {check && <CheckLine r={check} />}
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'Enregistrer'}</button>
          <button type="button" className="btn" disabled={busy} onClick={test}>Tester la connexion</button>
          {box && <button type="button" className="btn btn-danger" disabled={busy} onClick={remove} style={{ marginLeft: 'auto' }}>Supprimer</button>}
        </div>
      </form>
    </Sheet>
  )
}

function pick(presets: Preset[], id: string): Partial<MailboxInput> {
  const p = presets.find(x => x.id === id)
  if (!p) return {}
  return { imap_host: p.imap_host, imap_port: p.imap_port, imap_tls: p.imap_tls, smtp_host: p.smtp_host,
    smtp_port: p.smtp_port, smtp_tls: p.smtp_tls, save_sent: p.save_sent }
}

function ServerFields({ label, host, port, tls, onChange }:
  { label: string; host?: string; port?: number; tls?: Tls; onChange: (h: string, p: number, t: Tls) => void }) {
  const h = host || '', p = port || 993, t = tls || 'ssl'
  return (
    <fieldset className="card card-sub col" style={{ gap: 10 }}>
      <legend className="small strong">{label}</legend>
      <label className="field">Serveur<input className="input" required value={h} onChange={e => onChange(e.target.value, p, t)} /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ flex: 1 }}>Port
          <input className="input" type="number" min={1} max={65535} value={p} onChange={e => onChange(h, Number(e.target.value), t)} />
        </label>
        <label className="field" style={{ flex: 1 }}>Chiffrement
          <select className="input" value={t} onChange={e => onChange(h, p, e.target.value as Tls)}>
            <option value="ssl">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">Aucun</option>
          </select>
        </label>
      </div>
    </fieldset>
  )
}

export default function Mailboxes() {
  const boxes = useLoad(getMailboxes)
  const presets = useLoad(getPresets)
  const [editing, setEditing] = useState<Mailbox | 'new' | null>(null)
  const [checks, setChecks] = useState<Record<number, CheckResult | 'busy'>>({})

  const runTest = async (b: Mailbox) => {
    setChecks(c => ({ ...c, [b.id]: 'busy' }))
    try { const r = await testMailbox(b.id); setChecks(c => ({ ...c, [b.id]: r })); boxes.reload() }
    catch (e) { setChecks(c => ({ ...c, [b.id]: { ok: false, error: (e as Error).message } })) }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1>Boîtes mail</h1>
          <p className="muted">Les boîtes que Claude peut lire, et ce qu’il a le droit d’y faire.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!presets.data}>Ajouter une boîte</button>
      </div>
      {boxes.error && <Msg kind="err">{boxes.error}</Msg>}
      {!boxes.data && !boxes.error && <Skeleton n={3} />}
      {boxes.data?.length === 0 && (
        <div className="card empty">
          <h2>Aucune boîte</h2>
          <p className="muted">Ajoutez contact@chapote.fr (Email Pro OVH) puis vos comptes Gmail avec un mot de passe d’application.</p>
        </div>
      )}
      <div className="col" style={{ gap: 10 }}>
        {boxes.data?.map(b => {
          const ck = checks[b.id]
          return (
            <div key={b.id} className={`card box${b.is_active ? '' : ' off'}`}>
              <div className="box-main">
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{b.address}</strong>
                    <code className="chip">{b.slug}</code>
                    {b.preset && <span className="chip chip-soft">{PRESET_LABEL[b.preset] || b.preset}</span>}
                    {!b.is_active && <span className="chip chip-warn">Désactivée</span>}
                  </div>
                  <div className="small muted">
                    {b.allow_send ? 'Envoi permis' : 'Brouillons seulement'} · {b.allow_delete ? 'Corbeille permise' : 'Pas de corbeille'}
                    {' · '}Dernier test : {b.last_check_at ? `${when(b.last_check_at)} ${b.last_check_ok ? '✓' : '✗'}` : 'jamais'}
                  </div>
                  {b.last_check_ok === false && b.last_check_error && !ck && <span className="small danger">{b.last_check_error}</span>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => runTest(b)} disabled={ck === 'busy'}>{ck === 'busy' ? 'Test…' : 'Tester'}</button>
                  <button className="btn btn-sm" onClick={() => setEditing(b)} disabled={!presets.data}>Modifier</button>
                </div>
              </div>
              {ck && ck !== 'busy' && <CheckLine r={ck} />}
            </div>
          )
        })}
      </div>
      {editing && presets.data && (
        <Editor box={editing === 'new' ? null : editing} presets={presets.data} onClose={() => setEditing(null)}
                onSaved={() => { setEditing(null); boxes.reload() }} />
      )}
    </div>
  )
}
