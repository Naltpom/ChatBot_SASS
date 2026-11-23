// Personnes : qui a accès à cet espace, avec quel niveau (Admin, Peut publier, Lecture seule) et à
// quels comptes (tous, ou certains comptes / groupes). Partager se fait aussi depuis Comptes.
import { useState } from 'react'
import { removePerson, updatePerson, type CmRole, type Person, type PersonScope } from '../api'
import { PlatformLogo } from '../components/PlatformLogo'
import { ROLE_CHOICES, ROLE_NAME, ShareSheet } from '../components/ShareSheet'
import { Avatar, Empty, GroupDot, Icon, Msg, Sheet, Skeleton } from '../components/ui'
import { getPeople } from '../api'
import { useLoad, useSession } from '../session'
import { SearchBox, SortControl, useListState } from '../components/list'

function scopeText(p: Person, groupName: (id: number) => string | undefined, accountName: (k: string) => string | undefined) {
  if (p.role === 'admin' || p.scope.all) return 'Tous les comptes'
  const parts = [...p.scope.groups.map(groupName), ...p.scope.accounts.map(accountName)].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Aucun compte'
}

function EditPerson({ p, org, onClose, onSaved }: { p: Person; org: number; onClose: () => void; onSaved: (t: string) => void }) {
  const { groups, accounts } = useSession()
  const [role, setRole] = useState<CmRole>(p.role)
  const [scope, setScope] = useState<PersonScope>(p.scope)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (kind: 'groups' | 'accounts', v: number | string) =>
    setScope(s => {
      const cur = s[kind] as (number | string)[]
      return { ...s, all: false, [kind]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }
    })
  const save = async () => {
    setErr(''); setBusy(true)
    try { await updatePerson(org, p.email, role, scope); onSaved('Accès mis à jour.') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Retirer l’accès de ${p.email} ? Les comptes, le planning et la bibliothèque restent.`)) return
    setBusy(true)
    try { await removePerson(org, p.email); onSaved('Accès retiré.') }
    catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Sheet title={p.name || p.email} onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <fieldset className="col" style={{ gap: 4 }}>
          <legend>Accès</legend>
          {ROLE_CHOICES.map(([v, l, d]) => (
            <label key={v} className="check"><input type="radio" name="p-role" checked={role === v} onChange={() => setRole(v)} /><span><b>{l}</b><br /><span className="field-hint">{d}</span></span></label>
          ))}
        </fieldset>
        {role !== 'admin' && (
          <fieldset className="col" style={{ gap: 6 }}>
            <legend>Comptes</legend>
            <label className="check"><input type="checkbox" checked={scope.all} onChange={e => setScope(s => ({ ...s, all: e.target.checked }))} />Tous les comptes de l’espace</label>
            {!scope.all && (
              <>
                {groups.length > 0 && <div className="chips" role="group" aria-label="Groupes">
                  {groups.map(g => (
                    <button key={g.id} type="button" className="chip chip-sm" aria-pressed={scope.groups.includes(g.id)} onClick={() => toggle('groups', g.id)}>
                      <GroupDot color={g.color} />{g.name}
                    </button>
                  ))}
                </div>}
                <div className="chips" role="group" aria-label="Comptes">
                  {accounts.map(a => {
                    const k = `${a.platform}:${a.id}`
                    return (
                      <button key={k} type="button" className="chip chip-sm" aria-pressed={scope.accounts.includes(k)} onClick={() => toggle('accounts', k)}>
                        <PlatformLogo platform={a.platform} size={14} />{a.name}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </fieldset>
        )}
        {err && <Msg kind="err">{err}</Msg>}
        <div className="row-nw">
          <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>Retirer</button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Enregistrer</button>
        </div>
      </div>
    </Sheet>
  )
}

export default function People() {
  const { org, groups, accounts, visibleSpaces } = useSession()
  const lst = useListState<'added' | 'name' | 'role'>('added', () => 'asc')
  const data = useLoad(() => getPeople(org, { q: lst.q || undefined, sort: lst.sort, order: lst.order }), [org, lst.q, lst.sort, lst.order])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const d = data.data
  const groupName = (id: number) => groups.find(g => g.id === id)?.name
  const accountName = (k: string) => accounts.find(a => `${a.platform}:${a.id}` === k)?.name || undefined
  const space = visibleSpaces.find(s => s.org_id === org)
  const shared = d && (d.people.length > 1 || !!lst.q)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Personnes</h1>
          <p>{space && !space.owner && space.owner_name ? `Espace partagé par ${space.owner_name}. ` : ''}Partagez un compte, un groupe ou tout l’espace avec votre équipe.</p>
        </div>
        {d?.can_manage && <button type="button" className="btn btn-primary" onClick={() => setSharing(true)}><Icon name="plus" />Partager l’espace</button>}
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {data.error && <Msg kind="err">{data.error}</Msg>}
      {!d && data.loading && <Skeleton h={64} n={3} />}
      {d && !shared && (
        <Empty title="Vous êtes seul·e ici" icon="users">
          <p style={{ margin: 0 }}>Pour travailler avec un monteur ou un client : <b>Comptes → Partager</b> sur un compte ou un groupe,
            ou partagez tout l’espace. Vous choisissez : <b>Admin</b>, <b>Peut publier</b> ou <b>Lecture seule</b>.</p>
        </Empty>
      )}
      {d && shared && (
        <div className="listbar">
          <SearchBox value={lst.input} onChange={lst.setInput} label="Rechercher une personne (nom, e-mail)" />
          <span className="sortctl"><SortControl list={lst} options={[['added', 'Ajout'], ['name', 'Nom'], ['role', 'Accès']]} /></span>
        </div>
      )}
      {d && shared && d.people.length === 0 && <p className="muted small" style={{ margin: 0 }}>Personne ne correspond à « {lst.q} ».</p>}
      {d && shared && d.people.length > 0 && (
        <section className="card col" style={{ gap: 4 }}>
          <ul className="list">
            {d.people.map(p => {
              const editable = d.can_manage && !p.you && !p.owner && d.org_id != null
              return (
                <li key={p.email} style={{ flexWrap: 'wrap' }}>
                  <Avatar src={null} name={p.name || p.email} />
                  <div className="grow" style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div className="strong ellipsis">{p.name || p.email}{p.you && <span className="tiny muted"> (vous)</span>}</div>
                    <div className="tiny muted ellipsis">
                      {p.pending ? 'Invitation envoyée · ' : ''}{p.owner ? 'Propriétaire · ' : ''}{scopeText(p, groupName, accountName)}
                    </div>
                  </div>
                  <span className="chip chip-sm">{ROLE_NAME[p.role]}</span>
                  {editable && <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>Modifier</button>}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>Un compte TikTok, YouTube ou Instagram n’est relié qu’à un seul espace Chapote : quand quelqu’un part, les comptes restent ici. Pour confier un compte à quelqu’un d’autre : Comptes → Transférer.</p>
      {sharing && <ShareSheet what={{ all: true }} label="tout l’espace" onClose={() => setSharing(false)} onDone={() => data.reload()} />}
      {editing && d?.org_id != null && (
        <EditPerson p={editing} org={d.org_id} onClose={() => setEditing(null)} onSaved={t => { setEditing(null); setMsg({ kind: 'ok', text: t }); data.reload() }} />
      )}
    </>
  )
}
