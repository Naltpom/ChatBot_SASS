// « Partager » un compte, un groupe ou tout l'espace : une adresse e-mail et un niveau d'accès.
// La personne reçoit l'accès tout de suite si elle a un compte Chapote, sinon une invitation.
import { useState, type FormEvent } from 'react'
import { accountAccess, share, type CmRole, type Person, type ShareWhat } from '../api'
import { useLoad, useSession } from '../session'
import { Avatar, Icon, Msg, Sheet } from './ui'

export const ROLE_CHOICES: [CmRole, string, string][] = [
  ['editor', 'Peut publier', 'Programme, modifie et annule les publications.'],
  ['viewer', 'Lecture seule', 'Voit le planning et les statistiques.'],
  ['admin', 'Admin', 'Tout l’espace : comptes, groupes, personnes.'],
]
export const ROLE_NAME: Record<CmRole, string> = { admin: 'Admin', editor: 'Peut publier', viewer: 'Lecture seule' }

export function ShareSheet({ what, label, onClose, onDone }: { what: ShareWhat; label: string; onClose: () => void; onDone?: (text: string) => void }) {
  const { org, setOrg, refresh, me } = useSession()
  const access = useLoad(() => ('platform' in what ? accountAccess(org, what.platform, what.account_id) : Promise.resolve(null as Person[] | null)), [org, JSON.stringify(what)])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CmRole>('editor')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true)
    try {
      const r = await share(org, email.trim(), role, what)
      const text = r.message || (r.invited
        ? `Invitation envoyée à ${email.trim()} : l’accès s’ouvrira à son inscription.`
        : `${email.trim()} a maintenant accès à ${label}.`)
      if (r.org_id !== org) { await refresh(); setOrg(r.org_id) }
      setEmail(''); setOk(text); access.reload(); onDone?.(text)
    } catch (ex) { setErr((ex as Error).message) } finally { setBusy(false) }
  }
  const people = (access.data || []).filter(p => p.email !== me?.email)
  return (
    <Sheet title={`Partager ${label}`} onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <label className="field">Adresse e-mail
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="prenom@exemple.fr" autoCapitalize="none" />
        </label>
        <fieldset className="col" style={{ gap: 4 }}>
          <legend>Accès</legend>
          {ROLE_CHOICES.map(([v, l, d]) => (
            <label key={v} className="check"><input type="radio" name="share-role" checked={role === v} onChange={() => setRole(v)} />
              <span><b>{l}</b><br /><span className="field-hint">{v === 'admin' ? d : `${d} Seulement ${label}.`}</span></span></label>
          ))}
        </fieldset>
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn grow" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary grow" disabled={busy || !email.trim()}><Icon name="users" size={16} />Partager</button>
        </div>
        {people.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <span className="small strong">Ont déjà accès</span>
            <ul className="list">
              {people.map(p => (
                <li key={p.email}>
                  <Avatar src={null} name={p.name || p.email} size="sm" />
                  <span className="grow ellipsis small">{p.name || p.email}{p.pending && <span className="tiny muted"> · invitation envoyée</span>}</span>
                  <span className="tiny muted">{ROLE_NAME[p.role]}{p.scope.all && p.role !== 'admin' ? ' · tout' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>Gérer ou retirer un accès : page Personnes.</p>
      </form>
    </Sheet>
  )
}
